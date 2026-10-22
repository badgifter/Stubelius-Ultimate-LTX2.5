// Stubelius Ultimate LTX: the Director window (step 2 of 4), on the LTX Director node.
//
// What the video is, in the pack's look: a header with the step bar and the references switch, a command bar
// (size, length, frame rate, seed, the Setup mode, the model and the output, Render), a big preview of the latest
// seeds, an inspector for what you picked (a segment, a keyframe, a motion clip, a sound, a reference), a timeline
// across the video (keyframes, prompts, motion, audio, references) and, with references on, the cast.
//
// Everything stays in the node's own widgets: timeline_data and the three strings the Python side reads from it,
// written exactly as the classic editor writes them (ulx_director_model.js). A workflow that opens the node as a
// plain node keeps the classic editor (js/ltx_director.js), with a Show as window button under it.
import {
  h, icon, clear, seg, button, iconButton, label, menu, closeMenus, toast, popover, windowFrame, markSteps, goToStep,
  injectStyles, widget, widgetValue, setWidget, sourceOf, nodesOfType, hideWidget, mountWindow, autoHeight, refreshThemes,
  queueRun, confirmIn,
} from "./ulx_ui.js";
import { modeOf, precision } from "./ulx_setup.js";
import { uploadFile, uploadMedia, mediaAudio, inputUrl, extractAudioPeaks, pickFile, blockPicture, clipMeta } from "./ulx_media.js";
import * as M from "./ulx_director_model.js";
import { buildPreview } from "./ulx_director_preview.js";
import { buildInspector } from "./ulx_director_inspector.js";
import { buildTimeline } from "./ulx_director_timeline.js";
import { buildCast } from "./ulx_director_cast.js";
import { openSettings } from "./ulx_director_settings.js";

const { app } = window.comfyAPI.app;
const { api } = window.comfyAPI.api;

window.__stubeliusLtxDirectorWindow = true;     // js/ltx_director.js: the editor waits for this file's choice

export const WIDGETS = ["start_second", "end_second", "duration_seconds", "start_frame", "end_frame", "duration_frames",
  "timeline_data", "local_prompts", "segment_lengths", "epsilon", "guide_strength", "use_custom_audio", "use_custom_motion",
  "inpaint_audio", "frame_rate", "display_mode", "custom_width", "custom_height", "resize_method", "divisible_by",
  "img_compression", "override_audio", "reference_strength"];
export const SIZES = [[1280, 704, "HD"], [1920, 1088, "Full HD"], [1088, 1920, "Portrait"], [1024, 1024, "Square"],
  [768, 512, "Small"]];
export const FPS_CHOICES = [24, 25, 30, 48, 50, 60];
const MODES = [["Full size", "full size · sharp"], ["Draft", "half size · refine"], ["Low VRAM", "memory savers"]];
const HALF = 0.5;
const REF_OPTIONS = [
  [M.REF.off, "No references", null, "The prompts and the pictures on the timeline make the video"],
  [M.REF.msr, "Licon MSR", null, "Characters and items from the Cast keep their look (needs the MSR LoRA in Setup)"],
  [M.REF.ghost, "Ghost Mask", null, "The Cast pictures go in hidden frames after the video (the LTX 2.3 method)"],
];
const SIZE_LABEL = { "native (no upscale)": "Native", "2K (1440p)": "2K", "4K (2160p)": "4K" };

export const shortName = (n) => String(n || "").split(/[\\/]/).pop().replace(/\.(safetensors|gguf|ckpt|pt|pth)$/i, "");
export const isNone = (n) => !n || String(n).toLowerCase() === "none";
export const newSeed = () => Math.floor(Math.random() * 2 ** 32);

// A model file as a name: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot" -> "LTX 2.5 22B distilled"
export function modelLabel(name) {
  let s = shortName(name).replace(/(^|[_\-.])(int8|fp8|bf16|fp16|fp32|nvfp4|e4m3fn|e5m2|q\d(_[a-z0-9]+)*|gguf|comfy|convrot|transformer|scaled)(?=$|[_\-.])/gi, "$1");
  s = s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return s.replace(/^ltx\s?(\d)/i, "LTX $1").replace(/\b(\d+)b\b/i, "$1B");
}
const round3 = (v) => parseFloat(Number(v).toFixed(3));

// ------------------------------------------------------------------------------------------- the window

export class DirectorWindow {
  constructor(node) {
    this.node = node;
    this.w = {};
    for (const n of WIDGETS) this.w[n] = widget(node, n);
    this.ui = { sel: null, fold: {}, ...(node.properties?.slx_dir || {}) };
    this.run = { state: "idle" };      // idle | queued | running | done | error
    this.live = null;                  // live sampling frames while the seeds render
    this.stats = null;                 // /system_stats
    this.time = 0;                     // the playhead, seconds from the video's first frame
    this.editSeq = 0;                  // edits so far; the seeds on show were rendered at renderedSeq
    this.renderedSeq = 0;
    this.load();
    injectStyles();
    injectDirectorStyles();
    const f = windowFrame({ title: "Ultimate LTX · Director", subtitle: "What the video is", step: 2, onStep: goToStep });
    Object.assign(this, f);
    this.root.classList.add("slx-d");
    this.refSwitch = h("div.d-hdr-mode");
    this.status = h("div.slx-status", h("span.slx-dot"), h("span", "Ready"));
    this.head.append(this.refSwitch, h("div.slx-spacer"), this.status,
      iconButton("settings", "Settings: prompt relay, resizing, references, retake", (e) => openSettings(this, e.currentTarget)));
    this.cmd = h("div.d-cmd");
    this.preview = buildPreview(this);
    this.insp = h("div.d-insp.slx-panel");
    this.tl = h("div.d-tl.slx-panel");
    this.cast = h("div.d-cast");
    this.body.append(this.cmd, h("div.d-main", this.preview.el, this.insp), this.tl, this.cast);
    this.commit(false);                // the classic editor re-derives its strings when it opens; so does the window
    this.refresh();
    this.listen();
    this.fetchStats();
  }

  // The timeline from timeline_data; its own copies of the audio switches win, as when the classic editor opens it
  load() {
    const t = M.parseTimeline(this.w.timeline_data?.value);
    const p = (this.node.properties ||= {});
    if (this.w.inpaint_audio) this.w.inpaint_audio.value = t.inpaint_audio !== false;
    p.overrideAudio = !!t.overrideAudio;
    if (this.w.override_audio) this.w.override_audio.value = !!t.overrideAudio;
    p.showFilenames = t.showFilenames;
    const gp = t.retakeMode ? t.retake_global_prompt : t.global_prompt;
    if (gp) p.global_prompt = gp;
    this.t = t;
  }

  // ----------------------------------------------------------------------------------- widgets

  val(name, fallback = null) {
    const w = this.w[name];
    return w && w.value !== undefined && w.value !== null ? w.value : fallback;
  }

  set(name, value) {
    const w = this.w[name];
    if (w) w.value = value;
  }

  get fps() { const v = parseInt(this.val("frame_rate"), 10); return v > 0 ? v : 24; }
  get startF() { const v = parseInt(this.val("start_frame"), 10); return v >= 0 ? v : 0; }
  get durF() { const v = parseInt(this.val("duration_frames"), 10); return v > 0 ? v : 24; }
  get endF() { return this.startF + this.durF; }
  get lastF() { return this.startF + M.ltxvLength(this.durF); }        // the frame after the real last one
  get retake() { return !!this.t.retakeMode; }
  get viewF() {
    if (this.retake) return Math.max(this.lastF, Number(this.t.retakeVideo?.videoDurationFrames) || 0);
    return Math.max(this.lastF, M.visualFrames(this.t, this.startF, this.durF));
  }
  get refMode() { return this.t.reference_mode || M.REF.off; }
  get refsOn() { return this.refMode === M.REF.msr || this.refMode === M.REF.ghost; }
  sec(f) { return f / this.fps; }
  frm(s) { return Math.round(s * this.fps); }
  fmt(f) { return `${this.sec(f).toFixed(1)} s`; }

