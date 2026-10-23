// Stubelius Ultimate LTX Director: the timeline across the whole video.
//
// Keyframes (the pictures the video opens on, passes through and ends on, and the first frame of a clip), prompts
// (the segments as the Director cuts the video for its prompts: drag a cut to time them), motion (IC-LoRA guide
// videos), audio (your sounds and the clips' own sound) and references (the Cast, with references on). Pictures,
// clips and sounds dropped on a lane land at that second. In retake mode: the base video and the part made again.
import { h, icon, clear, iconButton, toggle } from "./ulx_ui.js";
import { pickFile, dropTarget, isImageFile, isVideoFile, isAudioFile, drawPeaks, blockPicture, inputUrl } from "./ulx_media.js";
import * as M from "./ulx_director_model.js";

let styled = false;
function injectStyles() {
  if (styled) return;
  styled = true;
  document.head.appendChild(h("style", { id: "stubelius-ultx-timeline", text: CSS }));
}

export function buildTimeline(d) {
  injectStyles();
  const box = clear(d.tl);
  const view = Math.max(1, d.viewF);
  const pct = (f) => `${Math.max(0, Math.min(100, (f / view) * 100))}%`;
  const grid = h("div.t-grid");
  const row = (head, lane, cls) => grid.append(h(`div.t-head.${cls}`, head), h(`div.t-area.${cls}`, lane));
  const fps = d.fps;
  const dur = view / fps;

  // ruler: whole seconds at a step that fits; a click or a drag moves the playhead
  const step = dur <= 12 ? 1 : dur <= 30 ? 2 : dur <= 60 ? 5 : 10;
  const ruler = h("div.t-in.t-ruler");
  for (let s = 0; s <= dur + 1e-6; s += step) {
    const last = s + step > dur + 1e-6;
    ruler.appendChild(h("span.t-tick", { style: { left: pct(s * fps) }, class: s === 0 ? "first" : last ? "last" : null },
      s === 0 ? "0s" : last && Math.abs(s - dur) < 0.05 ? `${s.toFixed(0)}s` : String(Math.round(s * 10) / 10)));
  }
  if (Math.abs(Math.floor(dur / step) * step - dur) > 0.05) ruler.appendChild(h("span.t-tick.last", { style: { left: "100%" } }, `${dur.toFixed(1)}s`));
  const seekAt = (e) => {
    const r = ruler.getBoundingClientRect();
    const f = ((e.clientX - r.left) / r.width) * view;
    d.preview.seek(Math.max(0, d.sec(f - d.startF)));
  };
  ruler.addEventListener("pointerdown", (e) => {
    seekAt(e);
    try { ruler.setPointerCapture(e.pointerId); } catch (_) { /* a synthetic event */ }
    const move = (ev) => seekAt(ev);
    const up = () => { ruler.removeEventListener("pointermove", move); ruler.removeEventListener("pointerup", up); };
    ruler.addEventListener("pointermove", move);
    ruler.addEventListener("pointerup", up);
  });
  row(null, ruler, "ruler");

  const at = () => d.startF + d.frm(d.preview?.time || d.time || 0);     // the playhead, a frame
  const plus = (title, fn) => {
    const b = iconButton("plus", title, fn);
    b.classList.add("t-add");
    return b;
  };

  if (d.retake) {
    row(trackHead("movie", "k", "Base video"), baseLane(d, view, pct), "kf");
    row(trackHead("refresh", "cut", "Retake"), retakeLane(d, view, pct), "shots");
    row(trackHead("run", "ok", "Motion"), h("div.t-in", h("div.t-hint", "Not used while retaking: outside the part the base video stays as it is")), "snd");
    row(trackHead("wave", "snd", "Audio"), h("div.t-in", h("div.t-hint", "The base video's own sound; the part made again gets new sound")), "snd");
  } else {
    const addKey = plus("Add a picture at the playhead (or drop pictures on the lane)", async () => {
      const f = await pickFile("image/*");
      if (f) dropPicture(d, f, at());
    });
    row(h("div.t-headin", trackHead("photo", "k", "Keyframes"), addKey), keyframeLane(d, view, pct), "kf");
    const addSeg = plus("A new segment: the one under the playhead is cut there", () => d.addSegmentAt(at()));
    row(h("div.t-headin", trackHead("lines", "ac", "Prompts"), addSeg), promptLane(d, view, pct), "shots");
    const motionOn = d.t.motionTrackEnabled !== false;
    const motionTog = toggle(motionOn, (v) => d.setMotionOn(v), "Use the motion clips (IC-LoRA guide videos)");
    const addMotion = plus("A pose, depth or edge video at the playhead (or drop it on the lane)", async () => {
      const f = await pickFile("video/*");
      if (f) d.addMotion(f, at());
    });
    row(h("div.t-headin", trackHead("run", "ok", "Motion"), h("div.t-hbtns", motionTog, addMotion)), motionLane(d, view, pct), "snd");
    const audioOn = d.t.audioTrackEnabled !== false && !d.node.properties?.overrideAudio;
    const audioTog = toggle(audioOn, (v) => d.setAudioOn(v), "Use your sounds (off: LTX makes all the sound)");
    const addSound = plus("A voice line or music at the playhead (or drop it on the lane)", async () => {
      const f = await pickFile("audio/*");
      if (f) d.addSound(f, at());
    });
    row(h("div.t-headin", trackHead("wave", "snd", "Audio"), h("div.t-hbtns", audioTog, addSound)), audioLane(d, view, pct), "snd");
  }
  row(trackHead("users", "cut", "References"), refLane(d), "refs");

  // what is not rendered: before the start and after the real last frame
  const shade = h("div.t-shade");
  if (d.startF > 0) shade.appendChild(h("div.t-out", { style: { left: "0%", width: pct(d.startF) } }));
  if (d.lastF < view) shade.appendChild(h("div.t-out", { style: { left: pct(d.lastF), width: `${100 - (d.lastF / view) * 100}%` } }));
  const lines = h("div.t-lines", { style: { backgroundSize: `calc(100% / ${Math.max(1, dur / step)}) 100%` } });
  const playhead = h("div.t-playhead");
  box.append(h("div.t-wrap", grid, lines, shade, playhead));
  d.onPlayhead = (t) => {
    const f = d.startF + t * fps;
    playhead.style.left = `calc(184px + 24px + (100% - 184px - 48px) * ${Math.max(0, Math.min(1, f / view))})`;
    playhead.style.display = "block";
  };
  d.onPlayhead(d.preview?.time || d.time || 0);
}

