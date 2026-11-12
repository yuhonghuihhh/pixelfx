// The gallery: every effect playing live from its own code. Tiles start when they scroll into view; a click
// opens one effect with its options, a sprite sheet and the code to use it.

import { effects, categories } from "../src/fx/index.js";
import { createFrame, clearFrame, createFx, createAct, actBounds, composite, backdrop, drawActor, painterFor, stockActor, actorAlphaOf, PAL, BACKDROPS } from "../src/core/index.js";
import { UI, CATS, FX as FX_I18N } from "./i18n.js";

const REPO = "https://github.com/patch-gg/pixelfx";
const FX = Object.entries(effects).map(([id, mod]) => {
  const meta = { fps: 30, bg: "dark", loop: false, duration: 1, tags: [], options: {}, ...mod.meta };
  return { id, cat: id.split("/")[0], name: meta.name, mod: { ...mod, meta }, meta };
});
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
// full-screen effects (transitions, weather, impact frames) fill a 16:9 stage edge to edge instead of floating in it
const isScreen = (fx) => fx.meta.size[0] >= 320 && Math.abs(fx.meta.size[0] / fx.meta.size[1] - 16 / 9) < 0.05;
const $ = (s) => document.querySelector(s);
function el(tag, props = {}, kids = []) {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of [].concat(kids)) e.append(k);
  return e;
}

// ---- language
const LANG_KEY = "pixelfx-lang";
function detectLang() {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === "zh" || saved === "en") return saved;
  return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}
let lang = detectLang();
const ui = () => UI[lang];
const fxName = (fx) => (lang === "zh" && FX_I18N[fx.id]?.name) || fx.meta.name;
const fxDesc = (fx) => (lang === "zh" && FX_I18N[fx.id]?.desc) || fx.meta.desc;
const catLabel = (c) => (lang === "zh" && CATS[c.id]?.name) || c.name;
const catBlurb = (c) => (lang === "zh" && CATS[c.id]?.blurb) || c.blurb;
const searchHay = (fx) => [fx.id, fx.meta.name, fx.meta.desc, FX_I18N[fx.id]?.name, FX_I18N[fx.id]?.desc, ...fx.meta.tags].filter(Boolean).join(" ").toLowerCase();

// ---- a live effect on a canvas, at an integer scale that fits the stage
class Player {
  constructor(canvas, fx, aspect, pad) {
    Object.assign(this, { canvas, fx, ctx: canvas.getContext("2d"), opts: {}, flip: false, actor: true, speed: 1, playing: true });
    this.bg = fx.meta.bg;
    this.layout(aspect, pad);
  }
  // the art-pixel stage: the effect's canvas plus some room, stretched to the tile's aspect; CSS scales it up
  layout(aspect, pad) {
    Object.assign(this, { aspect, pad });
    // an act needs room for the whole performance, not just the effect's canvas
    const acted = this.acted, b = acted ? { ...actBounds(this.fx.mod) } : null;
    // an act happens above the floor: don't spend the tile on bricks
    if (b) b.y1 = Math.min(b.y1, 22);
    const [w, h] = acted ? [b.x1 - b.x0, b.y1 - b.y0] : this.fx.meta.size, [ox, oy] = acted ? [-b.x0, -b.y0] : this.fx.meta.origin;
    this.W = Math.ceil(Math.max(w * (acted ? Math.min(pad, 1.1) : pad), h * (acted ? Math.min(pad, 1.1) : pad) * aspect));
    this.H = Math.ceil(this.W / aspect);
    this.x = Math.floor((this.W - w) / 2) + ox;
    // an act stands near the bottom of its tile, with the room above it
    this.y = acted ? Math.max(oy + 2, this.H - b.y1 - 2) : Math.floor((this.H - h) / 2) + oy;
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    // shrinking pixel art nearest-neighbour drops whole 1 px lines; smooth it only when it has to shrink
    const shown = this.canvas.getBoundingClientRect().width * devicePixelRatio;
    this.canvas.style.imageRendering = shown && shown < this.W ? "auto" : "";
    this.frame = createFrame(this.W, this.H);
    this.img = this.ctx.createImageData(this.W, this.H);
    this.setBg(this.bg);
    this.restart();
  }
  setBg(kind) {
    this.bg = kind;
    this.bgBuf = kind === "none" ? null : backdrop(kind, this.W, this.H, this.y);
    this.dirty = true;
  }
  // an effect with an act plays it, unless the character is switched off
  get acted() {
    return !!this.fx.mod.act && this.actor;
  }
  restart() {
    this.inst = (this.acted ? createAct : createFx)(this.fx.mod, { x: this.x, y: this.y, flip: this.flip, ...this.opts });
    this.acc = 0;
    this.wait = 0;
    this.dirty = true;
  }
  tick(dt) {
    const m = this.fx.meta, step = 1 / m.fps;
    if (this.playing) this.acc = Math.min(this.acc + dt * this.speed, 0.25);
    let moved = false;
    while (this.acc >= step) {
      this.acc -= step;
      if (!m.loop && (this.acted ? this.inst.done() : this.inst.t >= m.duration)) {
        this.wait += step;
        if (this.wait > 0.45) this.restart();
      } else this.inst.update(step);
      moved = true;
    }
    if (moved || this.dirty) this.render();
  }
  seek(t) {
    this.restart();
    this.inst.update(t);
    this.render();
  }
  render() {
    const f = clearFrame(this.frame);
    if (this.acted) {
      this.inst.draw(f);
      composite(f, this.img.data, this.bgBuf);
      const [sx, sy] = this.inst.shake;
      if (sx || sy) this.ctx.clearRect(0, 0, this.W, this.H);
      this.ctx.putImageData(this.img, sx, sy);
      this.dirty = false;
      return;
    }
    this.inst.draw(f, "back");
    const m = this.fx.meta, tt = m.loop ? this.inst.t % m.duration : Math.min(this.inst.t, m.duration);
    if (m.actor && this.actor) drawActor(painterFor(f).place(this.x, this.y, this.flip), this.inst.options.actor ?? stockActor(), actorAlphaOf(this.fx.mod, tt, this.inst.options));
    this.inst.draw(f, "front");
    composite(f, this.img.data, this.bgBuf);
    this.ctx.putImageData(this.img, 0, 0);
    this.dirty = false;
  }
}