  // Everything the classic editor writes on an edit: timeline_data, the three strings, the track switches, and every
  // widget mirrored into the node's properties (the classic editor restores the widgets from them on load)
  commit(edited = true) {
    const t = this.t;
    const p = (this.node.properties ||= {});
    const start = this.startF, dur = this.durF;
    if (!t.retakeMode) { t.normalStartFrame = start; t.normalDurationFrames = dur; }
    const d = M.deriveStrings(t, start, dur);
    this.zones = d.zones;
    const inpaint = this.val("inpaint_audio", true) !== false;
    t.inpaint_audio = inpaint;
    t.overrideAudio = !!p.overrideAudio;
    this.set("timeline_data", JSON.stringify(M.serializeTimeline(t, { showFilenames: p.showFilenames,
      showPromptZones: p.showPromptZones, overrideAudio: p.overrideAudio, inpaintAudio: inpaint })));
    this.set("local_prompts", d.localPrompts);
    this.set("segment_lengths", d.segmentLengths);
    this.set("guide_strength", d.guideStrength);
    this.set("use_custom_audio", t.audioTrackEnabled !== false);
    this.set("use_custom_motion", t.motionTrackEnabled !== false);
    this.set("override_audio", !!p.overrideAudio);
    for (const n of WIDGETS) if (this.w[n] && this.w[n].value !== undefined) p[n] = this.w[n].value;
    p.global_prompt = (t.retakeMode ? t.retake_global_prompt : t.global_prompt) || "";
    p.mainTrackEnabled = t.mainTrackEnabled !== false;
    p.audioTrackEnabled = t.audioTrackEnabled !== false;
    p.motionTrackEnabled = t.motionTrackEnabled !== false;
    p.retakeMode = !!t.retakeMode;
    this.node.setDirtyCanvas?.(true, true);
    if (edited) {
      this.editSeq++;
      this.noteChange();
    }
  }

  touch(parts = null) {
    this.commit();
    this.refresh(parts);
  }

  // ComfyUI marks the workflow changed (and keeps an undo step) when it checks the graph: ask it to look
  noteChange() {
    clearTimeout(this._noteTimer);
    this._noteTimer = setTimeout(() => {
      try { app.extensionManager?.workflow?.activeWorkflow?.changeTracker?.checkState?.(); } catch (e) { /* older frontend */ }
    }, 400);
  }

  saveUi() {
    this.node.properties = this.node.properties || {};
    this.node.properties.slx_dir = { sel: this.ui.sel, fold: this.ui.fold };
  }

  // Render length, start and frame rate go into all six time widgets, as the classic editor keeps them
  writeWindow(startF, durF) {
    const fps = this.fps;
    this.set("start_frame", startF);
    this.set("duration_frames", durF);
    this.set("end_frame", startF + durF);
    this.set("start_second", round3(startF / fps));
    this.set("duration_seconds", round3(durF / fps));
    this.set("end_second", round3((startF + durF) / fps));
  }

  setLength(seconds) {
    const old = this.durF;
    const dur = Math.max(1, Math.min(10000, Math.round(seconds * this.fps)));
    if (dur === old) { this.renderCmd(); return; }
    this.writeWindow(this.startF, dur);
    this.set("duration_seconds", round3(Math.max(0.1, seconds)));
    M.refitEnd(this.t, this.startF, old, dur);
    this.touch();
    this.others();
  }

  setStart(seconds) {
    const start = Math.max(0, this.frm(seconds));
    if (start === this.startF) return;
    this.writeWindow(start, this.durF);
    this.touch();
  }

  setFps(n) {
    n = Math.max(1, Math.min(240, Math.round(Number(n) || 0)));
    const old = this.fps;
    if (!n || n === old) return;
    const startS = this.startF / old, durS = this.durF / old;
    M.rebaseFps(this.t, old, n);
    this.set("frame_rate", n);
    this.writeWindow(Math.round(startS * n), Math.max(1, Math.round(durS * n)));
    this.touch();
    this.others("fps");
  }

  setSize(w, hgt) {
    this.set("custom_width", Math.max(0, Math.round(w)));
    this.set("custom_height", Math.max(0, Math.round(hgt)));
    this.touch(["cmd"]);
    this.others("size");
  }

  // the other windows show the size and the frame rate too
  others(name = "director") {
    this.setupNode()?._slx?.render?.();
    this.finishNode()?._slx?.render?.();
    window.dispatchEvent(new CustomEvent("stubelius-ltx-setup", { detail: { name } }));
  }

  // ----------------------------------------------------------------------------------- the other nodes

  setupNode() { return nodesOfType("StubeliusLTXSetup")[0] || null; }
  modelsNode() { return nodesOfType("StubeliusLTXModels")[0] || null; }
  outputNode() { return nodesOfType("StubeliusLTXOutput")[0] || null; }
  finishNode() { return nodesOfType("StubeliusLTXFinish")[0] || null; }
  previewsNode() { return nodesOfType("StubeliusLTXSeedPreviews")[0] || null; }
  seedsNode() { return nodesOfType("StubeliusLTXSeeds")[0] || null; }

  seedVideos() {
    return this.previewsNode()?.properties?.slx_seeds || [];
  }

  winner() {
    return Number(widgetValue(this.finishNode(), "winner", 0)) || 0;
  }

  // ----------------------------------------------------------------------------------- the global prompt

  // Linked to another node's text, that text is the global prompt (the classic editor writes both, as here)
  globalSource() {
    const src = sourceOf(this.node, "global_prompt");
    return src?.widgets?.[0] && typeof src.widgets[0].value === "string" ? src : null;
  }

  get globalPrompt() {
    const src = this.globalSource();
    if (src) return String(src.widgets[0].value ?? "");
    return (this.retake ? this.t.retake_global_prompt : this.t.global_prompt) || "";
  }

  setGlobalPrompt(text) {
    if (this.retake) this.t.retake_global_prompt = text;
    else this.t.global_prompt = text;
    const src = this.globalSource();
    if (src) {
      src.widgets[0].value = text;
      src.setDirtyCanvas?.(true, true);
    }
    this.commit();
  }

  // ----------------------------------------------------------------------------------- selection

  select(kind, id = null) {
    this.ui.sel = kind ? { kind, id } : null;
    this.saveUi();
    this.refresh(["insp", "tl", "cast"]);
  }

  // What the inspector shows: {kind, item}. A segment's own picture shows as that segment.
  picked() {
    const s = this.ui.sel;
    const t = this.t;
    if (this.retake) return { kind: "retake" };
    if (s?.kind === "ref" && s.id >= 0 && s.id < M.REF_SLOTS) return { kind: "ref", item: s.id };
    if (s?.kind === "motion") { const m = t.motionSegments.find((x) => x.id === s.id); if (m) return { kind: "motion", item: m }; }
    if (s?.kind === "audio") { const a = t.audioSegments.find((x) => x.id === s.id); if (a) return { kind: "audio", item: a }; }
    if (s?.kind === "key" || s?.kind === "seg") {
      const b = t.segments.find((x) => x.id === s.id);
      if (b) return { kind: b.isAnchor ? "key" : "seg", item: b };
    }
    const first = M.segmentsOf(t).find((x) => x.start + x.length > this.startF) || M.segmentsOf(t)[0];
    return first ? { kind: "seg", item: first } : { kind: "none" };
  }

  zoneOf(s) {
    return (this.zones || []).find((z) => z.seg === s) || null;
  }

  // The zone (and so the segment) a frame is in
  zoneAt(f) {
    const z = this.zones || [];
    return z.find((x) => f >= x.from && f < x.to) || (f >= this.endF ? z[z.length - 1] : z[0]) || null;
  }

  // ----------------------------------------------------------------------------------- segments

  // A new segment at frame f: the one it falls in is cut there (in the middle when f is too near an edge)
  addSegmentAt(f) {
    const t = this.t;
    const list = M.segmentsOf(t);
    if (!list.length) {
      const s = { id: M.newId(), start: this.startF, length: this.durF, prompt: "", type: "text", isEndFrame: false };
      t.segments.push(s);
      this.ui.sel = { kind: "seg", id: s.id };
      this.saveUi();
      this.touch();
      this.focusPrompt();
      return s;
    }
    const z = this.zoneAt(f);
    const host = z?.seg || list[list.length - 1];
    let at = Math.round(f);
    if (at - host.start < M.MIN_LEN || host.start + host.length - at < M.MIN_LEN) at = host.start + Math.round(host.length / 2);
    const made = M.splitSegment(t, host, at);
    if (!made) {
      toast(this.root, "That segment is too short to cut in two: make it longer first");
      return null;
    }
    const sound = M.soundOf(t, host);
    if (sound) Object.assign(sound, { start: host.start, length: host.length });
    this.ui.sel = { kind: "seg", id: made.id };
    this.saveUi();
    this.touch();
    this.focusPrompt();
    return made;
  }

  async removeSegment(s) {
    const busy = String(s.prompt || "").trim() || s.imageFile || s.imageB64;
    if (busy && !(await confirmIn(this.root, { title: "Delete this segment?", text: "Its prompt and its picture or clip go; the segment before it takes its time.",
      ok: "Delete it", danger: true }))) return;
    const list = M.segmentsOf(this.t);
    const i = list.indexOf(s);
    M.removeSegment(this.t, s);
    const next = M.segmentsOf(this.t)[Math.max(0, i - 1)];
    this.ui.sel = next ? { kind: "seg", id: next.id } : null;
    this.saveUi();
    this.touch();
  }

  setPrompt(s, text) {
    s.prompt = text;
    this.commit();
  }

