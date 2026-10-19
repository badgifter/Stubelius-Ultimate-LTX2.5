// Stubelius Ultimate LTX Director: the Cast, with references on.
//
// Five references (@ref1..@ref5), each a character or an item from 1-3 pictures and a short label. Licon MSR gives
// the MSR engine the pictures of the references the prompts name (all of them when none is named); Ghost Mask hides
// them in frames after the video. A picture is fitted into 1920 pixels and uploaded as a JPEG, as the classic editor
// does, so the timeline keeps a file name and never the picture itself.
import { h, icon, clear, label, toast, goToStep } from "./ulx_ui.js";
import { pickFiles, dropTargetMany, isImageFile, inputUrl, uploadFile } from "./ulx_media.js";
import * as M from "./ulx_director_model.js";

const { api } = window.comfyAPI.api;

export function refPictureUrl(img) {
  if (!img) return "";
  if (img.b64) return img.b64;
  return img.name ? inputUrl(img.name) : "";
}

// A reference picture as the classic editor stores it: the longest side at most 1920, JPEG 0.95,
// cglide/ltxref_<name>_<ms>.jpg (the picture itself only when the upload fails)
async function storeRef(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("not a picture the browser can read"));
      i.src = url;
    });
    let w = img.width, hgt = img.height;
    const max = 1920;
    if (w > max || hgt > max) {
      if (w > hgt) { hgt = Math.round((hgt * max) / w); w = max; } else { w = Math.round((w * max) / hgt); hgt = max; }
    }
    const c = document.createElement("canvas");
    c.width = w;
    c.height = hgt;
    c.getContext("2d").drawImage(img, 0, 0, w, hgt);
    const blob = await new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.95));
    const base = (file.name || "ref").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
    try {
      const up = await uploadFile(new File([blob], `ltxref_${base}_${Date.now()}.jpg`, { type: "image/jpeg" }));
      return { name: up.file };
    } catch (err) {
      console.error("[Stubelius LTX Director] reference upload failed, keeping the picture in the timeline", err);
      return { b64: c.toDataURL("image/jpeg", 0.95), name: file.name };
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function addRefPictures(d, i, files) {
  const c = d.t.characters[i];
  if (!c || !files?.length) return;
  if (!Array.isArray(c.images)) c.images = [];
  const take = files.filter(isImageFile).slice(0, M.REF_VIEWS);
  if (!take.length) return;
  d.ui.sel = { kind: "ref", id: i };
  d.saveUi();
  for (const file of take) {
    try {
      c.images.push(await storeRef(file));
      while (c.images.length > M.REF_VIEWS) c.images.shift();
    } catch (err) {
      toast(d.root, `Can't read ${file.name}: ${err.message}`, "bad");
    }
  }
  d.touch(["insp", "tl", "cast", "foot"]);
}

async function toDataUrl(img) {
  if (img.b64) return img.b64;
  try {
    const r = await fetch(refPictureUrl(img));
    const blob = await r.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onloadend = () => resolve(fr.result);
      fr.readAsDataURL(blob);
    });
  } catch (e) {
    return null;
  }
}

// The label from the pictures, by the describe server picked in Settings (the classic editor's Analyze): a 3-5 word
// label with Licon MSR, a short description otherwise
export async function describeRef(d, i) {
  const c = d.t.characters[i];
  if (!c?.images?.length || d._describing != null) return;
  d._describing = i;
  toast(d.root, "Describing the pictures…");
  try {
    const images = (await Promise.all(c.images.map(toDataUrl))).filter(Boolean);
    const r = await api.fetchApi("/ltx_director/analyze_character", { method: "POST", body: JSON.stringify({
      clip_name: "", image_b64: images, char_index: i, provider: d.t.analyzeProvider || "ollama",
      base_url: d.t.analyzeBaseUrl || "", model: d.t.analyzeModel || "", short: d.refMode === M.REF.msr,
    }) });
    const res = await r.json();
    if (res.status === "success" && res.description) {
      c.description = String(res.description).trim();
      d.touch(["insp", "tl", "cast"]);
    } else {
      toast(d.root, `No label: ${res.message || "the describe server gave no answer"}`, "bad");
    }
  } catch (err) {
    toast(d.root, "The describe server didn't answer: check it in Settings", "bad");
  } finally {
    d._describing = null;
  }
}