// ---- tiles
const tiles = [];
const sections = [];
function build() {
  $("#count").textContent = FX.length;
  const main = $("#grid");
  for (const c of categories) {
    const list = FX.filter((f) => f.cat === c.id);
    if (!list.length) continue;
    const grid = el("div", { className: "grid" });
    const h2 = el("h2", { textContent: catLabel(c) + "." });
    const blurb = el("p", { textContent: catBlurb(c) });
    const sec = el("section", { id: c.id }, [el("div", { className: "section-head" }, [h2, blurb]), grid]);
    sections.push({ c, sec, h2, blurb, list });
    for (const fx of list) {
      const cv = el("canvas", { ariaLabel: fxName(fx) });
      const b = fx.mod.act ? actBounds(fx.mod) : null, [fw, fh] = b ? [b.x1 - b.x0, b.y1 - b.y0] : fx.meta.size;
      const nameEl = el("b", { textContent: fxName(fx) });
      const durEl = el("small", { textContent: fx.meta.loop ? ui().loop : `${+fx.meta.duration.toFixed(2)}s` });
      const fig = el("figure", { className: isScreen(fx) ? "tile big screen" : fw > 200 || fh > 170 || (b && (fw > 130 || fx.mod.act.target || fx.mod.act.targets)) ? "tile big" : "tile", tabIndex: 0 }, [
        el("div", { className: "stage" }, cv),
        el("figcaption", {}, [nameEl, durEl]),
      ]);
      const t = { fx, fig, cv, nameEl, durEl, player: null, visible: false, hover: false };
      fig.addEventListener("click", () => openDetail(fx));
      fig.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openDetail(fx)));
      fig.addEventListener("pointerenter", () => (t.hover = true));
      fig.addEventListener("pointerleave", () => (t.hover = false));
      grid.append(fig);
      tiles.push(t);
    }
    main.append(sec);
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const t = tiles.find((x) => x.fig === e.target);
      t.visible = e.isIntersecting;
      if (t.visible && !t.player) {
        t.player = isScreen(t.fx) ? new Player(t.cv, t.fx, 16 / 9, 1) : new Player(t.cv, t.fx, 6 / 5, 1.25);
        if (reduced) t.player.seek(t.fx.meta.duration * 0.4);
      }
    }
  }, { rootMargin: "200px" });
  tiles.forEach((t) => io.observe(t.fig));
}