  // Text, a picture or a clip: a picture or a clip asks for its file first
  async setKind(s, kind) {
    if (kind === "text") {
      this.dropMedia(s);
      s.type = "text";
      this.touch();
      return;
    }
    const file = await pickFile(kind === "image" ? "image/*" : "video/*");
    if (!file) { this.refresh(["insp"]); return; }          // nothing picked: the switch shows what it is again
    if (kind === "image") await this.setPicture(s, file);
    else await this.setClip(s, file);
  }

  // A segment back to its own time, without its picture or clip (and the clip's sound)
  dropMedia(s) {
    const z = this.zoneOf(s);
    const sound = M.soundOf(this.t, s);
    if (sound) this.t.audioSegments = this.t.audioSegments.filter((a) => a !== sound);
    for (const k of ["imageFile", "imageB64", "trimStart", "videoDurationFrames", "fileName", "fileSize", "imgObj", "_blobUrl", "_uploading"]) delete s[k];
    if (M.isClip(s)) {
      s.id = M.newId();
      if (z) s.length = Math.max(s.length, z.to - s.start);
      if (this.ui.sel?.kind === "seg") this.ui.sel.id = s.id;
    }
    s.isEndFrame = false;
  }

  async upload(file, s) {
    s._uploading = true;
    s._blobUrl = URL.createObjectURL(file);
    this.refresh(["tl", "insp", "status"]);
    try {
      return await uploadFile(file);
    } finally {
      delete s._uploading;
    }
  }

  async setPicture(s, file) {
    const wasClip = M.isClip(s);
    try {
      const up = await this.upload(file, s);
      if (wasClip) this.dropMedia(s);
      s.type = "image";
      s.imageFile = up.file;
      s.imageB64 = inputUrl(up.file);
      if (s.isEndFrame === undefined) s.isEndFrame = false;
      this.touch();
    } catch (err) {
      console.error("[Stubelius LTX Director] picture upload failed", err);
      toast(this.root, "Upload failed: see the console", "bad");
      this.refresh(["tl", "insp", "status"]);
    }
  }

  // A clip on a segment: its frames guide the segment, its sound goes on the Audio lane (linked, as the classic
  // editor links them). A clip without sound gets no sound block: LTX makes the sound there.
  async setClip(s, file) {
    let meta;
    try {
      meta = await clipMeta(file, this.fps);
    } catch (err) {
      toast(this.root, `Can't read ${file.name}: ${err.message}`, "bad");
      return;
    }
    const t = this.t;
    const old = M.soundOf(t, s);
    if (old) t.audioSegments = t.audioSegments.filter((a) => a !== old);
    const base = M.newId();
    const z = this.zoneOf(s);
    Object.assign(s, { id: base + "_v", type: "video", trimStart: 0, videoDurationFrames: meta.frames, fileName: file.name,
      fileSize: file.size, imageB64: meta.thumb, imageFile: "", isEndFrame: false, _uploading: true, _blobUrl: meta.url });
    s.length = Math.max(M.MIN_LEN, Math.min(z ? z.to - s.start : s.length, meta.frames));
    delete s.isAnchor;
    const sound = { id: base + "_a", type: "audio", start: s.start, length: s.length, trimStart: 0, audioDurationFrames: meta.frames,
      audioFile: "", fileName: file.name, waveformPeaks: [], fileSize: file.size, _uploading: true };
    t.audioSegments.push(sound);
    this.ui.sel = { kind: "seg", id: s.id };
    this.saveUi();
    this.touch();
    try {
      const up = await uploadMedia(file);
      s.imageFile = up.file;
      const a = up.audioFile ? { audioFile: up.audioFile, peaks: up.peaks } : await mediaAudio(up.file);
      if (a.audioFile) {
        sound.audioFile = a.audioFile;
        sound.waveformPeaks = a.peaks || [];
      } else {
        t.audioSegments = t.audioSegments.filter((x) => x !== sound);
        toast(this.root, `${file.name} has no sound: LTX makes the sound there`);
      }
    } catch (err) {
      console.error("[Stubelius LTX Director] clip upload failed", err);
      toast(this.root, "Upload failed: see the console", "bad");
      t.audioSegments = t.audioSegments.filter((x) => x !== sound);
      this.dropMedia(s);
      s.type = "text";
    }
    delete s._uploading;
    delete sound._uploading;
    this.touch();
  }

  // A segment's picture on its first or its last frame. The last segment's last frame is the video's real last
  // frame (LTX renders 8n+1 frames), as the classic editor's Pin to Last Frame puts it.
  pinPicture(s, end) {
    s.isEndFrame = !!end;
    if (end) {
      const z = this.zoneOf(s);
      const last = M.segmentsOf(this.t).filter((x) => x.start < this.endF).pop() === s;
      if (last) s.length = Math.max(M.MIN_LEN, this.lastF - s.start);
      else if (z) s.length = Math.max(M.MIN_LEN, z.to - s.start);
    }
    this.touch();
  }

  // Move the cut between segment a and the one after it to frame f
  moveCut(a, f) {
    const list = M.segmentsOf(this.t);
    const b = list[list.indexOf(a) + 1];
    if (!b) return;
    M.moveCut(this.t, a, b, f);
    this.commit();
  }

  // ----------------------------------------------------------------------------------- keyframes

  // Every picture on the timeline, at the frame it lands on: {s, at (absolute frame), kind: first|last|middle|clip}
  keyframes() {
    const out = [];
    for (const s of M.sortSegments(this.t)) {
      if (!(s.imageFile || s.imageB64 || s._uploading)) continue;
      if (s.start + s.length <= this.startF || s.start >= this.viewF) continue;
      if (M.isClip(s)) { out.push({ s, at: Math.max(s.start, this.startF), kind: "clip" }); continue; }
      if (!M.isPicture(s)) continue;
      const at = Math.max(this.startF, M.guideFrame(s));
      const kind = at <= this.startF ? "first" : at >= this.lastF - 1 ? "last" : "middle";
      out.push({ s, at, kind });
    }
    return out;
  }

  // The picture the video opens on: segment 1's own picture when it is text (or a picture on its first frame),
  // else a keyframe of its own at the first frame
  async setFirstFrame(file) {
    const t = this.t;
    const first = M.segmentsOf(t).find((x) => x.start + x.length > this.startF);
    let target = first;
    if (!first) {
      target = { id: M.newId(), start: this.startF, length: this.durF, prompt: "", type: "text", isEndFrame: false };
      t.segments.push(target);
    } else if (M.isText(first) || (M.isPicture(first) && !first.isEndFrame && first.start <= this.startF)) {
      if (first.start > this.startF) { first.length += first.start - this.startF; first.start = this.startF; }
    } else {
      target = { id: M.newId(), start: this.startF, length: M.MIN_LEN, prompt: "", type: "image", isAnchor: true, isEndFrame: false };
      t.segments.push(target);
    }
    target.isEndFrame = false;
    this.ui.sel = { kind: target.isAnchor ? "key" : "seg", id: target.id };
    this.saveUi();
    await this.setPicture(target, file);
  }

  // The picture the video ends on: the last segment's own picture, pinned to the video's real last frame, when it is
  // text; else a keyframe of its own there
  async setLastFrame(file) {
    const t = this.t;
    const last = M.segmentsOf(t).filter((x) => x.start < this.endF).pop();
    let target = last;
    if (!last) {
      target = { id: M.newId(), start: this.startF, length: this.lastF - this.startF, prompt: "", type: "text", isEndFrame: true };
      t.segments.push(target);
    } else if (M.isText(last) || (M.isPicture(last) && last.isEndFrame)) {
      last.length = Math.max(M.MIN_LEN, this.lastF - last.start);
    } else {
      target = { id: M.newId(), start: this.lastF - M.MIN_LEN, length: M.MIN_LEN, prompt: "", type: "image", isAnchor: true, isEndFrame: true };
      t.segments.push(target);
    }
    target.isEndFrame = true;
    this.ui.sel = { kind: target.isAnchor ? "key" : "seg", id: target.id };
    this.saveUi();
    await this.setPicture(target, file);
  }

  // A picture the video passes through at frame f: a keyframe that owns no prompt (an Image Anchor)
  async addKeyframe(file, f) {
    const s = { id: M.newId(), start: 0, length: M.MIN_LEN, prompt: "", type: "image", isAnchor: true, isEndFrame: false };
    M.placeAnchor(this.t, s, Math.round(f), this.startF, this.lastF);
    this.t.segments.push(s);
    this.ui.sel = { kind: "key", id: s.id };
    this.saveUi();
    await this.setPicture(s, file);
  }