export function buildCast(d) {
  injectStyles();
  const box = clear(d.cast);
  if (!d.refsOn || d.retake) return;
  const msr = d.refMode === M.REF.msr;
  const panel = h("div.slx-panel.c-panel");
  const head = h("div.c-head", h("div", h("div.slx-h2", "Cast"), h("div.slx-muted",
    msr ? "Five references, each from 1-3 pictures: write @ref1 where one should be" : "Five references, each from 1-3 pictures: they ride in hidden frames after the video")),
  h("div.slx-spacer"));
  const models = d.modelsNode();
  if (msr && models) {
    const name = models.widgets?.find((w) => w.name === "msr_lora")?.value;
    const strength = Number(models.widgets?.find((w) => w.name === "msr_lora_strength")?.value ?? 1);
    const none = !name || String(name).toLowerCase() === "none";
    head.appendChild(h("button.slx-chip.c-lora", { type: "button", class: none ? "bad" : null, title: "The MSR LoRA (Setup)", onclick: () => goToStep(1) },
      h("div.slx-ico.cut", icon("users", 16)), h("div", label("MSR LoRA"),
        h("div.c-loraval", none ? "none picked: pick one in Setup" : `${String(name).split(/[\\/]/).pop().replace(/\.safetensors$/i, "")} · ${strength.toFixed(2)}`))));
  }
  panel.appendChild(head);
  const grid = h("div.c-grid");
  const picked = d.picked();
  for (let i = 0; i < M.REF_SLOTS; i++) {
    const c = d.t.characters[i] || { images: [], description: "" };
    const n = (c.images || []).length;
    const card = h("div.c-card", { class: [picked.kind === "ref" && picked.item === i ? "sel" : "", n ? "" : "empty"].join(" ").trim() || null,
      onclick: () => d.select("ref", i) });
    card.appendChild(h("div.c-ttl", h("b", `Reference ${i + 1}`), h("span", `@ref${i + 1}`)));
    if (n) {
      card.appendChild(h("div.c-pics", ...c.images.map((img) => h("img", { src: refPictureUrl(img), draggable: false }))));
    } else {
      const drop = h("button.slx-drop.c-drop", { type: "button", title: "Pictures of one character or item (front, side, back)",
        onclick: async (e) => { e.stopPropagation(); const files = await pickFiles("image/*"); if (files.length) addRefPictures(d, i, files); } },
      icon("plus", 18), "Drop 1-3 pictures");
      card.appendChild(drop);
    }
    card.appendChild(h("div.c-label", { class: c.description ? null : "muted" }, c.description || (n ? "no label yet" : "a short label")));
    dropTargetMany(card, (files) => addRefPictures(d, i, files.filter(isImageFile)));
    grid.appendChild(card);
  }
  panel.appendChild(grid);
  box.appendChild(panel);
}

let styled = false;
function injectStyles() {
  if (styled) return;
  styled = true;
  document.head.appendChild(h("style", { id: "stubelius-ultx-cast", text: `
.slx-d .c-panel{padding:18px 22px;display:flex;flex-direction:column;gap:14px}
.slx-d .c-head{display:flex;align-items:center;gap:14px}
.slx-d .c-lora{max-width:420px}
.slx-d .c-lora.bad{border-color:rgba(var(--bad),.6)}
.slx-d .c-loraval{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.slx-d .c-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
.slx-d .c-card{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:16px;background:var(--glass);border:1px solid var(--stroke);
  cursor:pointer;min-width:0}
.slx-d .c-card:hover{border-color:var(--stroke2)}
.slx-d .c-card.sel{border-color:rgba(var(--cut),.8);box-shadow:0 0 22px rgba(var(--cut),.25)}
.slx-d .c-card.over{border-color:rgba(var(--cut),.8);background:rgba(var(--cut),.06)}
.slx-d .c-ttl{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.slx-d .c-ttl b{font-family:var(--fh);font-weight:600}
.slx-d .c-ttl span{color:rgb(var(--cut));font-family:var(--fh);font-weight:600;font-size:12px}
.slx-d .c-pics{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;height:96px}
.slx-d .c-pics img{width:100%;height:96px;object-fit:cover;border-radius:10px;border:1px solid var(--stroke2)}
.slx-d .c-drop{height:96px;flex-direction:column;gap:4px;font-size:12px;width:100%;background:none}
.slx-d .c-label{font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.slx-d .c-label.muted{color:var(--text3)}
.slx-d.narrow .c-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
` }));
}