// ---- filters
const state = { cat: "all", q: "" };
function chips() {
  const box = $("#chips");
  box.replaceChildren();
  const mk = (id, label, n) => {
    const b = el("button", { className: "chip", type: "button" }, [document.createTextNode(label), el("span", { textContent: n })]);
    b.dataset.cat = id;
    b.addEventListener("click", () => setCat(id));
    box.append(b);
  };
  mk("all", ui().all, FX.length);
  for (const s of sections) mk(s.c.id, catLabel(s.c), s.list.length);
  document.querySelectorAll(".chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cat === state.cat)));
}
function setCat(id, fromHash = false) {
  state.cat = sections.some((s) => s.c.id === id) ? id : "all";
  document.querySelectorAll(".chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cat === state.cat)));
  if (!fromHash) history.replaceState(null, "", state.cat === "all" ? location.pathname : "#" + state.cat);
  filter();
  if (!fromHash) window.scrollTo({ top: 0 });
}
function filter() {
  const q = state.q.trim().toLowerCase();
  let shown = 0;
  for (const s of sections) {
    let any = false;
    for (const fx of s.list) {
      const t = tiles.find((x) => x.fx === fx);
      const hit = (state.cat === "all" || state.cat === s.c.id) && (!q || searchHay(fx).includes(q));
      t.fig.hidden = !hit;
      any ||= hit;
      shown += hit;
    }
    s.sec.hidden = !any;
  }
  $("#none").hidden = shown > 0;
}

// ---- detail
let detail = null;
let sheetOpen = false;
function openDetail(fx) {
  const d = $("#detail");
  const big = $("#big"), screen = isScreen(fx);
  big.parentElement.classList.toggle("screen", screen);
  detail = screen ? new Player(big, fx, 16 / 9, 1) : new Player(big, fx, 16 / 10, 1.6);
  sheetOpen = false;
  $("#d-sheet").replaceChildren();
  fillDetail(fx);
  d.showModal();
  d.scrollTop = 0;
}
function fillDetail(fx) {
  const m = fx.meta, t = ui();
  $("#d-name").textContent = fxName(fx);
  $("#d-id").textContent = fx.id;
  $("#d-desc").textContent = fxDesc(fx);
  const frames = Math.round(m.duration * m.fps) + (m.loop ? 0 : 1);
  $("#d-facts").replaceChildren(
    ...[[t.kind, m.loop ? t.loop : t.oneShot], [t.length, t.lengthFmt(+m.duration.toFixed(2), frames, m.fps)], ...(fx.mod.act ? [[t.acted, actFacts(fx.mod)]] : []), [t.canvas, `${m.size[0]} × ${m.size[1]} px`], [t.tags, m.tags.join(", ")]].flatMap(([k, v]) => [el("dt", { textContent: k }), el("dd", { textContent: v })]),
  );
  const bgOn = detail?.bg ?? m.bg;
  const speedOn = detail?.speed ?? 1;
  $("#d-bg").replaceChildren(...BACKDROPS.concat("none").map((b) => btn(b, () => detail.setBg(b), b === bgOn, "bg")));
  $("#d-speed").replaceChildren(...[0.25, 0.5, 1].map((s) => btn(`${s}×`, () => (detail.speed = s), s === speedOn, "speed")));
  const pal = $("#d-pal");
  const palVal = pal.value;
  pal.replaceChildren(el("option", { value: "", textContent: t.itsOwn }), ...Object.keys(PAL).map((k) => el("option", { value: k, textContent: k })));
  pal.value = Object.keys(PAL).includes(palVal) ? palVal : "";
  pal.setAttribute("aria-label", t.palette);
  $("#d-actor").hidden = !m.actor;
  $("#d-actor").setAttribute("aria-pressed", String(detail?.actor ?? true));
  $("#d-flip").setAttribute("aria-pressed", String(detail?.flip ?? false));
  $("#d-play").setAttribute("aria-pressed", String(detail?.playing ?? true));
  $("#d-play").textContent = (detail?.playing ?? true) ? t.pause : t.play;
  $("#d-again").textContent = t.again;
  $("#d-seed").textContent = t.newSeed;
  $("#d-flip").textContent = t.mirror;
  $("#d-actor").textContent = t.character;
  $("#d-make").textContent = t.spriteSheet;
  $("#d-close").textContent = t.close;
  $("#lbl-play").textContent = t.play;
  $("#lbl-backdrop").textContent = t.backdrop;
  $("#lbl-palette").textContent = t.palette;
  $("#lbl-show").textContent = t.show;
  $("#lbl-use").textContent = t.useIt;
  $("#d-src").textContent = t.source;
  $("#d-copy").textContent = t.copy;
  if (sheetOpen) sheet();
  code(fx);
}
// what the body does around the effect, in a line: the wind-up, the freeze, the recovery
function actFacts(mod) {
  const t = ui();
  const k = mod.act.poses, lead = Math.max(0, -k[0][0]), end = k[k.length - 1][0] - mod.meta.duration, hits = (mod.act.hits ?? []).filter((h) => h.stop);
  const parts = [];
  if (lead > 0) parts.push(t.windUp(lead.toFixed(2)));
  if (hits.length) parts.push(`${hits.length === 1 ? t.freezeMs(Math.round(hits[0].stop * 1000)) : t.freezes(hits.length)} ${t.atTime(hits[0].t.toFixed(2))}`);
  if (!mod.meta.loop && end > 0.02) parts.push(t.recovery(end.toFixed(2)));
  return parts.join(lang === "zh" ? "，" : ", ") || t.bodyMoves;
}
function btn(label, fn, on, group) {
  const b = el("button", { className: "btn", type: "button", textContent: label });
  b.setAttribute("aria-pressed", String(!!on));
  b.addEventListener("click", () => {
    if (group) b.parentElement.querySelectorAll(".btn").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    fn();
  });
  return b;
}
function code(fx) {
  const v = fx.id.split("/")[1].replace(/-(\w)/g, (_, c) => c.toUpperCase());
  const opts = { x: 160, y: 120, ...(detail.opts.palette ? { palette: "[…]" } : {}), ...(detail.flip ? { flip: true } : {}) };
  const acted = !!fx.mod.act, make = acted ? "createAct" : "createFx";
  $("#d-code").textContent = [
    `import { createFrame, ${make}, composite } from "pixelfx";`,
    `import * as ${v} from "pixelfx/fx/${fx.id}";`,
    ``,
    `const frame = createFrame(320, 180);`,
    `const fx = ${make}(${v}, ${JSON.stringify(opts).replace(/"\[…\]"/, "[…]").replace(/"(\w+)":/g, "$1: ").replace(/,/g, ", ")});`,
    ``,
    `// every tick`,
    `fx.update(dt);`,
    `fx.draw(frame);          // color + light buffers`,
    `composite(frame, imageData.data, null);`,
    ...(acted ? [``, `// your own character? read the timing: ${v}.act (poses, hits, freezes)`] : []),
  ].join("\n");
  $("#d-src").href = `${REPO}/blob/main/src/fx/${fx.id}.js`;
}
function sheet() {
  const fx = detail.fx, m = fx.meta, [w, h] = m.size, n = Math.max(1, Math.round(m.duration * m.fps) + (m.loop ? 0 : 1));
  const cols = Math.min(n, Math.max(1, Math.ceil(Math.sqrt((n * h) / w)))), rows = Math.ceil(n / cols);
  const cv = el("canvas", { width: cols * w, height: rows * h }), ctx = cv.getContext("2d");
  const frame = createFrame(w, h), img = ctx.createImageData(w, h);
  const inst = createFx(fx.mod, { x: m.origin[0], y: m.origin[1], ...detail.opts, flip: detail.flip });
  for (let i = 0; i < n; i++) {
    if (i) inst.update(1 / m.fps);
    inst.draw(clearFrame(frame));
    composite(frame, img.data, null);
    ctx.putImageData(img, (i % cols) * w, Math.floor(i / cols) * h);
  }
  const k = Math.max(1, Math.min(4, Math.floor(1100 / (cols * w))));
  const name = fxName(fx);
  const pic = el("img", { src: cv.toDataURL("image/png"), alt: `${name} sprite sheet`, width: cols * w * k, height: rows * h * k });
  $("#d-sheet").replaceChildren(pic, el("p", { textContent: `${ui().sheetNote(n, w, h, cols, m.fps, m.loop)} ${fx.id} --sheet` }));
}
function wireDetail() {
  const d = $("#detail");
  $("#d-close").addEventListener("click", () => d.close());
  d.addEventListener("close", () => {
    detail = null;
    sheetOpen = false;
  });
  d.addEventListener("click", (e) => e.target === d && d.close());
  $("#d-play").addEventListener("click", (e) => {
    detail.playing = !detail.playing;
    e.target.setAttribute("aria-pressed", String(detail.playing));
    e.target.textContent = detail.playing ? ui().pause : ui().play;
  });
  $("#d-again").addEventListener("click", () => detail.restart());
  $("#d-flip").addEventListener("click", (e) => {
    detail.flip = !detail.flip;
    e.target.setAttribute("aria-pressed", String(detail.flip));
    detail.restart();
    code(detail.fx);
  });
  $("#d-actor").addEventListener("click", (e) => {
    detail.actor = !detail.actor;
    e.target.setAttribute("aria-pressed", String(detail.actor));
    // with an act, the character is the performance: off shows the effect alone, as a sprite sheet has it
    if (detail.fx.mod.act) detail.layout(detail.aspect, detail.pad);
    detail.dirty = true;
  });
  $("#d-seed").addEventListener("click", () => {
    detail.opts.seed = 1 + Math.floor(Math.random() * 9999);
    detail.restart();
  });
  $("#d-pal").addEventListener("change", (e) => {
    if (e.target.value) detail.opts.palette = PAL[e.target.value];
    else delete detail.opts.palette;
    detail.restart();
    code(detail.fx);
  });
  $("#d-make").addEventListener("click", () => {
    sheetOpen = true;
    sheet();
  });
  $("#d-copy").addEventListener("click", async (e) => {
    const text = $("#d-code").textContent;
    const t = ui();
    try {
      await navigator.clipboard.writeText(text);
      e.target.textContent = t.copied;
    } catch {
      getSelection().selectAllChildren($("#d-code"));
      e.target.textContent = t.selected;
    }
    setTimeout(() => (e.target.textContent = t.copy), 1400);
  });
}

function applyLang() {
  const t = ui();
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  $("#sub-text").textContent = t.sub;
  $("#link-github").textContent = t.github;
  $("#link-skill").textContent = t.skill;
  $("#link-patch").textContent = t.patch;
  const langBtn = $("#lang");
  langBtn.textContent = t.lang;
  langBtn.setAttribute("aria-label", t.langAria);
  $("#chips").setAttribute("aria-label", t.catsAria);
  $("#q").placeholder = t.search;
  $("#q").setAttribute("aria-label", t.searchAria);
  $("#none").textContent = t.empty;
  $("#d-close").textContent = t.close;
  $("#d-again").textContent = t.again;
  $("#d-seed").textContent = t.newSeed;
  $("#d-flip").textContent = t.mirror;
  $("#d-actor").textContent = t.character;
  $("#d-make").textContent = t.spriteSheet;
  $("#d-src").textContent = t.source;
  $("#d-copy").textContent = t.copy;
  $("#lbl-play").textContent = t.play;
  $("#lbl-backdrop").textContent = t.backdrop;
  $("#lbl-palette").textContent = t.palette;
  $("#lbl-show").textContent = t.show;
  $("#lbl-use").textContent = t.useIt;
  $("#d-pal").setAttribute("aria-label", t.palette);
  for (const s of sections) {
    s.h2.textContent = catLabel(s.c) + ".";
    s.blurb.textContent = catBlurb(s.c);
  }
  for (const tile of tiles) {
    tile.nameEl.textContent = fxName(tile.fx);
    tile.durEl.textContent = tile.fx.meta.loop ? t.loop : `${+tile.fx.meta.duration.toFixed(2)}s`;
    tile.cv.setAttribute("aria-label", fxName(tile.fx));
  }
  chips();
  filter();
  if (detail) fillDetail(detail.fx);
}

// ---- the clock
let last = performance.now();
function frameLoop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (detail) detail.tick(dt);
  else for (const t of tiles) if (t.visible && t.player && !t.fig.hidden && (!reduced || t.hover)) t.player.tick(dt);
  requestAnimationFrame(frameLoop);
}

build();
chips();
wireDetail();
applyLang();
$("#lang").addEventListener("click", () => {
  lang = lang === "zh" ? "en" : "zh";
  localStorage.setItem(LANG_KEY, lang);
  applyLang();
});
$("#q").addEventListener("input", (e) => {
  state.q = e.target.value;
  filter();
});
setCat(location.hash.slice(1) || "all", true);
addEventListener("hashchange", () => setCat(location.hash.slice(1) || "all", true));
requestAnimationFrame(frameLoop);
