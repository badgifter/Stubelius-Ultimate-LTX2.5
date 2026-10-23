// Stubelius Ultimate LTX: the Setup window (step 1 of 4), on the Setup node.
//
// How the seeds are rendered: three modes (Full size, Draft, Low VRAM: each fills the first pass and the memory
// switches), the fine-tuning under them, a sampler for each seed (the Seed Samplers node), the models (the Models
// node: checkpoint, text encoder, VAEs, latent upscaler, live preview), the distilled, IC, MSR and global LoRAs, the
// speed and memory switches, the video memory, and the look every window follows (the Theme node). The window
// edits those nodes' own widgets; nothing is stored twice.
import {
  h, icon, clear, seg, button, iconButton, label, badge, toast, select, slider, toggle, windowFrame, markSteps, goToStep,
  injectStyles, widget, widgetValue, setWidget, nodesOfType, fmtBytes, refreshThemes, THEME_NAMES, THEME_SWATCHES,
  windowOrCompact,
} from "./ulx_ui.js";
import { tidy } from "./ulx_stage.js";

const { app } = window.comfyAPI.app;
const { api } = window.comfyAPI.api;

const SETUP_WIDGETS = ["seeds", "seed", "control_after_generate", "steps", "cfg", "first_pass_scale"];
const SEED_STEP = 1000003;       // seed k = seed + (k - 1) * 1000003 (stubelius_ltx_pipeline.SEED_STEP)
const HALF = 0.5;                // the first pass of Draft and Low VRAM
const MODES = [
  ["Full size", "The seeds render at the Director's full size and the winner is finished as rendered. Real HD detail."],
  ["Draft", "Half-size seeds for quick looks. The winner is upscaled ×2 in latent space and refined."],
  ["Low VRAM", "Half-size seeds with the memory savers on, for smaller cards. Same refine as Draft."],
];
const MODEL_CARDS = [
  ["diffusion_model", "Video model · LTX 2.5", "movie", ["diffusion_models", "unet_gguf"]],
  ["text_encoder", "Text encoder", "message", ["text_encoders", "clip_gguf"]],
  ["video_vae", "Video VAE", "photo", ["vae"]],
  ["audio_vae", "Audio VAE", "wave", ["vae"]],
  ["latent_upscaler", "Latent upscaler ×2", "maximize", ["latent_upscale_models"]],
  ["live_preview", "Live preview", "eye", ["vae", "vae_approx"]],
];
const LORA_WIDGETS = ["distill_lora", "ic_lora", "msr_lora", "extra_lora_1", "extra_lora_2"];
const LORA_MAX = 2;              // the Models node's strength range

export function precision(name) {
  const n = String(name || "").toLowerCase();
  for (const [re, tag] of [[/nvfp4/, "NVFP4"], [/int8/, "INT8"], [/fp8|e4m3/, "FP8"], [/bf16/, "BF16"], [/fp16/, "FP16"], [/fp32/, "FP32"],
    [/q8_0/, "GGUF Q8"], [/q6/, "GGUF Q6"], [/q5/, "GGUF Q5"], [/q4/, "GGUF Q4"], [/\.gguf$/, "GGUF"]]) {
    if (re.test(n)) return tag;
  }
  return null;
}

const baseName = (n) => String(n || "").split(/[\\/]/).pop().replace(/\.(safetensors|gguf|ckpt|pt|pth)$/i, "");

// The mode the Setup's values make: the first pass decides; at half size the memory savers tell Low VRAM from Draft
export function modeOf(setup, models) {
  const scale = Number(widgetValue(setup, "first_pass_scale", 1));
  if (scale >= 0.999) return "Full size";
  const savers = widgetValue(models, "memory_efficient_attention", false) && widgetValue(models, "chunk_feed_forward", false);
  return savers ? "Low VRAM" : "Draft";
}

// The Director's size (its custom width and height; 0 = the first picture's own size)
export function directorSize(director) {
  const w = Number(widgetValue(director, "custom_width", 0)), hgt = Number(widgetValue(director, "custom_height", 0));
  return w > 0 && hgt > 0 ? [w, hgt] : null;
}

// The seed size at a first-pass scale: the Director's size scaled, on LTX's 32 grid
export function seedSize(size, scale) {
  if (!size) return null;
  const k = Math.min(1, Math.max(0.25, Number(scale) || 1));
  return [Math.max(32, Math.round((size[0] * k) / 32) * 32), Math.max(32, Math.round((size[1] * k) / 32) * 32)];
}

// ------------------------------------------------------------------------------------------- mode art

