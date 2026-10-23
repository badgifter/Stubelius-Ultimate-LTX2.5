// Stubelius Ultimate LTX Director: the timeline behind the Director window.
//
// The Director node (ltx_director.py) is fed by its timeline_data JSON and by three strings derived from it:
// local_prompts, segment_lengths and guide_strength. The classic editor (ltx_director.js, commitChanges) writes
// them on every edit; the window writes them here, the same way, so a timeline renders the same whichever editor
// last touched it. Every position is in frames at the Director's frame rate, counted from the timeline's start.
// Nothing in this file touches the page, so it can be tested on its own against the classic editor's code.

export const MIN_LEN = 6;                      // the classic editor's shortest block (MIN_SEGMENT_LENGTH)
export const REF = { off: "OFF", msr: "Licon MSR (Prefix)", ghost: "Ghost Mask (End)" };
export const REF_SLOTS = 5;                    // @ref1..@ref5
export const REF_VIEWS = 3;                    // pictures per reference slot
export const VOICE_SECONDS = 5;                // the voice slot of an AVref MSR LoRA (VOICE_SECONDS in ltx_director.py)
export const MSR_LIMIT = 5;                    // the MSR engine takes 1-5 reference pictures

export function newId(tag = "") {
  return Date.now().toString() + Math.random().toString(36).slice(2, 7) + tag;
}

// LTX renders 8n+1 frames: the length a video of `frames` really gets (ltxv_length in ltx_director.py)
export function ltxvLength(frames) {
  const d = Math.max(1, Math.round(Number(frames) || 1));
  return Math.ceil((d - 1) / 8) * 8 + 1;
}

const blankRef = () => ({ images: [], description: "" });

// ------------------------------------------------------------------------------------------- reading

// timeline_data -> the timeline, with the classic editor's defaults (parseInitial). The reference slots are
// always five (the classic editor starts a fresh node with three and fails on a picture for slot 4 or 5).
export function parseTimeline(text) {
  const t = {
    segments: [], motionSegments: [], audioSegments: [],
    global_prompt: "", retake_global_prompt: "",
    mainTrackEnabled: true, audioTrackEnabled: true, motionTrackEnabled: true,
    propHeight: 90, globalPropHeight: 60, showFilenames: true, overrideAudio: false, inpaint_audio: true,
    retakeMode: false, retakeStart: 24, retakeLength: 48, retakePrompt: "", retakeStrength: 1.0, retakeVideo: null,
    normalStartFrame: 0, normalDurationFrames: 120,
    reference_mode: REF.off, disable_prompt_relay: false, msr_prefix_frames: 41,
    analyzeProvider: "ollama", analyzeBaseUrl: "", analyzeModel: "",
    characters: [],
  };
  let p = null;
  try {
    p = text ? JSON.parse(text) : null;
  } catch (e) {
    p = null;
  }
  if (p && typeof p === "object" && !Array.isArray(p)) {
    for (const key of ["global_prompt", "retake_global_prompt", "mainTrackEnabled", "audioTrackEnabled", "motionTrackEnabled",
      "propHeight", "globalPropHeight", "showFilenames", "overrideAudio", "inpaint_audio", "retakeMode", "retakeStart",
      "retakeLength", "retakePrompt", "retakeStrength", "retakeVideo", "normalStartFrame", "normalDurationFrames",
      "reference_mode", "disable_prompt_relay", "msr_prefix_frames", "analyzeProvider", "analyzeBaseUrl", "analyzeModel"]) {
      if (p[key] !== undefined) t[key] = p[key];
    }
    if (Array.isArray(p.characters)) {
      t.characters = p.characters.map((c) => ({ images: Array.isArray(c?.images) ? c.images : [], description: c?.description || "",
        ...(c?.voice?.name ? { voice: { name: c.voice.name } } : {}) }));
    }
    for (const key of ["segments", "motionSegments", "audioSegments"]) {
      if (Array.isArray(p[key])) t[key] = p[key].filter((s) => s && typeof s === "object").map((s) => ({ ...s }));
    }
  }
  while (t.characters.length < REF_SLOTS) t.characters.push(blankRef());
  let cursor = 0;
  for (const s of t.segments) {
    if (s.start === undefined) { s.start = cursor; cursor += Number(s.length) || 0; }
    if (!s.id) s.id = newId();
    if (s.isEndFrame === undefined) s.isEndFrame = false;
  }
  for (const s of [...t.motionSegments, ...t.audioSegments]) {
    if (!s.id) s.id = newId();
    if (s.trimStart === undefined) s.trimStart = 0;
  }
  return t;
}

// ------------------------------------------------------------------------------------------- writing

