"""Stubelius MSR25 engine — LTX-2.5 Licon MSR injection for the Director guide.

Ports the slot-embedding reference convention from liconstudio/ComfyUI-LTX2.5-MSR
(learned Fourier-MLP slot embeddings + consecutive negative temporal offsets,
reference tokens appended as keyframes) into the Director pipeline. Replaces the
LTX-2.3 slideshow-prefix engine, which 2.5 was never trained on.

AVref LoRAs (Licon MSR V2) also carry audio slot embeddings: a character's voice clip
becomes reference audio tokens in that character's slot window, so the model speaks
new lines in that voice instead of playing the clip.
"""

import logging
import types

import torch

import comfy.sd
import comfy.utils
import comfy_extras.nodes_lt as nodes_lt
import folder_paths
import node_helpers
from comfy.patcher_extension import CallbacksMP

log = logging.getLogger("LTXDirector")

_SLOT_PREFIXES = (
    "diffusion_model.reference_slot_embedding.",
    "reference_slot_embedding.",
)
_AUDIO_SLOT_PREFIXES = (
    "diffusion_model.reference_audio_slot_embedding.",
    "reference_audio_slot_embedding.",
)
_REQUIRED_SLOT_KEYS = {
    "frequencies",
    "net.0.weight",
    "net.0.bias",
    "net.2.weight",
    "net.2.bias",
}
_VOICE_LAYOUT = "stubelius_msr25_voice_slots"
_VOICE_PATCH_PATH = "diffusion_model._process_input"
_VOICE_PATCH_MARKER = "_stubelius_msr25_voice_patch"
_VOICE_REBIND_KEY = "stubelius_msr25_voice_rebind"


def _extract_slot_state(lora):
    """Split an MSR LoRA into (normal LoRA weights, image slot state, audio slot state)."""
    state, audio_state, normal = {}, {}, {}
    for key, value in lora.items():
        for prefixes, target in ((_SLOT_PREFIXES, state), (_AUDIO_SLOT_PREFIXES, audio_state)):
            prefix = next((p for p in prefixes if key.startswith(p)), None)
            if prefix:
                target[key[len(prefix):]] = value.detach().cpu()
                break
        else:
            normal[key] = value
    return normal, state, audio_state


def _slot_embedding(slot_id, state, device, dtype):
    frequencies = state["frequencies"].to(device=device, dtype=torch.float32)
    slot_value = torch.tensor(float(slot_id), device=device, dtype=torch.float32)
    scaled = slot_value / 16.0
    phases = scaled * frequencies
    features = torch.cat((scaled.reshape(1), torch.sin(phases), torch.cos(phases)))
    w0 = state["net.0.weight"].to(device=device, dtype=torch.float32)
    b0 = state["net.0.bias"].to(device=device, dtype=torch.float32)
    hidden = torch.nn.functional.silu(torch.nn.functional.linear(features, w0, b0))
    w2 = state["net.2.weight"].to(device=device, dtype=torch.float32)
    b2 = state["net.2.bias"].to(device=device, dtype=torch.float32)
    return torch.nn.functional.linear(hidden, w2, b2).to(dtype=dtype)


def load_msr25_lora(model, lora_name, strength_model):
    """Load an LTX-2.5 MSR LoRA (model-only) and return (model, slot_state, voice_slots, downscale).
    voice_slots is None unless the LoRA is an AVref one with audio slot embeddings."""
    lora_path = folder_paths.get_full_path_or_raise("loras", lora_name)
    lora, metadata = comfy.utils.load_torch_file(lora_path, safe_load=True, return_metadata=True)
    metadata = metadata or {}
    normal_lora, slot_state, audio_state = _extract_slot_state(lora)
    missing = sorted(_REQUIRED_SLOT_KEYS.difference(slot_state))
    if not slot_state or missing:
        raise ValueError(
            f"'{lora_name}' is not an LTX-2.5 MSR checkpoint "
            f"(missing reference_slot_embedding tensors{': ' + ', '.join(missing) if missing else ''}). "
            "Use the Licon LTX-2.5 MSR LoRA here; union control stays in ic_lora_name."
        )
    if metadata.get("reference_token_order", "prepend") != "prepend":
        raise ValueError("Unsupported reference_token_order; expected 'prepend'.")
    offsets = metadata.get("reference_slot_time_offsets", "pic1_based_negative_time")
    if offsets != "pic1_based_negative_time":
        raise ValueError("Unsupported reference_slot_time_offsets; expected 'pic1_based_negative_time'.")
    if model is not None and strength_model != 0:
        model, _ = comfy.sd.load_lora_for_models(model, None, normal_lora, strength_model, 0, lora_metadata=metadata)
    voice_slots = None
    if audio_state:
        missing = sorted(_REQUIRED_SLOT_KEYS.difference(audio_state))
        if missing:
            raise ValueError(f"'{lora_name}' has an incomplete reference_audio_slot_embedding: {', '.join(missing)}.")
        voice_slots = {
            "state": audio_state,
            "duration": float(metadata.get("reference_audio_slot_duration_seconds", 5.0)),
            "margin": float(metadata.get("reference_audio_end_margin_seconds", 0.04)),
        }
    downscale = max(1, round(float(metadata.get("reference_downscale_factor", 1))))
    log.info("[Stubelius MSR25] Loaded %s (slot tensors=%d, voice slots=%s, downscale=%d)",
             lora_name, len(slot_state), "yes" if voice_slots else "no", downscale)
    return model, slot_state, voice_slots, downscale