function art(mode) {
  const svg = (inner) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.setAttribute("viewBox", "0 0 280 150");
    el.setAttribute("preserveAspectRatio", "xMidYMid slice");
    el.setAttribute("class", "su-art-svg");
    el.innerHTML = inner;
    return el;
  };
  if (mode === "Full size") {
    return svg(`<defs><pattern id="ufsg" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" style="stroke:rgb(var(--ac))" stroke-opacity=".28" stroke-width=".7"/></pattern>`
      + `<linearGradient id="ufsf" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity="1"/></linearGradient>`
      + `<mask id="ufsm"><rect width="280" height="150" fill="url(#ufsf)"/></mask><filter id="ufsb"><feGaussianBlur stdDeviation="3"/></filter></defs>`
      + `<rect width="280" height="150" fill="url(#ufsg)" mask="url(#ufsm)"/>`
      + `<rect x="140" y="26" width="112" height="62" rx="5" fill="none" style="stroke:rgb(var(--ac2))" stroke-width="5" opacity=".5" filter="url(#ufsb)"/>`
      + `<rect x="140" y="26" width="112" height="62" rx="5" fill="none" style="stroke:rgb(var(--ac))" stroke-width="2"/>`
      + `<path d="M132 34v-16h16M260 34v-16h-16M132 80v16h16M260 80v16h-16" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`
      + `<path d="M152 76l20 -22l16 14l14 -18l38 26" fill="none" style="stroke:rgb(var(--ac2))" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
      + `<circle cx="226" cy="44" r="6" fill="#fff" filter="url(#ufsb)"/><circle cx="226" cy="44" r="4" fill="#fff"/>`);
  }
  if (mode === "Draft") {
    return svg(`<defs><pattern id="udrg" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" style="stroke:rgb(var(--ac))" stroke-opacity=".22" stroke-width="1"/></pattern>`
      + `<filter id="udrb"><feGaussianBlur stdDeviation="9"/></filter></defs>`
      + `<rect width="280" height="150" fill="url(#udrg)"/>`
      + `<circle cx="96" cy="64" r="34" style="fill:rgb(var(--ac))" opacity=".55" filter="url(#udrb)"/>`
      + `<circle cx="122" cy="74" r="22" style="fill:rgb(var(--ac2))" opacity=".45" filter="url(#udrb)"/>`
      + `<rect x="60" y="40" width="80" height="44" rx="4" fill="none" style="stroke:rgb(var(--ac))" stroke-width="1.6" stroke-dasharray="5 5"/>`
      + `<path d="M154 70h46" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 6"/>`
      + `<path d="M194 62l10 8l-10 8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<rect x="214" y="30" width="54" height="80" rx="5" fill="none" style="stroke:rgb(var(--ac2))" stroke-width="2"/>`
      + `<text x="241" y="77" text-anchor="middle" fill="#fff" font-family="SLX Space Grotesk, Space Grotesk, sans-serif" font-weight="700" font-size="18">×2</text>`);
  }
  let bars = "";
  [[136, 70, 34], [156, 58, 46], [176, 78, 26]].forEach(([x, y, hh]) => { bars += `<rect x="${x}" y="${y}" width="12" height="${hh}" rx="3" fill="url(#ulvb)"/>`; });
  let empty = "";
  [196, 216, 236].forEach((x) => { empty += `<rect x="${x}" y="40" width="12" height="64" rx="3" fill="#fff" fill-opacity=".08" stroke="#fff" stroke-opacity=".25"/>`; });
  let pins = "";
  for (let x = 136; x <= 256; x += 20) pins += `M${x} 20v-8M${x} 124v-8`;
  return svg(`<defs><linearGradient id="ulvb" x1="0" x2="0" y1="1" y2="0"><stop offset="0" style="stop-color:rgb(var(--ac))"/><stop offset="1" style="stop-color:rgb(var(--ac2))"/></linearGradient>`
    + `<filter id="ulvg"><feGaussianBlur stdDeviation="2.5"/></filter></defs>`
    + `<rect x="120" y="20" width="148" height="96" rx="10" fill="none" style="stroke:rgb(var(--ac))" stroke-opacity=".5" stroke-width="1.6"/>`
    + `<path d="${pins}" style="stroke:rgb(var(--ac))" stroke-opacity=".45" stroke-width="2" stroke-linecap="round"/>`
    + `<g filter="url(#ulvg)" opacity=".6">${bars}</g>${bars}${empty}`);
}

// ------------------------------------------------------------------------------------------- the window

class SetupWindow {
  constructor(node) {
    this.node = node;
    this.sizes = {};          // file name -> bytes
    this.stats = null;
    injectStyles();
    injectSetupStyles();
    const f = windowFrame({ title: "Ultimate LTX · Setup", subtitle: "Models, speed and look", step: 1, onStep: goToStep });
    Object.assign(this, f);
    this.root.classList.add("slx-u");
    this.status = h("div.slx-status", h("span.slx-dot"), h("span", "Models"));
    this.head.append(h("div.slx-spacer"), this.status,
      iconButton("refresh", "Read the model folders and the video memory again", () => this.reload(true)));
    this.left = h("div.su-left");
    this.right = h("div.su-right");
    this.body.appendChild(h("div.su-main", this.left, this.right));
    this.render();
    this.reload(false);
  }

  models() { return nodesOfType("StubeliusLTXModels")[0] || null; }
  samplers() { return nodesOfType("StubeliusLTXSeedSamplers")[0] || null; }
  director() { return nodesOfType("LTXDirectorCS25")[0] || null; }
  output() { return nodesOfType("StubeliusLTXOutput")[0] || null; }
  theme() { return nodesOfType("StubeliusLTXTheme")[0] || null; }

  async reload(force) {
    const m = this.models();
    const items = [];
    for (const [name, , , folders] of MODEL_CARDS) {
      const v = widgetValue(m, name);
      if (v && v !== "off" && v !== "none") for (const f of folders) items.push([f, v]);
    }
    for (const name of LORA_WIDGETS) {
      const v = widgetValue(m, name);
      if (v && v !== "none") items.push(["loras", v]);
    }
    try {
      const [info, stats] = await Promise.all([
        api.fetchApi("/stubelius_ultimate_ltx/model_info", { method: "POST", body: JSON.stringify({ items }) }).then((r) => (r.ok ? r.json() : { items: [] })),
        api.fetchApi("/system_stats").then((r) => (r.ok ? r.json() : null)),
      ]);
      for (const it of info.items || []) if (it.found) this.sizes[`${it.name}`] = it.size;
      this.stats = stats;
    } catch (e) {
      // an older server side: no sizes
    }
    this.render();
    if (force) toast(this.root, "Model folders and video memory read again");
  }

  // the other windows draw again: the Director's mode chips and seed size, the Seeds window's samplers
  changed(name) {
    this.director()?._slx?.renderCmd?.();
    window.dispatchEvent(new CustomEvent("stubelius-ltx-setup", { detail: { name } }));
  }

  setM(name, value) {
    const m = this.models();
    if (!m) return;
    setWidget(m, name, value);
    this.reload(false);
    this.changed(name);
  }

  setS(name, value) {
    setWidget(this.node, name, value);
    this.render();
    this.changed(name);
  }

