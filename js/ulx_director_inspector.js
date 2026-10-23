// Stubelius Ultimate LTX Director: the inspector of what you picked.
//
// A segment (its prompt, its picture on its first or last frame, or its clip, and how hard either guides), a
// keyframe (a picture the video passes through), a motion clip, a sound, a reference of the Cast, or the part a retake
// makes again. Under it the global prompt and what the sound and the motion are, and the seeds of the last render:
// point at one to see it, click to pick the winner; New seed and Hunt render again.
import { h, icon, clear, seg, button, iconButton, label, menu, slider, toggle, toast, goToStep } from "./ulx_ui.js";
import { pickFile, pickFiles, blockPicture, drawPeaks, dropTarget, dropTargetMany, isImageFile, isAudioFile, inputUrl, uploadMedia } from "./ulx_media.js";
import * as M from "./ulx_director_model.js";
import { addRefPictures, describeRef, refPictureUrl, setRefVoice } from "./ulx_director_cast.js";

let styled = false;
function injectStyles() {
  if (styled) return;
  styled = true;
  document.head.appendChild(h("style", { id: "stubelius-ultx-inspector", text: CSS }));
}

export function buildInspector(d) {
  injectStyles();
  const box = clear(d.insp);
  const p = d.picked();
  if (p.kind === "retake") retakeInspector(d, box);
  else if (p.kind === "seg") segmentInspector(d, box, p.item);
  else if (p.kind === "key") keyframeInspector(d, box, p.item);
  else if (p.kind === "motion") motionInspector(d, box, p.item);
  else if (p.kind === "audio") audioInspector(d, box, p.item);
  else if (p.kind === "ref") refInspector(d, box, p.item);
  else emptyInspector(d, box);
  if (p.kind !== "ref" && p.kind !== "retake") box.appendChild(rows(d, p));
  box.appendChild(seedsSection(d));
}

// ------------------------------------------------------------------------------------------- parts

function head(badgeText, title, sub, ...tools) {
  return h("div.i-head", h("div.i-badge", badgeText), h("div.i-headtxt", h("div.slx-h2", title), h("div.slx-muted", sub)),
    h("div.slx-spacer"), ...tools);
}

