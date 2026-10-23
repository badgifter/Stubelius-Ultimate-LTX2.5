// Stubelius Ultimate LTX Director: the big preview.
//
// It plays the latest seeds (the Seed Previews node writes one video per seed): the winner, else the first, or the
// seed you point at; while the seeds render, the live sampling frames (a live preview model in Setup) or a note.
// Under it: play, the time, a scrub bar with the segments (the picked one lit) and a chip per seed.
import { h, icon, clear, fmtClock } from "./ulx_ui.js";
import { viewUrl, blockPicture } from "./ulx_media.js";

function b64ToBlob(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const CSS = `
.slx-d .d-preview{position:relative;border-radius:24px;overflow:hidden;border:1px solid var(--stroke2);box-shadow:var(--panel-shadow);
  background:var(--video);min-height:620px;isolation:isolate}
.slx-d .d-pv-bg{position:absolute;inset:-40px;background-size:cover;background-position:center;filter:blur(36px) saturate(1.3) brightness(.55);
  transform:scale(1.1);z-index:0}
.slx-d .d-pv-video,.slx-d .d-pv-live{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1;display:none;background:transparent}
.slx-d .d-vig{position:absolute;inset:0;z-index:2;pointer-events:none;
  background:linear-gradient(180deg,rgba(0,0,0,.35) 0%,transparent 22%,transparent 62%,rgba(5,4,10,.92) 100%)}
.slx-d .d-pv-tl{position:absolute;left:20px;top:18px;display:flex;gap:8px;z-index:3;flex-wrap:wrap;right:120px}
.slx-d .d-pv-tr{position:absolute;right:18px;top:18px;display:flex;gap:8px;z-index:3}
.slx-d .d-pv-tr .slx-gchip{padding:8px 10px;border:1px solid rgba(255,255,255,.16);color:#f3f1f8}
.slx-d .d-pv-tl .slx-gchip{color:#f3f1f8;display:flex;align-items:center;gap:7px}
.slx-d .d-pv-empty{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
  text-align:center;padding:40px;color:#f3f1f8}
.slx-d .d-pv-empty .slx-muted{max-width:460px;color:rgba(243,241,248,.7)}
.slx-d .d-pv-empty-ic{width:76px;height:76px;border-radius:22px;display:grid;place-items:center;background:rgba(255,255,255,.08);
  border:1px solid rgba(255,255,255,.16);color:rgba(255,255,255,.85);backdrop-filter:blur(10px)}
.slx-d .d-controls{position:absolute;left:22px;right:22px;bottom:70px;display:flex;align-items:center;gap:14px;color:#f3f1f8;z-index:3}
.slx-d .d-play{width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.92);color:#120a12;display:grid;place-items:center;border:0;
  box-shadow:0 10px 30px rgba(0,0,0,.45);flex:none;padding:0}
.slx-d .d-play:hover{transform:scale(1.05)}
.slx-d .d-time{font-family:var(--fh);font-size:16px;font-weight:600;white-space:nowrap}
.slx-d .d-time span{color:#9d9aae;font-weight:500}
.slx-d .d-scrub{flex:1;height:34px;position:relative;cursor:pointer}
.slx-d .d-sg{position:absolute;top:12px;height:10px;border-radius:6px;background:rgba(255,255,255,.4)}
.slx-d .d-sg.on{background:var(--brand);box-shadow:0 0 16px rgba(var(--ac),.6)}
.slx-d .d-knob{position:absolute;top:5px;width:24px;height:24px;border-radius:50%;background:#fff;pointer-events:none;
  box-shadow:0 0 0 5px rgba(var(--ac),.35),0 0 24px rgba(var(--ac),.8)}
.slx-d .d-seedrow{position:absolute;left:22px;right:22px;bottom:18px;display:flex;gap:8px;z-index:3;align-items:center}
.slx-d .d-seedchip{display:flex;align-items:center;gap:7px;padding:7px 12px;border-radius:11px;background:rgba(10,8,16,.5);
  backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.16);color:#f3f1f8;font-weight:600;font-size:12.5px}
.slx-d .d-seedchip:hover{border-color:rgba(255,255,255,.35)}
.slx-d .d-seedchip.on{border-color:rgba(var(--ac),.8);box-shadow:0 0 18px rgba(var(--ac),.35)}
.slx-d .d-seedchip .slx-ic{color:rgb(var(--ac))}
.slx-d .d-seedchip i{font-style:normal;color:#9d9aae;font-weight:500}
.slx-d .d-seedrow.busy{opacity:.35;pointer-events:none}
.slx-d .d-pv-spin{width:34px;height:34px;border-width:3px}
.slx-d .d-live-dot{width:8px;height:8px;border-radius:50%;background:#ff4d6a;box-shadow:0 0 10px #ff4d6a;animation:slx-pulse 1s infinite}
`;
let styled = false;

export function buildPreview(d) {
  if (!styled) {
    styled = true;
    document.head.appendChild(h("style", { id: "stubelius-ultx-preview", text: CSS }));
  }
  const video = h("video.d-pv-video", { playsInline: true, preload: "metadata" });
  video.muted = !!d.node.properties?.slx_muted;
  const live = h("img.d-pv-live");
  const liveVideo = h("video.d-pv-live", { muted: true, loop: true, autoplay: true, playsInline: true });
  liveVideo.muted = true;
  const bg = h("div.d-pv-bg");
  const empty = h("div.d-pv-empty");
  const tl = h("div.d-pv-tl");
  const muteBtn = h("button.slx-gchip", { type: "button", title: "Sound on/off" });
  const fullBtn = h("button.slx-gchip", { type: "button", title: "Full screen" }, icon("maximize", 16));
  const tr = h("div.d-pv-tr", fullBtn, muteBtn);
  const playBtn = h("button.d-play", { type: "button", title: "Play / pause" });
  const time = h("div.d-time");
  const scrub = h("div.d-scrub");
  const knob = h("div.d-knob");
  const controls = h("div.d-controls", playBtn, time, scrub);
  const seedRow = h("div.d-seedrow");
  const el = h("div.d-preview", bg, video, live, liveVideo, empty, h("div.d-vig"), tl, tr, controls, seedRow);

  const st = { show: null, liveUrl: null };

  const drawMute = () => { clear(muteBtn); muteBtn.appendChild(icon(video.muted ? "volumeOff" : "volume", 16)); };
  muteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    video.muted = !video.muted;
    d.node.properties = d.node.properties || {};
    d.node.properties.slx_muted = video.muted;
    drawMute();
  });
  fullBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  });
  const drawPlay = () => { clear(playBtn); playBtn.appendChild(icon(video.paused ? "play" : "pause", 22)); };
  playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!video.src) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  });
  video.addEventListener("play", drawPlay);
  video.addEventListener("pause", drawPlay);
  video.addEventListener("ended", drawPlay);
  video.addEventListener("loadedmetadata", () => { drawTime(); drawScrub(); });
  video.addEventListener("timeupdate", () => {
    drawTime();
    moveKnob();
    d.time = video.currentTime || 0;
    d.onPlayhead?.(d.time);
  });
  drawMute();
  drawPlay();

  const total = () => video.duration || d.sec(d.lastF - d.startF);

  function drawTime() {
    clear(time);
    time.append(fmtClock(video.currentTime || 0), h("span", ` / ${fmtClock(total())}`));
  }

  // the segments along the scrub bar, as their zones run in the video
  function drawScrub() {
    clear(scrub);
    const end = Math.max(1, d.lastF - d.startF);
    const picked = d.picked();
    const zones = d.zones || [];
    zones.forEach((z, i) => {
      const from = z.from - d.startF;
      const to = (i === zones.length - 1 ? Math.max(z.to, d.lastF) : z.to) - d.startF;
      const segEl = h("div.d-sg", { class: picked.item && z.seg === picked.item ? "on" : null,
        style: { left: `${(from / end) * 100}%`, width: `calc(${((to - from) / end) * 100}% - 4px)` },
        title: z.seg ? `Segment ${i + 1}: ${String(z.seg.prompt || "").slice(0, 80)}` : "" });
      segEl.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const r = scrub.getBoundingClientRect();
        seek(((ev.clientX - r.left) / r.width) * d.sec(end));
        if (z.seg) d.select("seg", z.seg.id);
      });
      scrub.appendChild(segEl);
    });
    if (!zones.length) scrub.appendChild(h("div.d-sg", { style: { left: "0%", width: "100%" } }));
    scrub.appendChild(knob);
    moveKnob();
  }

  scrub.addEventListener("pointerdown", (e) => {
    if (e.target !== scrub) return;
    const r = scrub.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * d.sec(Math.max(1, d.lastF - d.startF)));
  });

  function moveKnob() {
    const t = video.currentTime || 0;
    knob.style.left = `calc(${Math.min(100, (t / Math.max(0.001, total())) * 100)}% - 12px)`;
  }

  function seek(t) {
    d.time = Math.max(0, t);
    d.onPlayhead?.(d.time);
    if (!video.src) return;
    video.currentTime = Math.max(0, Math.min((video.duration || t) - 0.02, t));
  }

  function videos() {
    return d.seedVideos();
  }

  // which seed plays: the one pointed at, the winner, the first
  function shown() {
    const list = videos();
    if (!list.length) return null;
    return list.find((v) => v.candidate === st.show) || list.find((v) => v.candidate === d.winner()) || list[0];
  }

  function poster() {
    const k = d.keyframes().find((x) => x.kind === "first" || x.kind === "clip") || d.keyframes()[0];
    return k ? blockPicture(k.s) : null;
  }

  function drawChips(v) {
    clear(tl);
    if (!v) return;
    const win = v.candidate === d.winner();
    tl.append(h("div.slx-gchip.brand", icon(win ? "crown" : "dice", 15),
      `Seed ${v.candidate}${v.seed != null ? " · " + v.seed : ""}${win ? " · the winner" : ""}`));
    const bits = [v.width && v.height ? `${v.width}×${v.height}` : null, v.fps ? `${Math.round(v.fps * 100) / 100} fps` : null].filter(Boolean);
    if (bits.length) tl.append(h("div.slx-gchip", bits.join(" · ")));
    if (d.editSeq > d.renderedSeq) tl.append(h("div.slx-gchip", icon("alert", 14), "from before your last change"));
  }

  function drawSeeds(busy) {
    clear(seedRow);
    seedRow.classList.toggle("busy", !!busy);
    const list = videos();
    if (list.length < 2) return;
    const v = shown();
    for (const s of list) {
      const win = s.candidate === d.winner();
      const chip = h("button.d-seedchip", { type: "button", class: v && s.candidate === v.candidate ? "on" : null,
        title: win ? "The winner" : "Show this seed here (pick the winner in the inspector or in Seeds)" },
      win ? icon("crown", 14) : null, `Seed ${s.candidate}`, h("i", s.sampler || ""));
      chip.addEventListener("click", (e) => { e.stopPropagation(); st.show = s.candidate; render(); });
      seedRow.appendChild(chip);
    }
  }

  function render() {
    const busy = d.run.state === "queued" || d.run.state === "running";
    const p = poster();
    d.ambient.style.backgroundImage = p ? `url("${p}")` : "none";
    bg.style.backgroundImage = p ? `url("${p}")` : "none";
    if (!(d.live && d.run.state === "running")) {
      live.style.display = "none";
      liveVideo.style.display = "none";
      if (!liveVideo.paused) liveVideo.pause();
    }
    if (busy) {
      if (!video.paused) video.pause();
      video.style.display = "none";
      controls.style.display = "none";
      if (d.live && d.run.state === "running") showLive(d.live);
      else {
        empty.style.display = "flex";
        clear(empty);
        empty.append(h("div.d-pv-empty-ic", h("div.slx-spin.d-pv-spin")),
          h("div.slx-h3", d.run.state === "queued" ? "Waiting in the queue" : (d.run.text || "Rendering")),
          h("div.slx-muted", "The seeds play here when they are done. With a live preview model in Setup, the frames show here while they sample."));
        clear(tl);
      }
      drawSeeds(true);
      return;
    }
    const v = shown();
    if (v) {
      const url = viewUrl(v);
      if (video.dataset.src !== url) {
        const wasPlaying = !video.paused;
        const at = video.currentTime || 0;
        video.dataset.src = url;
        video.src = url;
        video.poster = p || "";
        video.addEventListener("loadedmetadata", () => {
          try { video.currentTime = Math.min(at, (video.duration || at) - 0.02); } catch (e) { /* not seekable yet */ }
          if (wasPlaying) video.play().catch(() => {});
        }, { once: true });
      }
      video.style.display = "block";
      empty.style.display = "none";
      controls.style.display = "flex";
    } else {
      video.removeAttribute("src");
      video.dataset.src = "";
      video.style.display = "none";
      controls.style.display = "none";
      empty.style.display = "flex";
      clear(empty);
      empty.append(h("div.d-pv-empty-ic", icon("movie", 34)),
        h("div.slx-h3", d.retake ? "Render to see the retake here" : "Render to see it here"),
        h("div.slx-muted", "Every seed you render plays here: pick the winner, then finish it in Output. Hunt renders a few new seeds at once."));
    }
    drawChips(v);
    drawSeeds(false);
    drawScrub();
    drawTime();
  }

  function showLive(lv) {
    if (!lv?.image) return;
    let url;
    try {
      url = URL.createObjectURL(b64ToBlob(lv.image, lv.mime));
    } catch (e) {
      return;
    }
    const old = st.liveUrl;
    st.liveUrl = url;
    if (lv.mime.startsWith("video/")) {
      live.style.display = "none";
      liveVideo.style.display = "block";
      liveVideo.src = url;
      liveVideo.play?.().catch(() => {});
    } else {
      liveVideo.style.display = "none";
      live.style.display = "block";
      live.src = url;
    }
    empty.style.display = "none";
    clear(tl);
    const step = lv.step != null && lv.total ? ` · step ${lv.step}/${lv.total}` : "";
    const seedNo = d.run.of > 1 ? ` · seed ${d.run.candidate} of ${d.run.of}` : "";
    tl.append(h("div.slx-gchip.brand", h("span.d-live-dot"), `Live${seedNo}${step}`));
    if (old) setTimeout(() => URL.revokeObjectURL(old), 2000);
  }

  return {
    el,
    render,
    showLive,
    seek,
    setVideos() {
      st.show = null;
      render();
    },
    showSeed(candidate) {
      st.show = candidate || null;
      render();
    },
    refreshScrub: drawScrub,
    get time() { return video.currentTime || d.time || 0; },
    dispose() {
      if (st.liveUrl) URL.revokeObjectURL(st.liveUrl);
      video.pause?.();
    },
  };
}