  setSampler(name, value) {
    const s = this.samplers();
    if (!s) return;
    setWidget(s, name, value);
    this.render();
    this.changed(name);
  }

  setMode(mode) {
    const m = this.models();
    if (mode === "Full size") {
      setWidget(this.node, "first_pass_scale", 1.0);
      if (m) { setWidget(m, "memory_efficient_attention", false); setWidget(m, "chunk_feed_forward", false); }
    } else {
      if (Number(widgetValue(this.node, "first_pass_scale", 1)) >= 0.999) setWidget(this.node, "first_pass_scale", HALF);
      const low = mode === "Low VRAM";
      if (m) { setWidget(m, "memory_efficient_attention", low); setWidget(m, "chunk_feed_forward", low); }
    }
    this.render();
    this.changed("mode");
  }

  // ----------------------------------------------------------------------------------- drawing

  render() {
    this.renderStatus();
    const L = clear(this.left), R = clear(this.right);
    L.append(this.modesPanel(), this.modelsPanel(), this.lorasPanel());
    R.append(this.memoryPanel(), this.perfPanel(), this.lookPanel());
    this.renderFoot();
    this.markSteps();
  }

  modelState() {
    const m = this.models();
    let found = 0, total = 0;
    for (const [name] of MODEL_CARDS) {
      const w = widget(m, name);
      if (!w) continue;
      if (name === "live_preview" && w.value === "off") continue;
      total++;
      if ((w.options?.values || []).includes(w.value)) found++;
    }
    return { found, total };
  }

  renderStatus() {
    const s = this.status;
    if (!this.models()) {
      s.className = "slx-status warn";
      s.lastChild.textContent = "Add a Stubelius LTX Models node";
      return;
    }
    const { found, total } = this.modelState();
    s.className = "slx-status" + (found < total ? " warn" : "");
    s.lastChild.textContent = found < total ? `${total - found} model${total - found > 1 ? "s" : ""} missing · ${found} of ${total} found`
      : `Models ready · ${found} of ${total} found`;
  }

  modesPanel() {
    const m = this.models();
    const mode = modeOf(this.node, m);
    const size = directorSize(this.director());
    const scale = Number(widgetValue(this.node, "first_pass_scale", 1));
    const refineSteps = widgetValue(this.output(), "refine_steps", 4);
    const panel = h("div.slx-panel.su-modes", h("div.su-ph", h("div.slx-h2", "How do you want to render?"),
      h("span.slx-muted", "Each mode fills the first pass and the memory switches for you")));
    const cards = h("div.su-cards.three");
    for (const [name, text] of MODES) {
      const on = name === mode;
      const k = name === "Full size" ? 1 : on ? scale : HALF;
      const s = seedSize(size, k);
      cards.appendChild(h("button.su-card", { type: "button", class: on ? "on" : null, onclick: () => this.setMode(name) },
        h("div.su-art", art(name), h("div.su-art-name", name), on ? h("span.su-check", icon("check", 15)) : null),
        h("div.su-card-b", h("div.su-card-t", text),
          h("div.su-kv", icon("stairs", 14), h("span", "Steps"), h("b", String(widgetValue(this.node, "steps", 8)))),
          h("div.su-kv", icon("aspect", 14), h("span", "Seeds at"), h("b", s ? `${s[0]}×${s[1]}` : k >= 0.999 ? "full size" : `${k.toFixed(2)}×`)),
          name === "Low VRAM"
            ? h("div.su-kv", icon("layers", 14), h("span", "Memory savers"), h("b", "on"))
            : h("div.su-kv", icon("sparkles", 14), h("span", "Refine"), h("b", name === "Full size" ? "none" : `${refineSteps} steps`)))));
    }
    panel.appendChild(cards);

    // fine-tuning: the Setup node's own values
    const sv = (name) => Number(widgetValue(this.node, name, 0));
    const tune = (lab, name, min, max, step, fmt) => {
      const o = widget(this.node, name)?.options || {};
      if (Number.isFinite(o.min)) min = Math.max(min, o.min);
      if (Number.isFinite(o.max)) max = Math.min(max, o.max);
      const val = h("b", fmt(sv(name)));
      const s = slider({ min, max, step, value: sv(name), onInput: (v) => { val.textContent = fmt(v); }, onChange: (v) => this.setS(name, v) });
      return h("div.su-tune", h("div.su-tune-h", label(lab), val), s);
    };
    panel.appendChild(h("div.su-tunes.lx",
      tune("Steps", "steps", 1, 40, 1, (v) => String(Math.round(v))),
      tune("First pass", "first_pass_scale", 0.25, 1, 0.05, (v) => `${Number(v).toFixed(2)}×`),
      tune("CFG", "cfg", 1, 8, 0.1, (v) => Number(v).toFixed(1)),
      h("div.su-tune.su-seeds", label("Seeds to compare"),
        seg([[1, "1"], [2, "2"], [3, "3"], [4, "4"]], Number(widgetValue(this.node, "seeds", 1)), (v) => this.setS("seeds", v)))));

    // a sampler for each seed (the Seed Samplers node); the seeds past the count aren't rendered
    const sn = this.samplers();
    const count = Number(widgetValue(this.node, "seeds", 1));
    const seed0 = Number(widgetValue(this.node, "seed", 42));
    if (sn) {
      const row = h("div.lx-samp");
      for (let k = 1; k <= 4; k++) {
        const sw = widget(sn, `seed_${k}_sampler`), cw = widget(sn, `seed_${k}_scheduler`);
        if (!sw || !cw) continue;
        const seedK = (BigInt(Math.max(0, Math.floor(seed0))) + BigInt((k - 1) * SEED_STEP)) % (1n << 64n);
        row.appendChild(h("div.lx-samp-c", { class: k > count ? "off" : null, title: k > count ? `Seed ${k} isn't rendered: Seeds to compare is ${count}` : null },
          h("div.lx-samp-h", h("b", `Seed ${k}`), h("span", String(seedK))),
          select(sw.options?.values || [], sw.value, (v) => this.setSampler(`seed_${k}_sampler`, v)),
          select(cw.options?.values || [], cw.value, (v) => this.setSampler(`seed_${k}_scheduler`, v))));
      }
      panel.appendChild(row);
      panel.appendChild(h("div.lx-samp-note", icon("info", 14),
        h("span", "A sampler for each seed. euler_ancestral with linear_quadratic at 8 steps is Lightricks' distilled first pass; seeds 2–4 add 1000003 each.")));
    } else {
      panel.appendChild(h("div.lx-samp-note", icon("info", 14),
        h("span", "No Seed Samplers node: every seed uses euler_ancestral with linear_quadratic.")));
    }
    return panel;
  }

