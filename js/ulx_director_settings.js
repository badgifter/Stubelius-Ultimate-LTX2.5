// Stubelius Ultimate LTX Director: the Settings popover (the gear in the header).
//
// What the classic editor keeps in its settings panel and gear menu: prompt relay and how sharp its cuts are, how
// pictures are fitted and compressed, where the render starts, the reference strength and MSR frames, the server
// that writes a reference's label, retake, the upload folder, and the way back to the classic editor.
import { h, seg, select, button, popover, closeMenus, toast } from "./ulx_ui.js";

const { api } = window.comfyAPI.api;

const PROVIDERS = [["off", "Off"], ["ollama", "Ollama"], ["lmstudio", "LM Studio"], ["custom", "Custom (OpenAI style)"]];

export function openSettings(d, anchor) {
  injectStyles();
  const t = d.t;
  const sec = (title, ...rows) => h("div.st-sec", h("div.slx-lbl", title), ...rows);
  const row = (name, hint, el) => h("div.st-row", h("div.st-name", h("b", name), hint ? h("span", hint) : null), el);
  const num = (value, { step = 1, min = null, max = null, onSet }) => {
    const input = h("input.slx-input.st-num", { type: "number", step, value });
    if (min !== null) input.min = min;
    if (max !== null) input.max = max;
    input.addEventListener("change", () => {
      let v = parseFloat(input.value);
      if (!Number.isFinite(v)) { input.value = value; return; }
      if (min !== null) v = Math.max(min, v);
      if (max !== null) v = Math.min(max, v);
      input.value = v;
      onSet(v);
    });
    return input;
  };
  const text = (value, placeholder, onSet) => {
    const input = h("input.slx-input.st-text", { type: "text", value: value || "", placeholder });
    input.addEventListener("change", () => onSet(input.value.trim()));
    return input;
  };

  const relayOn = !t.disable_prompt_relay;
  const resizeW = d.w.resize_method;
  const resizeValues = resizeW?.options?.values || ["maintain aspect ratio", "stretch to fit", "pad", "pad green", "crop"];
  const msrFrames = Number(t.msr_prefix_frames) === 25 ? 25 : 33;

  const body = h("div.st-pop",
    sec("Prompts",
      row("Prompt relay", "On: each segment's prompt holds for its own time. Off: the global prompt alone",
        seg([[true, "On"], [false, "Off"]], relayOn, (v) => { t.disable_prompt_relay = !v; d.touch(); })),
      row("Cut sharpness", "Epsilon: below about 0.1 the cuts are sharp; 0.5 and up blend",
        num(Number(d.val("epsilon", 0.001)), { step: 0.0001, min: 0.0001, max: 0.99, onSet: (v) => { d.set("epsilon", v); d.commit(); } }))),
    sec("Pictures",
      row("Fitting", "How a picture that isn't the video's shape is fitted",
        select(resizeValues, d.val("resize_method", "maintain aspect ratio"), (v) => { d.set("resize_method", v); d.touch(["cmd"]); })),
      row("Compression", "H.264 artefacts on each guide picture, as in a real video (0 = none)",
        num(Number(d.val("img_compression", 18)), { min: 0, max: 100, onSet: (v) => { d.set("img_compression", Math.round(v)); d.commit(); } })),
      row("Size grid", "Sizes snap to this (LTX: 32)",
        num(Number(d.val("divisible_by", 32)), { min: 1, max: 256, onSet: (v) => { d.set("divisible_by", Math.round(v)); d.commit(); } }))),
    sec("Render",
      row("Starts at", `Renders ${d.sec(d.durF).toFixed(1)} s from here; the timeline before it is left out`,
        h("div.st-inline", num(Number(d.sec(d.startF).toFixed(2)), { step: 0.1, min: 0, onSet: (v) => d.setStart(v) }), h("span.slx-muted", "s")))),
    sec("References",
      row("Strength", "How hard the Cast pictures pull in the seeds",
        num(Number(d.val("reference_strength", 1)), { step: 0.05, min: 0, max: 5, onSet: (v) => { d.set("reference_strength", v); d.commit(); } })),
      row("MSR frames", "Frames each MSR reference takes (LTX 2.5: 25 or 33)",
        seg([[25, "25"], [33, "33"]], msrFrames, (v) => { t.msr_prefix_frames = v; d.commit(); })),
      row("Labels by", "The model that writes a reference's label from its pictures",
        select(PROVIDERS, t.analyzeProvider || "ollama", (v) => { t.analyzeProvider = v; d.commit(); })),
      row("Its address", "Empty: the provider's usual address",
        text(t.analyzeBaseUrl, "e.g. http://127.0.0.1:1234", (v) => { t.analyzeBaseUrl = v; d.commit(); })),
      row("Its model", "Empty: the provider's default",
        text(t.analyzeModel, "a vision model", (v) => { t.analyzeModel = v; d.commit(); }))),
    sec("More",
      h("div.st-btns",
        d.retake
          ? button("Leave retake", "x", "small", () => { closeMenus(); d.setRetake(false); })
          : button("Retake a part of a video…", "refresh", "small", () => { closeMenus(); d.setRetake(true); },
            "Make one part of a finished video again: the rest stays as it is"),
        button("Open the upload folder", "folder", "small", async () => {
          try {
            const r = await api.fetchApi("/ltx_director_open_folder");
            if (!r.ok) toast(d.root, "The folder opens only on the machine ComfyUI runs on", "warn");
          } catch (e) { toast(d.root, "Couldn't open it", "bad"); }
        }, "input/cglide: the pictures, clips and sounds this timeline uses"),
        button("Classic editor", "columns", "small flat", () => { closeMenus(); d.toClassic(); },
          "Back to the LTX Director's own timeline editor (Show as window brings this back)"))));
  popover(anchor, body, 480);
}

let styled = false;
function injectStyles() {
  if (styled) return;
  styled = true;
  document.head.appendChild(h("style", { id: "stubelius-ultx-dsettings", text: `
.slx .st-pop{display:flex;flex-direction:column;gap:14px;padding:6px;max-height:640px;overflow:auto}
.slx .st-sec{display:flex;flex-direction:column;gap:8px}
.slx .st-row{display:flex;align-items:center;justify-content:space-between;gap:14px}
.slx .st-name{display:flex;flex-direction:column;gap:2px;min-width:0}
.slx .st-name b{font-weight:600}
.slx .st-name span{color:var(--text3);font-size:11.5px;line-height:1.35}
.slx .st-row>:last-child{flex:none}
.slx .st-num{width:96px;height:34px;text-align:right}
.slx .st-text{width:190px;height:34px}
.slx .st-row .slx-select{height:34px;max-width:200px}
.slx .st-inline{display:flex;align-items:center;gap:6px}
.slx .st-btns{display:flex;gap:8px;flex-wrap:wrap}
` }));
}

