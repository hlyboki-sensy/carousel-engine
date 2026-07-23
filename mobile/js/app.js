// app.js — мобільний конструктор каруселей (логіка). Затверджений вигляд у index.html.
// Рушій: engine.js (build.py→JS) · render.js (snapdom PNG) · store.js (IndexedDB).
import { THEMES, DEFAULT_THEME } from "./themes.js";
import { buildSlideHTML, formatWH, applyOverridesToTheme } from "./engine.js";
import { mountSlide, renderToBlob, realignFrost } from "./render.js";
import * as store from "./store.js";
import { splitText } from "./ai.js";

// ── СТИЛІ (комбо: шрифт + палітра), як у десктоп-панелі. Кольори — точні десктопні;
// шрифти — системні Apple-аналоги Google-шрифтів десктопу (офлайн, прев'ю правдиве).
// Виняток: «Оксамит» використовує СПРАВЖНІЙ Comforter Brush (локальні woff2 у mobile/fonts,
// @font-face у index.html) — щоб заголовок 1-в-1 збігався з десктопом. ──
const STYLES = [
  { key: "hlyboki", t: "Глибокі Сенси", sw: ["#cfc9c2", "#2b211b", "#FFD20E"], pv: "Aa",
    display: '"Didot","Playfair Display",Georgia,serif', body: '"Helvetica Neue",Arial,sans-serif', di: true, dw: 400,
    c: { accent: "#FFD20E", photoBg: "#11151a", coverBg: "#cfc9c2", lightBg: "#d7d0c5", textOnDark: "#f4efe7", textOnLight: "#2b211b", bodyOnLight: "#473b31", mutedOnDark: "rgba(244,239,231,0.82)", mutedOnLight: "rgba(60,48,38,0.5)" } },
  { key: "oksamyt", t: "Оксамит", sw: ["#C99C97", "#3E4A49", "#E5E2E4"],
    display: '"Comforter Brush","Snell Roundhand","Savoye LET",cursive', body: '"Avenir Next","Helvetica Neue",sans-serif', di: false, dw: 400,
    c: { accent: "#3E4A49", photoBg: "#3E4A49", coverBg: "#C99C97", lightBg: "#E5E2E4", textOnDark: "#E5E2E4", textOnLight: "#3E4A49", bodyOnLight: "#6E7C7B", bodyOnDark: "#E5E2E4", mutedOnDark: "rgba(229,226,228,0.7)", mutedOnLight: "rgba(62,74,73,0.6)" } },
  { key: "nich", t: "Ніч", sw: ["#141210", "#F5F1EA", "#FF6A3D"],
    display: '"Avenir Next","Helvetica Neue",sans-serif', body: '"Avenir Next",sans-serif', di: false, dw: 800,
    c: { accent: "#FF6A3D", photoBg: "#141210", coverBg: "#141210", lightBg: "#141210", textOnDark: "#F5F1EA", textOnLight: "#F5F1EA", bodyOnLight: "#C7C0B6", mutedOnDark: "rgba(245,241,234,0.6)", mutedOnLight: "rgba(245,241,234,0.55)" } },
  { key: "more", t: "Море", sw: ["#14243A", "#EAE6DD", "#E0A458"],
    display: '"Didot","Playfair Display",Georgia,serif', body: '"Avenir Next",sans-serif', di: true, dw: 600,
    c: { accent: "#E0A458", photoBg: "#101F33", coverBg: "#14243A", lightBg: "#EAE6DD", textOnDark: "#EEF2F7", textOnLight: "#14243A", bodyOnLight: "#3E4A5A", mutedOnDark: "rgba(238,242,247,0.7)", mutedOnLight: "rgba(20,36,58,0.5)" } },
  { key: "botanik", t: "Ботанік", sw: ["#E7E9E0", "#23291F", "#5E7C52"],
    display: '"Baskerville",Georgia,serif', body: '"Helvetica Neue",sans-serif', di: true, dw: 600,
    c: { accent: "#5E7C52", photoBg: "#1C2A1E", coverBg: "#232E22", lightBg: "#E7E9E0", textOnDark: "#EEF1E8", textOnLight: "#23291F", bodyOnLight: "#45503C", mutedOnDark: "rgba(238,241,232,0.7)", mutedOnLight: "rgba(35,41,31,0.5)" } },
  { key: "lavanda", t: "Лаванда", sw: ["#4A2340", "#C9A9E9", "#7A4A70"],
    display: '"Avenir Next","Helvetica Neue",sans-serif', body: '"Avenir Next",sans-serif', di: false, dw: 800,
    c: { accent: "#C9A9E9", photoBg: "#4A2340", coverBg: "#4A2340", lightBg: "#4A2340", textOnDark: "#EDE3F5", textOnLight: "#EDE3F5", bodyOnLight: "#D8C7EA", mutedOnDark: "rgba(237,227,245,0.6)", mutedOnLight: "rgba(237,227,245,0.6)" } },
  { key: "glyna", t: "Глина", sw: ["#E9DCCB", "#B4532A", "#3A2A20"],
    display: '"Noteworthy","Bradley Hand",cursive', body: '"Avenir Next",sans-serif', di: false, dw: 600,
    c: { accent: "#B4532A", photoBg: "#241812", coverBg: "#2A1D15", lightBg: "#E9DCCB", textOnDark: "#F4EBDD", textOnLight: "#3A2A20", bodyOnLight: "#5A4636", mutedOnDark: "rgba(244,235,221,0.7)", mutedOnLight: "rgba(58,42,32,0.5)" } },
  { key: "mono", t: "Монохром", sw: ["#101010", "#F4F4F4", "#E63329"],
    display: 'Georgia,"Times New Roman",serif', body: '"Helvetica Neue",sans-serif', di: true, dw: 700,
    c: { accent: "#E63329", photoBg: "#101010", coverBg: "#101010", lightBg: "#101010", textOnDark: "#F4F4F4", textOnLight: "#F4F4F4", bodyOnLight: "#C4C4C4", mutedOnDark: "rgba(244,244,244,0.55)", mutedOnLight: "rgba(244,244,244,0.55)" } },
];
// ручні кольори «поверх стилю» (як десктоп «Кольори стилю»)
// "ink" — одне поле «Заголовок»: міняє колір заголовка на БУДЬ-ЯКОМУ тлі стилю (темному й світлому)
const COLOR_FIELDS = [
  ["coverBg", "Тло обкладинки"], ["lightBg", "Тло слайду"],
  ["ink", "Заголовок"], ["bodyOnLight", "Текст"],
];

// ── стан ────────────────────────────────────────────────────────────
const state = {
  format: "3:4",
  overrides: { kicker: "роздуми маркетолога", handle: "@hlyboki_sensy", colors: {} },
  styleKey: "hlyboki",
  styleOrder: STYLES.map((s) => s.key), // поточний порядок стилів (циклічна ротація при виборі)
  accOpen: { styles: true, colors: true }, // секції «Стилю» незалежні; обидві відкриті за замовчуванням
  slides: [],
  tab: "style", // при відкритті сайту одразу «Стиль»
};
let draftId = "draft-1";      // активна чернетка
let draftName = "Моя карусель"; // її назва

// тема = базова + обраний СТИЛЬ (шрифт+палітра) + ручні кольори поверх + бренд-тексти
const theme = () => {
  const t = JSON.parse(JSON.stringify(THEMES[DEFAULT_THEME]));
  const st = STYLES.find((x) => x.key === state.styleKey) || STYLES[0];
  Object.assign(t.colors, st.c);
  const oc = state.overrides.colors || {};
  Object.assign(t.colors, Object.fromEntries(Object.entries(oc).filter(([, v]) => v)));
  t.fonts.display = st.display; t.fonts.body = st.body;
  t.fonts.displayStyle = st.di ? "italic" : "normal";
  t.fonts.displayWeight = String(st.dw || 400);
  if (st.bw) t.fonts.bodyWeight = String(st.bw);
  t.fonts.links = []; // офлайн: жодного CDN
  if (state.overrides.kicker != null) t.kicker = state.overrides.kicker;
  if (state.overrides.handle != null) t.handle = state.overrides.handle;
  return t;
};

function newSlide(type) {
  const s = {
    type, bgMode: type === "cover" ? "photo" : "color", bgColor: "", photo: "",
    posX: 0, posY: 0, scale: 1, rotate: 0,
    cutout: "", cutX: 0, cutY: 0, cutScale: 1, cutRotate: 0,
    textX: 0, textY: 0, textAlign: "center",
    plate: "none", plateOpacity: 0.5, texture: "", dim: 0, _open: true,
  };
  if (type === "cover") { s["ЗАГ_1"] = "Заголовок"; s["ЗАГ_2"] = "у два рядки"; s["ПІДЗАГ"] = "Короткий підзаголовок"; }
  else { s["ТЕЗА"] = "Твоя теза"; s["ТЕКСТ"] = "Розкрий думку кількома реченнями."; }
  return s;
}

