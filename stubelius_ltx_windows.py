"""Stubelius Ultimate LTX: the server side of the four windows (js/ulx_*.js).

Seed Previews  writes each seed of a run as a small mp4 with its sound (output/StubeliusLTX/previews) and hands
               the list to the Seeds and Director windows. It reads the Seeds node's takes, so it runs with the
               seeds and comes from cache when only the finish runs.
finish_stage   tells the Output window where the finish is (winner, refine, frame rate, upscale, done).
seed_stage     tells the Director window which seed is sampling.
Routes         the Setup window's model sizes and the Output window's Open folder.
"""
import logging
import os
import re
import time

import folder_paths
import torch

log = logging.getLogger(__name__)

PREVIEWS = ("StubeliusLTX", "previews")     # in the output folder: one mp4 per seed, overwritten by the next run
QUIET_DBFS = -45.0                          # a seed whose loudest second stays under this is flagged as silent


def write_mp4(path, frames, audio=None, fps=25.0, max_width=None, crf=20):
    """frames (IMAGE) and their sound as an H.264 + AAC mp4 (even size, at most max_width wide)."""
    import av
    from fractions import Fraction
    height, width = int(frames.shape[1]), int(frames.shape[2])
    pw = width if not max_width else min(int(max_width), width)
    pw = max(2, pw // 2 * 2)
    ph = max(2, round(height * pw / width) // 2 * 2)
    with av.open(path, "w", options={"movflags": "+faststart"}) as out:
        video = out.add_stream("libx264", rate=Fraction(fps).limit_denominator(1001))
        video.width, video.height, video.pix_fmt = pw, ph, "yuv420p"
        video.options = {"crf": str(crf), "preset": "veryfast"}
        sound = wave = None
        if audio is not None and audio.get("waveform") is not None and audio["waveform"].shape[-1] > 0:
            rate = int(audio["sample_rate"])
            wave = audio["waveform"][0].detach().cpu().float()[:2]
            wave = wave[:, :int(round(frames.shape[0] / fps * rate)) + rate // 10]
            layout = "mono" if wave.shape[0] == 1 else "stereo"
            sound = out.add_stream("aac", rate=rate, layout=layout)
        for i in range(0, int(frames.shape[0]), 16):
            part = frames[i:i + 16].detach().cpu()
            if (pw, ph) != (width, height):
                part = torch.nn.functional.interpolate(part.movedim(-1, 1), size=(ph, pw), mode="area").movedim(1, -1)
            for frame in part.mul(255.0).round_().clamp_(0, 255).to(torch.uint8).numpy():
                out.mux(video.encode(av.VideoFrame.from_ndarray(frame, format="rgb24")))
        out.mux(video.encode(None))
        if sound is not None and wave.shape[-1] > 0:
            frame = av.AudioFrame.from_ndarray(wave.clamp(-1, 1).contiguous().numpy(), format="fltp", layout=layout)
            frame.sample_rate, frame.pts = rate, 0
            out.mux(sound.encode(frame))
            out.mux(sound.encode(None))


def open_in_file_manager(path):
    import subprocess
    import sys
    if sys.platform.startswith("win"):
        os.startfile(path)                  # a folder inside the output folder, see the route
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


def _send(event, data):
    try:
        from server import PromptServer
        send = getattr(PromptServer.instance, "send_sync", None)
        if send is not None:
            send(event, data)
    except Exception:
        pass


def finish_stage(node, stage, **info):
    """Tell the Output window where the finish is: hold, start, refine, fps, upscale, done."""
    _send("stubelius_ultimate_ltx.finish", dict(info, node=node, stage=stage))


def seed_stage(node, candidate, of, seed):
    """Tell the Director window which seed is sampling (candidate k of n)."""
    _send("stubelius_ultimate_ltx.seed", {"node": node, "candidate": candidate, "of": of, "seed": seed})


def _seed_flags(audio):
    """Hints for the Seeds window, never a ranking: a nearly silent seed."""
    flags = []
    wave = (audio or {}).get("waveform")
    rate = int((audio or {}).get("sample_rate") or 0)
    if torch.is_tensor(wave) and wave.numel() and rate:
        w = wave[0].float().mean(dim=0)
        n = w.shape[-1] // rate
        if n:
            loudest = float(w[:n * rate].reshape(n, rate).pow(2).mean(dim=1).sqrt().max())
            if loudest < 10 ** (QUIET_DBFS / 20):
                flags.append({"kind": "sound", "text": "Nearly silent"})
    return flags


class StubeliusLTXSeedPreviews:
    """Every seed of the run as a small mp4 with its sound, for the Seeds and Director windows. Reads the
    Seeds node's takes: it runs with the seeds and comes from cache when only the finish changes."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"takes": ("LTX_TAKES",)}, "hidden": {"unique_id": "UNIQUE_ID"}}

    RETURN_TYPES = ()
    FUNCTION = "run"
    CATEGORY = "StubeliusLTX"
    OUTPUT_NODE = True          # it shows the seeds itself, with or without preview nodes after it

    def run(self, takes, unique_id=None):
        out_dir = folder_paths.get_output_directory()
        folder = os.environ.get("STUBELIUS_LTX_PREVIEWS_DIR") or os.path.join(out_dir, *PREVIEWS)
        # the windows play the previews through ComfyUI's /view, which serves the output folder only
        try:
            sub = os.path.relpath(folder, out_dir).replace("\\", "/")
        except ValueError:                       # another drive
            sub = ".."
        if sub == ".." or sub.startswith("../"):
            log.warning("[StubeliusLTXSeedPreviews] STUBELIUS_LTX_PREVIEWS_DIR is outside the output folder: the "
                        "windows can only play from inside it, so the previews go to the default folder")
            folder, sub = os.path.join(out_dir, *PREVIEWS), "/".join(PREVIEWS)
        prefix = re.sub(r"[^A-Za-z0-9_-]", "", f"node{unique_id or ''}") or "seeds"
        fps = float(takes.get("fps") or 25.0)
        samplers = list(takes.get("samplers") or [])
        seeds = list(takes.get("seeds") or [])
        times = list(takes.get("seconds") or [])
        shown = []
        for i, (images, audio) in enumerate(list(takes.get("decoded") or [])[:4]):
            if images is None or images.shape[0] < 1:
                continue
            name = f"{prefix}_seed{i + 1}.mp4"
            try:
                os.makedirs(folder, exist_ok=True)
                write_mp4(os.path.join(folder, name), images, audio, fps=fps, crf=20)
            except Exception as e:
                log.warning("[StubeliusLTXSeedPreviews] seed %d: no preview video (%s)", i + 1, e)
                continue
            sampler, scheduler = samplers[i] if i < len(samplers) else ("", "")
            shown.append({"filename": name, "subfolder": "" if sub == "." else sub, "type": "output", "candidate": i + 1,
                          "frames": int(images.shape[0]), "seconds": round(int(images.shape[0]) / fps, 3), "fps": fps,
                          "width": int(images.shape[2]), "height": int(images.shape[1]),
                          "seed": int(seeds[i]) if i < len(seeds) else None, "sampler": sampler, "scheduler": scheduler,
                          "scale": float(takes.get("scale", 1.0)),
                          "render_seconds": round(times[i], 1) if i < len(times) and times[i] else None,
                          "flags": _seed_flags(audio), "v": int(time.time() * 1000)})
        return {"ui": {"stubelius_ltx_seeds": shown}}


def _routes():
    try:
        import asyncio
        from aiohttp import web
        from server import PromptServer
        routes = PromptServer.instance.routes
    except Exception:
        return

    async def off_loop(fn, *args):
        return await asyncio.get_running_loop().run_in_executor(None, fn, *args)

    async def body_of(request):
        """The request's JSON object, or None for anything else (the route then answers 400)."""
        try:
            body = await request.json()
        except Exception:
            return None
        return body if isinstance(body, dict) else None

    # The Setup window's model cards: each file's size (folder = a ComfyUI model folder name)
    @routes.post("/stubelius_ultimate_ltx/model_info")
    async def _model_info(request):
        body = await body_of(request)
        if body is None:
            return web.Response(status=400)

        def sizes():
            out = []
            for item in (body.get("items") or [])[:32]:
                if not (isinstance(item, (list, tuple)) and len(item) == 2):
                    continue
                folder, name = item
                size = None
                try:
                    path = folder_paths.get_full_path(str(folder), str(name))
                    size = os.path.getsize(path) if path else None
                except Exception:
                    pass
                out.append({"folder": folder, "name": name, "size": size, "found": size is not None})
            return out
        return web.json_response({"items": await off_loop(sizes)})

    # The Output window's Open folder: a folder inside ComfyUI's output folder, in the file manager of the
    # machine ComfyUI runs on, and only for a browser on that same machine.
    @routes.post("/stubelius_ultimate_ltx/open_folder")
    async def _open_folder(request):
        if request.remote not in ("127.0.0.1", "::1", "localhost"):
            return web.json_response({"opened": False, "why": "only from the machine ComfyUI runs on"}, status=403)
        body = await body_of(request)
        if body is None:
            return web.Response(status=400)
        top = os.path.abspath(folder_paths.get_output_directory())
        path = os.path.abspath(os.path.join(top, str(body.get("subfolder") or "")))
        try:
            inside = os.path.commonpath([path, top]) == top
        except ValueError:                       # another drive
            inside = False
        if not inside or not os.path.isdir(path):
            return web.json_response({"opened": False, "why": "not a folder in the output folder"}, status=400)
        await off_loop(open_in_file_manager, path)
        return web.json_response({"opened": True})


_routes()

NODE_CLASS_MAPPINGS = {"StubeliusLTXSeedPreviews": StubeliusLTXSeedPreviews}
NODE_DISPLAY_NAME_MAPPINGS = {"StubeliusLTXSeedPreviews": "Stubelius LTX Seed Previews"}