  modelsPanel() {
    const m = this.models();
    const panel = h("div.slx-panel.su-models", h("div.su-ph", h("div.slx-h2", "Models"), h("span.slx-muted", "From your ComfyUI model folders")));
    if (!m) {
      panel.appendChild(h("div.slx-muted", "Add a Stubelius LTX Models node to this workflow."));
      return panel;
    }
    const grid = h("div.su-mgrid");
    for (const [name, title, ic] of MODEL_CARDS) {
      const w = widget(m, name);
      if (!w) continue;
      const opts = w.options?.values || [];
      const v = w.value;
      const found = opts.includes(v);
      const size = this.sizes[v];
      const tag = precision(v);
      const isPreview = name === "live_preview";
      const isUpscaler = name === "latent_upscaler";
      const sel = select(opts, v, (x) => this.setM(name, x), "su-file");
      sel.title = String(v || "");
      const draftOnly = isUpscaler && Number(widgetValue(this.node, "first_pass_scale", 1)) >= 0.999;
      const state = isPreview && v === "off" ? "Off" : !found ? "Missing" : isPreview ? "On"
        : name === "text_encoder" ? "Runs first" : draftOnly ? "Draft only" : "On disk";
      grid.appendChild(h("div.su-mcard", { class: found || (isPreview && v === "off") ? null : "missing" },
        h("span.slx-ico.ac.su-mic", icon(ic, 18)),
        h("div.su-mbody", h("b", title), sel,
          h("div.su-mbadges", tag ? badge(tag, "ac") : null, size ? badge(fmtBytes(size)) : null,
            h("div.slx-spacer"), h("span.su-state", { class: state === "Missing" ? "bad" : state === "Off" || state === "Draft only" ? "off" : null }, h("i"), state)))));
    }
    panel.appendChild(grid);
    return panel;
  }

  // a LoRA picker with its strength: [select] [slider] [value]
  loraRow(name, title, ic, cls, hint) {
    const m = this.models();
    const nameW = widget(m, name), strW = widget(m, `${name}_strength`);
    if (!nameW) return null;
    const val = h("span.lx-val", Number(strW?.value ?? 1).toFixed(2));
    const off = nameW.value === "none";
    const s = strW ? slider({ min: -LORA_MAX, max: LORA_MAX, step: 0.05, value: Number(strW.value ?? 1),
      onInput: (v) => { val.textContent = Number(v).toFixed(2); }, onChange: (v) => this.setM(`${name}_strength`, v) }) : null;
    if (s && off) s.disabled = true;
    return h(`div.lx-lrow${cls ? "." + cls : ""}`, { class: off ? "off" : null },
      icon(ic, 20),
      h("div.su-pdmd-t", h("b", title), select(nameW.options?.values || [], nameW.value, (x) => this.setM(name, x), "su-file"),
        hint ? h("span.lx-hint", hint) : null),
      s ? h("div.lx-lstr", s) : null, strW ? val : null);
  }