// ── дрібні утиліти ──────────────────────────────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
let toastT;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2200);
}

// ── монтування слайда в контейнер (масштаб під ширину) ─────────────
async function slideHTML(slide, mode = "preview") {
  const resolver = await store.resolveSlideAssets([slide], mode);
  return buildSlideHTML(theme(), slide, state.format, resolver);
}
// висота великого прев'ю в редакторі слайда — половина екрана (прев'ю + контроли видно разом)
const previewMaxH = () => Math.round((window.innerHeight || 720) * 0.5);

async function mountInto(container, slide, holderClass = "mnt", maxH = 0) {
  const [w, h] = formatWH(state.format);
  const html = await slideHTML(slide, "preview");
  const { host } = await mountSlide(html, w, h);
  host.style.cssText = "position:absolute;top:0;left:0;opacity:1;pointer-events:none";
  const holder = el("div", holderClass);
  holder.appendChild(host);
  // прибрати старий слайд/напрямні, але ЗБЕРЕГТИ службову кнопку закриття прев'ю (✕)
  [...container.children].forEach((c) => { if (!c.classList.contains("thumbclose")) c.remove(); });
  container.appendChild(holder);
  const fit = () => {
    container.style.width = ""; container.style.marginLeft = ""; // повна ширина для чистого виміру
    const cwFull = container.clientWidth;
    if (!cwFull) return; // ширина ще не порахована — спробуємо пізніше
    let k = cwFull / w;
    // обмеження по висоті (велике прев'ю в редакторі): щоб прев'ю і контроли було видно разом
    if (maxH && h * k > maxH) k = maxH / h;
    const vw = Math.round(w * k), vh = Math.round(h * k);
    holder.style.transform = `scale(${k})`; holder.style.width = w + "px"; holder.style.height = h + "px";
    holder.style.left = "0px";
    // контейнер = точний розмір слайда обраного формату (без бічних смуг), центрований ЯВНИМ
    // margin-left (не auto — auto на iPhone Safari у sticky/flex-контексті не завжди центрує).
    container.style.width = vw + "px";
    container.style.height = vh + "px";
    container.style.marginLeft = Math.max(0, Math.round((cwFull - vw) / 2)) + "px";
    container.style.marginRight = "0";
  };
  requestAnimationFrame(fit);
  setTimeout(fit, 50); // фолбек: rAF заморожений у фоновій вкладці
  return fit;
}

// ── ВКЛАДКА: СЛАЙДИ ─────────────────────────────────────────────────
const SEG_ALIGN = [["left", "⌫"], ["center", "≡"], ["right", "⌦"], ["justify", "☰"]];
// плашка — порядок і назви як у десктопі (panel.html): none/dark/light/blur
const SEG_PLATE = [["none", "Немає"], ["dark", "Темна"], ["light", "Світла"], ["blur", "Розмиття"]];
// композиції обкладинки (пресети розкладки заголовка) — лише для type=cover
const SEG_COMP = [["classic", "Класика"], ["rvana", "Рвана"], ["script", "Скрипт"], ["minimal", "Мінімал"]];
const TEXTURES_UI = [["", "Немає"], ["kraft", "Крафт"], ["cream", "Крем"], ["glaze", "Глазур"], ["coffee", "Кава"],
  ["chocolate", "Шоколад"], ["matcha", "Матча"], ["linen", "Льон"], ["flower", "Квітка"], ["leaf", "Листя"],
  ["grain", "Зерно"], ["dots", "Крапки"], ["grid", "Сітка"], ["diagonal", "Діагональ"], ["glow", "Сяйво"]];
const IMG_TEX = new Set(["kraft", "cream", "glaze", "coffee", "chocolate", "matcha", "linen", "flower", "leaf"]);

function renderSlides() {
  const root = $("#screen-slides"); root.innerHTML = "";

  // «Написи бренду» — РІВНОЗНАЧНА плашка-розділ (та сама .split, що й «Розкидати»),
  // а не тонкий підзаголовок — щоб обидва були самостійними розділами одного рівня
  const bd = el("details", "split");
  if (localStorage.getItem("brandOpen") === "1") bd.open = true;
  const bsum = el("summary"); bsum.innerHTML = `<span class="chev">▸</span>Написи бренду`;
  const bbody = el("div", "splitbody");
  bbody.appendChild(textField("Кікер (напис зверху)", state.overrides.kicker, (v) => { state.overrides.kicker = v; updateOpenThumbs(); autosave(); }));
  bbody.appendChild(textField("Твій нік", state.overrides.handle, (v) => { state.overrides.handle = v; updateOpenThumbs(); autosave(); }));
  bd.append(bsum, bbody);
  bd.addEventListener("toggle", () => localStorage.setItem("brandOpen", bd.open ? "1" : "0"));
  root.appendChild(bd);

  root.appendChild(splitBlock());

  root.appendChild(el("div", "sectlabel", `Слайди · ${state.slides.length}`));

  state.slides.forEach((s, i) => {
    const card = el("div", "slide");
    card.dataset.idx = i;
    const isCover = s.type === "cover";
    const titleType = isCover ? "Обкладинка" : "Слайд";
    const sub = esc(isCover ? (s["ЗАГ_1"] || "") + " " + (s["ЗАГ_2"] || "") : (s["ТЕЗА"] || ""));
    const head = el("div", "shead", `
      <span class="chev">${s._open ? "▾" : "▸"}</span>
      <span class="snum">${i + 1}</span>
      <span class="stitle"><span class="t">${titleType}</span><span class="s">${sub || "—"}</span></span>
      <span class="sacts">
        <button class="sbtn" data-act="up">↑</button>
        <button class="sbtn" data-act="down">↓</button>
        <button class="sbtn" data-act="del">✕</button>
      </span>`);
    head.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]");
      if (act) { e.stopPropagation(); slideAction(i, act.dataset.act); return; }
      s._open = !s._open; renderSlides();
    });
    card.appendChild(head);

    if (s._open) card.appendChild(slideBody(s, i));
    root.appendChild(card);
  });

  const add = el("div", "addrow");
  const b1 = el("button", "obtn ghost", '<b>+</b> Обкладинка');
  const b2 = el("button", "obtn ghost", '<b>+</b> Слайд');
  b1.onclick = () => addSlide("cover"); b2.onclick = () => addSlide("text");
  add.append(b1, b2); root.appendChild(add);
}