// A number in seconds that commits on Enter or leaving it
function secondsField(value, title, onSet, { min = 0, max = Infinity, places = 2 } = {}) {
  const input = h("input.i-num", { type: "text", inputMode: "decimal", value: Number(value).toFixed(places), title });
  input.addEventListener("change", () => {
    const v = parseFloat(String(input.value).replace(",", "."));
    if (Number.isFinite(v)) onSet(Math.max(min, Math.min(max, v)));
    else input.value = Number(value).toFixed(places);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
  return h("div.i-numwrap", input, h("span", "s"));
}

// A 0-1 (or wider) strength: a slider and its value
function strengthRow(name, value, onSet, { min = 0, max = 1, step = 0.05, title = "" } = {}) {
  const out = h("b.i-sval", Number(value).toFixed(2));
  const range = slider({ min, max, step, value, title, onInput: (v) => { out.textContent = Number(v).toFixed(2); }, onChange: (v) => onSet(v) });
  return h("div.i-srow", h("span.i-sname", name), range, out);
}

function mediaCard(url, title, sub, ...actions) {
  return h("div.i-media", h("div.i-thumb", url ? h("img", { src: url, draggable: false }) : icon("photo", 22)),
    h("div.i-mtxt", h("b", title), h("span.slx-muted", sub)), h("div.slx-spacer"), ...actions);
}

const fileBase = (p) => String(p || "").split(/[\\/]/).pop();

function describe(d, s) {
  if (s.start >= d.endF) return "past the end: not rendered";
  if (M.isClip(s)) return "a clip guides it";
  if (M.isPicture(s)) return s.isEndFrame ? "a picture pinned to its last frame" : "a picture on its first frame";
  return String(s.prompt || "").trim() ? "text" : "no prompt yet: the global prompt fills it";
}

// ------------------------------------------------------------------------------------------- segment

function segmentInspector(d, box, s) {
  const list = M.segmentsOf(d.t);
  const i = list.indexOf(s);
  const zones = d.zones || [];
  const zi = zones.findIndex((z) => z.seg === s);
  const z = zones[zi];
  const from = z ? z.from : s.start;
  const to = z ? (zi === zones.length - 1 ? Math.max(z.to, d.lastF) : z.to) : s.start + s.length;
  const playF = d.startF + d.frm(d.preview?.time || d.time || 0);
  const canCut = playF - s.start >= M.MIN_LEN && s.start + s.length - playF >= M.MIN_LEN;
  const nav = h("div.i-nav",
    iconButton("chevronRight", "The segment before", () => list[i - 1] && d.select("seg", list[i - 1].id)),
    iconButton("chevronRight", "The next segment", () => list[i + 1] && d.select("seg", list[i + 1].id)));
  nav.firstChild.disabled = i <= 0;
  nav.lastChild.disabled = i >= list.length - 1;
  const more = iconButton("dots", "More", (e) => menu(e.currentTarget, [
    { label: "Cut it at the playhead", icon: "cut", disabled: !canCut, hint: canCut ? d.fmt(playF) : "", onClick: () => d.addSegmentAt(playF) },
    { label: "Cut it in two", icon: "columns", onClick: () => d.addSegmentAt(s.start + Math.round(s.length / 2)) },
    null,
    { label: `Delete segment ${i + 1}`, icon: "trash", danger: true, onClick: () => d.removeSegment(s) },
  ]));
  box.appendChild(head(String(i + 1), `Segment ${i + 1}`, `${d.fmt(from)} – ${d.fmt(to)} · ${describe(d, s)}`, nav, more));

  // text, a picture or a clip
  const kind = M.isClip(s) ? "video" : M.isPicture(s) ? "image" : "text";
  box.appendChild(h("div.i-sec", h("div.i-sech", label("Segment")),
    seg([["text", "Text", "type", "Only the prompt"], ["image", "Picture", "photo", "A picture on its first or last frame"],
      ["video", "Video", "movie", "A clip guides its frames (its sound goes on the Audio lane)"]], kind, (v) => d.setKind(s, v), "i-kind")));

  // the prompt, and the segment's length (typed: the cut after it moves)
  const sec = h("div.i-sec");
  sec.appendChild(h("div.i-sech", label("Prompt"), h("span.slx-muted", "a spoken line goes in quotes")));
  const last = zi === zones.length - 1;
  const len = last
    ? h("span.i-dur.one", { title: "The last segment runs to the end of the video" }, d.sec(to - from).toFixed(1))
    : (() => {
      const input = h("input.i-dur", { type: "text", inputMode: "decimal", value: d.sec(to - from).toFixed(1),
        title: "This segment's length in seconds; the next segment gives or takes the difference" });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
      input.addEventListener("change", () => {
        const v = parseFloat(String(input.value).replace(",", "."));
        if (Number.isFinite(v) && v > 0) d.moveCut(s, from + d.frm(v));
        d.refresh(["tl", "insp", "preview"]);
      });
      return input;
    })();
  const ta = h("textarea.i-prompt", { rows: 3, placeholder: "What happens in this segment: action, camera, sound, a spoken line in quotes" });
  ta.value = s.prompt || "";
  const grow = () => { ta.style.height = "auto"; ta.style.height = `${Math.max(66, ta.scrollHeight)}px`; };
  const warn = h("div.i-note", { style: { display: "none" } }, icon("alert", 14), "A | would split the prompt in two: it is sent as a comma");
  let timer = 0;
  ta.addEventListener("input", () => {
    d.setPrompt(s, ta.value);
    grow();
    warn.style.display = ta.value.includes("|") ? "flex" : "none";
    clearTimeout(timer);
    timer = setTimeout(() => d.refresh(["tl", "foot"]), 350);
  });
  setTimeout(grow, 0);
  warn.style.display = ta.value.includes("|") ? "flex" : "none";
  sec.appendChild(h("div.i-cut", h("div.i-dur-wrap", len, h("span", "s")), ta));
  sec.appendChild(warn);
  if (d.refsOn) sec.appendChild(refChips(d, ta, (text) => d.setPrompt(s, text)));
  if (d.t.disable_prompt_relay) sec.appendChild(h("div.i-note", icon("info", 14), "Prompt relay is off (Settings): only the global prompt is used"));
  box.appendChild(sec);

  if (M.isPicture(s)) box.appendChild(pictureSection(d, s));
  if (M.isClip(s)) box.appendChild(clipSection(d, s));
}

// @ref chips under a prompt: a click puts the tag where the cursor is
function refChips(d, ta, onText) {
  const row = h("div.i-refchips");
  const filled = M.refsFilled(d.t);
  if (!filled.length) {
    row.appendChild(h("button.slx-link.i-reflink", { type: "button", onclick: () => d.select("ref", 0) }, icon("users", 13), "Add a reference to the Cast"));
    return row;
  }
  for (const { i, c } of filled) {
    row.appendChild(h("button.i-refchip", { type: "button", title: `Put @ref${i + 1} in the prompt`, onclick: () => {
      const tag = `@ref${i + 1}`;
      const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
      const before = ta.value.slice(0, a), after = ta.value.slice(b);
      const pad = before && !/\s$/.test(before) ? " " : "";
      ta.value = `${before}${pad}${tag} ${after}`;
      onText(ta.value);
      ta.focus();
      const at = before.length + pad.length + tag.length + 1;
      ta.setSelectionRange(at, at);
      ta.dispatchEvent(new Event("input"));
    } }, h("b", `@ref${i + 1}`), h("span", c.description || "no label")));
  }
  return row;
}

function pictureSection(d, s) {
  const sec = h("div.i-sec");
  sec.appendChild(h("div.i-sech", label("Picture"), s._uploading ? h("span.slx-muted", "uploading…") : null));
  const replace = button("Replace", "upload", "small", async () => { const f = await pickFile("image/*"); if (f) d.setPicture(s, f); });
  const card = mediaCard(blockPicture(s), fileBase(s.imageFile) || "picture",
    s.isEndFrame ? "lands on the segment's last frame" : "lands on the segment's first frame", replace);
  dropTarget(card, (file) => isImageFile(file) && d.setPicture(s, file));
  sec.appendChild(card);
  sec.appendChild(h("div.i-line", h("span.i-sname", "Pinned to"),
    seg([[false, "First frame", null, "The segment opens on it"], [true, "Last frame", null, "The segment ends on it (the last segment: the video's real last frame)"]],
      !!s.isEndFrame, (v) => d.pinPicture(s, v))));
  sec.appendChild(strengthRow("Guide strength", s.guideStrength ?? 1, (v) => { s.guideStrength = v; d.commit(); },
    { title: "How closely the frame follows the picture" }));
  return sec;
}

function clipSection(d, s) {
  const sec = h("div.i-sec");
  const frames = Number(s.videoDurationFrames) || s.length;
  sec.appendChild(h("div.i-sech", label("Video"), s._uploading ? h("span.slx-muted", "uploading…") : h("span.slx-muted", `${frames} frames at ${d.fps} fps`)));
  const replace = button("Replace", "upload", "small", async () => { const f = await pickFile("video/*"); if (f) d.setClip(s, f); });
  sec.appendChild(mediaCard(s.imageB64 || null, s.fileName || fileBase(s.imageFile) || "clip", `uses ${d.sec(s.length).toFixed(1)} s of ${d.sec(frames).toFixed(1)} s`, replace));
  const room = Math.max(0, frames - M.MIN_LEN);
  sec.appendChild(h("div.i-line", h("span.i-sname", "Starts at"), secondsField(d.sec(Number(s.trimStart) || 0), "Where in the clip its frames start", (v) => {
    s.trimStart = Math.max(0, Math.min(room, d.frm(v)));
    s.length = Math.max(M.MIN_LEN, Math.min(s.length, frames - s.trimStart));
    const sound = M.soundOf(d.t, s);
    if (sound) Object.assign(sound, { trimStart: s.trimStart, length: s.length });
    d.touch(["tl", "insp"]);
  }, { max: d.sec(room) }), h("span.slx-muted", "into the clip")));
  sec.appendChild(strengthRow("Guide strength", s.guideStrength ?? 1, (v) => { s.guideStrength = v; d.commit(); },
    { title: "How closely the frames follow the clip" }));
  const sound = M.soundOf(d.t, s);
  const audioOn = d.t.audioTrackEnabled !== false && !d.node.properties?.overrideAudio;
  sec.appendChild(h("div.i-note.dim", icon(sound ? "link" : "volumeOff", 14), !sound ? "No sound of its own: LTX makes the sound here"
    : audioOn ? "Its own sound plays from the Audio lane" : "Its own sound is on the Audio lane: turn on Your sounds there to use it"));
  return sec;
}

// ------------------------------------------------------------------------------------------- keyframe

function keyframeInspector(d, box, s) {
  const g = M.guideFrame(s);
  const where = g <= d.startF ? "the video's first frame" : g >= d.lastF - 1 ? "the video's last frame" : "a frame the video passes through";
  box.appendChild(head(icon("photo", 18), "Keyframe", `${d.fmt(g)} · ${where}`,
    iconButton("trash", "Remove this keyframe", () => d.removeKeyframe(s))));
  const sec = h("div.i-sec");
  const replace = button("Replace", "upload", "small", async () => { const f = await pickFile("image/*"); if (f) d.setPicture(s, f); });
  const card = mediaCard(blockPicture(s), fileBase(s.imageFile) || "picture", "owns no prompt: the segment around it does", replace);
  dropTarget(card, (file) => isImageFile(file) && d.setPicture(s, file));
  sec.append(h("div.i-sech", label("Picture")), card);
  box.appendChild(sec);

  // when the video reaches it: typed, nudged a frame at a time or slid, the preview following
  const tsec = h("div.i-sec", h("div.i-sech", label("When"), h("span.slx-muted", `frame ${g - d.startF}`)));
  const lo = d.startF, hi = d.lastF - 1;
  const to = (f) => { d.moveKeyframe(s, f); d.preview?.seek?.(d.sec(M.guideFrame(s) - d.startF)); d.refresh(["tl", "insp"]); };
  const range = slider({ min: lo, max: hi, step: 1, value: g, title: "Drag: the preview follows",
    onInput: (f) => d.preview?.seek?.(d.sec(f - d.startF)), onChange: (f) => to(f) });
  tsec.appendChild(h("div.i-line",
    iconButton("minus", "A frame earlier", () => to(g - 1)),
    secondsField(d.sec(g), "Seconds from the start of the timeline", (v) => to(d.frm(v)), { places: 2 }),
    iconButton("plus", "A frame later", () => to(g + 1)), range));
  box.appendChild(tsec);
  box.appendChild(h("div.i-sec", strengthRow("Guide strength", s.guideStrength ?? 1, (v) => { s.guideStrength = v; d.commit(); },
    { title: "How closely that frame follows the picture" })));
}

// ------------------------------------------------------------------------------------------- motion

function motionInspector(d, box, s) {
  const frames = Number(s.videoDurationFrames) || s.length;
  box.appendChild(head(icon("run", 18), "Motion clip", `${d.fmt(s.start)} – ${d.fmt(s.start + s.length)} · a guide video`,
    iconButton("trash", "Remove this motion clip", () => d.removeBlock("motionSegments", s))));
  const sec = h("div.i-sec");
  const replace = button("Replace", "upload", "small", async () => {
    const f = await pickFile("video/*");
    if (!f) return;
    s._uploading = true;
    d.refresh(["tl", "insp"]);
    try {
      const up = await uploadMedia(f);
      Object.assign(s, { videoFile: up.file, fileName: f.name, fileSize: f.size });
    } catch (err) {
      toast(d.root, "Upload failed: see the console", "bad");
    }
    delete s._uploading;
    d.touch(["tl", "insp"]);
  });
  sec.append(h("div.i-sech", label("Guide video"), s._uploading ? h("span.slx-muted", "uploading…") : null),
    mediaCard(s.imageB64 || null, s.fileName || fileBase(s.videoFile) || "motion clip", `${frames} frames at ${d.fps} fps`, replace));
  box.appendChild(sec);

  // the IC-LoRA (Setup) and how hard the clip pulls
  const models = d.modelsNode();
  const ic = models?.widgets?.find((w) => w.name === "ic_lora")?.value;
  const icStrength = Number(models?.widgets?.find((w) => w.name === "ic_lora_strength")?.value ?? 1);
  const none = !ic || String(ic).toLowerCase() === "none";
  const lsec = h("div.i-sec");
  lsec.appendChild(h("button.slx-chip.i-chip", { type: "button", title: "The IC-LoRA (Setup)", onclick: () => goToStep(1) },
    h("div.slx-ico.ok", icon("bolt", 16)), h("div", label("IC-LoRA"), h("div.i-chipval", none ? "none picked in Setup" : `${fileBase(ic).replace(/\.safetensors$/i, "")} · ${icStrength.toFixed(2)}`))));
  if (none) lsec.appendChild(h("div.i-note", icon("alert", 14), "The motion clip needs an IC-LoRA (Union Control) picked in Setup to move the picture"));
  lsec.appendChild(strengthRow("Video strength", s.videoStrength ?? 1, (v) => { s.videoStrength = v; d.commit(); },
    { title: "How hard the guide frames pull (0 leaves the clip out)" }));
  lsec.appendChild(strengthRow("Attention", s.videoAttentionStrength ?? 0.65, (v) => { s.videoAttentionStrength = v; d.commit(); },
    { title: "The guide's attention strength (used with an IC-LoRA)" }));
  box.appendChild(lsec);

  const tsec = h("div.i-sec", h("div.i-sech", label("Time")));
  tsec.appendChild(h("div.i-line", h("span.i-sname", "Starts at"), secondsField(d.sec(s.start), "Where on the timeline it starts", (v) => {
    s.start = d.frm(v);
    d.touch(["tl", "insp"]);
  })));
  tsec.appendChild(h("div.i-line", h("span.i-sname", "From"), secondsField(d.sec(Number(s.trimStart) || 0), "Where in the clip it starts", (v) => {
    s.trimStart = Math.max(0, Math.min(frames - M.MIN_LEN, d.frm(v)));
    s.length = Math.max(M.MIN_LEN, Math.min(s.length, frames - s.trimStart));
    d.touch(["tl", "insp"]);
  }), h("span.slx-muted", "into the clip")));
  tsec.appendChild(h("div.i-line", h("span.i-sname", "Length"), secondsField(d.sec(s.length), "How much of the clip it uses", (v) => {
    s.length = Math.max(M.MIN_LEN, Math.min(frames - (Number(s.trimStart) || 0), d.frm(v)));
    d.touch(["tl", "insp"]);
  })));
  tsec.appendChild(h("label.i-inline", toggle(!!d.node.properties?.overrideAudio, (v) => d.setClipSound(v),
    "The motion clips' own sound instead of LTX's (your sounds go off while this is on)"), "Use the motion clips' own sound instead of LTX's"));
  box.appendChild(tsec);
}

// ------------------------------------------------------------------------------------------- sound

function audioInspector(d, box, s) {
  const clip = M.clipOf(d.t, s);
  const frames = Number(s.audioDurationFrames) || s.length;
  box.appendChild(head(icon(clip ? "link" : "mic", 18), clip ? "The clip's sound" : "Sound",
    `${d.fmt(s.start)} – ${d.fmt(s.start + s.length)} · ${clip ? "moves with its clip" : s.fileName || "your sound"}`,
    iconButton("trash", clip ? "Remove the clip's sound (the clip stays)" : "Remove this sound", () => d.removeBlock("audioSegments", s))));
  const sec = h("div.i-sec");
  const canvas = h("canvas.i-wave", { width: 1000, height: 90 });
  sec.append(h("div.i-sech", label("Waveform"), h("span.slx-muted", `${d.sec(frames).toFixed(1)} s file`)), canvas);
  const tint = getComputedStyle(d.root).getPropertyValue("--snd").trim() || "63,213,255";
  requestAnimationFrame(() => drawPeaks(canvas, s.waveformPeaks || [], `rgba(${tint},.7)`));
  box.appendChild(sec);
  if (!clip) {
    const tsec = h("div.i-sec", h("div.i-sech", label("Time")));
    tsec.appendChild(h("div.i-line", h("span.i-sname", "Starts at"), secondsField(d.sec(s.start), "Where on the timeline it plays", (v) => {
      s.start = d.frm(v);
      d.touch(["tl", "insp"]);
    })));
    tsec.appendChild(h("div.i-line", h("span.i-sname", "From"), secondsField(d.sec(Number(s.trimStart) || 0), "Where in the file it starts", (v) => {
      s.trimStart = Math.max(0, Math.min(frames - 1, d.frm(v)));
      s.length = Math.max(1, Math.min(s.length, frames - s.trimStart));
      d.touch(["tl", "insp"]);
    }), h("span.slx-muted", "into the file")));
    tsec.appendChild(h("div.i-line", h("span.i-sname", "Length"), secondsField(d.sec(s.length), "How much of it plays", (v) => {
      s.length = Math.max(1, Math.min(frames - (Number(s.trimStart) || 0), d.frm(v)));
      d.touch(["tl", "insp"]);
    })));
    box.appendChild(tsec);
  }
  box.appendChild(audioSwitches(d));
}

function audioSwitches(d) {
  const sec = h("div.i-sec", h("div.i-sech", label("Sound")));
  const override = !!d.node.properties?.overrideAudio;
  sec.appendChild(h("label.i-inline", toggle(d.t.audioTrackEnabled !== false && !override, (v) => d.setAudioOn(v),
    "Your sounds on the Audio lane are used"), "Use your sounds"));
  sec.appendChild(h("label.i-inline", toggle(d.val("inpaint_audio", true) !== false, (v) => d.setFillGaps(v),
    "LTX makes sound where none of yours plays"), "LTX fills the gaps"));
  sec.appendChild(h("div.i-note.dim", icon("info", 14), `Now: ${d.audioSummary()}`));
  return sec;
}

// ------------------------------------------------------------------------------------------- reference

function refInspector(d, box, i) {
  const c = d.t.characters[i] || { images: [], description: "" };
  const msr = d.refMode === M.REF.msr;
  const n = (c.images || []).length;
  box.appendChild(head(`@${i + 1}`, `Reference ${i + 1} · @ref${i + 1}`,
    `${n} picture${n === 1 ? "" : "s"}${c.voice ? " and a voice" : ""} · ${d.refsOn ? (msr ? "Licon MSR" : "Ghost Mask") : "references are off"}`));
  if (!d.refsOn) {
    box.appendChild(h("div.i-note", icon("info", 14), "References are off: pick Licon MSR (or Ghost Mask) at the top to use them"));
  }
  // its pictures (views): drop or add up to three
  const sec = h("div.i-sec", h("div.i-sech", label("Pictures"), h("span.slx-muted", `up to ${M.REF_VIEWS}`)));
  const grid = h("div.i-views");
  (c.images || []).forEach((img, j) => {
    const del = h("button.i-view-del", { type: "button", title: "Remove this picture" }, icon("x", 12));
    del.addEventListener("click", (e) => { e.stopPropagation(); c.images.splice(j, 1); d.touch(["insp", "tl", "cast", "foot"]); });
    grid.appendChild(h("div.i-view", h("img", { src: refPictureUrl(img), draggable: false }), del));
  });
  if (n < M.REF_VIEWS) {
    const add = h("button.i-view.add", { type: "button", title: "Add pictures (one view each: front, side, back…)",
      onclick: async () => { const files = await pickFiles("image/*"); if (files.length) addRefPictures(d, i, files); } }, icon("plus", 20), "Add a view");
    dropTargetMany(add, (files) => addRefPictures(d, i, files.filter(isImageFile)));
    grid.appendChild(add);
  }
  sec.appendChild(grid);
  box.appendChild(sec);

  // its voice (Licon MSR with an AVref LoRA): how it sounds when a prompt gives it a line; the clip isn't played
  const vsec = h("div.i-sec", h("div.i-sech", label("Voice"),
    h("span.slx-muted", msr ? `its first ${M.VOICE_SECONDS} s set how it sounds` : "used with Licon MSR")));
  const pickVoice = async () => { const f = await pickFile("audio/*"); if (f) setRefVoice(d, i, f); };
  let vcard;
  if (c.voice) {
    vcard = h("div.i-media.i-voice", h("div.i-mtxt", h("b", fileBase(c.voice.name)),
      h("audio", { controls: true, preload: "metadata", src: inputUrl(c.voice.name) })),
    button("Replace", "upload", "small", pickVoice),
    iconButton("trash", "Remove the voice", () => { delete c.voice; d.touch(["insp", "tl", "cast"]); }));
  } else {
    vcard = h("button.i-voice-add", { type: "button", title: "A clip of this character speaking: only the voice is used", onclick: pickVoice },
      icon("mic", 18), "Add a voice clip");
  }
  dropTarget(vcard, (file) => isAudioFile(file) && setRefVoice(d, i, file));
  vsec.appendChild(vcard);
  if (msr) vsec.appendChild(h("div.i-note.dim", icon("info", 14), "Give it a line in quotes in a prompt: it's spoken in this voice. Needs an AVref MSR LoRA (Licon MSR V2)."));
  box.appendChild(vsec);

  // its label: short in MSR (the pictures carry the look), a description otherwise
  const lsec = h("div.i-sec", h("div.i-sech", label("Label"), h("span.slx-muted", msr ? "3-5 words; the pictures carry the look" : "who or what it is")));
  const input = h("textarea.slx-text.i-label", { rows: msr ? 1 : 3,
    placeholder: msr ? "e.g. man in yellow jacket" : "e.g. a red-haired woman in a green field jacket and brown boots" });
  input.value = c.description || "";
  let timer = 0;
  input.addEventListener("input", () => {
    c.description = input.value;
    d.commit();
    clearTimeout(timer);
    timer = setTimeout(() => d.refresh(["tl", "cast"]), 400);
  });
  const provider = d.t.analyzeProvider || "ollama";
  const describeBtn = button(c.description ? "Describe again" : "Describe it", "sparkles", "small", () => describeRef(d, i),
    `Let ${provider === "lmstudio" ? "LM Studio" : provider} write the label from the pictures (Settings)`);
  if (!n || provider === "off") describeBtn.disabled = true;
  lsec.append(input, h("div.i-line", describeBtn, h("div.slx-spacer"), h("span.slx-muted", `Write @ref${i + 1} in a prompt where it should be`)));
  box.appendChild(lsec);

  // how hard the pictures pull: the seeds (the Director's reference strength) and, with MSR, the refine (Output)
  const ssec = h("div.i-sec", h("div.i-sech", label("How hard the pictures pull")));
  ssec.appendChild(strengthRow("Seeds", Number(d.val("reference_strength", 1)), (v) => { d.set("reference_strength", v); d.commit(); },
    { max: 2, title: "The Director's reference strength (every reference)" }));
  const out = d.outputNode();
  const rw = out?.widgets?.find((w) => w.name === "refine_msr_reference");
  if (msr && rw) {
    ssec.appendChild(strengthRow("Refine", Number(rw.value ?? 0.4), (v) => { rw.value = v; out.setDirtyCanvas?.(true, true); d.finishNode()?._slx?.render?.(); },
      { title: "The MSR pull in the Output window's refine" }));
  }
  if (msr) {
    const text = [d.globalPrompt, ...d.t.segments.map((x) => x.prompt || "")].join(" ");
    const count = M.msrPictureCount(d.t, text);
    const tagged = M.taggedSlots(text);
    ssec.appendChild(h("div.i-note" + (count > M.MSR_LIMIT ? "" : ".dim"), icon(count > M.MSR_LIMIT ? "alert" : "info", 14),
      `${tagged.length ? `Your prompts name ${tagged.map((k) => "@ref" + (k + 1)).join(", ")}` : "No @ref in your prompts: every reference is used"}: `
      + `${count} picture${count === 1 ? "" : "s"}${count > M.MSR_LIMIT ? `, MSR takes the first ${M.MSR_LIMIT}` : ""}`));
  }
  box.appendChild(ssec);
  box.appendChild(globalRow(d));
}

// ------------------------------------------------------------------------------------------- retake

function retakeInspector(d, box) {
  const t = d.t;
  const rv = t.retakeVideo;
  const total = Number(rv?.videoDurationFrames) || d.durF;
  const rs = Number(t.retakeStart ?? 0), rl = Number(t.retakeLength ?? total);
  box.appendChild(head(icon("refresh", 18), "Retake a part", `${d.fmt(rs)} – ${d.fmt(rs + rl)} of ${d.fmt(total)} is made again`,
    button("Leave retake", "x", "small", () => d.setRetake(false))));
  const sec = h("div.i-sec", h("div.i-sech", label("Base video"), rv?._uploading ? h("span.slx-muted", "uploading…") : null));
  sec.appendChild(mediaCard(rv?._thumb || null, rv?.fileName || fileBase(rv?.imageFile) || "none yet", `${total} frames at ${d.fps} fps`,
    button("Another video", "upload", "small", () => d.setRetake(true))));
  box.appendChild(sec);
  const tsec = h("div.i-sec", h("div.i-sech", label("The part made again")));
  tsec.appendChild(h("div.i-line", h("span.i-sname", "From"), secondsField(d.sec(rs), "Where the part made again starts", (v) => {
    t.retakeStart = Math.max(0, Math.min(total - M.MIN_LEN, d.frm(v)));
    t.retakeLength = Math.max(M.MIN_LEN, Math.min(total - t.retakeStart, rl));
    d.touch(["tl", "insp"]);
  })));
  tsec.appendChild(h("div.i-line", h("span.i-sname", "Length"), secondsField(d.sec(rl), "How long the part made again is", (v) => {
    t.retakeLength = Math.max(M.MIN_LEN, Math.min(total - rs, d.frm(v)));
    d.touch(["tl", "insp"]);
  })));
  const ta = h("textarea.i-prompt", { rows: 3, placeholder: "What happens in the part made again" });
  ta.value = t.retakePrompt || "";
  ta.addEventListener("input", () => { t.retakePrompt = ta.value; d.commit(); });
  tsec.append(h("div.i-sech", label("Prompt for it")), ta);
  tsec.appendChild(strengthRow("Strength", Number(t.retakeStrength ?? 1), (v) => { t.retakeStrength = v; d.commit(); },
    { title: "1 makes the part again from noise; lower keeps more of the base video" }));
  box.appendChild(tsec);
  box.appendChild(globalRow(d));
}

// ------------------------------------------------------------------------------------------- empty

function emptyInspector(d, box) {
  box.appendChild(head(icon("lines", 18), "No segments yet", "Write a prompt, or drop a picture on the timeline"));
  box.appendChild(h("div.i-sec", button("Write the first prompt", "plus", "brand", () => d.addSegmentAt(d.startF)),
    h("div.slx-muted", "A segment is a stretch of the video with its own prompt. One segment over the whole video works; "
      + "add more to change what happens, and pictures for the frames it should hit.")));
}

// ------------------------------------------------------------------------------------------- the rows under it

function globalRow(d) {
  const open = d.ui.fold?.global !== false;
  const src = d.globalSource();
  const value = d.globalPrompt;
  const row = h("div.i-row", { class: open ? "open" : null });
  const headRow = h("button.i-row-head", { type: "button", onclick: () => {
    d.ui.fold = { ...(d.ui.fold || {}), global: !open };
    d.saveUi();
    d.refresh(["insp"]);
  } }, icon("palette", 16), h("span.i-row-k", "Global"),
  h("span.i-row-v", { class: value.trim() ? null : "muted" }, value.trim() || "A prompt for the whole video: who, where, the style"),
  icon(open ? "chevronUp" : "chevronDown", 16));
  row.appendChild(headRow);
  if (open) {
    const ta = h("textarea.slx-text", { rows: 3, placeholder: "Who and where, the look and the sound that hold for the whole video" });
    ta.value = value;
    ta.addEventListener("input", () => {
      d.setGlobalPrompt(ta.value);
      headRow.querySelector(".i-row-v").textContent = ta.value.trim() || "A prompt for the whole video";
    });
    const body = h("div.i-row-body", ta);
    if (src) body.appendChild(h("div.i-note.dim", icon("link", 14), `From ${src.title || src.type} (linked): edits go there too`));
    if (d.refsOn) body.appendChild(refChips(d, ta, (text) => d.setGlobalPrompt(text)));
    row.appendChild(body);
  }
  return h("div.i-rows", row);
}

function rows(d, p) {
  const box = globalRow(d);
  // the sound
  box.appendChild(h("button.i-row-head.i-row1", { type: "button", title: "The sound: click for the switches",
    onclick: () => { const a = d.t.audioSegments[0]; if (a) d.select("audio", a.id); } },
  icon("wave", 16), h("span.i-row-k", "Sound"), h("span.i-row-v", d.audioSummary())));
  // the motion under the segment
  let motion = "No guide video";
  if (p.kind === "seg" || p.kind === "key") {
    const z = d.zoneOf(p.item);
    const from = z ? z.from : p.item.start, to = z ? z.to : p.item.start + p.item.length;
    const under = d.t.motionSegments.filter((m) => m.start < to && m.start + m.length > from);
    motion = under.length ? under.map((m) => m.fileName || "clip").join(", ") + (d.t.motionTrackEnabled === false ? " (off)" : "") : "No guide video under this segment";
  } else if (d.t.motionSegments.length) {
    motion = `${d.t.motionSegments.length} clip${d.t.motionSegments.length > 1 ? "s" : ""}`;
  }
  box.appendChild(h("button.i-row-head.i-row1", { type: "button", title: "Motion: click to see the clip",
    onclick: () => { const m = d.t.motionSegments[0]; if (m) d.select("motion", m.id); } },
  icon("run", 16), h("span.i-row-k", "Motion"), h("span.i-row-v", motion)));
  return box;
}

// ------------------------------------------------------------------------------------------- seeds

function seedsSection(d) {
  const sec = h("div.i-sec.i-seeds-sec");
  const vids = d.seedVideos();
  const win = d.winner();
  sec.appendChild(h("div.i-sech", label("Seeds"), h("span.slx-muted",
    vids.length ? `${vids.length} rendered · ${win && vids.some((v) => v.candidate === win) ? `seed ${win} picked` : "none picked yet"}` : "No seeds yet")));
  if (vids.length) {
    const row = h("div.i-seeds");
    for (const v of vids) {
      const on = v.candidate === win;
      const tile = h("button.i-seed", { type: "button", class: on ? "on" : null,
        title: `Seed ${v.candidate}${v.seed != null ? " · " + v.seed : ""}: ${on ? "the winner" : "click to pick it as the winner"}` },
      h("b", String(v.seed ?? v.candidate)), h("span", v.sampler || `seed ${v.candidate}`), on ? h("i", icon("crown", 14)) : null);
      tile.addEventListener("mouseenter", () => d.preview.showSeed(v.candidate));
      tile.addEventListener("mouseleave", () => d.preview.showSeed(null));
      tile.addEventListener("click", () => d.pickWinner(v.candidate));
      row.appendChild(tile);
    }
    sec.appendChild(row);
    if (d.editSeq > d.renderedSeq) sec.appendChild(h("div.i-note", icon("info", 14), "You changed the timeline since these seeds: render to see the change"));
  }
  const n = d.huntCount();
  const more = iconButton("chevronDown", "How many seeds to hunt with: 2, 3 or 4", (e) => menu(e.currentTarget, [2, 3, 4].map((x) => ({
    label: `Hunt with ${x} new seeds`, icon: x === n ? "check" : null, onClick: () => { d.setHuntCount(x); d.hunt(x); },
  }))));
  more.classList.add("i-hunt-n");
  sec.appendChild(h("div.i-tbtns",
    button("New seed", "refresh", "", () => d.newSeedRender(), "Render the video again with a new seed"),
    h("div.i-hunt", button(`Hunt ×${n}`, "dice", "brand", () => d.hunt(n), `Render ${n} new seeds side by side; pick one here or in Seeds`), more)));
  return sec;
}

const CSS = `
.slx-d .i-head{display:flex;align-items:center;gap:12px}
.slx-d .i-headtxt{min-width:0}
.slx-d .i-headtxt .slx-muted{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.slx-d .i-nav{display:flex;gap:6px}
.slx-d .i-nav .slx-ibtn:first-child svg{transform:rotate(180deg)}
.slx-d .i-nav .slx-ibtn:disabled{opacity:.35}
.slx-d .i-badge{min-width:40px;height:40px;padding:0 8px;border-radius:12px;background:var(--brand);color:var(--on);display:grid;place-items:center;
  font-family:var(--fh);font-weight:700;font-size:17px;box-shadow:0 6px 24px rgba(var(--ac),.4);flex:none}
.slx-d .i-sec{display:flex;flex-direction:column;gap:9px}
.slx-d .i-sech{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:22px}
.slx-d .i-kind{background:var(--glass);border-radius:13px}
.slx-d .i-kind .slx-seg-opt{flex:1;justify-content:center}
.slx-d .i-cut{display:flex;gap:10px;align-items:flex-start;border-radius:13px;background:var(--glass);border:1px solid var(--stroke);padding:10px 10px 8px 12px}
.slx-d .i-cut:focus-within{border-color:rgba(var(--ac),.55)}
.slx-d .i-dur-wrap{display:flex;align-items:baseline;gap:1px;flex:none;padding-top:3px;color:rgb(var(--ac));font-family:var(--fh);font-weight:600}
.slx-d .i-dur-wrap span{font-size:12px;opacity:.8}
.slx-d .i-dur{width:40px;background:none;border:0;border-bottom:1px dashed rgba(var(--ac),.35);color:rgb(var(--ac));font-family:var(--fh);
  font-weight:600;font-size:14px;padding:0;text-align:right;outline:none}
.slx-d .i-dur.one{border:0;display:inline-block}
.slx-d .i-prompt{flex:1;min-width:0;background:none;border:0;color:var(--text);resize:none;outline:none;font-size:13.5px;line-height:1.45;
  padding:2px 0;overflow:hidden;min-height:66px;font-family:inherit}
.slx-d .i-sec>.i-prompt{border-radius:13px;background:var(--glass);border:1px solid var(--stroke);padding:10px 12px}
.slx-d .i-prompt::placeholder{color:var(--text3)}
.slx-d .i-refchips{display:flex;gap:6px;flex-wrap:wrap}
.slx-d .i-refchip{display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:20px;background:rgba(var(--cut),.1);border:1px solid rgba(var(--cut),.45);
  color:var(--text);font-size:12px;max-width:100%}
.slx-d .i-refchip b{color:rgb(var(--cut));font-family:var(--fh)}
.slx-d .i-refchip span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px;color:var(--text2)}
.slx-d .i-reflink{display:flex;align-items:center;gap:6px;font-size:12px}
.slx-d .i-media{display:flex;align-items:center;gap:12px;padding:10px;border-radius:14px;background:var(--glass);border:1px solid var(--stroke)}
.slx-d .i-media.over{border-color:rgba(var(--ac),.7)}
.slx-d .i-thumb{width:96px;height:56px;border-radius:10px;overflow:hidden;background:#000;display:grid;place-items:center;color:var(--text3);flex:none;
  border:1px solid var(--stroke2)}
.slx-d .i-thumb img{width:100%;height:100%;object-fit:cover}
.slx-d .i-mtxt{display:flex;flex-direction:column;gap:2px;min-width:0}
.slx-d .i-mtxt b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
.slx-d .i-mtxt span{font-size:12px}
.slx-d .i-line{display:flex;align-items:center;gap:10px;min-width:0}
.slx-d .i-line .slx-range{flex:1}
.slx-d .i-sname{color:var(--text2);width:104px;flex:none}
.slx-d .i-srow{display:flex;align-items:center;gap:12px}
.slx-d .i-srow .slx-range{flex:1}
.slx-d .i-sval{font-family:var(--fh);font-weight:600;width:40px;text-align:right}
.slx-d .i-numwrap{display:flex;align-items:baseline;gap:3px}
.slx-d .i-num{width:64px;height:32px;border-radius:9px;background:var(--field);border:1px solid var(--stroke2);color:var(--text);
  font-family:var(--fh);font-weight:600;font-size:14px;text-align:right;padding:0 8px;outline:none}
.slx-d .i-num:focus{border-color:rgba(var(--ac),.7)}
.slx-d .i-numwrap span{color:var(--text2);font-size:12px}
.slx-d .i-inline{display:flex;align-items:center;gap:10px;color:var(--text2);cursor:pointer}
.slx-d .i-chip{width:100%}
.slx-d .i-chipval{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.slx-d .i-wave{width:100%;height:90px;border-radius:12px;background:var(--well);border:1px solid var(--stroke)}
.slx-d .i-views{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.slx-d .i-view{position:relative;aspect-ratio:3/4;border-radius:14px;overflow:hidden;border:1px solid var(--stroke2);background:#000;padding:0}
.slx-d .i-view img{width:100%;height:100%;object-fit:cover}
.slx-d .i-view.add{background:var(--glass);border-style:dashed;color:var(--text3);display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:6px;font-size:12px}
.slx-d .i-view.add:hover,.slx-d .i-view.add.over{color:var(--text);border-color:rgba(var(--cut),.7)}
.slx-d .i-view-del{position:absolute;right:6px;top:6px;width:22px;height:22px;border-radius:50%;border:0;background:rgba(0,0,0,.65);color:#fff;
  display:grid;place-items:center;padding:0;cursor:pointer}
.slx-d .i-view-del:hover{background:rgba(var(--bad),.9)}
.slx-d .i-voice .i-mtxt{flex:1;gap:6px}
.slx-d .i-voice audio{width:100%;height:32px}
.slx-d .i-voice-add{display:flex;align-items:center;justify-content:center;gap:8px;height:52px;border-radius:14px;border:1px dashed var(--stroke2);
  background:var(--glass);color:var(--text3);font-size:12px;cursor:pointer}
.slx-d .i-voice-add:hover,.slx-d .i-voice-add.over,.slx-d .i-voice.over{color:var(--text);border-color:rgba(var(--snd),.7)}
.slx-d .i-label{font-size:13.5px}
.slx-d .i-note{display:flex;align-items:flex-start;gap:7px;font-size:12px;color:rgb(var(--cut));line-height:1.4}
.slx-d .i-note.dim{color:var(--text2)}
.slx-d .i-note .slx-ic{margin-top:1px;flex:none}
.slx-d .i-rows{display:flex;flex-direction:column;border-radius:14px;border:1px solid var(--stroke);overflow:hidden}
.slx-d .i-rows>*+*{border-top:1px solid var(--stroke)}
.slx-d .i-row-head{display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--glass);width:100%;border:0;text-align:left;color:var(--text)}
.slx-d .i-row-head:hover{background:var(--glass2)}
.slx-d .i-row-head .slx-ic{color:var(--text3);flex:none}
.slx-d .i-row-k{width:70px;color:var(--text2);flex:none}
.slx-d .i-row-v{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.slx-d .i-row-v.muted{color:var(--text3)}
.slx-d .i-row-body{padding:8px 12px 10px;background:var(--glass);display:flex;flex-direction:column;gap:8px}
.slx-d .i-seeds{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.slx-d .i-seed{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:10px 12px;border-radius:13px;
  background:var(--glass);border:1px solid var(--stroke2);color:var(--text);text-align:left;min-width:0}
.slx-d .i-seed b{font-family:var(--fh);font-weight:600;font-size:14px;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.slx-d .i-seed span{font-size:11px;color:var(--text3);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.slx-d .i-seed i{position:absolute;right:8px;top:8px;color:rgb(var(--ac))}
.slx-d .i-seed:hover{border-color:rgba(var(--ac),.5)}
.slx-d .i-seed.on{border:2px solid rgb(var(--ac));box-shadow:0 0 0 4px rgba(var(--ac),.16),0 10px 30px rgba(var(--ac),.3)}
.slx-d .i-tbtns{display:flex;gap:8px}
.slx-d .i-tbtns>.slx-btn{flex:1}
.slx-d .i-hunt{flex:1;display:flex;gap:0;min-width:0}
.slx-d .i-hunt .slx-btn{flex:1;border-top-right-radius:0;border-bottom-right-radius:0}
.slx-d .i-hunt .i-hunt-n{height:40px;width:36px;border-radius:0 12px 12px 0;border:1px solid rgba(var(--ac),.5);border-left:0;
  background:linear-gradient(100deg,rgba(var(--ac),.16),rgba(var(--ac2),.1))}
`;