  lorasPanel() {
    const m = this.models();
    const panel = h("div.slx-panel.su-loras", h("div.su-ph", h("div.slx-h2", "LoRAs"), h("span.slx-muted", "They apply to the seeds and to the refine")));
    if (!m) return panel;
    const left = h("div.su-lcol");

    // the distilled LoRA: only for a dev checkpoint (a distilled one, the Stubelius remix included, has it baked in)
    const dw = widget(m, "distill_lora");
    if (dw) {
      const all = dw.options?.values || [];
      const current = dw.value;
      const ckpt = String(widgetValue(m, "diffusion_model", "")).toLowerCase();
      const distilledCkpt = /distill|stubelius_remix|remix_v|_dev_?distill/.test(ckpt) && !/[^a-z]dev[^a-z]/.test(ckpt.replace(/distill.*$/, ""));
      const named = all.filter((n) => n !== "none" && /distill/i.test(n) && /ltx/i.test(n) && /2[._-]?5/.test(n));
      const shown = ["none", ...[current, ...named].filter((n, i, a) => n && n !== "none" && a.indexOf(n) === i)].slice(0, 3);
      left.appendChild(label("Distilled LoRA · only for a dev checkpoint"));
      for (const n of shown) {
        const on = n === current;
        const gone = n !== "none" && !all.includes(n);
        left.appendChild(h("button.su-turbo", { type: "button", class: [on ? "on" : "", gone ? "missing" : ""].join(" ").trim() || null,
          title: n === "none" ? "No distilled LoRA" : n, onclick: () => this.setM("distill_lora", n) },
        h("span.su-radio"),
        h("div", h("b", n === "none" ? "None needed" : baseName(n)),
          h("div.slx-muted", n === "none" ? (distilledCkpt ? "The checkpoint is distilled: the LoRA is already in it" : "Use this with a distilled checkpoint")
            : gone ? "not on this machine" : "for the dev checkpoint: 8 steps, CFG 1")),
        on && n === "none" && distilledCkpt ? badge("baked in", "ok") : on ? badge(gone ? "missing" : "active", gone ? "bad" : "ac") : null));
      }
      if (current && current !== "none") {
        const sw = widget(m, "distill_lora_strength");
        if (sw) {
          const val = h("b.su-tstr-v", Number(sw.value ?? 1).toFixed(2));
          left.appendChild(h("div.su-tstr", h("div.su-tstr-h", label("Strength"), h("span.slx-muted", "1.00 is the distilled first pass"), h("div.slx-spacer"), val),
            slider({ min: 0, max: 2, step: 0.05, value: Number(sw.value ?? 1), onInput: (v) => { val.textContent = Number(v).toFixed(2); },
              onChange: (v) => this.setM("distill_lora_strength", v) })));
        }
      }
    }
    left.appendChild(label("Director guides"));
    const ic = this.loraRow("ic_lora", "IC-LoRA · motion and video guides", "run", "ic",
      widgetValue(m, "ic_lora") === "none" ? "off: the Director's Motion lane needs one" : "follows the Director's Motion lane");
    if (ic) left.appendChild(ic);
    const msr = this.loraRow("msr_lora", "MSR LoRA · character references", "users", "",
      "used when the Director's references are Licon MSR; its refine strength is in Output");
    if (msr) left.appendChild(msr);

    const right = h("div.su-lcol", label("Global LoRAs"));
    for (const i of [1, 2]) {
      const nameW = widget(m, `extra_lora_${i}`), strW = widget(m, `extra_lora_${i}_strength`);
      if (!nameW) continue;
      if (nameW.value === "none" && i === 2 && widgetValue(m, "extra_lora_1") === "none") continue;
      if (nameW.value === "none") {
        right.appendChild(h("button.su-addl", { type: "button", onclick: (e) => {
          const pick = select(nameW.options?.values || [], "none", (x) => this.setM(`extra_lora_${i}`, x), "su-file");
          e.currentTarget.replaceWith(pick);
          pick.focus();
        } }, icon("plus", 14), "Add a global LoRA"));
        continue;
      }
      const strength = Number(strW?.value ?? 1);
      const num = h("input.slx-input.su-gval", { type: "number", step: 0.05, min: -LORA_MAX, max: LORA_MAX, value: strength, title: "Strength" });
      num.addEventListener("change", () => {
        const v = parseFloat(num.value);
        this.setM(`extra_lora_${i}_strength`, Number.isFinite(v) ? Math.max(-LORA_MAX, Math.min(LORA_MAX, v)) : 1.0);
      });
      right.appendChild(h("div.su-glora",
        h("div.su-glora-h", icon("sliders", 16), select(nameW.options?.values || [], nameW.value, (x) => this.setM(`extra_lora_${i}`, x), "su-file"),
          iconButton("x", "Take it out", () => this.setM(`extra_lora_${i}`, "none"))),
        h("div.su-glora-s", slider({ min: -LORA_MAX, max: LORA_MAX, step: 0.05, value: strength,
          onInput: (v) => { num.value = v; }, onChange: (v) => this.setM(`extra_lora_${i}_strength`, v) }), num)));
    }
    panel.appendChild(h("div.su-lgrid", left, right));
    return panel;
  }

  memoryPanel() {
    const dev = this.stats?.devices?.[0];
    const panel = h("div.slx-panel.su-mem");
    const name = dev ? String(dev.name || "").replace(/^cuda:\d+\s*/, "").replace(/NVIDIA GeForce /, "").replace(/ : .*$/, "") : "";
    const total = dev?.vram_total || 0;
    panel.appendChild(h("div.su-ph", h("div.slx-h2", "Video memory"), dev ? badge(`${name} · ${(total / 1e9).toFixed(0)} GB`) : null));
    const m = this.models();
    const video = this.sizes[widgetValue(m, "diffusion_model")] || 0;
    const msrOn = this.director()?._slx?.referenceMode?.() === "Licon MSR";
    const loras = ["distill_lora", "extra_lora_1", "extra_lora_2", "ic_lora", ...(msrOn ? ["msr_lora"] : [])]
      .reduce((a, n) => a + (widgetValue(m, n) !== "none" ? this.sizes[widgetValue(m, n)] || 0 : 0), 0);
    const vaes = (this.sizes[widgetValue(m, "video_vae")] || 0) + (this.sizes[widgetValue(m, "audio_vae")] || 0);
    const free = dev?.vram_free || 0;
    const parts = [["Video model", video, "ac"], ["LoRAs", loras, "k"], ["VAEs", vaes, "snd"], ["Free on the card now", free, "free"]];
    const sum = Math.max(1, total || parts.reduce((a, p) => a + p[1], 0));
    const r = 74, c = 2 * Math.PI * r;
    let off = 0, arcs = "";
    for (const [, v, k] of parts.slice(0, 3)) {
      const len = (v / sum) * c;
      if (len > 0.5) arcs += `<circle cx="90" cy="90" r="${r}" fill="none" style="stroke:rgb(var(--${k}))" stroke-width="16" stroke-dasharray="${len > 3 ? len - 3 : len} ${c}" stroke-dashoffset="${-off}" stroke-linecap="round"/>`;
      off += len;
    }
    const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    ring.setAttribute("viewBox", "0 0 180 180");
    ring.setAttribute("class", "su-ring");
    ring.innerHTML = `<circle cx="90" cy="90" r="${r}" fill="none" style="stroke:var(--glass3)" stroke-width="16"/><g transform="rotate(-90 90 90)">${arcs}</g>`;
    const weights = video + loras + vaes;
    panel.appendChild(h("div.su-mem-row",
      h("div.su-ring-wrap", ring, h("div.su-ring-c", h("b", weights ? (weights / 1e9).toFixed(1) : "–"),
        h("span", total ? `GB of weights · ${(total / 1e9).toFixed(0)} GB card` : "GB of weights"))),
      h("div.su-legend", ...parts.map(([n, v, k]) => h("div.su-leg", h("i", { class: k }), h("span", n), h("b", v ? `${(v / 1e9).toFixed(1)} GB` : "–"))))));
    panel.appendChild(h("div.slx-muted.su-note", "The text encoder runs first and leaves the card before sampling starts. The decode plans its tiles to what is free."));
    return panel;
  }