function trackHead(ic, kind, text) {
  return h("div.t-trk", h(`span.slx-ico.${kind}`, icon(ic, 16)), text);
}

// A drag along a lane: onMove(frame) while it moves (after 3 px), onEnd(moved) on release
function dragAlong(e, el, lane, view, { onMove, onEnd }) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const r = lane.getBoundingClientRect();
  const x0 = e.clientX;
  let moved = false;
  try { el.setPointerCapture(e.pointerId); } catch (_) { /* a synthetic event */ }
  const move = (ev) => {
    if (!moved && Math.abs(ev.clientX - x0) <= 3) return;
    moved = true;
    onMove(((ev.clientX - r.left) / r.width) * view, ((ev.clientX - x0) / r.width) * view);
  };
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    onEnd(moved);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
}

// A file dropped at frame f: a picture becomes the first or last frame near the ends, a keyframe elsewhere
function dropPicture(d, file, f) {
  const near = Math.max(4, Math.round(d.fps * 0.4));
  if (f <= d.startF + near) return d.setFirstFrame(file);
  if (f >= d.lastF - near) return d.setLastFrame(file);
  return d.addKeyframe(file, f);
}

// ------------------------------------------------------------------------------------------- keyframes

function keyframeLane(d, view, pct) {
  const lane = h("div.t-in.t-kf");
  const keys = d.keyframes();
  const thumb = (url) => h("div.t-kf-t", url ? h("img", { src: url, draggable: false }) : null);
  const picked = d.picked();
  for (const k of keys) {
    const span = k.s.isAnchor ? null : keySpan(d, k.s, view, pct, lane);
    if (span) lane.appendChild(span);
  }
  for (const k of keys) {
    const s = k.s;
    const isSel = picked.item === s;
    const label = k.kind === "first" ? `First · ${d.fmt(k.at)}` : k.kind === "last" ? `Last · ${d.fmt(k.at + 1)}`
      : k.kind === "clip" ? `Clip · ${d.fmt(k.at)}` : d.fmt(k.at);
    const lab = h("small", label);
    const edge = k.kind === "first" || (k.kind === "clip" && k.at <= d.startF) ? "start" : k.kind === "last" ? "end" : "mid";
    const m = h(`div.t-kf-m.${edge}`, {
      class: [isSel ? "sel" : "", s.isAnchor ? "anchor" : "", k.kind === "clip" ? "clip" : "", s._uploading ? "busy" : ""].join(" ").trim() || null,
      style: { left: pct(edge === "end" ? k.at + 1 : k.at) },
      title: s.isAnchor ? "A keyframe: drag to change when the video reaches it, click for more"
        : k.kind === "clip" ? `${s.fileName || "clip"}: its frames guide segment ${segNo(d, s)}` : `Segment ${segNo(d, s)}'s picture`,
    }, thumb(blockPicture(s)), lab);
    m.addEventListener("pointerdown", (e) => {
      if (!s.isAnchor) { if (e.button === 0) d.select("seg", s.id); return; }
      dragAlong(e, m, lane, view, {
        onMove: (f) => {
          const g = Math.round(Math.max(d.startF, Math.min(d.lastF - 1, f)));
          M.placeAnchor(d.t, s, s.isEndFrame ? g - s.length + 1 : g, d.startF, d.lastF);
          const g2 = M.guideFrame(s);
          m.style.left = pct(m.classList.contains("end") ? g2 + 1 : g2);
          lab.textContent = d.fmt(M.guideFrame(s));
        },
        onEnd: (moved) => {
          if (moved) { d.commit(); d.refresh(["tl", "insp", "preview"]); }
          else d.select("key", s.id);
        },
      });
    });
    dropTarget(m, (file) => { if (isImageFile(file)) d.setPicture(s, file); });
    lane.appendChild(m);
  }
  const has = (kind) => keys.some((k) => k.kind === kind || (kind === "first" && k.kind === "clip" && k.at <= d.startF));
  if (!has("first")) {
    const slot = h("button.t-kf-slot.start", { type: "button", title: "The picture the video opens on", style: { left: pct(d.startF) },
      onclick: async () => { const f = await pickFile("image/*"); if (f) d.setFirstFrame(f); } }, icon("plus", 16), "First frame");
    dropTarget(slot, (file) => isImageFile(file) && d.setFirstFrame(file));
    lane.appendChild(slot);
  }
  if (!has("last")) {
    const slot = h("button.t-kf-slot.end", { type: "button", title: "The picture the video ends on (its real last frame)", style: { left: pct(d.lastF) },
      onclick: async () => { const f = await pickFile("image/*"); if (f) d.setLastFrame(f); } }, icon("plus", 16), "Last frame");
    dropTarget(slot, (file) => isImageFile(file) && d.setLastFrame(file));
    lane.appendChild(slot);
  }
  if (!keys.some((k) => k.kind === "middle")) {
    lane.appendChild(h("div.t-hint", "Drop pictures here: frames the video passes through, at that second"));
  }
  dropTarget(lane, (file, e) => {
    const r = lane.getBoundingClientRect();
    const f = ((e.clientX - r.left) / r.width) * view;
    if (isImageFile(file)) return dropPicture(d, file, f);
    if (isVideoFile(file)) { const z = d.zoneAt(f); if (z?.seg) return d.setClip(z.seg, file); }
    if (isAudioFile(file)) return d.addSound(file, f);
  });
  return lane;
}