  // A keyframe to frame f (where its picture lands)
  moveKeyframe(s, f) {
    const g = Math.round(Math.max(this.startF, Math.min(this.lastF - 1, f)));
    if (s.isAnchor) {
      const want = s.isEndFrame ? g - s.length + 1 : g;
      M.placeAnchor(this.t, s, want, this.startF, this.lastF);
    }
    this.commit();
  }

  removeKeyframe(s) {
    if (s.isAnchor) {
      this.t.segments = this.t.segments.filter((x) => x !== s);
      if (this.ui.sel?.id === s.id) this.ui.sel = null;
    } else {
      this.dropMedia(s);
      s.type = "text";
    }
    this.saveUi();
    this.touch();
  }

  // ----------------------------------------------------------------------------------- motion and sound

  // The first free place at or after frame f on a lane of blocks, for a block of `len` frames
  freeSpot(list, f, len, skip = null) {
    let at = Math.max(0, Math.round(f));
    const others = list.filter((x) => x !== skip).sort((a, b) => a.start - b.start);
    for (const o of others) {
      if (at + len <= o.start) break;
      if (at < o.start + o.length) at = o.start + o.length;
    }
    return at;
  }

  async addMotion(file, f) {
    let meta;
    try {
      meta = await clipMeta(file, this.fps);
    } catch (err) {
      toast(this.root, `Can't read ${file.name}: ${err.message}`, "bad");
      return;
    }
    const t = this.t;
    const s = { id: M.newId(), type: "motion_video", start: 0, length: meta.frames, trimStart: 0, videoDurationFrames: meta.frames,
      videoFile: "", fileName: file.name, videoStrength: 1.0, videoAttentionStrength: 0.65, resampleMode: "nearest",
      previewThumbs: [], previewThumbSourceFrames: meta.frames, fileSize: file.size, imageB64: meta.thumb,
      _uploading: true, _blobUrl: meta.url };
    s.start = this.freeSpot(t.motionSegments, Math.max(this.startF, f), meta.frames);
    t.motionSegments.push(s);
    if (t.motionTrackEnabled === false) t.motionTrackEnabled = true;
    this.ui.sel = { kind: "motion", id: s.id };
    this.saveUi();
    this.touch();
    try {
      const up = await uploadMedia(file);
      s.videoFile = up.file;
    } catch (err) {
      console.error("[Stubelius LTX Director] motion clip upload failed", err);
      toast(this.root, "Upload failed: see the console", "bad");
      t.motionSegments = t.motionSegments.filter((x) => x !== s);
    }
    delete s._uploading;
    this.touch();
  }

  async addSound(file, f) {
    const t = this.t;
    let peaks = [], seconds = 0;
    try {
      ({ peaks, duration: seconds } = await extractAudioPeaks(file, 200));
    } catch (err) {
      toast(this.root, `Can't read ${file.name} as sound`, "bad");
      return;
    }
    const frames = Math.max(1, Math.ceil(seconds * this.fps));
    const s = { id: M.newId(), type: "audio", start: 0, length: frames, trimStart: 0, audioDurationFrames: frames, audioFile: "",
      fileName: file.name, waveformPeaks: peaks.map((p) => Math.round(p * 1000) / 1000), _uploading: true };
    s.start = this.freeSpot(t.audioSegments, Math.max(this.startF, f), frames);
    t.audioSegments.push(s);
    const wasOff = t.audioTrackEnabled === false;
    t.audioTrackEnabled = true;
    if (this.node.properties?.overrideAudio) this.node.properties.overrideAudio = false;
    this.ui.sel = { kind: "audio", id: s.id };
    this.saveUi();
    this.touch();
    try {
      const up = await uploadFile(file);
      s.audioFile = up.file;
      if (wasOff) toast(this.root, "Your audio is on: LTX keeps your sounds and fills the rest");
    } catch (err) {
      console.error("[Stubelius LTX Director] sound upload failed", err);
      toast(this.root, "Upload failed: see the console", "bad");
      t.audioSegments = t.audioSegments.filter((x) => x !== s);
    }
    delete s._uploading;
    this.touch();
  }

  removeBlock(list, s) {
    this.t[list] = this.t[list].filter((x) => x !== s);
    if (list === "audioSegments") {
      const clip = M.clipOf(this.t, s);
      if (clip) clip.id = M.newId("_v");          // unlinked: the clip keeps its frames, its sound is gone
    }
    if (this.ui.sel?.id === s.id) this.ui.sel = null;
    this.saveUi();
    this.touch();
  }

  // Your audio on or off (the classic editor's speaker on the AUDIO track: use_custom_audio)
  setAudioOn(on) {
    const p = this.node.properties;
    this.t.audioTrackEnabled = !!on;
    if (on && p.overrideAudio) p.overrideAudio = false;
    this.touch();
  }

  setFillGaps(on) {
    this.set("inpaint_audio", !!on);
    this.touch();
  }

  setMotionOn(on) {
    this.t.motionTrackEnabled = !!on;
    if (!on && this.node.properties.overrideAudio) this.setClipSound(false, false);
    this.touch();
  }

  // The motion clips' own sound instead of LTX's (override_audio): your audio goes off while it is on and comes
  // back after, as in the classic editor
  setClipSound(on, commit = true) {
    const p = this.node.properties;
    if (on && !p.overrideAudio) {
      p.audioTrackWasEnabledBeforeOverride = this.t.audioTrackEnabled !== false;
      this.t.audioTrackEnabled = false;
    } else if (!on && p.overrideAudio) {
      this.t.audioTrackEnabled = p.audioTrackWasEnabledBeforeOverride !== false;
    }
    p.overrideAudio = !!on;
    if (commit) this.touch();
  }

  // ----------------------------------------------------------------------------------- references

  setRefMode(mode) {
    this.t.reference_mode = mode;
    if (mode !== M.REF.off && this.ui.sel?.kind !== "ref") {
      const filled = M.refsFilled(this.t);
      if (!filled.length) this.ui.sel = { kind: "ref", id: 0 };
    }
    this.saveUi();
    this.touch();
  }

  // ----------------------------------------------------------------------------------- retake

  // Retake a part of a video: the video is the base, only the part between the handles is made again
  async setRetake(on, file = null) {
    const t = this.t;
    if (!on) {
      t.retakeMode = false;
      this.writeWindow(Number(t.normalStartFrame) || 0, Math.max(1, Number(t.normalDurationFrames) || this.durF));
      this.touch();
      return;
    }
    if (!file) {
        file = await pickFile("video/*");
      if (!file) return;
    }
    let meta;
    try {
      meta = await clipMeta(file, this.fps);
    } catch (err) {
      toast(this.root, `Can't read ${file.name}: ${err.message}`, "bad");
      return;
    }
    t.normalStartFrame = this.startF;
    t.normalDurationFrames = this.durF;
    t.retakeMode = true;
    t.retakeVideo = { fileName: file.name, imageFile: "", videoDurationFrames: meta.frames, fileSize: file.size, _uploading: true,
      _blobUrl: meta.url, _thumb: meta.thumb };
    const len = Math.max(1, Math.round(meta.frames * 0.5));
    t.retakeStart = Math.round((meta.frames - len) / 2);
    t.retakeLength = len;
    if (t.retakePrompt === undefined) t.retakePrompt = "";
    if (t.retakeStrength === undefined) t.retakeStrength = 1.0;
    this.writeWindow(0, meta.frames);
    this.touch();
    try {
      const up = await uploadMedia(file);
      if (t.retakeVideo) t.retakeVideo.imageFile = up.file;
    } catch (err) {
      console.error("[Stubelius LTX Director] retake video upload failed", err);
      toast(this.root, "Upload failed: see the console", "bad");
    }
    if (t.retakeVideo) delete t.retakeVideo._uploading;
    this.touch();
  }

  // ----------------------------------------------------------------------------------- the Setup mode

  setMode(mode) {
    const setup = this.setupNode(), m = this.modelsNode();
    if (!setup) return;
    if (mode === "Full size") {
      setWidget(setup, "first_pass_scale", 1.0);
      if (m) { setWidget(m, "memory_efficient_attention", false); setWidget(m, "chunk_feed_forward", false); }
    } else {
      if (Number(widgetValue(setup, "first_pass_scale", 1)) >= 0.999) setWidget(setup, "first_pass_scale", HALF);
      const low = mode === "Low VRAM";
      if (m) { setWidget(m, "memory_efficient_attention", low); setWidget(m, "chunk_feed_forward", low); }
    }
    this.setupChanged("mode");
  }

  setupChanged(name) {
    this.renderCmd();
    this.setupNode()?._slx?.render?.();
    window.dispatchEvent(new CustomEvent("stubelius-ltx-setup", { detail: { name } }));
  }

  // ----------------------------------------------------------------------------------- render