function slideBody(s, i) {
  const body = el("div", "sbody");
  const isCover = s.type === "cover";

  // велике прев'ю слайда (прилипає зверху) + ✕ щоб сховати його, якщо не треба (стан на всі слайди)
  const previewOn = localStorage.getItem("previewHidden") !== "1";
  let thumb = null; // може бути null (прев'ю сховане) — touchSlide це враховує (if thumb …)
  if (previewOn) {
    thumb = el("div", "thumb");
    const x = el("button", "thumbclose", "✕"); x.title = "Сховати прев'ю";
    x.onclick = (e) => { e.stopPropagation(); localStorage.setItem("previewHidden", "1"); renderSlides(); };
    thumb.appendChild(x); // mountInto зберігає .thumbclose при перемонтуванні
    body.appendChild(thumb);
    body.appendChild(el("div", "thumbhint", "Живе прев'ю — змінюється, поки коригуєш. ✕ згорне його. Тягати текст пальцем — на вкладці «Прев'ю»."));
    mountInto(thumb, s, "mnt", previewMaxH());
  } else {
    const showBtn = el("button", "showpv", "▸ Показати прев'ю слайда");
    showBtn.onclick = () => { localStorage.setItem("previewHidden", "0"); renderSlides(); };
    body.appendChild(showBtn);
  }

  // текстові поля
  if (isCover) {
    body.appendChild(textField("Заголовок — рядок 1", s["ЗАГ_1"], (v) => { s["ЗАГ_1"] = v; touchSlide(i, thumb, s); }));
    body.appendChild(textField("Заголовок — рядок 2", s["ЗАГ_2"], (v) => { s["ЗАГ_2"] = v; touchSlide(i, thumb, s); }));
    body.appendChild(textArea("Підзаголовок", s["ПІДЗАГ"], (v) => { s["ПІДЗАГ"] = v; touchSlide(i, thumb, s); }));
  } else {
    body.appendChild(textField("Теза", s["ТЕЗА"], (v) => { s["ТЕЗА"] = v; touchSlide(i, thumb, s); }));
    body.appendChild(textArea("Текст", s["ТЕКСТ"], (v) => { s["ТЕКСТ"] = v; touchSlide(i, thumb, s); }));
  }

  const upd = () => touchSlide(i, thumb, s);

  // --- Написи на слайді: кікер / лінія / хендл (одразу під текстом) ---
  body.appendChild(toggleField("Написи на слайді",
    [["showKicker", "Кікер"], ["showRule", "Лінія"], ["showHandle", "Хендл"]], s, upd));

  // --- Фонове фото/колір (зсув, масштаб, поворот, розмите тло) — під написами, перед композицією ---
  body.appendChild(segField("Тло", [["photo", "Фото"], ["color", "Колір"]], s.bgMode, false, (v) => { s.bgMode = v; renderSlides(); }));
  if (s.bgMode === "photo") body.appendChild(photoControls(s, i, thumb));
  else body.appendChild(colorField("Колір тла", s.bgColor || "#d7d0c5", (v) => { s.bgColor = v; upd(); }));

  // --- Композиція + докрутка заголовка (лише обкладинка) ---
  if (isCover) {
    body.appendChild(segField("Композиція", SEG_COMP, s.layout || "classic", false, (v) => {
      s.layout = v;
      // композиція виставляє свій дефолт вирівнювання; далі його можна змінити нижче (Текст — вирівнювання)
      s.textAlign = (v === "rvana" || v === "minimal") ? "left" : "center";
      renderSlides();
    }));
    const twrap = el("div", "field"); twrap.appendChild(el("label", null, "Заголовок — розмір і поворот"));
    twrap.appendChild(el("div", "thumbhint", "Тягни заголовок пальцем на «Прев'ю»; двома пальцями — щипок міняє розмір, обертання — нахил."));
    body.appendChild(twrap);
    body.appendChild(sliderField("Розмір ⤢", 55, 175, Math.round((s.titleScale ?? 1) * 100), (v) => { s.titleScale = v / 100; touchSlide(i, thumb, s); }, (v) => v + "%"));
    body.appendChild(sliderField("Нахил ⟳", -20, 20, s.titleRotate || 0, (v) => { s.titleRotate = v; touchSlide(i, thumb, s); }, (v) => v + "°"));
    // ширина блоку заголовка: ширше → довге слово вміщується в рядок (напр. «ЗАГОЛОВОК» не переноситься)
    body.appendChild(sliderField("Ширина блоку ↔️", 55, 98, Math.round(s.blockW ?? 87), (v) => { s.blockW = v; touchSlide(i, thumb, s); }, (v) => v + "%"));
    if ((s.titleScale ?? 1) !== 1 || (s.titleRotate || 0) !== 0 || s.titleX || s.titleY) {
      const rb = el("button", "ghost", "↺ Скинути докрутку заголовка");
      rb.onclick = () => { s.titleScale = 1; s.titleRotate = 0; s.titleX = 0; s.titleY = 0; renderSlides(); };
      const rf = el("div", "field"); rf.appendChild(rb); body.appendChild(rf);
    }
  }

  // --- Текст: вирівнювання + позиція ---
  const tx = el("div", "field"); tx.appendChild(el("label", null, "Текст — вирівнювання та позиція"));
  tx.appendChild(rawSeg(SEG_ALIGN, s.textAlign || "center", true, (v) => { s.textAlign = v; upd(); }));
  body.appendChild(tx);
  body.appendChild(sliderField("Текст ↔️", -500, 500, s.textX || 0, (v) => { s.textX = v; upd(); }));
  body.appendChild(sliderField("Текст ↕️", -500, 500, s.textY || 0, (v) => { s.textY = v; upd(); }));

  // --- Плашка під текстом + щільність ---
  body.appendChild(segField("Плашка під текстом", SEG_PLATE, s.plate || "none", false, (v) => { s.plate = v; if (s.plateOpacity == null) s.plateOpacity = 0.5; renderSlides(); }));
  if ((s.plate || "none") !== "none")
    body.appendChild(sliderField("Щільність", 15, 90, Math.round((s.plateOpacity ?? 0.5) * 100), (v) => { s.plateOpacity = v / 100; upd(); }, (v) => v + "%"));

  // --- Текстура тла ---
  const texWrap = el("div", "field"); texWrap.appendChild(el("label", null, "Текстура тла"));
  const chips = el("div", "chips");
  TEXTURES_UI.forEach(([v, t]) => {
    const b = el("button", "chip" + ((s.texture || "") === v ? " on" : ""), esc(t));
    b.onclick = () => { s.texture = v; s.textureOp = v ? (IMG_TEX.has(v) ? 1 : 0.5) : undefined; renderSlides(); };
    chips.appendChild(b);
  });
  texWrap.appendChild(chips); body.appendChild(texWrap);
  if (s.texture)
    body.appendChild(sliderField("Інтенсивність", 0, 100, Math.round((s.textureOp ?? (IMG_TEX.has(s.texture) ? 1 : 0.5)) * 100), (v) => { s.textureOp = v / 100; upd(); }, (v) => v + "%"));

  // --- Затемнення тла ---
  body.appendChild(sliderField("Затемнення тла", 0, 85, Math.round((s.dim || 0) * 100), (v) => { s.dim = v / 100; upd(); }, (v) => v + "%"));

  // --- Об'єкт зверху (готовий PNG без тла, над текстом) ---
  body.appendChild(cutoutControls(s, i, thumb));

  return body;
}

function photoControls(s, i, thumb) {
  const upd = () => touchSlide(i, thumb, s);
  const wrap = el("div", "field");
  wrap.appendChild(el("label", null, "Фонове фото"));
  const row = el("div", "btnrow");
  const up = el("button", "obtn", s.photo ? "Замінити фото" : "<b>+</b> Завантажити фото");
  up.onclick = () => pickPhoto((ref) => { s.photo = ref; renderSlides(); });
  row.appendChild(up);
  if (s.photo) {
    const rm = el("button", "obtn", "Прибрати");
    rm.onclick = () => { s.photo = ""; renderSlides(); };
    row.appendChild(rm);
  }
  wrap.appendChild(row);
  if (s.photo) {
    wrap.appendChild(sliderField("Зсув ↔️", -500, 500, s.posX || 0, (v) => { s.posX = v; upd(); }));
    wrap.appendChild(sliderField("Зсув ↕️", -500, 500, s.posY || 0, (v) => { s.posY = v; upd(); }));
    wrap.appendChild(sliderField("Масштаб", 100, 300, Math.round((s.scale || 1) * 100), (v) => { s.scale = v / 100; upd(); }, (v) => (v / 100).toFixed(2) + "×"));
    wrap.appendChild(sliderField("Поворот", -180, 180, s.rotate || 0, (v) => { s.rotate = v; upd(); }, (v) => v + "°"));
    wrap.appendChild(sliderField("Розмити тло", 0, 40, Math.round(s.bgBlur || 0), (v) => { s.bgBlur = v; upd(); }, (v) => v || "0"));
  }
  return wrap;
}

function cutoutControls(s, i, thumb) {
  const upd = () => touchSlide(i, thumb, s);
  const wrap = el("div", "field");
  wrap.appendChild(el("label", null, "Об'єкт зверху (над текстом)"));
  const row = el("div", "btnrow");
  const up = el("button", "obtn", s.cutout ? "Замінити об'єкт" : "<b>+</b> Додати об'єкт (PNG без тла)");
  up.onclick = () => pickPhoto((ref) => { s.cutout = ref; renderSlides(); });
  row.appendChild(up);
  if (s.cutout) {
    const rm = el("button", "obtn", "Прибрати");
    rm.onclick = () => { s.cutout = ""; renderSlides(); };
    row.appendChild(rm);
  }
  wrap.appendChild(row);
  if (s.cutout) {
    wrap.appendChild(sliderField("Зсув ↔️", -500, 500, Math.round(s.cutX ?? 0), (v) => { s.cutX = v; upd(); }, (v) => v + "px"));
    wrap.appendChild(sliderField("Зсув ↕️", -500, 500, Math.round(s.cutY ?? 0), (v) => { s.cutY = v; upd(); }, (v) => v + "px"));
    wrap.appendChild(sliderField("Масштаб", 30, 200, Math.round((s.cutScale || 1) * 100), (v) => { s.cutScale = v / 100; upd(); }, (v) => (v / 100).toFixed(2) + "×"));
    wrap.appendChild(sliderField("Поворот", -180, 180, s.cutRotate || 0, (v) => { s.cutRotate = v; upd(); }, (v) => v + "°"));
  }
  return wrap;
}