def _append_attention_entry(conditioning, pre_filter_count, latent_shape, strength):
    existing = None
    for _, values in conditioning:
        if "guide_attention_entries" in values:
            existing = values["guide_attention_entries"]
            break
    existing = existing or []
    entry = {
        "pre_filter_count": pre_filter_count,
        "strength": strength,
        "pixel_mask": None,
        "latent_shape": latent_shape,
    }
    return node_helpers.conditioning_set_values(
        conditioning, {"guide_attention_entries": [*existing, entry]}
    )


def inject_msr25(positive, negative, vae, latent_image, noise_mask, slot_state,
                 references, strength, reference_frames, downscale=1):
    """Append MSR references as slot-embedded keyframes at negative temporal positions.

    references: list of (label, IMAGE[1,H,W,C], is_background). Returns
    (positive, negative, latent_image, noise_mask, appended_latent_frames).
    """
    if latent_image.ndim != 5 or latent_image.shape[1] != 128:
        raise ValueError("MSR25 needs a video-only LTX latent [B, 128, F, H, W] (before AV concat).")
    if latent_image.shape[0] != 1:
        raise ValueError("MSR25 inference requires batch_size=1.")
    reference_frames = int(reference_frames)
    if reference_frames not in (25, 33):
        reference_frames = 33
    num_slots = len(references)
    if not 1 <= num_slots <= 5:
        raise ValueError(f"MSR25 requires 1-5 references, got {num_slots}.")

    scale_factors = vae.downscale_index_formula
    _, _, _, latent_height, latent_width = latent_image.shape
    if latent_height % downscale or latent_width % downscale:
        raise ValueError(
            f"Latent grid {latent_width}x{latent_height} not divisible by reference_downscale_factor={downscale}."
        )

    frames_before = int(latent_image.shape[2])
    log.info(
        "[Stubelius MSR25] Inject start: references=%d, reference_frames=%d, downscale=%d, target_latent=%s",
        num_slots, reference_frames, downscale, tuple(latent_image.shape),
    )

    for slot_index, (label, image, is_background) in enumerate(references):
        slot_id = slot_index + 1
        if image.shape[0] != 1:
            image = image[:1]
        repeated = image.repeat(reference_frames, 1, 1, 1)
        _, guide_latent = nodes_lt.LTXVAddGuide.encode(
            vae, latent_width, latent_height, repeated, scale_factors, downscale
        )
        embedding = _slot_embedding(slot_id, slot_state, guide_latent.device, guide_latent.dtype)
        if embedding.numel() != guide_latent.shape[1]:
            raise ValueError(
                f"Slot embedding dim {embedding.numel()} != latent channels {guide_latent.shape[1]}."
            )
        guide_latent = guide_latent + embedding.view(1, -1, 1, 1, 1)
        original_shape = list(guide_latent.shape[2:])

        guide_mask = None
        if downscale > 1:
            guide_latent, guide_mask = nodes_lt.LTXVAddGuide.dilate_latent(guide_latent, downscale)

        frame_offset = -(num_slots - slot_index)
        positive, negative, latent_image, noise_mask = nodes_lt.LTXVAddGuide.append_keyframe(
            positive, negative, frame_offset, latent_image, noise_mask, guide_latent,
            strength, scale_factors, guide_mask=guide_mask,
            latent_downscale_factor=downscale, causal_fix=True,
        )
        token_count = guide_latent.shape[2] * guide_latent.shape[3] * guide_latent.shape[4]
        positive = _append_attention_entry(positive, token_count, original_shape, strength)
        negative = _append_attention_entry(negative, token_count, original_shape, strength)
        log.info(
            "[Stubelius MSR25] %s: slot_id=%d, time_offset=%d, guide_latent=%s",
            label, slot_id, frame_offset, tuple(guide_latent.shape),
        )

    appended = int(latent_image.shape[2]) - frames_before
    log.info(
        "[Stubelius MSR25] Inject complete: added=%d refs (%d latent frames), output_latent=%s",
        num_slots, appended, tuple(latent_image.shape),
    )
    return positive, negative, latent_image, noise_mask, appended