// A block as it is saved: without what only lives in the page (pictures, players, upload state: "_" keys)
function saved(s) {
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k.startsWith("_") || k === "imgObj" || k === "videoEl" || k === "thumbnails") continue;
    out[k] = v;
  }
  return out;
}

// The blocks of the main track in time order. A plain stable sort, as the classic editor and Python both sort:
// the guide strengths are matched to the guides by this order.
export function sortSegments(t) {
  const seen = new Set();
  t.segments = t.segments.filter((s) => (seen.has(s.id) ? false : seen.add(s.id)));
  t.segments.sort((a, b) => a.start - b.start);
  return t.segments;
}

// timeline -> the object saved in timeline_data, keys in the classic editor's order (commitChanges toSave).
// ctx: the node's own flags the classic editor saves from elsewhere {showFilenames, showPromptZones, overrideAudio,
// inpaintAudio}.
export function serializeTimeline(t, ctx = {}) {
  const segs = sortSegments(t);
  const rv = t.retakeVideo;
  return {
    mainTrackEnabled: t.mainTrackEnabled !== false,
    audioTrackEnabled: t.audioTrackEnabled !== false,
    motionTrackEnabled: t.motionTrackEnabled !== false,
    propHeight: t.propHeight,
    globalPropHeight: t.globalPropHeight,
    showFilenames: !!ctx.showFilenames,
    showPromptZones: !!ctx.showPromptZones,
    overrideAudio: !!ctx.overrideAudio,
    inpaint_audio: !!ctx.inpaintAudio,
    global_prompt: t.global_prompt || "",
    retake_global_prompt: t.retake_global_prompt || "",
    retakeMode: !!t.retakeMode,
    retakeStart: t.retakeStart,
    retakeLength: t.retakeLength,
    retakePrompt: t.retakePrompt,
    retakeStrength: t.retakeStrength,
    retakeVideo: rv ? { fileName: rv.fileName, imageFile: rv.imageFile, videoDurationFrames: rv.videoDurationFrames, fileSize: rv.fileSize } : null,
    normalStartFrame: t.normalStartFrame,
    normalDurationFrames: t.normalDurationFrames,
    reference_mode: t.reference_mode || REF.off,
    disable_prompt_relay: !!t.disable_prompt_relay,
    msr_prefix_frames: t.msr_prefix_frames || 41,
    analyzeProvider: t.analyzeProvider || "ollama",
    analyzeBaseUrl: t.analyzeBaseUrl || "",
    analyzeModel: t.analyzeModel || "",
    characters: (t.characters || []).map((c) => ({
      images: (c.images || []).map((img) => (img.b64 ? { b64: img.b64, name: img.name } : { name: img.name })),
      description: c.description || "",
      ...(c.voice?.name ? { voice: { name: c.voice.name } } : {}),
    })),
    segments: segs.map(saved),
    motionSegments: (t.motionSegments || []).map(saved),
    audioSegments: (t.audioSegments || []).map(saved),
  };
}

// ------------------------------------------------------------------------------------------- what Python reads

// A "|" splits local_prompts: one inside a prompt would give Python one prompt more than lengths (an error)
const cleanPrompt = (p) => String(p || "").replace(/\s*\|\s*/g, ", ");

// The frames the timeline covers on screen: the render window and every block (getVisualDurationFrames)
export function visualFrames(t, start, duration) {
  if (t.retakeMode) {
    const d = Number(t.retakeVideo?.videoDurationFrames) || 0;
    return t.retakeVideo ? Math.max(24, Math.ceil(d * 1.15)) : 24;
  }
  let far = start + duration;
  for (const s of [...t.segments, ...t.audioSegments, ...t.motionSegments]) far = Math.max(far, s.start + s.length);
  return far;
}