// поля-конструктори
function textField(label, val, on) {
  const f = el("div", "field"); f.appendChild(el("label", null, esc(label)));
  const inp = el("input"); inp.type = "text"; inp.value = val || "";
  inp.addEventListener("input", () => on(inp.value)); f.appendChild(inp); return f;
}
function textArea(label, val, on) {
  const f = el("div", "field"); f.appendChild(el("label", null, esc(label)));
  const ta = el("textarea"); ta.value = val || "";
  ta.addEventListener("input", () => on(ta.value)); f.appendChild(ta); return f;
}
function rawSeg(opts, cur, mini, on) {
  const seg = el("div", "seg" + (mini ? " mini" : ""));
  opts.forEach(([val, txt]) => {
    const b = el("button", val === cur ? "on" : null, txt);
    b.onclick = () => { seg.querySelectorAll("button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); on(val); };
    seg.appendChild(b);
  });
  return seg;
}
function segField(label, opts, cur, mini, on) {
  const f = el("div", "field"); if (label) f.appendChild(el("label", null, esc(label)));
  f.appendChild(rawSeg(opts, cur, mini, on)); return f;
}
// незалежні тумблери (default true = увімкнено), як «Написи на слайді» в десктопі
function toggleField(label, opts, s, on) {
  const f = el("div", "field"); f.appendChild(el("label", null, esc(label)));
  const seg = el("div", "seg");
  opts.forEach(([key, txt]) => {
    const b = el("button", s[key] !== false ? "on" : null, txt);
    b.onclick = () => { s[key] = s[key] === false; b.classList.toggle("on", s[key] !== false); on(); };
    seg.appendChild(b);
  });
  f.appendChild(seg); return f;
}
function sliderField(label, min, max, val, on, fmt) {
  const f = el("div", "slider"); f.appendChild(el("label", null, esc(label)));
  const r = el("input"); r.type = "range"; r.min = min; r.max = max; r.value = val;
  const out = el("span", "val", String(fmt ? fmt(val) : val));
  r.addEventListener("input", () => { out.textContent = fmt ? fmt(+r.value) : r.value; on(+r.value); });
  f.append(r, out); return f;
}
function colorField(label, val, on) {
  const f = el("div", "field"); f.appendChild(el("label", null, esc(label)));
  const c = el("input"); c.type = "color"; c.value = val;  // круглий вигляд задає CSS input[type=color]
  c.addEventListener("input", () => on(c.value)); f.appendChild(c); return f;
}

// оновити один слайд без повного ре-рендера списку (лише мініатюру + прев'ю + автозбереж.)
let touchT;
function touchSlide(i, thumb, s) {
  if (thumb) mountInto(thumb, s, "mnt", previewMaxH());
  // заголовок картки (підпис) оновимо легко
  const card = $("#screen-slides").children[i + 1]; // +1 бо перший — sectlabel
  const sub = card && card.querySelector(".stitle .s");
  if (sub) sub.textContent = (s.type === "cover" ? (s["ЗАГ_1"] || "") + " " + (s["ЗАГ_2"] || "") : (s["ТЕЗА"] || "")) || "—";
  clearTimeout(touchT); touchT = setTimeout(autosave, 500);
  refreshExportCount();
}

function slideAction(i, act) {
  if (act === "del") {
    if (state.slides.length <= 1) { toast("Має лишитись хоча б один слайд"); return; }
    state.slides.splice(i, 1);
  } else if (act === "up" && i > 0) { [state.slides[i - 1], state.slides[i]] = [state.slides[i], state.slides[i - 1]]; }
  else if (act === "down" && i < state.slides.length - 1) { [state.slides[i + 1], state.slides[i]] = [state.slides[i], state.slides[i + 1]]; }
  renderSlides(); autosave(); refreshExportCount();
}
// новий слайд успадковує вирівнювання й позицію тексту з ОБКЛАДИНКИ (slides[0]) — єдиний стиль
// каруселі за замовчуванням; на конкретному слайді це можна потім змінити вручну
function inheritTextLayout(s) {
  const cover = state.slides[0];
  if (cover && cover !== s) {
    if (cover.textAlign != null) s.textAlign = cover.textAlign;
    if (cover.textX != null) s.textX = cover.textX;
    if (cover.textY != null) s.textY = cover.textY;
  }
  return s;
}
function addSlide(type) {
  state.slides.forEach((s) => (s._open = false));
  state.slides.push(inheritTextLayout(newSlide(type)));
  renderSlides(); autosave(); refreshExportCount();
}

// ── AI-розкидання тексту по слайдах (Gemini) ───────────────────────
function splitBlock() {
  const d = el("details", "split");
  const savedKey = localStorage.getItem("geminiKey") || "";
  d.innerHTML = `
    <summary><span class="chev">▸</span>✨ Розкидати текст по слайдах</summary>
    <div class="splitbody">
      <textarea id="bigtext" placeholder="Встав великий текст — AI розкладе його на слайди-тези"></textarea>
      <div class="splitrow">
        <input type="text" id="splitcount" placeholder="скільки слайдів (авто)" inputmode="numeric">
        <button class="obtn" id="splitgo">Розкидати</button>
      </div>
      <details class="keywiz"${savedKey ? "" : " open"}>
        <summary>🔑 Ключ Gemini</summary>
        <input type="text" id="geminiKey" placeholder="встав ключ (AQ.… або AIza…)" value="${esc(savedKey)}">
        <div class="keystate" id="keyState"></div>
        <button class="obtn ghost" id="getkey">Отримати ключ</button>
      </details>
    </div>`;
  const key = d.querySelector("#geminiKey");
  const upd = () => {
    const v = key.value.trim();
    const ks = d.querySelector("#keyState");
    if (v) { ks.textContent = "✓ ключ збережено — можна розкидати"; ks.classList.add("ok"); }
    else { ks.textContent = "Потрібен ключ, щоб розкидати текст"; ks.classList.remove("ok"); }
  };
  key.addEventListener("input", () => { localStorage.setItem("geminiKey", key.value.trim()); upd(); });
  upd();
  d.querySelector("#getkey").onclick = () => window.open("https://aistudio.google.com/apikey", "_blank");
  d.querySelector("#splitgo").onclick = () => doSplit(d);
  return d;
}
async function doSplit(d) {
  const text = d.querySelector("#bigtext").value.trim();
  const key = (d.querySelector("#geminiKey").value || "").trim();
  const count = parseInt(d.querySelector("#splitcount").value) || null;
  if (!text) { toast("Встав текст для розкидання"); return; }
  if (!key) { toast("Потрібен ключ Gemini — розгорни «Ключ Gemini»"); return; }
  const btn = d.querySelector("#splitgo"); btn.disabled = true; btn.textContent = "Думаю…";
  try {
    const parts = await splitText(text, count, key);
    if (!parts.length) throw new Error("порожня відповідь");
    // лишаємо перший слайд (обкладинку), решту замінюємо розкиданими тезами
    const cover = state.slides[0];
    state.slides = [cover];
    parts.forEach((p) => {
      const s = inheritTextLayout(newSlide("text")); s._open = false; // вирівнювання/позиція як в обкладинки
      s["ТЕЗА"] = p["ТЕЗА"]; s["ТЕКСТ"] = p["ТЕКСТ"];
      state.slides.push(s);
    });
    renderSlides(); refreshExportCount(); autosave();
    toast(`Розкидано на ${parts.length} слайдів`);
  } catch (e) { toast("Помилка: " + e.message); }
  btn.disabled = false; btn.textContent = "Розкидати";
}

// ── завантаження фото → IndexedDB ──────────────────────────────────
function pickPhoto(cb) {
  const inp = el("input"); inp.type = "file"; inp.accept = "image/*";
  inp.onchange = async () => {
    const file = inp.files && inp.files[0]; if (!file) return;
    try {
      const ref = await store.putAsset(file, "photo", file.name || "");
      cb(ref); autosave(); toast("Фото додано");
    } catch (e) { toast("Не вдалося додати фото"); }
  };
  inp.click();
}

// ── ВКЛАДКА: СТИЛЬ ──────────────────────────────────────────────────
function renderStyle() {
  const root = $("#screen-style"); root.innerHTML = "";
  root.appendChild(el("div", "sectlabel", "Формат"));
  const g1 = el("div", "group");
  g1.appendChild(segField(null, [["3:4", "3:4"], ["4:5", "4:5"], ["1:1", "1:1"]], state.format, false, (v) => {
    state.format = v; autosave(); reflowActiveThumbs(); // оновити мініатюру стилю / прев'ю під новий формат
  }));
  g1.appendChild(el("div", null, `<span style="font-size:12px;color:var(--muted)">Розмір усієї каруселі. 3:4 — класика Instagram.</span>`));
  root.appendChild(g1);

  // ── жива мініатюра слайда: перемикай стилі → видно зміни в композиції ──
  if (state.slides.length) {
    root.appendChild(el("div", "sectlabel", "Прев'ю стилю"));
    const pvg = el("div", "group");
    const pv = el("div", "stylepv");
    const box = el("div", "mnt-box");
    pv.appendChild(box); pvg.appendChild(pv);
    pvg.appendChild(el("div", null, `<span style="font-size:12px;color:var(--muted)">Перемикай стилі нижче — дивись, як міняється композиція слайда.</span>`));
    root.appendChild(pvg);
    mountInto(box, state.slides[0]);
  }

  // ── Дві незалежні секції «Стилю» — обидві можуть бути відкриті одночасно ──
  root.appendChild(accHead("Стиль · шрифти + кольори", "styles"));
  if (state.accOpen.styles) {
    const list = el("div", "stylelist");
    // рендеримо за поточним порядком (циклічна ротація тримає обраний першим)
    const byKey = Object.fromEntries(STYLES.map((s) => [s.key, s]));
    const ordered = state.styleOrder.map((k) => byKey[k]).filter(Boolean);
    ordered.forEach((st) => {
      const it = el("div", "styleitem" + (st.key === state.styleKey ? " on" : ""));
      const aa = el("div", "aa", st.di ? "<i>Aa</i>" : "Aa");
      aa.style.cssText += `background:${st.sw[0]};color:${st.sw[1]};font-family:${st.display};font-weight:${st.dw || 400}`;
      const meta = el("div", "meta");
      meta.appendChild(el("div", "nm", esc(st.t)));
      const sws = el("div", "sws");
      st.sw.forEach((c) => { const dot = el("i"); dot.style.background = c; sws.appendChild(dot); });
      meta.appendChild(sws);
      it.append(aa, meta);
      it.onclick = () => {
        // повторний клік по АКТИВНОМУ (першому) стилю → перемикає на НАСТУПНИЙ по колу
        // (перший стиль почергово гортає всі стилі); клік по іншому — просто обирає його
        let target = st.key;
        if (st.key === state.styleKey) {
          const idx = state.styleOrder.indexOf(st.key);
          target = state.styleOrder[(idx + 1) % state.styleOrder.length];
        }
        state.styleKey = target;
        // ротація: обраний → перший, усе що було перед ним → у кінець по колу
        const i = state.styleOrder.indexOf(target);
        if (i > 0) state.styleOrder = [...state.styleOrder.slice(i), ...state.styleOrder.slice(0, i)];
        renderStyle();
        const pv = $("#screen-style .stylepv"); // мініатюра + обраний стиль (тепер перший) в одному кадрі
        if (pv) pv.scrollIntoView({ block: "start" });
        autosave();
      };
      list.appendChild(it);
    });
    root.appendChild(list);
  }

  root.appendChild(accHead("Кольори стилю — підправити", "colors"));
  if (state.accOpen.colors) {
    const g3 = el("div", "group");
    const cg = el("div", "colorgrid");
    const baseColors = theme().colors;
    COLOR_FIELDS.forEach(([key, label]) => {
      const cell = el("div", "colorcell");
      const oc0 = state.overrides.colors || {};
      const c = el("input"); c.type = "color";
      // «Заголовок» (ink) керує обома textOnDark+textOnLight — колір заголовка міняється
      // на будь-якому тлі стилю (раніше два окремих поля збивали з пантелику, і на темному
      // стилі зміна «світлого» варіанта нічого не робила).
      c.value = key === "ink" ? (oc0.textOnDark || baseColors.textOnDark || "#ffffff")
                              : (oc0[key] || baseColors[key] || "#000000");
      // згорнути «Стиль·шрифти» ОДРАЗУ при відкритті палітри (до зміни кольору) → пікери ближче до прев'ю
      c.addEventListener("pointerdown", collapseStylesSection);
      c.addEventListener("input", () => {
        collapseStylesSection();
        const oc = state.overrides.colors || (state.overrides.colors = {});
        if (key === "ink") { oc.textOnDark = c.value; oc.textOnLight = c.value; }
        else oc[key] = c.value;
        reflowActiveThumbs(); autosave();
      });
      cell.append(c, el("span", "cl", esc(label)));
      cg.appendChild(cell);
    });
    g3.appendChild(cg);
    const rst = el("button", "obtn ghost", "↺ Скинути ручні кольори");
    rst.onclick = () => { state.overrides.colors = {}; renderStyle(); reflowActiveThumbs(); autosave(); };
    g3.appendChild(rst);
    root.appendChild(g3);
  }
}

// згорнути секцію «Стиль · шрифти + кольори» БЕЗ повного renderStyle (щоб не збити відкритий
// color-picker): прибираємо лише список стилів + оновлюємо стрілку. Викликається при зміні кольору,
// щоб пікери кольорів піднялись ближче до прев'ю.
function collapseStylesSection() {
  if (!state.accOpen.styles) return;
  state.accOpen.styles = false;
  const list = document.querySelector("#screen-style .stylelist");
  if (list) list.remove();
  const stylesHead = document.querySelector("#screen-style .acchead"); // перший = «Стиль · шрифти»
  if (stylesHead) {
    stylesHead.classList.remove("open");
    const chev = stylesHead.querySelector(".chev"); if (chev) chev.textContent = "▸";
  }
}

// клікабельна панель-акордеон для розділу «Стиль» (виразна, як картка слайда)
function accHead(label, key) {
  const open = !!state.accOpen[key];
  const h = el("div", "acchead" + (open ? " open" : ""));
  h.innerHTML = `<span class="chev">${open ? "▾" : "▸"}</span><span class="acctitle">${esc(label)}</span>`;
  // незалежний toggle: кожна секція відкривається/закривається окремо
  h.onclick = () => { state.accOpen[key] = !state.accOpen[key]; renderStyle(); };
  return h;
}

// оновити мініатюри всіх розгорнутих слайдів (напр. після зміни кікера/ніка) — без ре-рендера списку, щоб не втратити фокус поля
function updateOpenThumbs() {
  $("#screen-slides").querySelectorAll(".slide").forEach((card) => {
    const i = +card.dataset.idx; const s = state.slides[i];
    const thumb = card.querySelector(".thumb");
    if (s && s._open && thumb) mountInto(thumb, s, "mnt", previewMaxH());
  });
}

// перемалювати активні мініатюри (після зміни стилю/кольору) — на будь-якій вкладці
function reflowActiveThumbs() {
  if (state.tab === "slides") renderSlides();
  else if (state.tab === "preview") renderPreview();
  else if (state.tab === "style") {
    const box = $("#screen-style .mnt-box");
    if (box && state.slides.length) mountInto(box, state.slides[0]);
  }
}

// ── ВКЛАДКА: ПРЕВʼЮ ─────────────────────────────────────────────────
async function renderPreview() {
  const root = $("#screen-preview"); root.innerHTML = "";
  root.appendChild(el("div", "sectlabel", "Прев'ю · гортай →"));
  if (!state.slides.length) { root.appendChild(el("div", "empty", "Додай слайди на вкладці «Слайди».")); return; }
  root.appendChild(el("div", "pvhint", "<b>Тягни пальцем по тексту</b> — він рухається (гортання слайдів на мить завмирає). На обкладинці <b>двома пальцями</b> заголовок: щипок — розмір, обертання — нахил. Що бачиш — те й буде у PNG."));
  const swipe = el("div", "swipe");
  root.appendChild(swipe);
  const dots = el("div", "dots"); root.appendChild(dots);
  for (let i = 0; i < state.slides.length; i++) {
    const card = el("div", "pcard");
    const mnt = el("div"); mnt.style.cssText = "position:relative;width:100%";
    card.appendChild(mnt); swipe.appendChild(card);
    await mountInto(mnt, state.slides[i]);
    attachPreviewDrag(mnt, state.slides[i]);
    const fs = el("button", "fsbtn", "⛶"); fs.title = "На весь екран";
    fs.onclick = (e) => { e.stopPropagation(); openFullscreen(i); };
    card.appendChild(fs);
    const dot = el("span", "dot" + (i === 0 ? " on" : "")); dots.appendChild(dot);
  }
}

// повноекранне прев'ю одного слайда: тап по ⛶ → весь екран + редагування пальцем (drag тексту / щипок заголовка)
let fsIdx = 0;
async function openFullscreen(i) {
  fsIdx = clamp(i, 0, state.slides.length - 1);
  let ov = document.querySelector(".fsprev");
  if (!ov) {
    ov = el("div", "fsprev");
    ov.innerHTML = `<div class="fstop"><span class="fsn"></span><button class="fsclose" title="Закрити">✕</button></div>
      <div class="fsstage"><div class="fsmnt"></div></div>
      <div class="fsbar"><button class="fsnavbtn" data-nav="-1" title="Попередній">‹</button>
      <div class="fshint">Тягни текст пальцем. На обкладинці двома пальцями — щипок міняє розмір, обертання — нахил.</div>
      <button class="fsnavbtn" data-nav="1" title="Наступний">›</button></div>`;
    document.body.appendChild(ov);
    ov.querySelector(".fsclose").onclick = () => { ov.remove(); renderPreview(); };
    ov.querySelectorAll("[data-nav]").forEach((b) => (b.onclick = () => openFullscreen(fsIdx + (+b.dataset.nav))));
  }
  ov.querySelector(".fsn").textContent = `${fsIdx + 1} / ${state.slides.length}`;
  ov.querySelector('[data-nav="-1"]').disabled = fsIdx === 0;
  ov.querySelector('[data-nav="1"]').disabled = fsIdx === state.slides.length - 1;
  const mnt = ov.querySelector(".fsmnt");
  const maxH = Math.round(window.innerHeight * 0.72); // лишаємо місце для панелі знизу/зверху
  await mountInto(mnt, state.slides[fsIdx], "mnt", maxH);
  attachPreviewDrag(mnt, state.slides[fsIdx]);
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const photoTransform = (s) => `translate(-50%,-50%) translate(${s.posX || 0}px,${s.posY || 0}px) scale(${s.scale || 1}) rotate(${s.rotate || 0}deg)`;

// На iOS горизонтальний scroll-snap свайп (.swipe) перехоплює палець раніше за drag →
// текст «не тягнеться». Тому на час перетягування заморожуємо гортання (overflow-x:hidden).
function freezeSwipe() { document.querySelectorAll(".swipe").forEach((s) => { s.style.overflowX = "hidden"; }); }
function thawSwipe() { document.querySelectorAll(".swipe").forEach((s) => { s.style.overflowX = "auto"; }); }

// ── напрямні притягування (магніт до центру / до рівного повороту) ──────────
function ensureGuides(container) {
  let gv = container.querySelector(":scope > .guide-v"), gh = container.querySelector(":scope > .guide-h");
  if (!gv) { gv = el("div", "guide-v"); container.appendChild(gv); }
  if (!gh) { gh = el("div", "guide-h"); container.appendChild(gh); }
  return { gv, gh };
}
function hideGuides(container) { container.querySelectorAll(".guide-v,.guide-h").forEach((g) => g.classList.remove("on")); }
function centerOf(target, container) {
  const t = target.getBoundingClientRect(), c = container.getBoundingClientRect();
  return { x: t.left - c.left + t.width / 2, y: t.top - c.top + t.height / 2 };
}
// притягнути центр блоку до центру слайда (holder); показати відповідну напрямну. Повертає true, якщо притягнулось.
function snapCenter(wrap, holder, container, k, s) {
  const wc = centerOf(wrap, container), sc = centerOf(holder, container);
  const T = 9; // поріг у px екрана
  const { gv, gh } = ensureGuides(container);
  let snapped = false;
  if (Math.abs(wc.x - sc.x) < T) { s.textX = Math.round((s.textX || 0) - (wc.x - sc.x) / k); gv.style.left = sc.x + "px"; gv.classList.add("on"); snapped = true; }
  else gv.classList.remove("on");
  if (Math.abs(wc.y - sc.y) < T) { s.textY = Math.round((s.textY || 0) - (wc.y - sc.y) / k); gh.style.top = sc.y + "px"; gh.classList.add("on"); snapped = true; }
  else gh.classList.remove("on");
  return snapped;
}
// притягнути поворот до 0° (рівно); показати хрест по центру заголовка. Повертає true, якщо притягнулось.
function snapRotate(target, container, s) {
  const { gv, gh } = ensureGuides(container);
  if (Math.abs(s.titleRotate || 0) < 3) {
    s.titleRotate = 0;
    const c = centerOf(target, container);
    gv.style.left = c.x + "px"; gh.style.top = c.y + "px";
    gv.classList.add("on"); gh.classList.add("on");
    return true;
  }
  gv.classList.remove("on"); gh.classList.remove("on");
  return false;
}

// перетягування елемента пальцем/мишею; kOf() — поточний масштаб прев'ю (екран→1080-простір).
// onMove отримує (dx, dy, k); on* властивості (не addEventListener) — щоб повторний виклик не множив обробники.
function dragXY(elm, kOf, onMove, onEnd) {
  let active = false, px, py, k = 1;
  // host слайда має pointer-events:none — вмикаємо на самому елементі, щоб реальний палець його «бачив»
  elm.style.cursor = "move"; elm.style.touchAction = "none"; elm.style.pointerEvents = "auto";
  elm.onpointerdown = (e) => {
    active = true; px = e.clientX; py = e.clientY; k = kOf() || 1;
    freezeSwipe();
    try { elm.setPointerCapture(e.pointerId); } catch (er) {}
    e.preventDefault(); e.stopPropagation();
  };
  elm.onpointermove = (e) => {
    if (!active) return;
    onMove((e.clientX - px) / k, (e.clientY - py) / k, k);
    px = e.clientX; py = e.clientY;
  };
  elm.onpointerup = elm.onpointercancel = () => { if (active) { active = false; thawSwipe(); onEnd && onEnd(); } };
}

// Жест заголовка обкладинки: 1 палець — рух усього текст-блоку (textX/Y);
// 2 пальці — щипок міняє розмір заголовка (titleScale), обертання — нахил (titleRotate).
// Обидва режими на одному .wrap; переходи 1↔2 пальці безшовні (перебазовуємо якорі).
function titleGesture(wrap, headline, holder, container, kOf, s, onEnd) {
  const pts = new Map();
  let k = 1, lastX = 0, lastY = 0;
  let d0 = 1, a0 = 0, baseScale = 1, baseRot = 0;
  // host слайда має pointer-events:none — вмикаємо на .wrap, щоб реальний палець його «бачив»
  wrap.style.cursor = "move"; wrap.style.touchAction = "none"; wrap.style.pointerEvents = "auto";
  // докрутка (scale/rotate) застосовується до ВСЬОГО блоку .wrap → підзаголовок масштабується з заголовком
  const applyWrap = () => {
    wrap.style.transform =
      `translate(${s.textX || 0}px,${s.textY || 0}px) scale(${s.titleScale ?? 1}) rotate(${s.titleRotate || 0}deg)`;
    realignFrost(wrap); // розмите тло матового скла стоїть на місці картки при переносі/масштабі плашки
  };
  const twoInit = () => {
    const [a, b] = [...pts.values()];
    d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    a0 = Math.atan2(b.y - a.y, b.x - a.x);
    baseScale = s.titleScale ?? 1; baseRot = s.titleRotate || 0;
  };
  wrap.onpointerdown = (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    freezeSwipe();
    try { wrap.setPointerCapture(e.pointerId); } catch (er) {}
    e.preventDefault(); e.stopPropagation();
    if (pts.size === 1) { k = kOf() || 1; lastX = e.clientX; lastY = e.clientY; }
    else if (pts.size === 2) twoInit();
  };
  wrap.onpointermove = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      s.textX = Math.round((s.textX || 0) + (e.clientX - lastX) / k);
      s.textY = Math.round((s.textY || 0) + (e.clientY - lastY) / k);
      lastX = e.clientX; lastY = e.clientY; applyWrap();
      if (snapCenter(wrap, holder, container, k, s)) applyWrap(); // магніт до центру + напрямні
    } else if (pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      s.titleScale = clamp(baseScale * (d / d0), 0.55, 1.75);
      s.titleRotate = clamp(Math.round(baseRot + (ang - a0) * 180 / Math.PI), -20, 20);
      snapRotate(wrap, container, s); // магніт до рівного (0°) + хрест-напрямні (по центру блоку)
      applyWrap();
    }
  };
  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    onEnd && onEnd();
    if (pts.size === 0) { thawSwipe(); hideGuides(container); }
    else if (pts.size === 1) { const only = [...pts.values()][0]; lastX = only.x; lastY = only.y; k = kOf() || 1; }
    else if (pts.size === 2) twoInit();
  };
  wrap.onpointerup = wrap.onpointercancel = end;
}

