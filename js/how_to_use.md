# Ultimate LTX — how to use

Four windows, left to right: **1 Setup → 2 Director → 3 Seeds → 4 Output**. The step bar at the top of every window jumps to the others. The small nodes the windows edit sit behind them: move a window to reach one. A workflow laid out before is tidied once when it opens (**Tidy the canvas** under Look in Setup does it again). A Director from an older workflow opens in its classic editor: **Show as window** under it brings the window.

**Updates:** [github.com/stuubszzz/Stubelius-Ultimate-LTX2.5](https://github.com/stuubszzz/Stubelius-Ultimate-LTX2.5) · ComfyUI Manager → Update All, or `git pull` in custom_nodes/Stubelius-Ultimate-LTX2.5. **Live preview:** put the tiny LTX VAE (`taeltx2_5`) in models/vae and pick it under Models in Setup.

## 1 · SETUP — how the seeds are rendered
- **Mode** — **Full size**: the seeds render at the Director's size and the winner is finished as rendered, with real HD detail. **Draft**: half-size seeds for quick looks; the winner is upscaled ×2 in latent space and refined, which can't add the detail a half-size render never had. **Low VRAM**: Draft with the memory savers on, for smaller cards. Steps, first pass and cfg are under the cards: 8 steps at cfg 1 is the official distilled first pass.
- **Seeds to compare** — how many full videos, with sound, to render: 1–4. Seed 1 is the seed (in Setup, and on the Director's command bar); seeds 2–4 add 1000003 each.
- **Sampler per seed** — euler_ancestral with linear_quadratic is the official first pass (linear_quadratic at 8 steps is Lightricks' distilled sigmas); give another seed another sampler for variety.
- **Models** — the LTX 2.5 checkpoint (safetensors or GGUF), the Gemma 4 text encoder, video and audio VAE, latent upscaler ×2 and live preview. Each card shows the precision, the size and whether the file is on disk.
- **LoRAs** — the **distilled LoRA** only for a dev checkpoint (the Stubelius remix has it baked in), the **IC-LoRA** for the Director's motion clips, the **MSR LoRA** for Licon MSR references (LTX-2.5-Licon-MSR-V2), two **global LoRAs**.
- **Video memory**, **Performance** (attention, memory-efficient attention, chunked feed-forward, decode tile size) and **Look** (six themes, **Tidy the canvas**).
- Changing anything here **re-renders** the seeds.

## 2 · DIRECTOR — what the video is
- **Top:** references (none, Licon MSR or Ghost Mask), size, length, frame rate, seed, the Setup mode, the model and the output, **Render**.
- **Keyframes** — the picture the video opens on (**First frame**), pictures it passes through at a second and the picture it ends on (**Last frame**, the video's real last frame: LTX renders 8n+1 frames). Drop pictures on the lane or click **+** for one at the playhead; drag a middle one along; click one for its card.
- **Prompts** — the video in segments, each with its own prompt (**Prompt relay**): drag the cut between two, **+** cuts the one under the playhead. A segment can carry a **picture** on its first or last frame, or a **video** clip whose frames guide it (its sound goes on the Audio lane). An empty segment takes the global prompt.
- **Motion** — pose, depth or edge videos: with the IC-LoRA (Union Control) picked in Setup they move the picture along. **Audio** — voice lines and music at their second; **LTX fills the gaps** with sound, or switch it off. Switch **Your sounds** off and LTX makes all the sound.
- **Inspector** (what you picked): a segment's prompt (a spoken line goes in quotes), its picture or clip and **Guide strength**; a keyframe's second; a motion clip's strength and attention; a sound's start and trim. Under it the **Global** prompt (who, where, the look), the sound and the motion.
- **Seeds** — the seeds of the last render: point at one to see it in the preview, click one to pick it as the winner. **New seed** renders again with a new seed; **Hunt** renders 2, 3 or 4 new seeds at once (the arrow picks how many).
- **References** — **Licon MSR**: the **Cast** below holds five references (@ref1–@ref5), each from 1–3 pictures and a short label; write @ref1 in a prompt where it should be. MSR uses the pictures of the references your prompts name (all of them when none is named), up to five. It needs the MSR LoRA in Setup.
- **Settings** (the gear): Prompt relay on or off, how pictures are fitted and compressed, where the render starts, the reference strength and MSR frames, the model that writes a reference's label, **Retake a part of a video**, the upload folder and the **Classic editor**.

## 3 · SEEDS — pick the winner
All the seeds side by side, in sync. **Solo** a seed's sound, **A/B split**, **Full size**. A nearly silent seed gets a hint: your eye picks. **Pick** the winner, then **Finish the winner**: only the finish runs, the seeds come from cache. **Hunt** renders new seeds and holds after them.

## 4 · OUTPUT — what comes out
- The winner against the finished video: drag the divider, **Loupe** for the detail; the finish step by step.
- **Final size** — native (the Director's size) or 720p–4K; the short side lands exactly on the number, portrait too. 4K holds ≈100 MB of RAM per frame: keep 4K clips short, especially at 48–60 fps.
- **Frame rate** — the rendered rate (untouched) up to 120; above it RIFE draws the frames in between, length and sync kept.
- **Upscaler** — RTX VSR, or DLSS5 + Color Lock (more detail, original colours).
- **Refine** — Draft and Low VRAM only: strength, steps and sampler of the full-size refine. 0.3–0.45 keeps the seed's look. **MSR in the refine** — with Licon MSR: the LoRA's strength there and how hard the references pull (about 0.4 keeps the detail without the references repainting the opening).
- **Sound of the winner** — keep it as you heard it, or let the refine make it again.
- **After a render with one seed** — wait for your pick, or finish it right away.
- **Export** — the file, its size and loudness, **Open folder**. **Last frame** — **Save** it to start the next video from it.
- Changing anything here **never re-renders** the seeds: only the finish runs again.

## 5 · GOOD TO KNOW
- **Render stops after the seeds:** pick one in Seeds (or in the Director), then **Finish the winner**. One seed with **Finish it right away** (Output) goes straight on.
- **A spoken line:** write it in quotes in the segment's prompt. A voice recording on the Audio lane gives the exact words; the prompt still tells LTX someone is talking.
- **The last frame doesn't match the picture:** use **Last frame** on the Keyframes lane, which pins it to the video's real last frame.
- **A segment without a prompt** takes the global prompt; with Prompt relay off only the global prompt is used.
- **Licon MSR:** three views of one character (front, side, back) and a 3–5 word label; mention the character with @ref1 in the prompt. MSR is trained at 50 fps: the Director suggests it when another rate is set.
- **Uploads:** pictures, clips and sounds go to input/cglide; render when an upload is done.