function segNo(d, s) {
  return M.segmentsOf(d.t).indexOf(s) + 1;
}

// A segment's picture lasts as long as its segment: a bar from the picture over the segment's prompt zone. Its far
// edge is the cut to the next segment (the cut before it for a picture pinned to the last frame): drag it as on the
// Prompts lane.
function keySpan(d, s, view, pct, lane) {
  const zones = d.zones || [];
  const zi = zones.findIndex((z) => z.seg === s);
  if (zi < 0) return null;
  const list = M.segmentsOf(d.t);
  const i = list.indexOf(s);
  const end = !!s.isEndFrame && M.isPicture(s);
  const pair = end ? [list[i - 1], s] : [s, list[i + 1]];
  const len = h("em");
  const el = h("div.t-kf-span", { class: end ? "end" : null, title: "How long this picture's segment lasts", onclick: () => d.select("seg", s.id) }, len);
  const place = () => {
    const zs = d.zones || [];
    const k = zs.findIndex((z) => z.seg === s);
    const z = zs[k];
    if (!z) return;
    const to = k === zs.length - 1 ? Math.max(z.to, d.lastF) : z.to;
    el.style.left = pct(z.from);
    el.style.width = `${Math.max(0, ((to - z.from) / view) * 100)}%`;
    len.textContent = `${d.sec(to - z.from).toFixed(1)} s`;
  };
  place();
  if (pair[0] && pair[1] && zones.some((z) => z.seg === pair[0]) && zones.some((z) => z.seg === pair[1])) {
    const edge = h("div.t-edge", { class: end ? "l" : null, title: "Drag to change how long it lasts (moves the cut)" });
    edge.addEventListener("click", (ev) => ev.stopPropagation());
    edge.addEventListener("pointerdown", (e) => dragAlong(e, edge, lane, view, {
      onMove: (f) => {
        M.moveCut(d.t, pair[0], pair[1], f);
        d.zones = M.deriveStrings(d.t, d.startF, d.durF).zones;
        place();
      },
      onEnd: (moved) => { if (moved) { d.commit(); d.refresh(["tl", "insp", "preview"]); } },
    }));
    el.appendChild(edge);
  }
  return el;
}

// ------------------------------------------------------------------------------------------- prompts

function promptLane(d, view, pct) {
  const lane = h("div.t-in.t-shots");
  const zones = d.zones || [];
  const picked = d.picked();
  const blocks = [];
  zones.forEach((z, i) => {
    const s = z.seg;
    if (!s) return;
    const to = i === zones.length - 1 ? Math.max(z.to, d.lastF) : z.to;
    const text = String(s.prompt || "").trim().split("\n")[0];
    const dialogue = /"[^"]+"|“[^”]+”/.test(text);
    const ic = M.isClip(s) ? "movie" : M.isPicture(s) ? "photo" : dialogue ? "message" : "lines";
    const blk = h("div.t-blk.t-zone", {
      class: [picked.item === s ? "sel" : "", text ? "" : "empty"].join(" ").trim() || null,
      style: { left: pct(z.from), width: `calc(${((to - z.from) / view) * 100}% - 6px)` },
      title: text ? `Segment ${i + 1} (${d.fmt(z.from)} – ${d.fmt(to)}): ${s.prompt}` : `Segment ${i + 1}: no prompt of its own (the global prompt fills it)`,
    }, icon(ic, 14), h("span", text ? text.replace(/^"|"$/g, "") : `Segment ${i + 1} · the global prompt`));
    blk.addEventListener("click", () => {
      d.select("seg", s.id);
      d.focusPrompt();
    });
    // the cut after it: drag to time the two segments
    if (i < zones.length - 1 && zones[i + 1]?.seg) {
      const edge = h("div.t-edge", { title: "Drag to time the cut between these segments" });
      edge.addEventListener("click", (ev) => ev.stopPropagation());
      edge.addEventListener("pointerdown", (e) => {
        const b = zones[i + 1].seg;
        dragAlong(e, edge, lane, view, {
          onMove: (f) => {
            M.moveCut(d.t, s, b, f);
            d.zones = M.deriveStrings(d.t, d.startF, d.durF).zones;
            fastZones(d, blocks, view);
          },
          onEnd: (moved) => { if (moved) { d.commit(); d.refresh(["tl", "insp", "preview"]); } },
        });
      });
      blk.appendChild(edge);
    }
    blocks.push({ blk, seg: s });
    lane.appendChild(blk);
  });
  // blocks past the end: kept, not rendered
  for (const s of M.segmentsOf(d.t)) {
    if (s.start < d.endF) continue;
    lane.appendChild(h("div.t-blk.t-zone.out", { style: { left: pct(s.start), width: `calc(${(s.length / view) * 100}% - 6px)` },
      title: "Past the end of the video: not rendered (make the video longer to use it)", onclick: () => d.select("seg", s.id) },
    icon("lines", 14), h("span", String(s.prompt || "").trim() || "past the end")));
  }
  if (!zones.length) {
    lane.appendChild(h("button.t-hint.t-hint-btn", { type: "button", onclick: () => d.addSegmentAt(d.startF) },
      "No prompts yet: click to write one (or just the global prompt)"));
  }
  return lane;
}