// Універсальний жест для фото/об'єкта: 1 палець — рух, 2 пальці — щипок (масштаб) + обертання.
// Аналог titleGesture, але без магнітів: onMove(dx,dy) рухає, onPinch(scaleMul, rotDelta) докручує.
function pinchDrag(elm, kOf, onMove, onPinch, onEnd) {
  const pts = new Map();
  let k = 1, lastX = 0, lastY = 0, d0 = 1, a0 = 0;
  elm.style.cursor = "move"; elm.style.touchAction = "none"; elm.style.pointerEvents = "auto";
  const twoInit = () => {
    const [a, b] = [...pts.values()];
    d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    a0 = Math.atan2(b.y - a.y, b.x - a.x);
    onPinch && onPinch(1, 0, true);            // база: зафіксувати поточні scale/rotate
  };
  elm.onpointerdown = (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    freezeSwipe();
    try { elm.setPointerCapture(e.pointerId); } catch (er) {}
    e.preventDefault(); e.stopPropagation();
    if (pts.size === 1) { k = kOf() || 1; lastX = e.clientX; lastY = e.clientY; }
    else if (pts.size === 2) twoInit();
  };
  elm.onpointermove = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      onMove((e.clientX - lastX) / k, (e.clientY - lastY) / k, k);
      lastX = e.clientX; lastY = e.clientY;
    } else if (pts.size >= 2 && onPinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      onPinch(d / d0, (ang - a0) * 180 / Math.PI, false);
    }
  };
  elm.onpointerup = elm.onpointercancel = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    onEnd && onEnd();
    if (pts.size === 0) thawSwipe();
    else if (pts.size === 1) { const only = [...pts.values()][0]; lastX = only.x; lastY = only.y; k = kOf() || 1; }
    else if (pts.size === 2) twoInit();
  };
}