// local_prompts, segment_lengths and guide_strength for the render window [start, start + duration), exactly as
// commitChanges derives them, plus the prompt zones those strings make: [{seg, from, to}] in absolute frames.
export function deriveStrings(t, start, duration) {
  const segs = sortSegments(t);
  const end = start + duration;
  const lengths = [];
  const prompts = [];
  const owners = [];
  const strengths = [];
  if (t.retakeMode) {
    const total = visualFrames(t, start, duration);
    const rs = t.retakeStart ?? 0;
    const rl = t.retakeLength ?? total;
    const re = rs + rl;
    const global = t.retake_global_prompt || "";
    const strength = Number(t.retakeStrength ?? 1.0);
    const region = (from, to, prompt, s) => {
      if (to - from > 0) { lengths.push(to - from); prompts.push(prompt); owners.push(null); strengths.push(s); }
    };
    region(start, Math.min(end, rs), global || "video", "0.00");
    region(Math.max(start, rs), Math.min(end, re), t.retakePrompt || "video", strength.toFixed(2));
    region(Math.max(start, re), end, global || "video", "0.00");
  } else {
    let cursor = start;
    let pending = 0;
    for (const s of segs) {
      if (s.start + s.length <= start) continue;
      if (s.start >= end) break;
      const es = Math.max(s.start, start);
      const ce = Math.min(s.start + s.length, end);
      if (s.isAnchor) {
        const absorb = ce - cursor;
        if (absorb > 0) {
          if (lengths.length) lengths[lengths.length - 1] += absorb;
          else pending += absorb;
        }
        cursor = Math.max(cursor, s.start + s.length);
        continue;
      }
      if (es > cursor) {
        const gap = Math.min(es, end) - cursor;
        if (lengths.length) lengths[lengths.length - 1] += gap;
        else pending += gap;
      }
      lengths.push(ce - es + pending);
      prompts.push(cleanPrompt(s.prompt));
      owners.push(s);
      pending = 0;
      cursor = Math.max(cursor, s.start + s.length);
    }
    const at = Math.min(cursor, end);
    if (lengths.length && at < end) lengths[lengths.length - 1] += end - at;
    for (const s of segs) {
      if (s.type === "text") continue;
      if (!(s.start + s.length > start && s.start < end)) continue;
      strengths.push(Number(s.guideStrength !== undefined ? s.guideStrength : 1.0).toFixed(2));
    }
  }
  const zones = [];
  let from = start;
  lengths.forEach((len, i) => { zones.push({ seg: owners[i], from, to: from + len }); from += len; });
  return {
    localPrompts: prompts.join(" | "),
    segmentLengths: lengths.join(","),
    guideStrength: strengths.join(","),
    zones,
  };
}

// The frame a picture block lands on (the guide's insert frame, absolute)
export function guideFrame(s) {
  return s.isEndFrame ? s.start + s.length - 1 : s.start;
}

// ------------------------------------------------------------------------------------------- frame rate

// A new frame rate: every block keeps its seconds (the classic editor leaves the IC-LoRA clips and the retake
// region at their old frames; here they move with the rest)
export function rebaseFps(t, oldFps, newFps) {
  const k = oldFps > 0 && newFps > 0 ? newFps / oldFps : 1;
  if (k === 1) return;
  const scale = (s, keys) => {
    for (const key of keys) {
      if (s[key] === undefined || s[key] === null) continue;
      s[key] = key === "length" ? Math.max(1, Math.round(s[key] * k)) : Math.round(s[key] * k);
    }
  };
  for (const s of t.segments) scale(s, ["start", "length", "trimStart", "videoDurationFrames"]);
  for (const s of t.audioSegments) scale(s, ["start", "length", "trimStart", "audioDurationFrames"]);
  for (const s of t.motionSegments) scale(s, ["start", "length", "trimStart", "videoDurationFrames", "previewThumbSourceFrames"]);
  scale(t, ["retakeStart", "retakeLength", "normalStartFrame", "normalDurationFrames"]);
  if (t.retakeVideo) scale(t.retakeVideo, ["videoDurationFrames"]);
}

// ------------------------------------------------------------------------------------------- editing

export const isPicture = (s) => s?.type === "image" || (s && s.type === undefined);
export const isClip = (s) => s?.type === "video";
export const isText = (s) => s?.type === "text";

// The segments: the blocks that own a prompt (everything on the main track but the anchors), in time order
export function segmentsOf(t) {
  return sortSegments(t).filter((s) => !s.isAnchor);
}

// The block a clip's sound sits in (the classic editor links "<id>_v" with "<id>_a")
export function soundOf(t, s) {
  if (!s?.id || !String(s.id).endsWith("_v")) return null;
  const id = String(s.id).slice(0, -2) + "_a";
  return t.audioSegments.find((a) => a.id === id) || null;
}

export function clipOf(t, a) {
  if (!a?.id || !String(a.id).endsWith("_a")) return null;
  const id = String(a.id).slice(0, -2) + "_v";
  return t.segments.find((s) => s.id === id) || null;
}

// The most frames a clip block can run from its trim point
export function clipRoom(s) {
  const d = Number(s.videoDurationFrames ?? s.audioDurationFrames);
  return Number.isFinite(d) && d > 0 ? Math.max(1, d - (Number(s.trimStart) || 0)) : Infinity;
}

// Split segment s at frame `at`: the part after it becomes a new text segment (a picture pinned to the end, and a
// clip, keep their own side). Returns the new segment, or null when either side would be too short.
export function splitSegment(t, s, at) {
  at = Math.round(at);
  if (at - s.start < MIN_LEN || s.start + s.length - at < MIN_LEN) return null;
  const right = { id: newId(), start: at, length: s.start + s.length - at, prompt: "", type: "text", isEndFrame: false };
  if (isPicture(s) && s.isEndFrame) {
    // the picture stays on the segment's last frame: it goes with the right side, the left becomes text
    const left = { id: newId(), start: s.start, length: at - s.start, prompt: s.prompt || "", type: "text", isEndFrame: false };
    s.start = at;
    s.length = right.length;
    s.prompt = "";
    t.segments.push(left);
    sortSegments(t);
    return s;
  }
  s.length = at - s.start;
  t.segments.push(right);
  sortSegments(t);
  return right;
}