  // Anything for LTX to go on: a prompt, a picture, a clip, a motion clip, a sound or a base video
  hasContent() {
    const t = this.t;
    const typed = (x) => !!String(x ?? "").trim();
    if (typed(this.globalPrompt)) return true;
    if (t.retakeMode) return !!t.retakeVideo;
    if (t.segments.some((s) => typed(s.prompt) || s.imageFile || s.imageB64)) return true;
    return t.motionSegments.some((s) => s.videoFile) || t.audioSegments.some((s) => s.audioFile);
  }

  uploading() {
    const t = this.t;
    return [...t.segments, ...t.motionSegments, ...t.audioSegments].some((s) => s._uploading) || !!t.retakeVideo?._uploading;
  }

  // What would stop the render on the Python side, said before it is queued
  renderProblem() {
    const t = this.t;
    if (this.refMode === M.REF.msr && !t.retakeMode) {
      const text = [this.globalPrompt, ...t.segments.map((s) => s.prompt || "")].join(" ");
      const ingredients = this.node.inputs?.find((i) => i.name === "ref_images")?.link != null;
      if (!M.msrPictureCount(t, text) && !ingredients) return "Licon MSR needs a picture in the Cast (or turn references off)";
      if (this.node.inputs?.find((i) => i.name === "vae")?.link == null) return "Licon MSR needs the video VAE wired into the Director's vae input";
      if (isNone(widgetValue(this.modelsNode(), "msr_lora", "none"))) return "Licon MSR needs an MSR LoRA: pick one in Setup";
    }
    if (t.retakeMode && !t.retakeVideo?.imageFile) return "Retake needs its base video: pick one";
    return null;
  }

  // A render brings new seeds, so an older pick doesn't hold: the Finish waits for one in Seeds (winner 0). One seed
  // with "Finish it right away" on (the Output window) finishes it straight away. A Finish shown as a plain node keeps
  // the winner it was given.
  holdFinish() {
    const fin = this.finishNode();
    if (!fin?._slx) return;
    const seeds = Number(widgetValue(this.setupNode(), "seeds", 1)) || 1;
    const want = seeds === 1 && fin.properties?.slx_autofinish ? 1 : 0;
    if (Number(widgetValue(fin, "winner", 0)) === want) return;
    setWidget(fin, "winner", want);
    window.dispatchEvent(new CustomEvent("stubelius-ltx-winner"));
  }

  async queue(label = null) {
    if (this.submitting) return;
    if (this.uploading()) { toast(this.root, "Still uploading: render when it's done", "warn"); return; }
    if (!this.hasContent()) {
      toast(this.root, "Nothing to render yet: write a prompt or add a picture", "warn");
      this.focusPrompt();
      return;
    }
    const why = this.renderProblem();
    if (why) { toast(this.root, why, "bad"); return; }
    this.commit(false);
    this.queuedSeq = this.editSeq;
    this.holdFinish();
    const n = Number(widgetValue(this.setupNode(), "seeds", 1)) || 1;
    this.run = { state: "queued", label: label || (n > 1 ? `Rendering ${n} seeds` : "Rendering") };
    this.refresh(["cmd", "preview"]);
    this.submitting = true;
    let r;
    try {
      r = await queueRun();
    } finally {
      this.submitting = false;
    }
    if (!r.ok) {
      this.run = { state: "error", label: "Not rendered: " + r.why };
      this.live = null;
      this.refresh(["cmd", "preview"]);
    }
  }

  // New seeds: n of them from a fresh seed (Hunt), held after them so one can be picked in Seeds
  hunt(n) {
    const setup = this.setupNode();
    if (!setup) { toast(this.root, "Add a Stubelius LTX Setup node", "bad"); return; }
    setWidget(setup, "seeds", n);
    setWidget(setup, "seed", newSeed());
    this.setupChanged("seeds");
    this.queue(`Hunting with ${n} new seeds`);
  }

  // The same seeds count with a new seed
  newSeedRender() {
    const setup = this.setupNode();
    if (!setup) { toast(this.root, "Add a Stubelius LTX Setup node", "bad"); return; }
    setWidget(setup, "seed", newSeed());
    this.setupChanged("seed");
    this.queue("Rendering with a new seed");
  }

  // How many seeds a hunt renders (2, 3 or 4)
  huntCount() {
    const n = Number(this.ui.fold?.hunt);
    return [2, 3, 4].includes(n) ? n : 3;
  }

  setHuntCount(n) {
    this.ui.fold = { ...(this.ui.fold || {}), hunt: n };
    this.saveUi();
  }

  pickWinner(candidate) {
    const fin = this.finishNode();
    if (!fin) return;
    setWidget(fin, "winner", candidate);
    window.dispatchEvent(new CustomEvent("stubelius-ltx-winner"));
    toast(this.root, `Seed ${candidate} is the winner: finish it in Seeds or Output`);
  }

  toClassic() {
    toClassic(this.node);
  }

  focusPrompt() {
    setTimeout(() => this.insp.querySelector(".i-prompt")?.focus(), 60);
  }

  async fetchStats() {
    try {
      const r = await api.fetchApi("/system_stats");
      this.stats = r.ok ? await r.json() : null;
    } catch (e) {
      this.stats = null;
    }
    this.renderFoot();
  }

  // ----------------------------------------------------------------------------------- drawing

  refresh(parts = null) {
    const all = !parts;
    const has = (p) => all || parts.includes(p);
    if (has("head")) this.renderHead();
    if (has("cmd") || this.sizeLabel() !== this._sizeShown) this.renderCmd();   // a first picture can change the size
    if (has("preview")) this.preview.render();
    if (has("insp")) buildInspector(this);
    if (has("tl")) buildTimeline(this);
    if (has("cast")) buildCast(this);
    if (has("foot")) this.renderFoot();
    this.renderStatus();
    this.markSteps();
  }

  renderHead() {
    const box = clear(this.refSwitch);
    if (this.retake) {
      box.append(h("div.d-retake-tag", icon("refresh", 16), "Retake a part of a video"),
        button("Back to the timeline", "arrowRight", "small", () => this.setRetake(false),
          "Leave retake: the timeline comes back as it was"));
      return;
    }
    box.appendChild(seg(REF_OPTIONS, this.refMode, (v) => { this.setRefMode(v); }));
  }

  sizeLabel() {
    const w = Number(this.val("custom_width", 0)), hgt = Number(this.val("custom_height", 0));
    const fit = this.fittedSize();
    if (fit) return `${fit[0]}×${fit[1]}`;
    if (w > 0 && hgt > 0) return `${w}×${hgt}`;
    if (w > 0) return `${w} wide`;
    if (hgt > 0) return `${hgt} high`;
    return "Picture";
  }

  // The size the render really gets. With "maintain aspect ratio" the Director node fits its size source inside the set
  // size and the video takes that shape (ltx_director.py, _resize_image). The source is the first picture or clip in the
  // render window, else the retake's video, else the first motion clip: 1920x1088 pictures make 1280x704 into 1216x704.
  // Null when it is the set size, or while the source's size isn't known yet.
  fittedSize() {
    const w = Number(this.val("custom_width", 0)), hgt = Number(this.val("custom_height", 0));
    if (!(w > 0 && hgt > 0) || this.val("resize_method", "maintain aspect ratio") !== "maintain aspect ratio") return null;
    const t = this.t;
    const first = [...t.segments].sort((a, b) => a.start - b.start).find((s) => (s.imageFile || s.imageB64)
      && s.start < this.startF + this.durF && s.start + s.length > this.startF);
    const motion = (t.motionSegments || []).find((s) => s.videoFile);
    const dims = first ? (M.isClip(first) ? first.imageFile && this.mediaSize(inputUrl(first.imageFile), true)
        : this.mediaSize(first.imageFile ? inputUrl(first.imageFile) : first.imageB64))
      : t.retakeMode && t.retakeVideo?.imageFile ? this.mediaSize(inputUrl(t.retakeVideo.imageFile), true)
      : motion ? this.mediaSize(inputUrl(motion.videoFile), true) : null;
    if (!dims) return null;
    const div = Number(this.val("divisible_by", 32)) || 32;
    const snap = (v) => Math.max(div, Math.floor(v / div) * div);
    const tw = snap(w), th = snap(hgt), r = Math.min(tw / dims[0], th / dims[1]);
    const fw = snap(Math.trunc(dims[0] * r)), fh = snap(Math.trunc(dims[1] * r));
    return fw === tw && fh === th ? null : [fw, fh];
  }

  // A picture's or video's own size, read once per file; the size field is drawn again when it arrives
  mediaSize(url, video = false) {
    const known = (this._mediaSizes ||= new Map());
    if (!url) return null;
    if (!known.has(url)) {
      known.set(url, null);
      const el = video ? document.createElement("video") : new Image();
      const done = () => {
        const size = video ? [el.videoWidth, el.videoHeight] : [el.naturalWidth, el.naturalHeight];
        if (size[0] > 0 && size[1] > 0) { known.set(url, size); this.renderCmd(); }
      };
      if (video) { el.preload = "metadata"; el.muted = true; el.addEventListener("loadedmetadata", done, { once: true }); }
      else el.addEventListener("load", done, { once: true });
      el.src = url;
    }
    return known.get(url);
  }