// навісити перетягування на текст / фон / об'єкт у змонтованому прев'ю-слайді
function attachPreviewDrag(container, s) {
  const holder = container.querySelector(".mnt");       // mountInto: container > .mnt(holder) > host(shadow)
  const shadowHost = holder && holder.firstElementChild;
  const root = shadowHost && shadowHost.shadowRoot;
  if (!root) return;
  const [w, h] = formatWH(state.format);
  // масштаб прев'ю беремо з holder scale() — детерміновано (mountInto його виставляє), без залежності від rect-timing
  const kOf = () => { const m = /scale\(([\d.]+)\)/.exec(holder.style.transform); return m ? parseFloat(m[1]) : 0.3; };

  const wrap = root.querySelector(".wrap");
  const headline = root.querySelector(".headline");
  if (wrap && s.type === "cover" && headline) {
    // обкладинка: 1 палець рухає блок (магніт до центру), 2 пальці — розмір/нахил (магніт до рівного)
    titleGesture(wrap, headline, holder, container, kOf, s, autosave);
  } else if (wrap) {
    const applyW = () => { wrap.style.transform = `translate(${s.textX || 0}px,${s.textY || 0}px)`; realignFrost(wrap); };
    dragXY(wrap, kOf, (dx, dy, k) => {
      s.textX = Math.round((s.textX || 0) + dx); s.textY = Math.round((s.textY || 0) + dy);
      applyW();
      if (snapCenter(wrap, holder, container, k, s)) applyW(); // магніт до центру + напрямні
    }, () => { hideGuides(container); autosave(); });
  }

  const photo = root.querySelector(".photo");
  if (photo && s.bgMode === "photo" && s.photo) {
    // 1 палець — рух кадру (в межах запасу), 2 пальці — щипок = масштаб, обертання = нахил
    let baseScale = 1, baseRot = 0;
    pinchDrag(photo, kOf, (dx, dy) => {
      const mx = 1080 * (1.16 * (s.scale || 1) - 1) / 2, my = h * (1.16 * (s.scale || 1) - 1) / 2;
      s.posX = Math.round(clamp((s.posX || 0) + dx, -mx, mx));
      s.posY = Math.round(clamp((s.posY || 0) + dy, -my, my));
      photo.style.transform = photoTransform(s);
    }, (mul, rotDelta, init) => {
      if (init) { baseScale = s.scale || 1; baseRot = s.rotate || 0; return; }
      s.scale = clamp(baseScale * mul, 1, 3);                                  // як повзунок «Масштаб» 1–3×
      s.rotate = clamp(Math.round(baseRot + rotDelta), -180, 180);
      // зсув лишаємо в межах нового запасу, щоб краї не оголились
      const mx = 1080 * (1.16 * s.scale - 1) / 2, my = h * (1.16 * s.scale - 1) / 2;
      s.posX = clamp(s.posX || 0, -mx, mx); s.posY = clamp(s.posY || 0, -my, my);
      photo.style.transform = photoTransform(s);
    }, autosave);
  }

  const cut = root.querySelector(".cutout");
  if (cut && s.cutout) {
    cut.style.pointerEvents = "auto";
    const cutT = () => `translate(${s.cutX || 0}px,${s.cutY || 0}px) scale(${s.cutScale || 1}) rotate(${s.cutRotate || 0}deg)`;
    let baseScale = 1, baseRot = 0;
    pinchDrag(cut, kOf, (dx, dy, k) => {  // зсув у 1080-просторі (translate) — палець рухає обома осями
      s.cutX = Math.round((s.cutX || 0) + dx);
      s.cutY = Math.round((s.cutY || 0) + dy);
      // магніт до центру (як у тексту): зсув 0 = об'єкт по центру картки; лінії-напрямні
      const T = 9, sc = centerOf(holder, container), { gv, gh } = ensureGuides(container);
      if (Math.abs((s.cutX || 0) * k) < T) { s.cutX = 0; gv.style.left = sc.x + "px"; gv.classList.add("on"); }
      else gv.classList.remove("on");
      if (Math.abs((s.cutY || 0) * k) < T) { s.cutY = 0; gh.style.top = sc.y + "px"; gh.classList.add("on"); }
      else gh.classList.remove("on");
      cut.style.transform = cutT();
    }, (mul, rotDelta, init) => {
      if (init) { baseScale = s.cutScale || 1; baseRot = s.cutRotate || 0; return; }
      s.cutScale = clamp(baseScale * mul, 0.3, 2);                             // як повзунок «Масштаб» 0.3–2×
      s.cutRotate = clamp(Math.round(baseRot + rotDelta), -180, 180);
      // магніт повороту до рівного 0° + хрест-напрямні (як у заголовка)
      const { gv, gh } = ensureGuides(container);
      if (Math.abs(s.cutRotate) < 3) {
        s.cutRotate = 0;
        const c = centerOf(cut, container);
        gv.style.left = c.x + "px"; gh.style.top = c.y + "px";
        gv.classList.add("on"); gh.classList.add("on");
      } else { gv.classList.remove("on"); gh.classList.remove("on"); }
      cut.style.transform = cutT();
    }, () => { hideGuides(container); autosave(); });
  }
}