// while a cut is dragged: move the blocks only
function fastZones(d, blocks, view) {
  const zones = d.zones || [];
  for (const { blk, seg } of blocks) {
    const i = zones.findIndex((z) => z.seg === seg);
    const z = zones[i];
    if (!z) continue;
    const to = i === zones.length - 1 ? Math.max(z.to, d.lastF) : z.to;
    blk.style.left = `${(z.from / view) * 100}%`;
    blk.style.width = `calc(${((to - z.from) / view) * 100}% - 6px)`;
  }
  d.preview?.refreshScrub?.();
}

// Blocks that overlap on a lane (Python mixes overlapping sounds) go in two rows instead of on top of each other
function laneRows(list) {
  const rows = new Map();
  const ends = [-Infinity, -Infinity];
  for (const s of [...list].sort((a, b) => a.start - b.start)) {
    const r = s.start >= ends[0] ? 0 : s.start >= ends[1] ? 1 : (ends[0] <= ends[1] ? 0 : 1);
    rows.set(s, r);
    ends[r] = Math.max(ends[r], s.start + s.length);
  }
  return { rows, two: [...rows.values()].some((r) => r === 1) };
}

// ------------------------------------------------------------------------------------------- motion

function motionLane(d, view, pct) {
  const lane = h("div.t-in.t-snd");
  const on = d.t.motionTrackEnabled !== false;
  const picked = d.picked();
  const ic = d.modelsNode()?.widgets?.find((w) => w.name === "ic_lora")?.value;
  const noLora = !ic || String(ic).toLowerCase() === "none";
  const { rows, two } = laneRows(d.t.motionSegments);
  for (const s of d.t.motionSegments) {
    const blk = h("div.t-blk.t-motion", {
      class: [picked.item === s ? "sel" : "", on ? "" : "off", s._uploading ? "busy" : "", two ? `half r${rows.get(s)}` : ""].join(" ").trim() || null,
      style: { left: pct(s.start), width: `calc(${Math.max(1, (s.length / view) * 100)}% - 2px)` },
      title: `${s.fileName || s.videoFile || "motion clip"}: drag to move it, click for more`,
    });
    if (s.imageB64) blk.appendChild(h("img.t-still", { src: s.imageB64, draggable: false }));
    blk.append(icon("run", 14), h("span", `${s.fileName || "motion clip"}${s._uploading ? " · uploading" : ""}`));
    blk.addEventListener("pointerdown", (e) => {
      const grab0 = s.start;
      dragAlong(e, blk, lane, view, {
        onMove: (f, dx) => { s.start = Math.max(0, Math.round(grab0 + dx)); blk.style.left = pct(s.start); },
        onEnd: (moved) => {
          if (moved) { d.commit(); d.refresh(["tl", "insp"]); }
          else d.select("motion", s.id);
        },
      });
    });
    lane.appendChild(blk);
  }
  if (!d.t.motionSegments.length) {
    lane.appendChild(h("div.t-hint", noLora
      ? "Drop a pose, depth or edge video here (pick an IC-LoRA in Setup for it to move the picture)"
      : "Drop a pose, depth or edge video here: the IC-LoRA moves the picture along with it"));
  }
  dropTarget(lane, (file, e) => {
    if (!isVideoFile(file)) return;
    const r = lane.getBoundingClientRect();
    d.addMotion(file, ((e.clientX - r.left) / r.width) * view);
  });
  return lane;
}

// ------------------------------------------------------------------------------------------- audio

