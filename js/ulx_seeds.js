// Stubelius Ultimate LTX: the Seeds window (step 3 of 4), on the Seed Previews node.
//
// Every seed of the last render, side by side and in sync, with a hint worth a look (a nearly silent seed) and
// never a ranking: your eye picks. Pick one as the winner, then Finish the winner goes on to the Output window
// (the seeds come from cache). Hunt renders 2, 3 or 4 new seeds and holds after them. Each seed's sampler is
// here too (the Seed Samplers node).
import {
  h, icon, clear, button, iconButton, badge, menu, toast, windowFrame, markSteps, goToStep, glideTo, injectStyles,
  widget, widgetValue, setWidget, nodesOfType, fmtClock, refreshThemes, windowOrCompact, queueRun, chooseIn, select,
} from "./ulx_ui.js";
import { viewUrl } from "./ulx_media.js";
import { splitViewer } from "./ulx_viewer.js";
import { modeOf } from "./ulx_setup.js";

const { app } = window.comfyAPI.app;
const { api } = window.comfyAPI.api;

// The settings the seeds are rendered from: a change in any of them renders the seeds again
const SEED_INPUTS = ["StubeliusLTXSetup", "StubeliusLTXSeedSamplers", "StubeliusLTXModels", "LTXDirectorCS25"];

// What those nodes send: their inputs without the links, one string to compare
export async function seedFingerprint() {
  try {
    const p = await app.graphToPrompt();
    const out = {};
    for (const [id, n] of Object.entries(p.output || {})) {
      if (!SEED_INPUTS.includes(n.class_type)) continue;
      const inputs = {};
      for (const [k, v] of Object.entries(n.inputs || {})) if (!Array.isArray(v)) inputs[k] = v;
      out[`${n.class_type}:${id}`] = inputs;
    }
    return JSON.stringify(out);
  } catch (e) {
    return null;
  }
}