// ── вкладки ─────────────────────────────────────────────────────────
function switchTab(go) {
  state.tab = go;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.go === go));
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("on", s.dataset.screen === go));
  $("#body").scrollTop = 0;
  setHeaderHidden(false); // на новій вкладці шапка завжди видима
  if (go === "slides") renderSlides();
  else if (go === "style") renderStyle();
  else if (go === "preview") renderPreview();
}

// ── експорт (базовий: PNG-файли; Web Share — наступний крок) ────────
function refreshExportCount() {
  $("#exportCnt").textContent = state.slides.length + " PNG";
  $("#exportBtn").disabled = !state.slides.length;
}
function downloadFiles(files) {
  files.forEach((f) => { const a = el("a"); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); });
}
async function exportAll() {
  const btn = $("#exportBtn"); btn.disabled = true; const label = btn.querySelector(".cnt").textContent;
  btn.firstChild.textContent = "Рендерю… ";
  try {
    const [w, h] = formatWH(state.format);
    const files = [];
    for (let i = 0; i < state.slides.length; i++) {
      const resolver = await store.resolveSlideAssets([state.slides[i]], "export");
      const html = buildSlideHTML(theme(), state.slides[i], state.format, resolver);
      const blob = await renderToBlob(html, w, h);
      files.push(new File([blob], String(i + 1).padStart(2, "0") + ".png", { type: "image/png" }));
    }
    // на телефоні — системний share-sheet (Зберегти в Фото / поділитись); інакше — завантаження
    if (navigator.canShare && navigator.canShare({ files })) {
      try { await navigator.share({ files, title: "Карусель" }); toast(`Готово: ${files.length} PNG`); }
      catch (e) { if (e.name !== "AbortError") { downloadFiles(files); toast(`Завантажено: ${files.length} PNG`); } }
    } else {
      downloadFiles(files); toast(`Завантажено: ${files.length} PNG`);
    }
  } catch (e) { toast("Помилка експорту: " + e.message); }
  btn.firstChild.textContent = "Експорт "; btn.querySelector(".cnt").textContent = label; btn.disabled = false;
}

// ── автозбереження / відновлення ────────────────────────────────────
function snapshot() { return { format: state.format, overrides: state.overrides, styleKey: state.styleKey, styleOrder: state.styleOrder, slides: state.slides }; }
let saveT;
function autosave() { clearTimeout(saveT); saveT = setTimeout(() => { recordUndo(); store.saveDraft(draftId, snapshot(), draftName).catch(() => {}); }, 600); }

// ── КРОК НАЗАД (undo, до 10 кроків) ──────────────────────────────────
// Точка undo фіксується при кожному автозбереженні (debounce 600ms). Стек тримає до 10 станів.
const undoStack = [];
let lastSnap = null; // JSON останнього зафіксованого стану
function undoBaseline() { lastSnap = JSON.stringify(snapshot()); refreshUndo(); } // після завантаження/undo
function recordUndo() {
  const cur = JSON.stringify(snapshot());
  if (lastSnap !== null && lastSnap !== cur) {
    undoStack.push(lastSnap);
    if (undoStack.length > 10) undoStack.shift(); // не глибше 10 кроків
  }
  lastSnap = cur;
  refreshUndo();
}
function refreshUndo() { const b = $("#undoBtn"); if (b) b.disabled = undoStack.length === 0; }
function doUndo() {
  if (!undoStack.length) return;
  const prev = undoStack.pop();
  applyDraftState(JSON.parse(prev));
  lastSnap = prev; // відновлений стан = базовий (не пишемо його назад у стек)
  renderSlides(); refreshExportCount();
  store.saveDraft(draftId, snapshot(), draftName).catch(() => {});
  refreshUndo();
  toast("↶ Крок назад");
}