  renderCmd() {
    const c = clear(this.cmd);
    const num = (value, places, title, onSet) => {
      const input = h("input.d-val", { type: "text", inputMode: "decimal", value: Number(value).toFixed(places), title });
      input.addEventListener("change", () => {
        const v = parseFloat(String(input.value).replace(",", "."));
        if (Number.isFinite(v) && v > 0) onSet(v);
        else input.value = Number(value).toFixed(places);
      });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
      return input;
    };
    const field = (name, el) => h("div.d-field", label(name), el);
    const vsep = () => h("div.d-vsep");
    const fit = this.fittedSize();
    this._sizeShown = this.sizeLabel();
    const sizeBtn = h("button.d-val.d-valbtn", { type: "button", onclick: (e) => this.sizeMenu(e.currentTarget),
      title: fit ? `${this.val("custom_width", 0)}×${this.val("custom_height", 0)} is set; the video takes the first picture's `
        + `shape inside it ("maintain aspect ratio" in Settings, "crop" keeps the set size). Click for the sizes`
        : "The video's size: click for the sizes" }, this._sizeShown);
    const fpsBtn = h("button.d-val.d-valbtn.d-fps", { type: "button", title: "Frames per second: click for the rates",
      onclick: (e) => this.fpsMenu(e.currentTarget) }, String(this.fps));
    const fpsRow = h("div.d-valrow", fpsBtn, h("span.d-unit", "fps"));
    if (this.refMode === M.REF.msr && this.fps !== 50) {
      fpsRow.appendChild(h("button.d-hint", { type: "button", onclick: () => this.setFps(50),
        title: "Licon MSR is trained at 50 fps; other rates can give doubled or jittery motion. Click: 50 fps" }, icon("alert", 13), "MSR 50"));
    }
    const lenTitle = `The video's length in seconds (LTX renders ${M.ltxvLength(this.durF)} frames: ${this.sec(M.ltxvLength(this.durF)).toFixed(2)} s)`;
    const lenField = this.retake
      ? h("div.d-valrow", h("span.d-val.d-ro", this.sec(this.durF).toFixed(1)), h("span.d-unit", "s"))
      : h("div.d-valrow", num(this.sec(this.durF), 1, lenTitle, (v) => this.setLength(v)), h("span.d-unit", "s"));
    c.appendChild(h("div.slx-grp.d-fields",
      field("Size", sizeBtn), vsep(),
      field("Length", lenField), vsep(),
      field("Frame rate", fpsRow), vsep(),
      field("Seed", this.seedRow())));

    // the Setup node's mode
    const setup = this.setupNode(), models = this.modelsNode();
    if (setup) {
      const now = modeOf(setup, models);
      const steps = widgetValue(setup, "steps");
      const cards = h("div.d-modes");
      for (const [name, tag] of MODES) {
        cards.appendChild(h("button.d-mode", { type: "button", class: name === now ? "on" : null,
          title: `${name} (Setup): click to switch`, onclick: () => this.setMode(name) },
        h("b", name), h("i", name === "Full size" ? `${steps ?? "?"} steps · full size` : tag)));
      }
      c.appendChild(h("div.slx-grp", cards));
    }

    // the model (the MSR LoRA with references on) and the output
    const chips = h("div.slx-grp.d-chips");
    if (models) {
      const msr = this.refMode === M.REF.msr;
      let text;
      if (msr) {
        const name = widgetValue(models, "msr_lora", "none");
        text = isNone(name) ? "none picked" : `${shortName(name)} · ${Number(widgetValue(models, "msr_lora_strength", 1)).toFixed(2)}`;
      } else {
        const name = widgetValue(models, "diffusion_model", "");
        const tag = precision(name);
        text = `${modelLabel(name)}${tag ? " · " + tag : ""}`;
      }
      chips.appendChild(h("button.slx-chip", { type: "button", title: msr ? "The MSR LoRA (Setup)" : "The video model (Setup)", onclick: () => goToStep(1) },
        h("div.slx-ico.ac", icon(msr ? "users" : "movie", 16)), h("div", label(msr ? "MSR LoRA" : "Model"), h("div.d-chipval", text))));
    }
    const output = this.outputNode();
    if (output) {
      chips.appendChild(h("button.slx-chip", { type: "button", title: "Final size, frame rate, upscaler (Output)", onclick: () => goToStep(4) },
        h("div.slx-ico.snd", icon("aspect", 16)), h("div", label("Output"), h("div.d-chipval", this.outputLabel(output)))));
    }
    if (chips.childNodes.length) c.appendChild(chips);

    const running = this.run.state === "running" || this.run.state === "queued";
    const n = Number(widgetValue(setup, "seeds", 1)) || 1;
    c.appendChild(h("div.d-render", running
      ? button("Stop", "x", "ghost", () => api.interrupt?.(), "Stop the render")
      : button("Render", "play", "cta", () => this.queue(), n > 1 ? `Render the video with ${n} seeds` : "Render the video")));
  }

  outputLabel(output) {
    const res = widgetValue(output, "final_resolution", "1080p");
    const fps = Number(widgetValue(output, "final_fps", 0)) || this.fps;
    const up = widgetValue(output, "upscaler", "RTX VSR");
    const size = SIZE_LABEL[res] || res;
    const parts = [size, `${Math.round(fps * 100) / 100} fps`];
    if (size !== "Native") parts.push(String(up).startsWith("DLSS5") ? "DLSS 5" : "RTX VSR");
    return parts.join(" · ");
  }