function audioLane(d, view, pct) {
  const lane = h("div.t-in.t-snd");
  const override = !!d.node.properties?.overrideAudio;
  const on = d.t.audioTrackEnabled !== false && !override;
  const picked = d.picked();
  const tint = getComputedStyle(d.root).getPropertyValue("--snd").trim() || "63,213,255";
  const { rows, two } = laneRows(d.t.audioSegments);
  for (const s of d.t.audioSegments) {
    const clip = M.clipOf(d.t, s);
    const blk = h("div.t-blk.t-sound", {
      class: [picked.item === s ? "sel" : "", on ? "" : "off", clip ? "linked" : "", s._uploading ? "busy" : "", two ? `half r${rows.get(s)}` : ""].join(" ").trim() || null,
      style: { left: pct(s.start), width: `calc(${Math.max(1, (s.length / view) * 100)}% - 2px)` },
      title: clip ? `${s.fileName || "clip"}'s own sound: it moves with its clip` : `${s.fileName || "sound"}: drag to move it, click for more`,
    });
    if (Array.isArray(s.waveformPeaks) && s.waveformPeaks.length) {
      const canvas = h("canvas.t-wave", { width: 480, height: 40 });
      blk.appendChild(canvas);
      const all = s.waveformPeaks;
      const src = Number(s.audioDurationFrames) || s.length;
      const from = Math.floor(((Number(s.trimStart) || 0) / src) * all.length);
      const to = Math.ceil((((Number(s.trimStart) || 0) + s.length) / src) * all.length);
      requestAnimationFrame(() => drawPeaks(canvas, all.slice(from, Math.max(from + 1, to)), `rgba(${tint},.55)`));
    }
    blk.append(icon(clip ? "link" : "mic", 14), h("span", `${s.fileName || "sound"}${s._uploading ? " · uploading" : ""}`));
    blk.addEventListener("pointerdown", (e) => {
      if (clip) { if (e.button === 0) d.select("audio", s.id); return; }
      const grab0 = s.start;
      dragAlong(e, blk, lane, view, {
        onMove: (f, dx) => { s.start = Math.max(0, Math.round(grab0 + dx)); blk.style.left = pct(s.start); },
        onEnd: (moved) => {
          if (moved) { d.commit(); d.refresh(["tl", "insp"]); }
          else d.select("audio", s.id);
        },
      });
    });
    if (!clip) {
      // the edges clip the sound: the left one cuts its front (what remains stays where it played), the right one its end
      const src = Number(s.audioDurationFrames) || Infinity;
      const trim = (e, front) => {
        const s0 = s.start, t0 = Number(s.trimStart) || 0, l0 = s.length;
        dragAlong(e, e.currentTarget, lane, view, {
          onMove: (f, dx) => {
            const k = Math.round(dx);
            if (front) {
              const cut = Math.max(-Math.min(s0, t0), Math.min(l0 - M.MIN_LEN, k));
              Object.assign(s, { start: s0 + cut, trimStart: t0 + cut, length: l0 - cut });
            } else {
              s.length = Math.max(M.MIN_LEN, Math.min(src - t0, l0 + k));
            }
            blk.style.left = pct(s.start);
            blk.style.width = `calc(${Math.max(1, (s.length / view) * 100)}% - 2px)`;
          },
          onEnd: (moved) => { if (moved) { d.commit(); d.refresh(["tl", "insp"]); } },
        });
      };
      const left = h("div.t-trim.l", { title: "Drag to clip the start of the sound" });
      const right = h("div.t-trim", { title: "Drag to clip the end of the sound" });
      left.addEventListener("pointerdown", (e) => trim(e, true));
      right.addEventListener("pointerdown", (e) => trim(e, false));
      blk.append(left, right);
    }
    lane.appendChild(blk);
  }
  if (override) lane.appendChild(h("div.t-hint.top", "The motion clips' own sound is used (Motion inspector)"));
  else if (!d.t.audioSegments.length) lane.appendChild(h("div.t-hint", "Drop a voice line or music here: it plays at that second, and LTX fills the gaps with sound"));
  dropTarget(lane, (file, e) => {
    if (!isAudioFile(file) && !isVideoFile(file)) return;
    const r = lane.getBoundingClientRect();
    const f = ((e.clientX - r.left) / r.width) * view;
    if (isAudioFile(file)) d.addSound(file, f);
  });
  return lane;
}

// ------------------------------------------------------------------------------------------- references

function refLane(d) {
  const lane = h("div.t-in.t-refs");
  if (!d.refsOn) {
    lane.appendChild(h("button.t-hint.t-hint-btn", { type: "button", onclick: () => d.setRefMode(M.REF.msr),
      title: "Turn on Licon MSR" }, "Characters and items that keep their look (Licon MSR): pick Licon MSR at the top to use them"));
    return lane;
  }
  const filled = M.refsFilled(d.t);
  const picked = d.picked();
  if (!filled.length) {
    lane.appendChild(h("button.t-hint.t-hint-btn", { type: "button", onclick: () => d.select("ref", 0) },
      "Add a character or an item in the Cast below: 1-3 pictures each, then write @ref1 in a prompt"));
    return lane;
  }
  const row = h("div.t-refrow");
  for (const { i, c } of filled) {
    const img = c.images[0];
    const src = img?.b64 || (img?.name ? inputUrl(img.name) : null);
    row.appendChild(h("button.t-ref", { type: "button", class: picked.kind === "ref" && picked.item === i ? "sel" : null,
      onclick: () => d.select("ref", i), title: `@ref${i + 1}: ${c.description || "no label yet"}` },
    src ? h("img", { src, draggable: false }) : icon("user", 16),
    h("b", `@ref${i + 1}`), h("span", c.description || "no label yet"), h("i", `${c.images.length} picture${c.images.length > 1 ? "s" : ""}`)));
  }
  lane.appendChild(row);
  return lane;
}