def _voice_process_input(original):
    """Wrap the LTX AV model's _process_input. The native ref_audio path puts all reference
    audio just before t=0 (the ID-LoRA layout); AVref was trained with each voice ending at
    the end of its image slot's window: -(image_slot_count - slot_id) * duration - margin."""
    needs_model = isinstance(original, types.MethodType)
    original_fn = original.__func__ if needs_model else original

    def process_input(diffusion_model, x, keyframe_idxs, denoise_mask, **kwargs):
        args = (diffusion_model, x, keyframe_idxs, denoise_mask) if needs_model else (x, keyframe_idxs, denoise_mask)
        latents, positions, additional_args = original_fn(*args, **kwargs)
        ref_audio = kwargs.get("ref_audio")
        if not isinstance(ref_audio, dict) or ref_audio.get("layout") != _VOICE_LAYOUT:
            return latents, positions, additional_args

        vx, ax = latents
        video_positions, audio_positions = positions
        ref_len = sum(ref_audio["slot_lengths"])
        ref_positions = []
        for slot_id, length in zip(ref_audio["slot_ids"], ref_audio["slot_lengths"]):
            _, local = diffusion_model.a_patchifier.patchify(
                torch.empty((ax.shape[0], 1, length, 1), device=ax.device, dtype=torch.float32))
            slot_end = -(ref_audio["image_slot_count"] - slot_id) * ref_audio["slot_duration"] - ref_audio["end_margin"]
            ref_positions.append((local + (slot_end - local[:, :, -1:, 1:2])).to(audio_positions))
        audio_positions = torch.cat([*ref_positions, audio_positions[:, :, ref_len:]], dim=2)
        return [vx, ax], [video_positions, audio_positions], additional_args

    setattr(process_input, _VOICE_PATCH_MARKER, True)
    return process_input


def _rebind_voice_patch(source, clone):
    """A clone that deep-copies the model would keep the patch bound to the old diffusion model."""
    if source.model is clone.model:
        return
    patch = clone.object_patches.get(_VOICE_PATCH_PATH)
    if getattr(getattr(patch, "__func__", None), _VOICE_PATCH_MARKER, False):
        clone.object_patches[_VOICE_PATCH_PATH] = types.MethodType(
            patch.__func__, clone.get_model_object("diffusion_model"))


def _max_voice_tokens(patchifier, seconds):
    token_seconds = patchifier.hop_length * patchifier.audio_latent_downsample_factor / patchifier.sample_rate
    ends = patchifier._get_audio_latent_time_in_sec(1, int(seconds / token_seconds) + 9, torch.float32, torch.device("cpu"))
    return max(1, int((ends <= seconds + 1e-6).sum().item()))


def attach_voices(model, positive, negative, voices, voice_slots, image_slot_count):
    """Give characters their voice. voices: [(slot_id, audio latent [1, C, T, F])], slot_id
    being the MSR image slot of that character. The clips are reference tokens only (timestep
    0, stripped from the output); what is said comes from the prompt."""
    if voice_slots is None:
        raise ValueError("A character has a voice clip, but the MSR LoRA has no voice (audio reference) slots. "
                         "Use an AVref MSR LoRA such as LTX-2.5-Licon-MSR-V2, or remove the voice.")
    model = model.clone()
    diffusion_model = model.get_model_object("diffusion_model")
    current = model.get_model_object(_VOICE_PATCH_PATH)
    if not getattr(getattr(current, "__func__", current), _VOICE_PATCH_MARKER, False):
        model.add_object_patch(_VOICE_PATCH_PATH, types.MethodType(_voice_process_input(current), diffusion_model))
    if not model.get_callbacks(CallbacksMP.ON_CLONE, _VOICE_REBIND_KEY):
        model.add_callback_with_key(CallbacksMP.ON_CLONE, _VOICE_REBIND_KEY, _rebind_voice_patch)

    max_tokens = _max_voice_tokens(diffusion_model.a_patchifier, voice_slots["duration"])
    blocks = []
    for slot_id, latent in voices:
        b, c, t, f = latent.shape
        tokens = latent.permute(0, 2, 1, 3).reshape(b, t, c * f)[:, :max_tokens]
        embedding = _slot_embedding(slot_id, voice_slots["state"], tokens.device, tokens.dtype)
        blocks.append(tokens + embedding.view(1, 1, -1))
        log.info("[Stubelius MSR25] voice for slot %d: %d tokens (%.2fs)", slot_id, tokens.shape[1],
                 tokens.shape[1] * voice_slots["duration"] / max_tokens)
    ref_audio = {
        "layout": _VOICE_LAYOUT,
        "tokens": torch.cat(blocks, dim=1),
        "slot_ids": tuple(slot_id for slot_id, _ in voices),
        "slot_lengths": tuple(block.shape[1] for block in blocks),
        "image_slot_count": int(image_slot_count),
        "slot_duration": voice_slots["duration"],
        "end_margin": voice_slots["margin"],
    }
    positive = node_helpers.conditioning_set_values(positive, {"ref_audio": ref_audio})
    negative = node_helpers.conditioning_set_values(negative, {"ref_audio": ref_audio})
    return model, positive, negative