  perfPanel() {
    const m = this.models();
    const panel = h("div.slx-panel.su-perf", h("div.su-ph", h("div.slx-h2", "Performance")));
    if (!m) return panel;
    const list = h("div.su-plist");
    const row = (ic, title, text, control) => list.appendChild(h("div.su-prow", icon(ic, 18), h("div.su-ptxt", h("b", title), text ? h("div.slx-muted", text) : null), control));
    const att = widget(m, "attention");
    if (att) row("bolt", "Attention", "Sage through KJNodes, ComfyUI's own INT8 kernels, or whatever ComfyUI started with",
      select(att.options?.values || [], att.value, (v) => this.setM("attention", v), "su-psel"));
    for (const [name, title] of [["memory_efficient_attention", "Memory-efficient attention"], ["chunk_feed_forward", "Chunked feed-forward"]]) {
      const w = widget(m, name);
      if (w) row(name === "chunk_feed_forward" ? "copy" : "layers", title, "saves memory, same picture", toggle(!!w.value, (v) => this.setM(name, v), title));
    }
    const tile = widget(m, "decode_tile_size");
    if (tile) {
      const o = tile.options || {};
      const val = h("b.lx-tval", `${tile.value} px`);
      const s = slider({ min: Number.isFinite(o.min) ? o.min : 256, max: Math.min(1536, Number.isFinite(o.max) ? o.max : 2048), step: 64, value: Number(tile.value),
        onInput: (v) => { val.textContent = `${v} px`; }, onChange: (v) => this.setM("decode_tile_size", v), title: "Largest decode tile" });
      row("grid", "Decode tile", "one pass in time, so no flicker; smaller by itself when memory is short", h("div.lx-tile", s, val));
    }
    panel.appendChild(list);
    return panel;
  }

  lookPanel() {
    const t = this.theme();
    const current = widgetValue(t, "theme", "ComfyUI default");
    const panel = h("div.slx-panel.su-look", h("div.su-ph", h("div.slx-h2", "Look"), h("span.slx-muted", "Every window follows it")));
    const grid = h("div.su-themes");
    for (const name of THEME_NAMES) {
      const [stripe, dots] = THEME_SWATCHES[name];
      const on = t ? name === current : name === "ComfyUI default";
      grid.appendChild(h("button.su-theme", { type: "button", class: [on ? "on" : "", name === "Paper light" ? "light" : ""].join(" ").trim() || null,
        dataset: { theme: name }, onclick: () => this.setTheme(name) },
      h("span.su-stripe", { style: { background: stripe } }), h("span.su-dots", ...dots.map((col) => h("i", { style: { background: col } }))),
      h("b", name), on ? h("span.su-tcheck", icon("check", 13)) : null));
    }
    panel.appendChild(grid);
    panel.appendChild(h("div.su-tidy", icon("sparkles", 18),
      h("div.su-ptxt", h("b", "Tidy the canvas"),
        h("div.slx-muted", "The small helper nodes go behind their windows and their wires hide; move a window to reach them.")),
      button("Tidy", null, "small", () => {
        const n = tidy();
        toast(this.root, n ? `${n} helper node${n === 1 ? "" : "s"} tucked behind the windows` : "Nothing to tidy");
      })));
    return panel;
  }

  setTheme(name) {
    let t = this.theme();
    if (!t) {
      t = window.LiteGraph?.createNode?.("StubeliusLTXTheme");
      if (!t) return;
      app.graph.add(t);
      t.collapse?.(true);
      t.pos = [this.node.pos[0] + 48, this.node.pos[1] + 140];          // behind this window (ulx_stage.js)
    }
    setWidget(t, "theme", name);
    setTimeout(() => { refreshThemes(); this.render(); }, 30);
  }

  renderFoot() {
    const f = clear(this.foot);
    const s = this.stats?.system || {};
    f.append(...[h("span.slx-fi", icon("refresh", 14), "Changing anything here ", h("b", "renders the seeds again")),
      s.pytorch_version ? h("span.slx-fi", icon("cpu", 14), "PyTorch ", h("b", String(s.pytorch_version).split("+")[0])) : null,
      h("div.slx-spacer"),
      h("button.slx-link.slx-fi", { type: "button", onclick: () => goToStep(2) }, icon("arrowRight", 14), "Next: what the video is, in the ", h("b", "Director"))]
      .filter(Boolean));          // append() would print a null
  }

  markSteps() {
    const done = new Set();
    if (this.models() && this.modelState().found === this.modelState().total) done.add(1);
    const seeds = nodesOfType("StubeliusLTXSeedPreviews")[0];
    if ((seeds?.properties?.slx_seeds || []).length) done.add(2);
    const fin = nodesOfType("StubeliusLTXFinish")[0];
    if (Number(widgetValue(fin, "winner", 0)) >= 1 && done.has(2)) done.add(3);
    if (fin?.properties?.slx_final) done.add(4);
    markSteps(this.steps, done);
  }
}