  seedRow() {
    const setup = this.setupNode();
    const sw = widget(setup, "seed");
    if (!sw) return h("span.slx-muted.d-noseed", "no Setup node");
    const input = h("input.d-val.d-seed", { type: "text", inputMode: "numeric", value: String(sw.value ?? 0),
      title: "The first seed (every next seed adds 1000003)" });
    input.addEventListener("change", () => {
      const digits = input.value.replace(/[^0-9]/g, "") || "0";
      input.value = digits;
      setWidget(setup, "seed", Number(digits));
      this.setupChanged("seed");
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    const ctrl = widget(setup, "control_after_generate");
    const fixed = !ctrl || ctrl.value === "fixed";
    const lock = iconButton(fixed ? "lock" : "dice", fixed
      ? "The seed stays the same after each render. Click: a new seed every render"
      : "A new seed after every render. Click: keep this seed", () => {
      if (!ctrl) return;
      ctrl.value = fixed ? "randomize" : "fixed";
      this.setupChanged("control_after_generate");
    });
    lock.classList.add("d-seed-lock");
    if (!fixed) lock.classList.add("on");
    return h("div.d-valrow", input, lock,
      iconButton("dice", "A new seed", () => { setWidget(setup, "seed", newSeed()); this.setupChanged("seed"); }));
  }

  sizeMenu(anchor) {
    const cw = Number(this.val("custom_width", 0)), ch = Number(this.val("custom_height", 0));
    const list = h("div.d-sizes");
    for (const [w, hgt, name] of SIZES) {
      list.appendChild(h("button.d-size", { type: "button", class: w === cw && hgt === ch ? "on" : null,
        onclick: () => { closeMenus(); this.setSize(w, hgt); } }, h("b", `${w}×${hgt}`), h("span", name)));
    }
    list.appendChild(h("button.d-size", { type: "button", class: !cw && !ch ? "on" : null,
      onclick: () => { closeMenus(); this.setSize(0, 0); } }, h("b", "Picture"), h("span", "the first picture's own size")));
    const snap = (v) => Math.max(0, Math.round((parseFloat(v) || 0) / 32) * 32);
    const wIn = h("input.slx-input.d-size-in", { type: "number", step: 32, min: 0, value: cw || "" , placeholder: "width" });
    const hIn = h("input.slx-input.d-size-in", { type: "number", step: 32, min: 0, value: ch || "", placeholder: "height" });
    const use = button("Use", null, "small", () => { closeMenus(); this.setSize(snap(wIn.value), snap(hIn.value)); });
    popover(anchor, h("div.d-sizepop", h("div.slx-lbl", "Video size"), list,
      h("div.d-size-row", wIn, h("span.slx-muted", "×"), hIn, use),
      h("div.slx-muted.d-size-note", (this.val("resize_method", "maintain aspect ratio") === "maintain aspect ratio"
        ? `With "maintain aspect ratio" (Settings) the video takes the first picture's shape inside this size; "crop" keeps it exact. `
        : `Pictures are fitted to it by "${this.val("resize_method")}" (Settings). `)
        + "Sizes snap to LTX's 32-pixel grid.")), 360);
  }

  fpsMenu(anchor) {
    menu(anchor, [
      ...FPS_CHOICES.map((v) => ({ label: `${v} fps`, icon: v === this.fps ? "check" : null, onClick: () => this.setFps(v) })),
      null,
      { label: "Another rate…", icon: "sliders", onClick: () => {
        const input = h("input.slx-input", { type: "number", min: 1, max: 240, step: 1, value: this.fps });
        const go = () => { closeMenus(); this.setFps(input.value); };
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
        popover(anchor, h("div.d-sizepop", h("div.slx-lbl", "Frames per second"), h("div.d-size-row", input, button("Use", null, "small", go)),
          h("div.slx-muted.d-size-note", "Whole numbers: the Director counts frames at this rate. Every block keeps its seconds.")), 300);
        setTimeout(() => input.select(), 30);
      } },
    ]);
  }

  renderStatus() {
    const s = this.status;
    const run = this.run;
    const vids = this.seedVideos();
    let text, cls = "";
    if (run.state === "queued") { text = `${run.label || "Rendering"} · queued`; cls = "busy"; }
    else if (run.state === "running") { text = run.text || run.label || "Rendering"; cls = "busy"; }
    else if (run.state === "error") { text = run.label || "Stopped"; cls = "bad"; }
    else if (this.uploading()) { text = "Uploading…"; cls = "busy"; }
    else if (!this.hasContent()) { text = "Nothing to render yet · write a prompt or add a picture"; cls = "warn"; }
    else if (vids.length && this.editSeq > this.renderedSeq) { text = "Changed since the last render"; cls = "warn"; }
    else if (vids.length) {
      const secs = Math.max(...vids.map((v) => v.seconds || 0));
      text = `Rendered · ${vids.length} seed${vids.length > 1 ? "s" : ""} · ${secs.toFixed(1)} s`;
    } else {
      const n = M.segmentsOf(this.t).length;
      text = `Ready · ${n} segment${n === 1 ? "" : "s"} · ${this.sec(this.durF).toFixed(1)} s`;
    }
    s.className = "slx-status" + (cls ? " " + cls : "");
    s.lastChild.textContent = text;
    s.title = text;
  }

  audioSummary() {
    const t = this.t;
    if (this.node.properties?.overrideAudio) return "the motion clips' sound";
    const n = t.audioSegments.filter((s) => s.audioFile || s._uploading).length;
    if (t.audioTrackEnabled === false || !n) {
      if (t.audioTrackEnabled !== false && this.val("inpaint_audio", true) === false) return "silent (Fill the gaps is off)";
      return "made by LTX";
    }
    return `${n} sound${n > 1 ? "s" : ""}${this.val("inpaint_audio", true) !== false ? " · LTX fills the rest" : " · the rest stays silent"}`;
  }

  renderFoot() {
    const f = clear(this.foot);
    const t = this.t;
    const pics = this.keyframes().filter((k) => k.kind !== "clip").length;
    const segs = M.segmentsOf(t).length;
    const motion = t.motionSegments.length;
    f.append(
      h("span.slx-fi", icon("photo", 14), "Keyframes ", h("b", String(pics))),
      h("span.slx-fi", icon("lines", 14), "Prompts ", h("b", String(segs))),
      h("span.slx-fi", icon("run", 14), "Motion ", h("b", motion ? `${motion} clip${motion > 1 ? "s" : ""}${t.motionTrackEnabled === false ? " · off" : ""}` : "–")),
      h("span.slx-fi", icon("wave", 14), "Audio ", h("b", this.audioSummary())));
    if (this.refsOn) {
      const filled = M.refsFilled(t);
      const views = filled.reduce((a, { c }) => a + c.images.length, 0);
      f.appendChild(h("span.slx-fi", icon("users", 14), "References ",
        h("b", filled.length ? `${filled.length} · ${views} picture${views === 1 ? "" : "s"}` : "none yet")));
    }
    f.appendChild(h("div.slx-spacer"));
    const dev = this.stats?.devices?.[0];
    if (dev) {
      const name = String(dev.name || "").replace(/^cuda:\d+\s*/, "").replace(/NVIDIA GeForce /, "").replace(/ : .*$/, "");
      f.appendChild(h("span.slx-fi", icon("cpu", 14), `${name} · `, h("b", `${(dev.vram_free / 1e9).toFixed(1)} GB free`)));
    }
  }

  markSteps() {
    const done = new Set();
    if (this.setupNode() && this.modelsNode()) done.add(1);
    const vids = this.seedVideos();
    if (vids.length) done.add(2);
    const fin = this.finishNode();
    if (fin && this.winner() >= 1 && vids.length) done.add(3);
    if (fin?.properties?.slx_final) done.add(4);
    markSteps(this.steps, done);
  }

  // ----------------------------------------------------------------------------------- live events

  listen() {
    const on = (type, fn, target = api) => {
      target.addEventListener(type, fn);
      (this._off ||= []).push(() => target.removeEventListener(type, fn));
    };
    const leaf = (id) => String(id ?? "").split(":").pop();
    const isGen = (id) => { const g = this.seedsNode(); return !!g && leaf(id) === String(g.id); };
    const busy = () => this.run.state === "running" || this.run.state === "queued";
    on("executing", (e) => {
      const d = e.detail;
      const id = typeof d === "object" && d !== null ? d.node : d;
      if (id == null || !isGen(id)) return;
      const started = this.run.state !== "running";
      this.run = { ...this.run, state: "running", label: this.run.label || "Rendering", text: this.run.text || this.run.label || "Rendering" };
      if (started) this.refresh(["cmd", "preview"]);
      else this.renderStatus();
    });
    on("stubelius_ultimate_ltx.seed", (e) => {
      const d = e.detail || {};
      if (!isGen(d.node)) return;
      const text = d.of > 1 ? `Rendering seed ${d.candidate} of ${d.of}` : "Rendering";
      this.run = { ...this.run, state: "running", candidate: d.candidate, of: d.of, text };
      this.renderStatus();
      this.preview.render();
    });
    on("progress", (e) => {
      const d = e.detail || {};
      if (!isGen(d.node) || this.run.state !== "running") return;
      this.status.lastChild.textContent = `${this.run.text || "Rendering"} · step ${d.value}/${d.max}`;
    });
    on("execution_error", (e) => {
      if (!busy()) return;
      const d = e.detail || {};
      const where = app.graph?.getNodeById?.(Number(leaf(d.node_id)))?.title || d.node_type || "a node";
      this.run = { state: "error", label: `Stopped: ${where}: ${String(d.exception_message || "error").split("\n")[0].slice(0, 120)}` };
      this.live = null;
      this.refresh(["cmd", "preview"]);
    });
    on("execution_interrupted", () => {
      if (!busy()) return;
      this.run = { state: "error", label: "Stopped" };
      this.live = null;
      this.refresh(["cmd", "preview"]);
    });
    on("execution_success", () => {
      if (busy()) {
        this.run = { state: "done" };
        this.live = null;
        this.refresh(["cmd", "preview"]);
      }
      this.fetchStats();
    });
    on("kj_preview_override", (e) => {
      const d = e.detail;
      if (!d || !isGen(d.node_id) || !busy()) return;
      this.live = { image: d.image, mime: typeof d.mime === "string" ? d.mime : "image/jpeg", step: d.step, total: d.total };
      this.preview.showLive(this.live);
    });
    on("executed", (e) => {
      const d = e.detail || {};
      const pv = this.previewsNode();
      if (!pv || leaf(d.node) !== String(pv.id) || !d.output?.stubelius_ltx_seeds) return;
      pv.properties = pv.properties || {};
      pv.properties.slx_seeds = d.output.stubelius_ltx_seeds;
      this.renderedSeq = this.queuedSeq ?? this.editSeq;
      this.preview.setVideos(d.output.stubelius_ltx_seeds);
      this.refresh(["insp", "foot"]);
    });
    on("stubelius-ltx-winner", () => { this.preview.render(); this.refresh(["insp"]); }, window);
    on("stubelius-ltx-setup", (e) => { if (e.detail?.name !== "director") this.renderCmd(); }, window);
    on("stubelius_ultimate_ltx.finish", () => this.markSteps());
  }

  dispose() {
    for (const off of this._off || []) off();
    this._off = [];
    this.preview?.dispose?.();
    closeMenus();
  }
}

// ------------------------------------------------------------------------------------------- styles

function injectDirectorStyles() {
  if (document.getElementById("stubelius-ultx-director")) return;
  document.head.appendChild(h("style", { id: "stubelius-ultx-director", text: DIRECTOR_CSS }));
}

const DIRECTOR_CSS = `
.slx-d .d-hdr-mode{display:flex;align-items:center;gap:10px}
.slx-d .d-hdr-mode .slx-seg{background:var(--glass);border-radius:14px}
.slx-d .d-hdr-mode .slx-seg-opt{padding:8px 16px;font-weight:500}
.slx-d .d-hdr-mode .slx-seg-opt.on{background:var(--glass3);box-shadow:inset 0 1px 0 rgba(255,255,255,.08);color:var(--text)}
.slx-d .d-retake-tag{display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:12px;background:rgba(var(--cut),.12);
  border:1px solid rgba(var(--cut),.45);font-weight:600}
.slx-d .d-retake-tag .slx-ic{color:rgb(var(--cut))}
.slx-d .d-cmd{display:flex;align-items:stretch;gap:12px;flex-wrap:wrap}
.slx-d .d-cmd>.slx-grp{min-height:78px;flex:none}
.slx-d .d-cmd>.d-chips{flex:1 1 0;min-width:0;overflow:hidden}
.slx-d .d-chips .slx-chip{flex:1 1 0;min-width:0}
.slx-d .d-chips .slx-chip>div:last-child{min-width:0}
.slx-d .d-chipval{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.slx-d.narrow .d-cmd>.d-chips{flex:1 1 100%;order:5}
.slx-d .d-field{display:flex;flex-direction:column;gap:3px;padding:0 6px}
.slx-d .d-valrow{display:flex;align-items:center;gap:4px}
.slx-d .d-val{font-family:var(--fh);font-size:20px;font-weight:600;background:none;border:0;color:var(--text);padding:0;width:62px;outline:none;
  border-bottom:1px solid transparent;border-radius:0;-moz-appearance:textfield}
.slx-d .d-val:hover,.slx-d .d-val:focus{border-bottom-color:rgba(var(--ac),.6)}
.slx-d .d-valbtn{width:auto;cursor:pointer;text-align:left;white-space:nowrap}
.slx-d .d-fps{min-width:28px}
.slx-d .d-ro{width:auto;cursor:default}
.slx-d .d-ro:hover{border-bottom-color:transparent}
.slx-d .d-seed{width:96px;font-size:17px;text-overflow:ellipsis}
.slx-d .d-seed:focus{width:150px}
.slx-d .d-valrow .slx-ibtn{width:28px;height:28px;border-radius:9px}
.slx-d .d-seed-lock.on{color:rgb(var(--ac))}
.slx-d .d-unit{color:var(--text2);font-size:12px;margin-left:-2px}
.slx-d .d-noseed{font-size:12px}
.slx-d .d-hint{display:inline-flex;align-items:center;gap:4px;margin-left:6px;padding:3px 7px;border-radius:8px;border:1px solid rgba(var(--cut),.5);
  background:rgba(var(--cut),.1);color:var(--text);font-size:11px;font-weight:600}
.slx-d .d-hint .slx-ic{color:rgb(var(--cut))}
.slx-d .d-vsep{width:1px;height:40px;background:var(--stroke)}
.slx-d .d-modes{display:flex;gap:6px}
.slx-d .d-mode{width:118px;height:56px;border-radius:13px;padding:9px 12px;background:var(--glass);border:1px solid var(--stroke);
  display:flex;flex-direction:column;justify-content:center;align-items:flex-start;text-align:left}
.slx-d .d-mode:hover{border-color:var(--stroke2)}
.slx-d .d-mode b{font-family:var(--fh);font-weight:600;font-size:15px;white-space:nowrap}
.slx-d .d-mode i{font-style:normal;color:var(--text3);font-size:11px;margin-top:2px;white-space:nowrap}
.slx-d .d-mode.on{background:linear-gradient(160deg,rgba(var(--ac),.28),rgba(var(--ac2),.14) 60%,rgba(var(--ac2),.06));border-color:rgba(var(--ac),.7);
  box-shadow:0 0 28px rgba(var(--ac),.28),inset 0 1px 0 rgba(255,255,255,.12)}
.slx-d .d-mode.on i{color:var(--text2)}
.slx-d .d-chips{gap:10px;padding:0 12px}
.slx-d .d-render{margin-left:auto;display:flex;gap:10px;align-items:center;flex:none}
.slx-d .d-main{display:grid;grid-template-columns:minmax(0,1fr) 554px;gap:18px;align-items:stretch}
.slx-d.narrow .d-main{grid-template-columns:minmax(0,1fr)}
.slx-d .d-insp{padding:18px 22px;display:flex;flex-direction:column;gap:14px;min-width:0}
.slx-d .d-cast:empty{display:none}
.slx-d .d-sizepop{display:flex;flex-direction:column;gap:10px;padding:6px}
.slx-d .d-sizes{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.slx-d .d-size{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:9px 11px;border-radius:12px;background:var(--glass);
  border:1px solid var(--stroke);text-align:left}
.slx-d .d-size b{font-family:var(--fh);font-weight:600;font-size:14px}
.slx-d .d-size span{color:var(--text3);font-size:11px}
.slx-d .d-size:hover{border-color:var(--stroke2)}
.slx-d .d-size.on{border-color:rgba(var(--ac),.7);background:rgba(var(--ac),.1)}
.slx-d .d-size-row{display:flex;align-items:center;gap:8px}
.slx-d .d-size-in{width:96px}
.slx-d .d-size-note{font-size:12px;line-height:1.45}
`;

// ------------------------------------------------------------------------------------------- the node

const DIRECTOR_SIZE = { minWidth: 1500, minHeight: 1050 };

// The classic editor's widgets come off the node when it turns into a window. Its callbacks stay on the node's own
// widgets (it wraps them), so the editor is told to stop writing: a later callback would commit its old timeline.
function dropClassic(node) {
  const old = node._timelineEditor;
  if (old) {
    old._suppressCommit = true;
    try { old.destroy?.(); } catch (e) { /* already gone */ }
  }
  node._timelineEditor = null;
  for (const name of ["ltx_settings_ui", "timeline_ui", "slx_show_window"]) {
    const i = (node.widgets || []).findIndex((w) => w.name === name);
    if (i < 0) continue;
    const w = node.widgets[i];
    try { w.onRemove?.(); } catch (e) { /* the frontend's own clean-up */ }
    w.element?.remove?.();
    node.widgets.splice(i, 1);
  }
  node._ltxClassicBuilt = false;
}

function makeWindow(node) {
  node.properties = node.properties || {};
  node.properties.slx_window = true;
  node._slxCompact = false;
  dropClassic(node);
  for (const w of node.widgets || []) if (WIDGETS.includes(w.name)) hideWidget(w);
  const win = new DirectorWindow(node);
  node._slx = win;
  mountWindow(node, "slx_director", win.root, DIRECTOR_SIZE);
  win.fit = autoHeight(node, win.root, { ...DIRECTOR_SIZE, extra: 46 });
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => win.root.classList.toggle("narrow", win.root.offsetWidth < 1560)).observe(win.root);
  }
  refreshThemes();
}