function fmtDuration(s) {
  s = Math.round(Number(s) || 0);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

class SeedsWindow {
  constructor(node) {
    this.node = node;
    this.solo = null;          // the tile whose sound plays (else the winner's, else the first)
    this.focus = null;         // a tile shown full size
    this.ab = false;           // A/B split: the winner against another seed
    this.sync = true;
    injectStyles();
    injectSeedStyles();
    const f = windowFrame({ title: "Ultimate LTX · Seeds", subtitle: "Compare the seeds, pick the winner", step: 3, onStep: goToStep });
    Object.assign(this, f);
    this.root.classList.add("slx-s");
    this.status = h("div.slx-status", h("span.slx-dot"), h("span", "No seeds yet"));
    this.layoutBtn = iconButton("grid", "Grid of all seeds", () => { this.focus = null; this.ab = false; this.render(); });
    this.head.append(h("div.slx-spacer"), this.status, this.layoutBtn);
    this.left = h("div.s-left");
    this.right = h("div.s-right");
    this.body.appendChild(h("div.s-main", this.left, this.right));
    this.listen();
    this.render();
  }

  get videos() {
    return this.node.properties?.slx_seeds || [];
  }

  async setVideos(list) {
    this.node.properties = this.node.properties || {};
    this.node.properties.slx_seeds = list || [];
    this.node.properties.slx_seeds_from = await seedFingerprint();    // what these seeds were rendered from
    this.solo = null;
    this.focus = null;
    this.render();
  }

  setup() { return nodesOfType("StubeliusLTXSetup")[0] || null; }
  samplers() { return nodesOfType("StubeliusLTXSeedSamplers")[0] || null; }
  models() { return nodesOfType("StubeliusLTXModels")[0] || null; }
  finish() { return nodesOfType("StubeliusLTXFinish")[0] || null; }

  winner() {
    return Number(widgetValue(this.finish(), "winner", 0)) || 0;
  }

  isPicked(v) { return v.candidate === this.winner(); }

  picked() { return this.videos.find((v) => this.isPicked(v))?.candidate || 0; }

  pick(v) {
    const f = this.finish();
    if (f) setWidget(f, "winner", v.candidate);
    toast(this.root, `Seed ${v.candidate} is the winner`);
    window.dispatchEvent(new CustomEvent("stubelius-ltx-winner"));     // this window redraws on it too
  }

  // Settings changed since these seeds? Finishing would render them again first: ask.
  async checkFinish() {
    const was = this.node.properties?.slx_seeds_from;
    if (!was) return true;
    const now = await seedFingerprint();
    if (!now || now === was) return true;
    const answer = await chooseIn(this.root, {
      title: "Settings changed since these seeds",
      text: "Setup, the models or the Director changed after these seeds were rendered, so finishing renders the seeds again first. "
        + "Change them back to finish these seeds from cache.",
      choices: [{ label: "Render again and finish", value: "again", icon: "refresh" }, { label: "Cancel", value: null, kind: "" }],
    });
    return answer === "again";
  }

  async finishWinner() {
    const vids = this.videos;
    if (!vids.length) { toast(this.root, "Render the seeds first (Director)"); return; }
    if (!(await this.checkFinish())) return;
    if (!this.winner()) {
      const f = this.finish();
      if (f) setWidget(f, "winner", vids[0].candidate);
      window.dispatchEvent(new CustomEvent("stubelius-ltx-winner"));
    }
    const r = await queueRun();
    if (!r.ok) {
      toast(this.root, "Not finished: " + r.why, "bad");
      return;
    }
    const out = this.finish();
    if (out?._slx) glideTo(out);
  }

  // New seeds: n of them from a fresh seed, held after the seeds (pick one, then finish)
  async hunt(n) {
    const s = this.setup(), f = this.finish();
    if (!s) { toast(this.root, "Add a Stubelius LTX Setup node", "bad"); return; }
    setWidget(s, "seeds", n);
    setWidget(s, "seed", Math.floor(Math.random() * 2 ** 32));
    if (f) setWidget(f, "winner", 0);
    window.dispatchEvent(new CustomEvent("stubelius-ltx-setup", { detail: { name: "seeds" } }));
    const r = await queueRun();
    toast(this.root, r.ok ? `Hunting with ${n} new seeds: pick one when they're in` : "Not rendered: " + r.why, r.ok ? "" : "bad");
    this.render();
  }

  // ----------------------------------------------------------------------------------- drawing

  render() {
    this.renderStatus();
    this.renderLeft();
    this.renderRight();
    this.renderFoot();
    this.markSteps();
  }

  renderStatus() {
    const vids = this.videos;
    const s = this.status;
    if (!vids.length) {
      s.className = "slx-status warn";
      s.lastChild.textContent = "No seeds yet: render in the Director";
      return;
    }
    const secs = Math.max(...vids.map((v) => v.seconds || 0));
    const total = vids.reduce((a, v) => a + (v.render_seconds || 0), 0);
    s.className = "slx-status";
    s.lastChild.textContent = `${vids.length} seed${vids.length > 1 ? "s" : ""} · ${secs.toFixed(1)} s each`
      + (total ? ` · rendered in ${fmtDuration(total)}` : "");
  }

  renderLeft() {
    const was = this.master ? { t: this.master.currentTime || 0, playing: !this.master.paused } : null;
    const box = clear(this.left);
    const vids = this.videos;
    this.tiles = [];
    if (!vids.length) {
      box.appendChild(h("div.s-empty.slx-panel", h("div.s-empty-ic", icon("grid", 34)), h("div.slx-h3", "The seeds show up here"),
        h("div.slx-muted", "Set Seeds to compare in Setup and Render in the Director. Every seed plays here, in sync, with its sound.")));
      return;
    }
    if (this.ab && vids.length > 1) {
      const a = vids.find((v) => this.isPicked(v)) || vids[0];
      const b = vids.find((v) => v.candidate === this.abOther && v !== a) || vids.find((v) => v !== a);
      const viewer = splitViewer({ labelA: `Seed ${a.candidate}`, labelB: `Seed ${b.candidate}` });
      viewer.setSources(viewUrl(a), viewUrl(b));
      viewer.el.classList.add("s-ab");
      this.viewer = viewer;
      box.appendChild(viewer.el);
      this.master = viewer.b;
      viewer.setMuted(false);
    } else {
      this.viewer = null;
      const shown = this.focus ? vids.filter((v) => v.candidate === this.focus) : vids;
      const grid = h("div.s-grid", { class: shown.length === 1 ? "one" : null });
      for (const v of shown) grid.appendChild(this.tile(v));
      box.appendChild(grid);
      this.master = this.tiles[0]?.video || null;
    }
    box.appendChild(this.transport());
    this.applySound();
    if (was && this.master) this.resume(was);
  }

  resume({ t, playing }) {
    const videos = this.viewer ? [this.viewer.b] : (this.tiles || []).map((x) => x.video);
    for (const v of videos) {
      const go = () => {
        try { v.currentTime = t; } catch (e) { /* not seekable yet */ }
        if (playing) v.play().catch(() => {});
      };
      if (v.readyState >= 1) go();
      else v.addEventListener("loadedmetadata", go, { once: true });
    }
  }

  tile(v) {
    const video = h("video.s-video", { src: viewUrl(v), muted: true, loop: true, playsInline: true, preload: "auto" });
    video.muted = true;
    const isWin = this.isPicked(v);
    const flags = v.flags || [];
    const flagChip = flags.length
      ? h("div.slx-gchip.s-flag.warn", icon("alert", 15), flags.map((f) => f.text).join(" · "))
      : h("div.slx-gchip.s-flag", icon("circleCheck", 15), "No flags");
    const tick = h("div.s-tick");
    const scrub = h("div.s-tscrub", h("span", { style: { left: "0%", width: "100%" } }), tick);
    const soloBtn = button("Solo", "headphones", "small", () => { this.solo = this.solo === v.candidate ? null : v.candidate; this.applySound(); this.renderLeftButtons(); },
      "Hear this seed (the others stay quiet)");
    soloBtn.classList.add("s-solo");
    soloBtn.dataset.cand = String(v.candidate);
    if (this.solo === v.candidate) soloBtn.classList.add("on");
    const pickBtn = button(isWin ? "Picked" : "Pick", "crown", isWin ? "small s-picked" : "small", () => this.pick(v), "Finish this seed");
    const el = h("div.s-tile", { class: isWin ? "win" : null },
      h("div.s-vwrap", video,
        h("div.s-tchips", isWin ? h("div.slx-gchip.brand.s-winchip", icon("crown", 15), "Winner") : null,
          h("div.slx-gchip", icon("dice", 15), `Seed ${v.candidate}${v.seed != null ? " · " + v.seed : ""}`)),
        h("div.s-tchips-r", flagChip),
        scrub),
      h("div.s-tfoot", h("b", v.seed != null ? String(v.seed) : `Seed ${v.candidate}`),
        h("span.slx-muted", v.render_seconds ? fmtDuration(v.render_seconds) : `${(v.seconds || 0).toFixed(1)} s`),
        v.sampler ? h("span.lx-samptag", v.sampler) : null,
        h("div.slx-spacer"), soloBtn, pickBtn));
    video.addEventListener("timeupdate", () => { tick.style.left = `${(video.currentTime / (video.duration || 1)) * 100}%`; });
    video.addEventListener("dblclick", () => { this.focus = this.focus ? null : v.candidate; this.render(); });
    this.tiles.push({ v, video, el });
    return el;
  }

  renderLeftButtons() {
    this.left.querySelectorAll(".s-solo").forEach((b) => b.classList.toggle("on", Number(b.dataset.cand) === this.solo));
    this.left.querySelectorAll(".s-snd-src").forEach((el) => { el.lastChild.textContent = this.soundLabel(); });
  }

  soundLabel() {
    if (this.ab) return "Sound: seed B";
    if (this.solo) return `Sound: seed ${this.solo}`;
    return this.picked() ? `Sound: seed ${this.picked()}` : "Sound: seed 1";
  }

  // one seed's sound at a time: the solo one, else the picked one's, else the first; always one that is on show
  applySound() {
    const tiles = this.tiles || [];
    let want = this.solo || this.picked() || tiles[0]?.v.candidate;
    if (!tiles.some((t) => t.v.candidate === want)) want = tiles[0]?.v.candidate;
    for (const t of tiles) t.video.muted = t.v.candidate !== want;
  }

  transport() {
    const play = h("button.s-play", { type: "button", title: "Play / pause every seed" });
    const time = h("div.d-time.s-time");
    const knob = h("div.s-knob");
    const scrub = h("div.s-scrub", h("span", { style: { left: "0%", width: "100%" } }), knob);
    const v0 = this.videos[0];
    const all = () => (this.viewer ? [this.viewer.b] : (this.tiles || []).map((t) => t.video));
    const drawPlay = () => { clear(play); play.appendChild(icon(this.master && !this.master.paused ? "pause" : "play", 22)); };
    play.addEventListener("click", () => {
      const m = this.master;
      if (!m) return;
      if (m.paused) all().forEach((x) => x.play().catch(() => {}));
      else all().forEach((x) => x.pause());
      setTimeout(drawPlay, 30);
    });
    scrub.addEventListener("pointerdown", (e) => {
      const r = scrub.getBoundingClientRect();
      const t = ((e.clientX - r.left) / r.width) * (this.master?.duration || 0);
      all().forEach((x) => { x.currentTime = t; });
    });
    const m = this.master;
    if (m) {
      m.addEventListener("timeupdate", () => {
        clear(time);
        time.append(fmtClock(m.currentTime), h("span", ` / ${fmtClock(m.duration || v0.seconds || 0)}`));
        knob.style.left = `calc(${(m.currentTime / (m.duration || 1)) * 100}% - 12px)`;
        if (this.sync) for (const x of all()) if (x !== m && Math.abs(x.currentTime - m.currentTime) > 0.1) x.currentTime = m.currentTime;
      });
      m.addEventListener("play", drawPlay);
      m.addEventListener("pause", drawPlay);
    }
    drawPlay();
    clear(time);
    time.append(fmtClock(0), h("span", ` / ${fmtClock(v0.seconds || 0)}`));
    const toggleBtn = (text, ic, on, fn, title) => {
      const b = button(text, ic, "small s-tbtn", fn, title);
      if (on) b.classList.add("on");
      return b;
    };
    const vids = this.videos;
    const sound = h("div.slx-badge.s-snd-src", icon("speaker", 13), this.soundLabel());
    return h("div.s-transport.slx-panel",
      h("div.s-trow", play, time, scrub),
      h("div.s-trow.s-tbtns",
        toggleBtn("All in sync", "link", this.sync, () => { this.sync = !this.sync; this.renderLeft(); }, "Every seed plays at the same moment"),
        vids.length > 1 ? toggleBtn("A/B split", "columns", this.ab, () => { this.ab = !this.ab; this.focus = null; this.renderLeft(); },
          "The winner (or seed 1) against another seed, a divider between them") : null,
        toggleBtn("Full size", "maximize", !!this.focus, () => {
          this.focus = this.focus ? null : (this.solo || this.picked() || vids[0].candidate);
          this.ab = false;
          this.renderLeft();
        }, "One seed, as big as it goes (double-click a seed too)"),
        h("div.slx-spacer"), sound));
  }

  renderRight() {
    const box = clear(this.right);
    box.appendChild(this.winnerPanel());
    box.appendChild(this.samplerPanel());
    const vids = this.videos;
    const cta = button("Finish the winner", "sparkles", "cta s-cta", () => this.finishWinner(),
      "Refine, upscale and encode the winner (the seeds come from cache)");
    cta.appendChild(icon("arrowRight", 20));
    if (!vids.length) cta.classList.add("disabled");
    box.appendChild(cta);
  }

  winnerPanel() {
    const panel = h("div.slx-panel.s-win");
    const vids = this.videos;
    const v = vids.find((x) => this.isPicked(x));
    panel.appendChild(h("div.s-ph", h("div.slx-h2", "Winner"), h("span.slx-muted", v ? `seed ${v.candidate} of ${vids.length}` : "not picked yet")));
    if (!v) {
      panel.appendChild(h("div.slx-muted.s-psub", !vids.length ? "Render first." : "Pick a seed on the left. The Finish renders only the winner."));
      return panel;
    }
    const thumb = h("video.s-win-thumb", { src: viewUrl(v), muted: true, playsInline: true, preload: "metadata" });
    thumb.addEventListener("loadedmetadata", () => { thumb.currentTime = Math.min(1, (thumb.duration || 2) / 3); });
    const desc = [modeOf(this.setup(), this.models()), v.sampler || null, v.width && v.height ? `${v.width}×${v.height}` : null].filter(Boolean).join(" · ");
    const flags = v.flags || [];
    panel.appendChild(h("div.s-win-row", thumb, h("div",
      h("div.slx-h3", `Seed ${v.seed ?? v.candidate}`), h("div.slx-muted", desc),
      h("div.s-win-badges", flags.length ? badge(flags.map((f) => f.text).join(" · "), "cut") : badge("no flags", "ok"),
        badge("its own sound")))));
    const stat = (value, name) => h("div.s-stat", h("b", value), h("span", name));
    panel.appendChild(h("div.s-stats", stat(`${(v.seconds || 0).toFixed(1)} s`, "length"), stat(String(v.frames || "–"), "frames"),
      stat(v.fps ? String(Math.round(v.fps * 100) / 100) : "–", "fps"), stat(v.render_seconds ? fmtDuration(v.render_seconds) : "–", "render")));
    return panel;
  }

  samplerPanel() {
    const panel = h("div.slx-panel.s-pbc");
    panel.appendChild(h("div.s-ph", h("div.slx-h2", "Sampler per seed"), badge("from Setup", "ac")));
    panel.appendChild(h("div.slx-muted.s-psub", "Each seed renders with its own sampler. A change here renders the seeds again."));
    const sn = this.samplers();
    const count = Number(widgetValue(this.setup(), "seeds", 1));
    if (sn) {
      const list = h("div.lx-sampsel");
      for (let k = 1; k <= 4; k++) {
        const sw = widget(sn, `seed_${k}_sampler`), cw = widget(sn, `seed_${k}_scheduler`);
        if (!sw || !cw) continue;
        const set = (name, v) => { setWidget(sn, name, v); window.dispatchEvent(new CustomEvent("stubelius-ltx-setup", { detail: { name } })); };
        list.appendChild(h("div.lx-sampsel-r", { class: k > count ? "off" : null },
          h("b", `Seed ${k}`), select(sw.options?.values || [], sw.value, (v) => set(`seed_${k}_sampler`, v)),
          select(cw.options?.values || [], cw.value, (v) => set(`seed_${k}_scheduler`, v))));
      }
      panel.appendChild(list);
    } else {
      panel.appendChild(h("div.slx-muted", "No Seed Samplers node: every seed uses euler_ancestral with linear_quadratic."));
    }
    const n = Math.max(2, Math.min(4, count > 1 ? count : 3));
    const more = iconButton("chevronDown", "How many new seeds: 2, 3 or 4", (e) => menu(e.currentTarget, [2, 3, 4].map((x) => ({
      label: `Hunt with ${x} new seeds`, icon: x === n ? "check" : null, onClick: () => this.hunt(x),
    }))));
    more.classList.add("s-hunt-n");
    panel.appendChild(h("div.s-hunt", button(`Hunt ×${n} · new seeds`, "dice", "brand", () => this.hunt(n),
      `${n} new seeds from a fresh seed, held after them so you can pick (the arrow: 2, 3 or 4)`), more));
    return panel;
  }

  renderFoot() {
    const f = clear(this.foot);
    f.append(h("span.slx-fi", icon("database", 14), "Seeds kept: ", h("b", "Output re-runs only the finish")),
      h("span.slx-fi", icon("eye", 14), "Flags are hints, ", h("b", "your eye decides")),
      h("div.slx-spacer"),
      h("button.slx-link.slx-fi", { type: "button", onclick: () => goToStep(4) }, icon("arrowRight", 14), "Next: refine, upscale and export in ", h("b", "Output")));
  }

  markSteps() {
    const done = new Set();
    const models = this.models();
    if (this.setup() && models) done.add(1);
    if (this.videos.length) done.add(2);
    if (this.winner() >= 1 && this.videos.length) done.add(3);
    if (this.finish()?.properties?.slx_final) done.add(4);
    markSteps(this.steps, done);
  }

  listen() {
    const on = (type, fn, target = api) => {
      target.addEventListener(type, fn);
      (this._off ||= []).push(() => target.removeEventListener(type, fn));
    };
    on("stubelius-ltx-winner", () => this.render(), window);
    on("stubelius-ltx-setup", () => { this.renderRight(); this.markSteps(); }, window);
  }

  dispose() {
    for (const off of this._off || []) off();
  }
}

let styled = false;
function injectSeedStyles() {
  if (styled) return;
  styled = true;
  document.head.appendChild(h("style", { id: "stubelius-ultx-seeds", text: `
.slx-s .s-main{display:grid;grid-template-columns:minmax(0,1fr) 544px;gap:20px;align-items:start}
.slx-s.narrow .s-main{grid-template-columns:minmax(0,1fr)}
.slx-s .s-left{display:flex;flex-direction:column;gap:20px;min-width:0}
.slx-s .s-right{display:flex;flex-direction:column;gap:20px;min-width:0}
.slx-s .s-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.slx-s .s-grid.one{grid-template-columns:1fr}
.slx-s .s-tile{border-radius:24px;overflow:hidden;border:1px solid var(--stroke2);background:linear-gradient(180deg,var(--glass2),var(--glass));
  box-shadow:var(--panel-shadow)}
.slx-s .s-tile.win{border:2px solid rgb(var(--ac));box-shadow:0 0 0 5px rgba(var(--ac),.16),0 20px 60px rgba(var(--ac),.25)}
.slx-s .s-vwrap{position:relative;aspect-ratio:16/9;background:var(--video)}
.slx-s .s-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.slx-s .s-grid.one .s-video{object-fit:contain}
.slx-s .s-tchips{position:absolute;left:16px;top:16px;display:flex;gap:8px}
.slx-s .s-tchips-r{position:absolute;right:16px;top:16px}
.slx-s .s-flag.warn{border-color:rgba(var(--cut),.65);color:#fff}
.slx-s .s-flag.warn .slx-ic{color:rgb(var(--cut))}
.slx-s .s-flag .slx-ic{color:rgb(var(--ok))}
.slx-s .s-tscrub{position:absolute;left:18px;right:18px;bottom:14px;height:8px}
.slx-s .s-tscrub span{position:absolute;top:2px;height:4px;border-radius:3px;background:rgba(255,255,255,.35)}
.slx-s .s-tile.win .s-tscrub span{background:var(--brand)}
.slx-s .s-tick{position:absolute;top:-5px;width:2px;height:18px;background:#fff;border-radius:2px;box-shadow:0 0 8px rgba(0,0,0,.6)}
.slx-s .s-tfoot{display:flex;align-items:center;gap:10px;padding:12px 16px}
.slx-s .s-tfoot b{font-family:var(--fh);font-size:18px;font-weight:600}
.slx-s .lx-samptag{font-family:var(--fm);font-size:11px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.slx-s .s-solo.on{border-color:rgba(var(--snd),.7);color:rgb(var(--snd))}
.slx-s .s-picked{background:var(--brand);color:var(--on);border:0}
.slx-s .s-ab{position:relative;aspect-ratio:16/9;border-radius:24px;border:1px solid var(--stroke2)}
.slx-s .s-transport{padding:16px 20px;display:flex;flex-direction:column;gap:12px}
.slx-s .s-trow{display:flex;align-items:center;gap:14px}
.slx-s .s-play{width:52px;height:52px;border-radius:50%;background:var(--brand);color:var(--on);display:grid;place-items:center;border:0;flex:none;
  box-shadow:0 10px 30px rgba(var(--ac),.4);padding:0}
.slx-s .s-time{color:var(--text);font-family:var(--fh);font-weight:600;white-space:nowrap}
.slx-s .s-time span{color:var(--text3);font-weight:500}
.slx-s .s-scrub{flex:1;height:34px;position:relative;cursor:pointer}
.slx-s .s-scrub span{position:absolute;top:12px;height:10px;border-radius:6px;background:var(--glass3)}
.slx-s .s-knob{position:absolute;top:5px;width:24px;height:24px;border-radius:50%;background:#fff;pointer-events:none;
  box-shadow:0 0 0 5px rgba(var(--ac),.35),0 0 24px rgba(var(--ac),.8)}
.slx-s .s-tbtns{gap:8px;flex-wrap:wrap}
.slx-s .s-tbtn.on{border-color:rgba(var(--ac),.6);background:linear-gradient(100deg,rgba(var(--ac),.2),rgba(var(--ac2),.1))}
.slx-s .s-pbc,.slx-s .s-win{padding:20px 22px;display:flex;flex-direction:column;gap:12px}
.slx-s .s-ph{display:flex;align-items:center;justify-content:space-between}
.slx-s .s-psub{margin-top:-6px}
.slx-s .lx-sampsel{display:flex;flex-direction:column;gap:8px}
.slx-s .lx-sampsel-r{display:grid;grid-template-columns:76px 1fr 1fr;gap:8px;align-items:center}
.slx-s .lx-sampsel-r b{font-family:var(--fh);font-weight:600}
.slx-s .lx-sampsel-r .slx-select{height:32px;font-size:12px;font-weight:500;border-radius:9px;width:100%}
.slx-s .lx-sampsel-r.off{opacity:.42}
.slx-s .s-hunt{display:flex;min-width:0}
.slx-s .s-hunt .slx-btn{flex:1;min-width:0;height:46px;border-top-right-radius:0;border-bottom-right-radius:0}
.slx-s .s-hunt .s-hunt-n{height:46px;width:40px;flex:none;border-radius:0 12px 12px 0;border:1px solid rgba(var(--ac),.5);border-left:0;
  background:linear-gradient(100deg,rgba(var(--ac),.16),rgba(var(--ac2),.1))}
.slx-s .s-win-row{display:flex;gap:16px;align-items:center}
.slx-s .s-win-thumb{width:168px;height:94px;border-radius:14px;object-fit:cover;border:2px solid rgb(var(--ac));background:#000;flex:none}
.slx-s .s-win-badges{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.slx-s .s-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.slx-s .s-stat{border-radius:14px;background:var(--glass);border:1px solid var(--stroke);padding:10px;text-align:center;display:flex;flex-direction:column;gap:2px}
.slx-s .s-stat b{font-family:var(--fh);font-size:19px;font-weight:600}
.slx-s .s-stat span{color:var(--text3);font-size:11.5px}
.slx-s .s-cta{height:72px;font-size:21px;width:100%;border-radius:20px}
.slx-s .s-cta.disabled{opacity:.5}
.slx-s .s-empty{padding:60px 40px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}
.slx-s .s-empty-ic{width:76px;height:76px;border-radius:22px;display:grid;place-items:center;background:var(--glass3);color:var(--text2)}
.slx-s .s-empty .slx-muted{max-width:520px}
` }));
}

app.registerExtension({
  name: "StubeliusLTX.SeedsWindow",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "StubeliusLTXSeedPreviews") return;
    windowOrCompact(nodeType, { name: "slx_seeds", create: (node) => new SeedsWindow(node), minHeight: 700 });
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
      setTimeout(() => { this._slx?.render(); refreshThemes(); }, 0);
      return r;
    };
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      const r = onExecuted ? onExecuted.apply(this, arguments) : undefined;
      if (output?.stubelius_ltx_seeds) {
        this.properties = this.properties || {};
        this.properties.slx_seeds = output.stubelius_ltx_seeds;
        if (this._slx) this._slx.setVideos(output.stubelius_ltx_seeds);
      }
      return r;
    };
    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._slx?.dispose();
      return onRemoved?.apply(this, arguments);
    };
  },
});