let styled = false;
function injectSetupStyles() {
  if (styled) return;
  styled = true;
  document.head.appendChild(h("style", { id: "stubelius-ultx-setup", text: `
.slx-u .su-main{display:grid;grid-template-columns:minmax(0,1fr) 604px;gap:20px;align-items:start}
.slx-u.narrow .su-main{grid-template-columns:minmax(0,1fr)}
.slx-u .su-left,.slx-u .su-right{display:flex;flex-direction:column;gap:20px;min-width:0}
.slx-u .slx-panel{padding:20px 22px;display:flex;flex-direction:column;gap:16px}
.slx-u .su-ph{display:flex;align-items:center;justify-content:space-between;gap:12px}
.slx-u .su-tidy{display:flex;align-items:center;gap:14px;margin-top:14px;padding:12px 14px;border-radius:14px;background:var(--glass);
  border:1px solid var(--stroke);color:var(--text2)}
.slx-u .su-tidy .su-ptxt{flex:1;min-width:0}
.slx-u .su-tidy b{color:var(--text);font-weight:600}
.slx-u .su-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.slx-u .su-card{border-radius:20px;overflow:hidden;background:var(--glass);border:1px solid var(--stroke);padding:0;text-align:left;display:flex;flex-direction:column;
  color:var(--text)}
.slx-u .su-card:hover{border-color:var(--stroke2)}
.slx-u .su-card.on{border:2px solid rgb(var(--ac));box-shadow:0 0 0 5px rgba(var(--ac),.15),0 18px 50px rgba(var(--ac),.28)}
.slx-u .su-art{position:relative;height:150px;background:radial-gradient(120% 90% at 20% 0%,rgba(var(--ac),.20),transparent 60%),
  radial-gradient(90% 80% at 100% 100%,rgba(var(--ac2),.16),transparent 60%),var(--in-b);overflow:hidden}
.slx-u[data-theme="paper"] .su-art{background:radial-gradient(120% 90% at 20% 0%,rgba(var(--ac),.45),transparent 60%),
  radial-gradient(90% 80% at 100% 100%,rgba(var(--ac2),.4),transparent 60%),#1c1f33}
.slx-u .su-art-svg{position:absolute;inset:0;width:100%;height:100%}
.slx-u .su-art-name{position:absolute;left:16px;bottom:12px;font-family:var(--fh);font-weight:700;font-size:26px;color:#fff;text-shadow:0 4px 20px rgba(0,0,0,.6)}
.slx-u .su-check{position:absolute;right:12px;top:12px;width:28px;height:28px;border-radius:50%;background:var(--brand);color:var(--on);display:grid;place-items:center}
.slx-u .su-card-b{padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px}
.slx-u .su-card-t{color:var(--text2);font-size:13px;line-height:1.4;min-height:36px}
.slx-u .su-kv{display:flex;align-items:center;gap:8px;color:var(--text3);font-size:13px}
.slx-u .su-kv span{flex:1;color:var(--text2)}
.slx-u .su-kv b{font-family:var(--fh);color:var(--text);font-weight:600}
.slx-u .su-tunes{display:grid;grid-template-columns:1fr 1fr 1fr 210px;gap:16px;align-items:end;padding:14px 16px;border-radius:16px;
  background:var(--well);border:1px solid var(--stroke)}
.slx-u .su-tune{display:flex;flex-direction:column;gap:4px;min-width:0}
.slx-u .su-tune-h{display:flex;align-items:center;justify-content:space-between}
.slx-u .su-tune-h b{font-family:var(--fh);font-weight:600}
.slx-u .su-seeds .slx-seg-opt{padding:7px 4px}
.slx-u .lx-samp{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.slx-u .lx-samp-c{border-radius:14px;padding:10px 12px 12px;background:var(--glass);border:1px solid var(--stroke);display:flex;flex-direction:column;gap:7px;min-width:0}
.slx-u .lx-samp-c.off{opacity:.42}
.slx-u .lx-samp-h{display:flex;align-items:center;gap:8px}
.slx-u .lx-samp-h b{font-family:var(--fh);font-weight:600}
.slx-u .lx-samp-h span{margin-left:auto;font-family:var(--fm);font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis}
.slx-u .lx-samp .slx-select{height:32px;font-size:12px;font-weight:500;width:100%;border-radius:9px}
.slx-u .lx-samp-note{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text3)}
.slx-u .su-mgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.slx-u .su-mcard{display:flex;gap:12px;border-radius:16px;padding:14px;background:var(--glass);border:1px solid var(--stroke);min-width:0}
.slx-u .su-mcard.missing{border-color:rgba(var(--bad),.55)}
.slx-u .su-mic{width:38px;height:38px;border-radius:11px}
.slx-u .su-mbody{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}
.slx-u .su-file{height:28px;border:0;background-color:transparent;padding:0 22px 0 0;font-family:var(--fm);font-size:11.5px;font-weight:400;color:var(--text3);
  width:100%;background-position:right 2px center}
.slx-u .su-file:hover{color:var(--text)}
.slx-u .su-mbadges{display:flex;align-items:center;gap:6px}
.slx-u .su-state{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2)}
.slx-u .su-state i{width:7px;height:7px;border-radius:50%;background:rgb(var(--ok))}
.slx-u .su-state.bad{color:rgb(var(--bad))} .slx-u .su-state.bad i{background:rgb(var(--bad))}
.slx-u .su-state.off i{background:var(--text3)}
.slx-u .su-lgrid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.slx-u .su-lcol{display:flex;flex-direction:column;gap:10px;min-width:0}
.slx-u .su-turbo{display:flex;align-items:center;gap:14px;border-radius:16px;padding:12px 16px;background:var(--glass);border:1px solid var(--stroke);text-align:left;color:var(--text)}
.slx-u .su-turbo>div{flex:1;min-width:0}
.slx-u .su-turbo .slx-muted{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.slx-u .su-turbo.on{background:linear-gradient(110deg,rgba(var(--ac),.2),rgba(var(--ac2),.06));border-color:rgba(var(--ac),.65)}
.slx-u .su-turbo.missing{border-color:rgba(var(--bad),.6);background:rgba(var(--bad),.08)}
.slx-u .su-radio{width:20px;height:20px;border-radius:50%;border:2px solid var(--stroke2);flex:none;position:relative}
.slx-u .su-turbo.on .su-radio{border-color:rgb(var(--ac));background:rgb(var(--ac));box-shadow:0 0 12px rgba(var(--ac),.5)}
.slx-u .su-turbo.on .su-radio:after{content:"";position:absolute;inset:4px;border-radius:50%;background:#fff}
.slx-u .su-tstr{display:flex;flex-direction:column;gap:8px;border-radius:14px;padding:10px 16px 12px;background:var(--well);border:1px solid var(--stroke)}
.slx-u .su-tstr-h{display:flex;align-items:center;gap:10px}
.slx-u .su-tstr-h .slx-muted{font-size:12px}
.slx-u .su-tstr-v{font-family:var(--fh);font-size:15px}
.slx-u .lx-lrow{display:flex;align-items:center;gap:12px;border-radius:16px;padding:12px 16px;background:var(--glass);border:1px solid var(--stroke)}
.slx-u .lx-lrow.off{opacity:.8}
.slx-u .lx-lrow>.slx-ic{color:rgb(var(--k))}
.slx-u .lx-lrow.ic>.slx-ic{color:rgb(var(--ok))}
.slx-u .su-pdmd-t{flex:1;min-width:0;display:flex;flex-direction:column}
.slx-u .su-pdmd-t b{font-weight:600}
.slx-u .lx-hint{font-size:11.5px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.slx-u .lx-lstr{width:130px;flex:none}
.slx-u .lx-val{font-family:var(--fh);font-weight:600;font-size:15px;width:44px;text-align:right;flex:none}
.slx-u .su-glora{border-radius:16px;padding:12px 16px;background:var(--glass);border:1px solid var(--stroke);display:flex;flex-direction:column;gap:6px}
.slx-u .su-glora-h{display:flex;align-items:center;gap:10px}
.slx-u .su-glora-h .su-file{font-family:var(--ff);font-size:13.5px;font-weight:600;color:var(--text)}
.slx-u .su-glora-h .slx-ibtn{width:28px;height:28px;border-radius:9px}
.slx-u .su-glora-s{display:flex;align-items:center;gap:12px}
.slx-u .su-gval{font-family:var(--fh);width:78px;flex:none;text-align:right}
.slx-u .su-addl{display:flex;align-items:center;justify-content:center;gap:8px;height:46px;border-radius:14px;border:1px dashed var(--stroke2);background:none;color:var(--text2)}
.slx-u .su-addl:hover{color:var(--text);border-color:rgba(var(--ac),.5)}
.slx-u .su-mem-row{display:flex;align-items:center;gap:24px}
.slx-u .su-ring-wrap{position:relative;width:210px;height:210px;flex:none}
.slx-u .su-ring{width:100%;height:100%}
.slx-u .su-ring-c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 40px}
.slx-u .su-ring-c b{font-family:var(--fh);font-size:34px;font-weight:700}
.slx-u .su-ring-c span{color:var(--text3);font-size:12px;line-height:1.3}
.slx-u .su-legend{flex:1;display:flex;flex-direction:column;gap:12px}
.slx-u .su-leg{display:flex;align-items:center;gap:10px}
.slx-u .su-leg i{width:12px;height:12px;border-radius:4px;background:var(--glass3)}
.slx-u .su-leg i.ac{background:rgb(var(--ac))} .slx-u .su-leg i.k{background:rgb(var(--k))} .slx-u .su-leg i.snd{background:rgb(var(--snd))}
.slx-u .su-leg span{flex:1;color:var(--text2)}
.slx-u .su-leg b{font-family:var(--fh);font-weight:600}
.slx-u .su-note{font-size:12.5px}
.slx-u .su-plist{display:flex;flex-direction:column;border-radius:16px;border:1px solid var(--stroke);overflow:hidden}
.slx-u .su-prow{display:flex;align-items:center;gap:14px;padding:12px 16px;background:var(--glass)}
.slx-u .su-prow+.su-prow{border-top:1px solid var(--stroke)}
.slx-u .su-prow>.slx-ic{color:var(--text3)}
.slx-u .su-ptxt{flex:1;min-width:0}
.slx-u .su-ptxt .slx-muted{font-size:12px}
.slx-u .su-psel{width:220px}
.slx-u .lx-tile{display:flex;align-items:center;gap:12px;width:220px;flex:none}
.slx-u .lx-tval{font-family:var(--fh);font-weight:600;width:64px;text-align:right;flex:none}
.slx-u .su-themes{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.slx-u .su-theme{position:relative;height:96px;border-radius:16px;padding:14px;display:flex;flex-direction:column;align-items:flex-start;gap:10px;
  background:#121116;border:1px solid var(--stroke2);color:#f0eef6;text-align:left}
.slx-u .su-theme[data-theme="Paper light"]{background:#f6f5f1;color:#232327}
.slx-u .su-theme[data-theme="Midnight blueprint"]{background:#0b1527}
.slx-u .su-theme[data-theme="Film stock"]{background:#17120d}
.slx-u .su-theme[data-theme="Studio slate"]{background:#16171b}
.slx-u .su-theme[data-theme="ComfyUI default"]{background:#232323}
.slx-u .su-theme.on{border:2px solid rgb(var(--ac));box-shadow:0 0 0 4px rgba(var(--ac),.18),0 10px 30px rgba(var(--ac),.3)}
.slx-u .su-stripe{width:100%;height:6px;border-radius:4px}
.slx-u .su-dots{display:flex;gap:6px}
.slx-u .su-dots i{width:12px;height:12px;border-radius:50%}
.slx-u .su-theme b{font-weight:600;font-size:13px}
.slx-u .su-tcheck{position:absolute;right:10px;bottom:10px;width:22px;height:22px;border-radius:50%;background:var(--brand);color:var(--on);display:grid;place-items:center}
` }));
}

app.registerExtension({
  name: "StubeliusLTX.SetupWindow",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "StubeliusLTXSetup") return;
    windowOrCompact(nodeType, { name: "slx_setup", widgets: SETUP_WIDGETS, create: (node) => new SetupWindow(node), minHeight: 700 });
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
      setTimeout(() => { this._slx?.reload(false); refreshThemes(); }, 0);
      return r;
    };
  },
  async afterConfigureGraph() {
    // the Models, Seed Samplers, Theme and Director nodes arrive after the Setup: draw again once they are all there
    setTimeout(() => {
      for (const n of nodesOfType("StubeliusLTXSetup")) n._slx?.render();
    }, 50);
  },
});