function makeClassic(node) {
  node._slxCompact = true;
  node._ltxBuildClassic?.();
  node.addWidget("button", "slx_show_window", null, () => {
    makeWindow(node);
    node.setDirtyCanvas?.(true, true);
  }, { serialize: false });
  const b = node.widgets[node.widgets.length - 1];
  b.label = "Show as window";
}

// From the window back to the classic editor (Settings)
export function toClassic(node) {
  const win = node._slx;
  if (!win) return;
  win.commit(false);
  win.dispose();
  const i = (node.widgets || []).findIndex((w) => w.name === "slx_director");
  if (i >= 0) {
    const w = node.widgets[i];
    try { w.onRemove?.(); } catch (e) { /* the frontend's own clean-up */ }
    w.element?.remove?.();
    node.widgets.splice(i, 1);
  }
  node._slx = null;
  node.properties.slx_window = false;
  makeClassic(node);
  node.setSize?.([1375, Math.max(800, node.computeSize?.()[1] || 800)]);
  node.setDirtyCanvas?.(true, true);
}

app.registerExtension({
  name: "StubeliusLTX.DirectorWindow",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "LTXDirectorCS25") return;

    // A new Director opens as a window; one from a saved workflow as the workflow says (properties.slx_window, set by
    // the example workflow and by Show as window), else as the classic editor: older workflows aren't rearranged.
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
      const node = this;
      setTimeout(() => {             // a loaded workflow's widgets and properties arrive with configure, after this
        if (node._slx || node._slxCompact) return;
        if (!node.graph) return;     // a clone made for a copy (Ctrl+C): never on the canvas
        const want = node.properties?.slx_window;
        if (want === true || (want === undefined && !node._slxConfigured)) makeWindow(node);
        else makeClassic(node);
      }, 0);
      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
      this._slxConfigured = true;
      return r;
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._slx?.dispose();
      return onRemoved?.apply(this, arguments);
    };
  },
  async afterConfigureGraph() {
    setTimeout(refreshThemes, 0);
  },
});