// ------------------------------------------------------------------------------------------- retake

function baseLane(d, view, pct) {
  const lane = h("div.t-in.t-kf");
  const rv = d.t.retakeVideo;
  if (!rv) {
    const slot = h("button.t-kf-slot.start", { type: "button", onclick: () => d.setRetake(true) }, icon("plus", 16), "Base video");
    lane.appendChild(slot);
    return lane;
  }
  const len = Number(rv.videoDurationFrames) || d.durF;
  const blk = h("div.t-blk.t-base", { style: { left: "0%", width: `calc(${(len / view) * 100}% - 2px)` },
    title: `${rv.fileName || rv.imageFile}: the base video` });
  const still = rv._thumb ? h("img.t-still", { src: rv._thumb, draggable: false }) : null;
  if (!still && rv.imageFile) {
    const v = h("video.t-still", { muted: true, preload: "metadata", src: inputUrl(rv.imageFile) });
    v.muted = true;
    v.addEventListener("loadedmetadata", () => { v.currentTime = Math.min(0.05, v.duration || 0); });
    blk.appendChild(v);
  } else if (still) blk.appendChild(still);
  blk.append(icon("movie", 14), h("span", `${rv.fileName || "base video"}${rv._uploading ? " · uploading" : ""}`));
  lane.appendChild(blk);
  return lane;
}

function retakeLane(d, view, pct) {
  const lane = h("div.t-in.t-shots");
  const t = d.t;
  const total = Number(t.retakeVideo?.videoDurationFrames) || d.durF;
  const rs = Number(t.retakeStart ?? 0), rl = Number(t.retakeLength ?? total);
  const part = (from, to, cls, text, title) => h(`div.t-blk.t-zone.${cls}`, { style: { left: pct(from), width: `calc(${((to - from) / view) * 100}% - 4px)` }, title },
    icon(cls === "retake" ? "refresh" : "lock", 14), h("span", text));
  if (rs > 0) lane.appendChild(part(0, rs, "kept", "kept as it is", "This part stays as the base video has it"));
  const mid = part(rs, rs + rl, "retake", String(t.retakePrompt || "").trim() || "made again · write what happens in the inspector",
    "This part is made again: drag it to move it, its edges to resize it");
  const left = h("div.t-edge.l", { title: "Drag: where the part made again starts" });
  const right = h("div.t-edge", { title: "Drag: where the part made again ends" });
  mid.append(left, right);
  if (rs + rl < total) lane.appendChild(part(rs + rl, total, "kept", "kept as it is", "This part stays as the base video has it"));
  lane.appendChild(mid);
  const redraw = () => {
    mid.style.left = pct(t.retakeStart);
    mid.style.width = `calc(${(t.retakeLength / view) * 100}% - 4px)`;
  };
  const drag = (e, how) => {
    const s0 = Number(t.retakeStart), l0 = Number(t.retakeLength);
    dragAlong(e, e.currentTarget, lane, view, {
      onMove: (f, dx) => {
        const k = Math.round(dx);
        if (how === "move") t.retakeStart = Math.max(0, Math.min(total - l0, s0 + k));
        else if (how === "l") { const s = Math.max(0, Math.min(s0 + l0 - M.MIN_LEN, s0 + k)); t.retakeLength = s0 + l0 - s; t.retakeStart = s; }
        else t.retakeLength = Math.max(M.MIN_LEN, Math.min(total - s0, l0 + k));
        redraw();
      },
      onEnd: (moved) => { if (moved) { d.commit(); d.refresh(["tl", "insp"]); } },
    });
  };
  mid.addEventListener("pointerdown", (e) => { if (e.target === mid || e.target.closest("span,svg")) drag(e, "move"); });
  left.addEventListener("pointerdown", (e) => drag(e, "l"));
  right.addEventListener("pointerdown", (e) => drag(e, "r"));
  return lane;
}