// Remove a segment: the zone before it takes its time (a text segment or a picture on its first frame grows to
// cover it; Python gives the gap to the zone before it either way)
export function removeSegment(t, s) {
  const list = segmentsOf(t);
  const i = list.indexOf(s);
  t.segments = t.segments.filter((x) => x !== s);
  const sound = soundOf(t, s);
  if (sound) t.audioSegments = t.audioSegments.filter((a) => a !== sound);
  const prev = list[i - 1];
  if (prev && !isClip(prev) && !prev.isEndFrame) prev.length = Math.max(prev.length, s.start + s.length - prev.start);
  else if (!prev) {
    const next = list[i + 1];
    if (next && !isClip(next) && !next.isEndFrame && next.start > s.start) {
      next.length += next.start - s.start;
      next.start = s.start;
    }
  }
  sortSegments(t);
}

// Move the cut between segments a and b (b right after a) to frame `at`. A clip after the cut keeps its frames
// where they were in the clip (its trim point moves with the cut); a clip before it can't run past its own end
// (Python gives that gap to the clip's zone anyway). A clip's sound block moves with it.
export function moveCut(t, a, b, at) {
  const bEnd = b.start + b.length;
  let lo = a.start + MIN_LEN;
  const hi = bEnd - MIN_LEN;
  if (isClip(b)) lo = Math.max(lo, b.start - (Number(b.trimStart) || 0));
  at = Math.round(Math.max(lo, Math.min(hi, at)));
  if (lo > hi) return b.start;
  if (isClip(b)) b.trimStart = Math.max(0, (Number(b.trimStart) || 0) + (at - b.start));
  b.length = bEnd - at;
  b.start = at;
  a.length = isClip(a) ? Math.max(MIN_LEN, Math.min(at - a.start, clipRoom(a))) : at - a.start;
  for (const s of [a, b]) {
    const sound = soundOf(t, s);
    if (sound) Object.assign(sound, { start: s.start, length: s.length, trimStart: Number(s.trimStart) || 0 });
  }
  sortSegments(t);
  return at;
}

// The guide frame of an anchor kept inside the block it sits in, so the anchor never adds frames to a zone
export function placeAnchor(t, s, at, start, end) {
  const host = segmentsOf(t).find((x) => at >= x.start && at < x.start + x.length);
  let lo = start;
  let hi = end - s.length;
  if (host) { lo = Math.max(lo, host.start); hi = Math.min(hi, host.start + host.length - s.length); }
  s.start = Math.round(Math.max(lo, Math.min(Math.max(lo, hi), at)));
  return s.start;
}

// After a new length: the picture pinned to the last frame stays on it, and the last segment, when it ended on
// the old end, ends on the new one
export function refitEnd(t, start, oldDur, newDur) {
  const oldEnd = start + oldDur, newEnd = start + newDur;
  const oldLast = start + ltxvLength(oldDur), newLast = start + ltxvLength(newDur);
  for (const s of t.segments) {
    if (!isPicture(s) || !s.isEndFrame || s.start + s.length !== oldLast) continue;
    if (s.isAnchor) s.start = Math.max(start, newLast - s.length);
    else s.length = Math.max(MIN_LEN, newLast - s.start);
  }
  const list = segmentsOf(t);
  const last = list[list.length - 1];
  if (last && !isClip(last) && !last.isEndFrame && last.start + last.length === oldEnd && newEnd - last.start >= MIN_LEN) {
    last.length = newEnd - last.start;
  }
  sortSegments(t);
}

// ------------------------------------------------------------------------------------------- references

export function refsFilled(t) {
  return (t.characters || []).map((c, i) => ({ i, c })).filter(({ c }) => (c.images || []).length > 0);
}

// The @refN slots a text names (also the older @charN / @characterN)
export function taggedSlots(text) {
  const out = [];
  for (let i = 1; i <= REF_SLOTS; i++) {
    if ([`@ref${i}`, `@char${i}`, `@character${i}`].some((tag) => String(text || "").includes(tag))) out.push(i - 1);
  }
  return out;
}

// How many pictures the MSR engine gets: the tagged slots' pictures (all slots when nothing is tagged)
export function msrPictureCount(t, text) {
  const tagged = taggedSlots(text);
  const slots = tagged.length ? tagged : (t.characters || []).map((_, i) => i);
  return slots.reduce((n, i) => n + ((t.characters?.[i]?.images || []).length), 0);
}