// застосувати збережений стан чернетки до застосунку (переюз у restore/openDraft/import)
function applyDraftState(s) {
  state.format = s.format || "3:4";
  state.overrides = Object.assign({ kicker: "роздуми маркетолога", handle: "@hlyboki_sensy", colors: {} }, s.overrides || {});
  if (!state.overrides.colors) state.overrides.colors = {};
  state.styleKey = s.styleKey || "hlyboki";
  if (Array.isArray(s.styleOrder)) {
    const valid = new Set(STYLES.map((x) => x.key));
    const kept = s.styleOrder.filter((k) => valid.has(k));
    const missing = STYLES.map((x) => x.key).filter((k) => !kept.includes(k));
    state.styleOrder = [...kept, ...missing];
  } else state.styleOrder = STYLES.map((x) => x.key);
  state.accOpen = { styles: true, colors: true }; // обидві секції «Стилю» відкриті
  state.slides = (Array.isArray(s.slides) && s.slides.length) ? s.slides : [newSlide("cover"), newSlide("text")];
}

async function restore() {
  try {
    const last = await store.getMeta("lastDraftId");
    const d = await store.getDraft(last || draftId);
    if (d && d.state && d.state.slides && d.state.slides.length) {
      draftId = d.id; draftName = d.name || "Моя карусель";
      applyDraftState(d.state);
      return true;
    }
  } catch (e) {}
  return false;
}

// ── ПРОЄКТИ / ЧЕРНЕТКИ ─────────────────────────────────────────────
function closeSheet() { const o = $(".overlay"); if (o) o.remove(); }
const fmtDate = (t) => { try { return new Date(t).toLocaleDateString("uk-UA", { day: "numeric", month: "short" }); } catch (e) { return ""; } };

async function openProjects() {
  await store.saveDraft(draftId, snapshot(), draftName).catch(() => {}); // зафіксувати поточну
  const drafts = await store.listDrafts();
  closeSheet();
  const ov = el("div", "overlay");
  ov.innerHTML = `<div class="sheet">
    <div class="sheethead"><b>Проєкти й чернетки</b><button class="x" aria-label="Закрити">✕</button></div>
    <div class="draftlist"></div>
    <div class="sheetacts">
      <button class="obtn" id="pNew"><b>+</b> Нова карусель</button>
      <div class="btnrow">
        <button class="obtn ghost" id="pExport">↓ Зберегти у файл</button>
        <button class="obtn ghost" id="pImport">↑ Завантажити файл</button>
      </div>
    </div>
  </div>`;
  ov.addEventListener("click", (e) => { if (e.target === ov) closeSheet(); });
  ov.querySelector(".x").onclick = closeSheet;
  ov.querySelector("#pNew").onclick = newProject;
  ov.querySelector("#pExport").onclick = exportProject;
  ov.querySelector("#pImport").onclick = importProject;
  const list = ov.querySelector(".draftlist");
  if (!drafts.length) list.appendChild(el("div", "empty", "Ще немає збережених каруселей."));
  drafts.forEach((d) => {
    const cnt = (d.state && d.state.slides && d.state.slides.length) || 0;
    const it = el("div", "draftitem" + (d.id === draftId ? " on" : ""));
    it.innerHTML = `<div class="dinfo"><div class="dn">${esc(d.name || "Без назви")}</div>
      <div class="dd">${cnt} слайдів · ${fmtDate(d.updatedAt)}${d.id === draftId ? " · відкрита" : ""}</div></div>
      <button class="sbtn" data-a="ren">✎</button><button class="sbtn" data-a="del">✕</button>`;
    it.querySelector(".dinfo").onclick = () => openDraft(d.id);
    it.querySelector('[data-a="ren"]').onclick = (e) => { e.stopPropagation(); renameDraft(d.id, d.name || ""); };
    it.querySelector('[data-a="del"]').onclick = (e) => { e.stopPropagation(); delDraft(d.id); };
    list.appendChild(it);
  });
  document.body.appendChild(ov);
}

async function newProject(saveCurrent = true) {
  clearTimeout(saveT); // скасувати pending autosave старої чернетки (щоб не «воскресила» видалену)
  if (saveCurrent) await store.saveDraft(draftId, snapshot(), draftName).catch(() => {});
  draftId = "draft-" + Date.now(); draftName = "Нова карусель";
  applyDraftState({}); // дефолтний чистий стан (2 слайди-приклади)
  await store.saveDraft(draftId, snapshot(), draftName);
  await store.setMeta("lastDraftId", draftId);
  closeSheet(); switchTab("slides"); refreshExportCount(); toast("Нова карусель створена");
}

async function openDraft(id) {
  const d = await store.getDraft(id);
  if (!d || !d.state) return;
  draftId = d.id; draftName = d.name || "Моя карусель";
  applyDraftState(d.state);
  await store.setMeta("lastDraftId", id);
  closeSheet(); switchTab("slides"); refreshExportCount();
}

async function renameDraft(id, cur) {
  const name = prompt("Назва каруселі:", cur);
  if (name == null) return;
  const d = await store.getDraft(id); if (!d) return;
  const nn = name.trim() || cur || "Без назви";
  await store.saveDraft(id, d.state, nn);
  if (id === draftId) draftName = nn;
  openProjects();
}

async function delDraft(id) {
  if (!confirm("Видалити цю карусель? Дію не можна скасувати.")) return;
  clearTimeout(saveT); // скасувати pending autosave, щоб він не зберіг видалену назад
  await store.deleteDraft(id);
  if (id === draftId) {
    const rest = await store.listDrafts();
    if (rest.length) { await openDraft(rest[0].id); return; }
    else { await newProject(false); return; } // не зберігати видалену активну як «поточну»
  }
  openProjects();
}

// бекап у файл: JSON зі станом + вбудованими фото (base64), щоб не втратити при чистці сховища
async function exportProject() {
  try {
    const snap = snapshot();
    const refs = new Set();
    snap.slides.forEach((s) => { if (store.isAssetRef(s.photo)) refs.add(s.photo); if (store.isAssetRef(s.cutout)) refs.add(s.cutout); });
    const assets = {};
    for (const r of refs) { const u = await store.assetDataURL(r); if (u) assets[r] = u; }
    const blob = new Blob([JSON.stringify({ v: 1, name: draftName, state: snap, assets })], { type: "application/json" });
    const a = el("a"); a.href = URL.createObjectURL(blob);
    a.download = (draftName || "карусель").replace(/[^\wа-яіїєґ\- ]/gi, "") + ".carousel.json"; a.click();
    toast("Збережено у файл");
  } catch (e) { toast("Не вдалося зберегти"); }
}

function importProject() {
  const inp = el("input"); inp.type = "file"; inp.accept = ".json,application/json";
  inp.onchange = async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || !data.state || !Array.isArray(data.state.slides)) throw new Error("формат");
      const map = {};
      for (const [oldRef, dataURL] of Object.entries(data.assets || {})) {
        try { const blob = await (await fetch(dataURL)).blob(); map[oldRef] = await store.putAsset(blob, "photo"); } catch (e) {}
      }
      data.state.slides.forEach((sl) => { if (map[sl.photo]) sl.photo = map[sl.photo]; if (map[sl.cutout]) sl.cutout = map[sl.cutout]; });
      draftId = "draft-" + Date.now(); draftName = (data.name || "Імпортована карусель").slice(0, 60);
      applyDraftState(data.state);
      await store.saveDraft(draftId, snapshot(), draftName);
      await store.setMeta("lastDraftId", draftId);
      closeSheet(); switchTab("slides"); refreshExportCount(); toast("Проєкт завантажено");
    } catch (e) { toast("Не вдалося прочитати файл"); }
  };
  inp.click();
}

// шапка ховається при гортанні вниз і вертається при гортанні вгору
// (рядок grid .app плавно стискається → без ривка sticky-прев'ю)
function setHeaderHidden(hide) {
  document.querySelector(".app")?.classList.toggle("hdr-collapsed", hide);
}
function initHeaderAutohide() {
  const body = $("#body");
  if (!body) return;
  // виставити точну висоту шапки у CSS-змінну — щоб grid-collapse анімувався від реального значення
  const header = document.querySelector("header"), app = document.querySelector(".app");
  const setH = () => { if (header && app) app.style.setProperty("--hdr-h", header.offsetHeight + "px"); };
  setH();
  let last = 0;
  body.addEventListener("scroll", () => {
    const y = body.scrollTop;
    if (y > last + 8 && y > 70) setHeaderHidden(true);         // вниз
    else if (y < last - 8) setHeaderHidden(false);             // вгору
    last = y;
  }, { passive: true });
}

// ── старт ───────────────────────────────────────────────────────────
async function init() {
  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => switchTab(t.dataset.go)));
  $("#exportBtn").onclick = exportAll;
  $("#menuBtn").onclick = openProjects;
  $("#undoBtn").onclick = doUndo;
  initHeaderAutohide();

  const restored = await restore();
  if (!restored) state.slides = [newSlide("cover"), newSlide("text")];
  store.requestPersist();
  renderSlides(); refreshExportCount();
  undoBaseline(); // базова точка undo після завантаження стану
  switchTab("style"); // при відкритті сайту одразу «Стиль»
  if (restored) toast("↩ Відновлено попередню роботу");
}
init();