const CSS = `
.slx-d .d-tl{padding:0;overflow:hidden}
.slx-d .t-wrap{position:relative}
.slx-d .t-grid{display:grid;grid-template-columns:184px minmax(0,1fr);position:relative;z-index:1}
.slx-d .t-head{border-right:1px solid var(--stroke);background:var(--well);display:flex;align-items:center;padding:0 10px 0 16px;min-width:0}
.slx-d .t-area{position:relative;min-width:0}
.slx-d .t-area.ruler,.slx-d .t-head.ruler{height:40px}
.slx-d .t-area.kf,.slx-d .t-head.kf{height:96px}
.slx-d .t-area.shots,.slx-d .t-head.shots{height:56px}
.slx-d .t-area.snd,.slx-d .t-head.snd{height:58px}
.slx-d .t-area.refs,.slx-d .t-head.refs{height:62px}
.slx-d .t-in{position:absolute;left:24px;right:24px;top:0;bottom:0}
.slx-d .t-trk{display:flex;align-items:center;gap:10px;color:var(--text2);font-weight:500;white-space:nowrap}
.slx-d .t-headin{display:flex;align-items:center;justify-content:space-between;width:100%;gap:6px}
.slx-d .t-hbtns{display:flex;align-items:center;gap:6px}
.slx-d .t-hbtns .slx-tog{transform:scale(.78);transform-origin:right center;margin-left:-6px}
.slx-d .t-add{width:28px;height:28px;border-radius:9px}
.slx-d .t-ruler{top:14px;height:22px;cursor:pointer;touch-action:none}
.slx-d .t-tick{position:absolute;top:0;transform:translateX(-50%);color:var(--text3);font-family:var(--fh);font-size:12px;white-space:nowrap;pointer-events:none}
.slx-d .t-tick.first{transform:none}
.slx-d .t-tick.last{transform:translateX(-100%)}
.slx-d .t-lines{position:absolute;left:208px;right:24px;top:40px;bottom:62px;z-index:0;pointer-events:none;
  background-image:linear-gradient(90deg,var(--stroke) 1px,transparent 1px)}
.slx-d .t-shade{position:absolute;left:208px;right:24px;top:40px;bottom:62px;z-index:2;pointer-events:none}
.slx-d .t-out{position:absolute;top:0;bottom:0;background:repeating-linear-gradient(135deg,rgba(0,0,0,.28) 0 6px,rgba(0,0,0,.12) 6px 12px)}
.slx-d .t-playhead{position:absolute;top:36px;bottom:64px;width:2px;margin-left:-1px;z-index:3;pointer-events:none;display:none;
  background:linear-gradient(180deg,#fff,rgb(var(--ac)));box-shadow:0 0 14px rgb(var(--ac))}
.slx-d .t-playhead:before{content:"";position:absolute;top:-8px;left:-6px;width:14px;height:14px;border-radius:4px;background:#fff;transform:rotate(45deg);
  box-shadow:0 0 16px rgb(var(--ac))}
.slx-d .t-hint{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;color:var(--text3);font-size:12px;pointer-events:none}
.slx-d .t-hint.top{top:4px;transform:none;z-index:2}
.slx-d .t-hint-btn{pointer-events:auto;background:none;border:0;cursor:pointer;font:inherit;font-size:12px;color:var(--text3)}
.slx-d .t-hint-btn:hover{color:var(--text)}
.slx-d .t-in.over{background:rgba(var(--ac),.06);outline:1.5px dashed rgba(var(--ac),.6);outline-offset:2px;border-radius:12px}
/* keyframes */
.slx-d .t-kf{top:6px;bottom:6px}
.slx-d .t-kf-m{position:absolute;top:0;display:flex;flex-direction:column;align-items:center;gap:5px;background:none;border:0;padding:0;
  transform:translateX(-50%);z-index:2;cursor:pointer;color:var(--text2)}
.slx-d .t-kf-m.start{transform:none;align-items:flex-start}
.slx-d .t-kf-m.end{transform:translateX(-100%);align-items:flex-end}
.slx-d .t-kf-m.anchor{cursor:grab;touch-action:none}
.slx-d .t-kf-m.anchor:active{cursor:grabbing;z-index:4}
.slx-d .t-kf-t{width:96px;height:56px;border-radius:11px;overflow:hidden;border:1.5px solid rgba(var(--k),.75);background:#000;
  box-shadow:0 8px 24px rgba(0,0,0,.35),0 0 18px rgba(var(--k),.25)}
.slx-d .t-kf-t img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}
.slx-d .t-kf-m small{font-size:11px;color:var(--text2);font-weight:500;white-space:nowrap}
.slx-d .t-kf-m.anchor .t-kf-t{border-color:rgba(var(--cut),.85);box-shadow:0 8px 24px rgba(0,0,0,.35),0 0 18px rgba(var(--cut),.28)}
.slx-d .t-kf-m.clip .t-kf-t{border-color:rgba(var(--ok),.8);box-shadow:0 8px 24px rgba(0,0,0,.35),0 0 18px rgba(var(--ok),.25)}
.slx-d .t-kf-m.sel .t-kf-t{outline:2px solid rgb(var(--ac));outline-offset:2px}
.slx-d .t-kf-m.busy .t-kf-t{opacity:.55}
.slx-d .t-kf-m:hover .t-kf-t{filter:brightness(1.12)}
.slx-d .t-kf-slot{position:absolute;top:0;width:96px;height:56px;border-radius:11px;border:1.5px dashed var(--stroke2);background:var(--well);
  color:var(--text3);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:11px;font-weight:500;z-index:2}
.slx-d .t-kf-slot.end{transform:translateX(-100%)}
.slx-d .t-kf-span{position:absolute;top:16px;height:24px;border-radius:8px;z-index:1;cursor:pointer;
  background:linear-gradient(90deg,rgba(var(--k),.22),rgba(var(--k),.08));border:1px solid rgba(var(--k),.4)}
.slx-d .t-kf-span em{position:absolute;right:12px;top:50%;transform:translateY(-50%);font-style:normal;font-size:11px;color:var(--text2);
  font-family:var(--fh);font-weight:600;white-space:nowrap;pointer-events:none}
.slx-d .t-kf-span.end em{right:auto;left:12px}
.slx-d .t-kf-span .t-edge{right:-5px}
.slx-d .t-kf-span .t-edge.l{left:-5px;right:auto}
.slx-d .t-kf-span .t-edge:hover{background:rgba(var(--k),.6)}
.slx-d .t-trim{position:absolute;top:0;bottom:0;right:0;width:9px;cursor:ew-resize;z-index:2;touch-action:none;border-radius:0 11px 11px 0}
.slx-d .t-trim.l{left:0;right:auto;border-radius:11px 0 0 11px}
.slx-d .t-trim:hover{background:rgba(var(--snd),.55)}
.slx-d .t-kf-slot:hover,.slx-d .t-kf-slot.over{border-color:rgba(var(--k),.8);color:var(--text)}
/* blocks */
.slx-d .t-shots,.slx-d .t-snd{top:8px;bottom:8px}
.slx-d .t-blk{position:absolute;top:0;height:40px;border-radius:11px;padding:0 12px;display:flex;align-items:center;gap:8px;white-space:nowrap;
  overflow:hidden;font-weight:500;min-width:8px}
.slx-d .t-blk>span{overflow:hidden;text-overflow:ellipsis;min-width:0;position:relative}
.slx-d .t-blk>.slx-ic{opacity:.85;flex:none;position:relative}
.slx-d .t-zone{background:linear-gradient(180deg,rgba(var(--ac),.16),rgba(var(--ac),.08));border:1px solid rgba(var(--ac),.38);cursor:pointer;overflow:visible}
.slx-d .t-zone>span{overflow:hidden}
.slx-d .t-zone.empty>span{color:var(--text3)}
.slx-d .t-zone.sel{background:linear-gradient(180deg,rgba(var(--ac),.30),rgba(var(--ac2),.14));border-color:rgba(var(--ac),.8);
  box-shadow:0 0 0 2px rgba(var(--ac),.35),0 0 22px rgba(var(--ac),.3)}
.slx-d .t-zone.out{opacity:.45;border-style:dashed}
.slx-d .t-zone.kept{background:var(--glass);border:1px solid var(--stroke2);color:var(--text3);cursor:default}
.slx-d .t-zone.retake{background:linear-gradient(180deg,rgba(var(--cut),.28),rgba(var(--cut),.12));border-color:rgba(var(--cut),.75);cursor:grab;
  touch-action:none;z-index:2}
.slx-d .t-zone.retake .slx-ic{color:rgb(var(--cut))}
.slx-d .t-edge{position:absolute;top:-2px;bottom:-2px;right:-7px;width:10px;cursor:ew-resize;z-index:3;border-radius:4px;touch-action:none}
.slx-d .t-edge.l{left:-5px;right:auto}
.slx-d .t-edge:hover{background:rgba(var(--ac),.5)}
.slx-d .t-motion{background:color-mix(in srgb,rgb(var(--ok)) 14%,var(--in-b));border:1px solid rgba(var(--ok),.5);cursor:grab;touch-action:none;padding-left:56px}
.slx-d .t-sound{background:color-mix(in srgb,rgb(var(--snd)) 16%,var(--in-b));border:1px solid rgba(var(--snd),.5);cursor:grab;touch-action:none}
.slx-d .t-sound.linked{cursor:pointer;border-style:dashed}
.slx-d .t-base{background:color-mix(in srgb,rgb(var(--k)) 14%,var(--in-b));border:1px solid rgba(var(--k),.55);padding-left:96px;height:56px;top:12px}
.slx-d .t-base .t-still{width:88px}
.slx-d .t-blk.half{height:19px;border-radius:7px;font-size:11.5px;padding-right:8px}
.slx-d .t-blk.half.r1{top:21px}
.slx-d .t-blk.half .t-still{width:28px}
.slx-d .t-motion.half{padding-left:34px}
.slx-d .t-blk.half>.slx-ic{width:12px;height:12px}
.slx-d .t-blk.off{opacity:.38}
.slx-d .t-blk.busy{opacity:.6}
.slx-d .t-blk.sel:not(.t-zone){box-shadow:0 0 0 2px rgba(var(--ac),.6),0 0 18px rgba(var(--ac),.3)}
.slx-d .t-sound .t-wave{position:absolute;inset:0;width:100%;height:100%;opacity:.75;pointer-events:none}
.slx-d .t-still{position:absolute;left:0;top:0;height:100%;width:48px;object-fit:cover;pointer-events:none}
/* references */
.slx-d .t-refs{top:9px;bottom:9px}
.slx-d .t-refrow{display:flex;gap:8px;height:100%;align-items:center;overflow:hidden}
.slx-d .t-ref{display:flex;align-items:center;gap:8px;height:42px;padding:0 12px 0 4px;border-radius:12px;background:rgba(var(--cut),.1);
  border:1px solid rgba(var(--cut),.45);color:var(--text);min-width:0;max-width:360px}
.slx-d .t-ref img{width:34px;height:34px;border-radius:9px;object-fit:cover}
.slx-d .t-ref b{font-family:var(--fh);font-weight:600;color:rgb(var(--cut))}
.slx-d .t-ref span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.slx-d .t-ref i{font-style:normal;color:var(--text3);font-size:11px;white-space:nowrap}
.slx-d .t-ref.sel{border-color:rgb(var(--cut));box-shadow:0 0 18px rgba(var(--cut),.3)}
`;
