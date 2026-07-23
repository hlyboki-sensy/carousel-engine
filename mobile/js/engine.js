// engine.js — клієнтський порт build.py (без сервера).
// Той самий рушій верстки: тема + поля слайда + шаблон → HTML-рядок.
// Використовується і прев'ю (iframe.srcdoc), і експортом (snapdom растеризує той самий HTML).
//
// Порт 1:1 з ../../build.py. Відмінності від десктопа:
//   • текстури-зображення тепер same-origin ("textures/…"), а не http://127.0.0.1:8090
//   • photoResolver отримує вже-готовий URL (data:/blob:), тож за замовчуванням identity
import { TEMPLATES } from "./templates.js";

// формати каруселі (ширина фіксована 1080)
export const FORMATS = {
  "3:4": [1080, 1440],
  "4:5": [1080, 1350],
  "1:1": [1080, 1080],
};
export const DEFAULT_FORMAT = "3:4";

// плейсхолдери {{...}} — латиниця (FONT_DISPLAY) + кирилиця (ЗАГ_1)
const PH = /\{\{([A-Z0-9_А-ЯІЇЄҐ]+)\}\}/g;

// текстури тла — самодостатні SVG/CSS (без зовнішніх файлів)
const _NOISE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' " +
  "width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' " +
  "baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E" +
  "%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

// реальні фото-текстури — same-origin статика (кешується service worker'ом)
const _TEX = "textures";
export const TEXTURES = {
  kraft:     { bg: `url('${_TEX}/paper-kraft.jpg')`, size: "cover", op: "1", blend: "normal", img: true, dark: false },
  cream:     { bg: `url('${_TEX}/cream.jpg')`,       size: "cover", op: "1", blend: "normal", img: true, dark: false },
  glaze:     { bg: `url('${_TEX}/glaze.jpg')`,       size: "cover", op: "1", blend: "normal", img: true, dark: false },
  coffee:    { bg: `url('${_TEX}/coffee.jpg')`,      size: "cover", op: "1", blend: "normal", img: true, dark: true },
  linen:     { bg: `url('${_TEX}/linen.jpg')`,       size: "cover", op: "1", blend: "normal", img: true, dark: false },
  chocolate: { bg: `url('${_TEX}/chocolate.jpg')`,   size: "cover", op: "1", blend: "normal", img: true, dark: true },
  matcha:    { bg: `url('${_TEX}/matcha.jpg')`,      size: "cover", op: "1", blend: "normal", img: true, dark: true },
  flower:    { bg: `url('${_TEX}/flower.jpg')`,      size: "cover", op: "1", blend: "normal", img: true, dark: false },
  leaf:      { bg: `url('${_TEX}/leaf.jpg')`,        size: "cover", op: "1", blend: "normal", img: true, dark: false },
  grain:    { bg: _NOISE, size: "140px", op: "0.5", blend: "overlay" },
  dots:     { bg: "radial-gradient(rgba(255,255,255,.9) 1.4px, transparent 1.6px)",
              size: "24px 24px", op: "0.5", blend: "overlay" },
  grid:     { bg: "linear-gradient(rgba(255,255,255,.7) 1px,transparent 1px)," +
                  "linear-gradient(90deg,rgba(255,255,255,.7) 1px,transparent 1px)",
              size: "46px 46px", op: "0.45", blend: "overlay" },
  diagonal: { bg: "repeating-linear-gradient(45deg,rgba(255,255,255,.6) 0 1px,transparent 1px 13px)",
              size: "auto", op: "0.4", blend: "overlay" },
  glow:     { bg: "radial-gradient(circle at 50% 30%,rgba(255,255,255,.95),transparent 62%)",
              size: "cover", op: "0.28", blend: "overlay" },
};

const SERIF_FALLBACK = '"Didot","Playfair Display","Bodoni 72","Hoefler Text",Georgia,serif';
const SANS_FALLBACK = '"Helvetica Neue",Arial,sans-serif';
const FONT_EXT = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };

export function formatWH(fmt) {
  return FORMATS[fmt || DEFAULT_FORMAT] || FORMATS[DEFAULT_FORMAT];
}

// формат числа як у Python f"{x:g}" (прибирає хвостові нулі): 1.0→"1", 0.5→"0.5"
function g(x) { return String(+x); }

function num(v, d) {
  if (v === "" || v == null) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function isFontFile(url) {
  return FONT_EXT.hasOwnProperty(url.split("?")[0].toLowerCase().split(".").pop());
}

// html.escape(v, quote=False): & < > (лапки не чіпаємо). Порядок: & першим.
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const ACCENT_RE = /\*([^*]+)\*/g;
// слово(а) в *зірочках* → акцентний span
function accentMarkup(s) {
  return s.replace(ACCENT_RE, '<span class="ac">$1</span>');
}

// українська типографіка: 1-2-літерні слова НЕ висять у кінці рядка → NBSP
const SHORT_RE = /(^|[\s ])([A-Za-zА-ЯІЇЄҐа-яіїєґ0-9']{1,2})[ \t]+(?=\S)/g;
function glueShortWords(s) {
  let prev = null;
  while (prev !== s) {
    prev = s;
    s = s.replace(SHORT_RE, (m, p1, p2) => p1 + p2 + " ");
  }
  return s;
}

// чи темний колір (для авто-контрасту тексту). #rgb / #rrggbb
function isDark(hexcol) {
  try {
    let c = String(hexcol).replace(/^#/, "");
    if (c.length === 3) c = c.split("").map((ch) => ch + ch).join("");
    const r = parseInt(c.slice(0, 2), 16), gg = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    if ([r, gg, b].some(Number.isNaN)) return false;
    return (0.299 * r + 0.587 * gg + 0.114 * b) < 140;
  } catch (e) { return false; }
}

// <head>-розмітка підключення шрифтів теми (links → <link>, faces → @font-face)
function fontHead(theme) {
  const f = theme.fonts || {};
  const parts = [], seen = new Set();
  for (const url of f.links || []) {
    if (url && !seen.has(url)) { seen.add(url); parts.push(`<link rel="stylesheet" href="${url}">`); }
  }
  const faces = [];
  for (const face of f.faces || []) {
    const url = face.url, fam = face.family || "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const ext = url.split("?")[0].toLowerCase().split(".").pop();
    faces.push(`@font-face{font-family:'${fam}';src:url('${url}') ` +
      `format('${FONT_EXT[ext] || "woff2"}');font-display:swap;}`);
  }
  if (faces.length) parts.push("<style>" + faces.join("") + "</style>");
  return parts.join("\n");
}

// застосування налаштувань панелі поверх теми (accent/kicker/handle/colors/fonts)
export function applyOverridesToTheme(theme, ov) {
  theme = JSON.parse(JSON.stringify(theme)); // глибока копія
  ov = ov || {};
  const cols = ov.colors;
  if (cols) {
    const tc = theme.colors || (theme.colors = {});
    for (const k in cols) if (cols[k]) tc[k] = cols[k];
  }
  if (ov.accent) (theme.colors || (theme.colors = {})).accent = ov.accent;
  if (ov.kicker) theme.kicker = ov.kicker;
  if (ov.handle) theme.handle = ov.handle;
  const fonts = ov.fonts;
  if (fonts) {
    const f = theme.fonts || (theme.fonts = {});
    const links = (f.links || []).slice();
    const faces = (f.faces || []).slice();
    for (const [slot, fallback] of [["display", SERIF_FALLBACK], ["body", SANS_FALLBACK], ["accent", SERIF_FALLBACK]]) {
      const spec = fonts[slot] || {};
      const name = spec.name, url = spec.url;
      if (name) f[slot] = `"${name}",${fallback}`;
      if (url) { if (isFontFile(url)) faces.push({ family: name || "", url }); else links.push(url); }
      const w = spec.weight;
      if (w) f[slot + "Weight"] = String(w);
      const it = spec.italic;
      if (it != null) f[slot + "Style"] = it ? "italic" : "normal";
    }
    const acol = (fonts.accent || {}).color;
    if (acol) theme.accentTextColor = acol;
    f.links = links; f.faces = faces;
  }
  return theme;
}

export function themeMap(theme) {
  const f = theme.fonts, c = theme.colors;
  return {
    FONT_DISPLAY: f.display,
    FONT_BODY: f.body,
    FONT_LINKS: fontHead(theme),
    DISP_WEIGHT: String(f.displayWeight ?? "400"),
    DISP_STYLE: f.displayStyle ?? "italic",
    BODY_WEIGHT: String(f.bodyWeight ?? "300"),
    BODY_STYLE: f.bodyStyle ?? "normal",
    ACCENT_FONT: f.accent ?? f.display,
    ACCENT_COLOR: theme.accentTextColor || c.accent,
    ACCENT_WEIGHT: String(f.accentWeight ?? "inherit"),
    ACCENT_STYLE: f.accentStyle ?? "inherit",
    ACCENT: c.accent,
    PHOTO_BG: c.photoBg,
    LIGHT_BG: c.lightBg,
    COVER_BG: c.coverBg,
    TEXT_ON_DARK: c.textOnDark,
    TEXT_ON_LIGHT: c.textOnLight,
    BODY_ON_LIGHT: c.bodyOnLight,
    BODY_ON_DARK: c.bodyOnDark ?? c.textOnDark,
    MUTED_ON_LIGHT: c.mutedOnLight ?? "rgba(60,48,38,0.5)",
    MUTED_ON_DARK: c.mutedOnDark ?? "rgba(244,239,231,0.82)",
    // escape ПЕРЕД вставкою в HTML: кікер/хендл — вільний ввід користувача (self-XSS guard,
    // і захист наперед, якщо колись зʼявиться імпорт/поділитися чужим проєктом)
    KICKER: escapeHtml(theme.kicker ?? ""),
    HANDLE: escapeHtml(theme.handle ?? ""),
  };
}

const DIRECT_FIELDS = new Set([
  "type", "photo", "cutout", "bgMode", "bgColor",
  "posX", "posY", "scale", "rotate", "cutX", "cutY", "cutScale",
  "textX", "textY", "textAlign", "plate", "plateOpacity", "texture", "_open",
  "dim", "cutRotate", "textureOp", "showKicker", "showRule", "showHandle",
  "layout", "titleX", "titleY", "titleScale", "titleRotate", "blockW",
]);

// пресети композиції обкладинки — лише допустимі значення (клас на .card)
const LAYOUTS = new Set(["classic", "rvana", "script", "minimal"]);

// Єдине джерело істини для одного слайда: тема + поля → повний набір плейсхолдерів.
export function slideMap(base, slide, photoResolver, fmt = DEFAULT_FORMAT) {
  const t = slide.type || "text";
  const [w, h] = formatWH(fmt);
  const m = Object.assign({}, base);

  for (const k in slide) {
    if (DIRECT_FIELDS.has(k)) continue;
    const v = slide[k];
    // escape ПЕРЕД розміткою (self-XSS guard), потім glue, потім accent
    m[k] = typeof v === "string" ? accentMarkup(glueShortWords(escapeHtml(v))) : v;
  }

  m.W = String(w); m.H = String(h);
  m.TEXT_X = g(num(slide.textX, 0));
  m.TEXT_Y = g(num(slide.textY, 0));
  const align = slide.textAlign || "center";
  m.TEXT_ALIGN = ["left", "center", "right", "justify"].includes(align) ? align : "center";
  // justify → розкидати КОЖЕН рядок (включно останній) від лівого поля до правого: text-align-last
  m.TEXT_ALIGN_LAST = align === "justify" ? "justify" : "auto";

  // композиція обкладинки (пресет розкладки заголовка) + пальцеве докручування заголовка
  const layout = LAYOUTS.has(slide.layout) ? slide.layout : "classic";
  m.LAYOUT = layout;
  m.TITLE_X = g(num(slide.titleX, 0));
  m.TITLE_Y = g(num(slide.titleY, 0));
  m.TITLE_SCALE = g(num(slide.titleScale, 1));
  m.TITLE_ROTATE = g(num(slide.titleRotate, 0));
  // докрутка (масштаб/поворот) застосовується до ВСЬОГО текст-блоку .wrap разом із підзаголовком,
  // об'єднана з позицією блоку в один transform; origin — ліво для rvana/minimal, центр для решти
  m.WRAP_TRANSFORM = `translate(${m.TEXT_X}px,${m.TEXT_Y}px) scale(${m.TITLE_SCALE}) rotate(${m.TITLE_ROTATE}deg)`;
  m.WRAP_ORIGIN = (layout === "rvana" || layout === "minimal") ? "left center" : "center";
  // ширина текст-блоку (повзунок): % від картки → симетричні поля з обох боків.
  // ширший блок = менші поля = довге слово вміщується в один рядок («К» не переноситься).
  const blockW = num(slide.blockW, 87); // 87% ≈ поля 70px (як було)
  m.WRAP_PAD = g(Math.max(16, Math.round(1080 * (1 - blockW / 100) / 2)));

  // ── тло ──
  const bgMode = slide.bgMode || (t === "cover" || t === "photo" ? "photo" : "color");
  const defaultCard = {
    cover: base.COVER_BG || "#cfc9c2",
    text: base.LIGHT_BG || "#d7d0c5",
    photo: base.PHOTO_BG || "#11151a",
    blank: base.LIGHT_BG || "#d7d0c5",
  }[t] || "#ffffff";
  m.CARD_BG = slide.bgColor || defaultCard;

  const photo = slide.photo || "";
  const showPhoto = !!photo && bgMode === "photo";
  m.PHOTO = showPhoto ? photoResolver(photo) : "";
  m.PHOTO_DISPLAY = showPhoto ? "block" : "none";
  m.GRAD_DISPLAY = showPhoto ? "block" : "none";
  m.POS_X = g(num(slide.posX, 0));
  m.POS_Y = g(num(slide.posY, 0));
  m.SCALE = g(num(slide.scale, 1));
  m.ROTATE = g(num(slide.rotate, 0));
  m.BG_BLUR = g(num(slide.bgBlur, 0)); // розмиття всього фону (px у 1080-просторі), через canvas у render.js

  // авто-контраст: фото/темне тло → світлий текст; світле → темний.
  const tex = TEXTURES[slide.texture || ""];
  const texOp = tex ? num(slide.textureOp, parseFloat(tex.op)) : 0.0;
  let onDark;
  // авто-контраст: якщо фото не показується — дивимось на яскравість тла картки
  // (байдуже режим photo/color), інакше текст «тоне» на темній палітрі-обкладинці.
  if (tex && tex.img && texOp >= 0.6) onDark = !!tex.dark;
  else onDark = showPhoto || isDark(m.CARD_BG);
  m.INK = onDark ? base.TEXT_ON_DARK : base.TEXT_ON_LIGHT;
  m.BODY_INK = onDark ? (base.BODY_ON_DARK ?? base.TEXT_ON_DARK) : base.BODY_ON_LIGHT;
  m.META_INK = onDark ? (base.MUTED_ON_DARK ?? "rgba(255,250,248,0.9)") : (base.MUTED_ON_LIGHT ?? "rgba(60,48,38,0.5)");

  // ── плашка під текстом ──
  const plate = slide.plate || "none";
  const op = num(slide.plateOpacity, 0.5);
  if (plate === "dark") {
    m.PLATE_BG = `rgba(12,10,9,${g(op)})`; m.PLATE_BLUR = "none";
    m.INK = base.TEXT_ON_DARK; m.BODY_INK = base.TEXT_ON_DARK;
    m.META_INK = base.MUTED_ON_DARK ?? "rgba(255,250,248,0.9)";
  } else if (plate === "light") {
    m.PLATE_BG = `rgba(247,244,239,${g(op)})`; m.PLATE_BLUR = "none";
    m.INK = base.TEXT_ON_LIGHT; m.BODY_INK = base.BODY_ON_LIGHT;
    m.META_INK = base.MUTED_ON_LIGHT ?? "rgba(60,48,38,0.5)";
  } else if (plate === "blur") {
    // матове скло: backdrop-filter НЕ растеризується в iOS Safari (foreignObject),
    // тому blur робимо canvas-ом у render.js (applyFrost). Тут лишаємо лише напівпрозоре
    // тонування + маркер FROST; PLATE_BLUR=none (жодного «живого» CSS-фільтра в DOM).
    const b = op - 0.18 > 0.1 ? op - 0.18 : 0.1;
    m.PLATE_BG = `rgba(16,14,13,${g(b)})`; m.PLATE_BLUR = "none"; m.PLATE_FROST = "1";
    m.INK = base.TEXT_ON_DARK; m.BODY_INK = base.TEXT_ON_DARK;
    m.META_INK = base.MUTED_ON_DARK ?? "rgba(255,250,248,0.9)";
  } else {
    m.PLATE_BG = "transparent"; m.PLATE_BLUR = "none";
  }
  if (!("PLATE_FROST" in m)) m.PLATE_FROST = "";
  m.PLATE_PAD = plate === "none" ? "0" : "46px 54px";
  // Плашка обгортає текст ЩІЛЬНО (відступ праворуч = ліворуч), а не тягнеться на всю ширину картки.
  // width:max-content = за найдовшим рядком; позиція за вирівнюванням (центр → margin auto).
  // justify лишається на повну ширину (текст сам розкиданий між полями).
  const padN = Number(m.WRAP_PAD);
  const maxw = 1080 - 2 * padN;
  if (plate === "none" || m.TEXT_ALIGN === "justify") m.WRAP_POS = `left:${padN}px; right:${padN}px;`;
  else if (m.TEXT_ALIGN === "right") m.WRAP_POS = `left:auto; right:${padN}px; width:max-content; max-width:${maxw}px;`;
  else if (m.TEXT_ALIGN === "left") m.WRAP_POS = `left:${padN}px; right:auto; width:max-content; max-width:${maxw}px;`;
  else m.WRAP_POS = `left:0; right:0; margin-left:auto; margin-right:auto; width:max-content; max-width:${maxw}px;`;

  // ── вирізаний об'єкт (верхній шар) ──
  const cut = slide.cutout || "";
  m.CUTOUT = cut ? photoResolver(cut) : "";
  m.CUTOUT_DISPLAY = cut ? "block" : "none";
  m.CUT_X = g(num(slide.cutX, 0));   // зсув об'єкта в px (1080-простір), 0 = центр
  m.CUT_Y = g(num(slide.cutY, 0));
  m.CUT_SCALE = g(num(slide.cutScale, 1));
  m.CUT_ROTATE = g(num(slide.cutRotate, 0));

  // ── затемнення ──
  const dim = num(slide.dim, 0);
  m.DIM = g(dim);
  m.DIM_DISPLAY = dim > 0 ? "block" : "none";

  // ── текстура ──
  if (tex) {
    m.TEXTURE = tex.bg; m.TEXTURE_SIZE = tex.size;
    m.TEXTURE_OP = g(texOp); m.TEXTURE_DISPLAY = "block";
    m.TEXTURE_BLEND = tex.blend || "overlay";
  } else {
    m.TEXTURE = "none"; m.TEXTURE_SIZE = "auto";
    m.TEXTURE_OP = "0"; m.TEXTURE_DISPLAY = "none"; m.TEXTURE_BLEND = "overlay";
  }

  // ── видимість службових написів ──
  const defaultShow = t !== "blank";
  const showKicker = (slide.showKicker ?? defaultShow) && !!m.KICKER;
  const showHandle = (slide.showHandle ?? defaultShow) && !!m.HANDLE;
  const showRule = slide.showRule ?? defaultShow;
  m.KICKER_DISPLAY = showKicker ? "block" : "none";
  m.HANDLE_DISPLAY = showHandle ? "block" : "none";
  m.RULE_DISPLAY = showRule ? "inline-block" : "none";

  return m;
}

// ── КОМПОЗИЦІЇ обкладинки (пресети розкладки заголовка) ─────────────────────
// Вставляється в <style> обкладинки під час збірки (клас {{LAYOUT}} на .card).
// Живе тут, а не у згенерованому templates.js, щоб регенерація шаблонів не стирала.
// Специфічність .card.rvana .l1 (0,3,1) перекриває базове .headline .l1 (0,2,0).
// Класика = базовий CSS (клас "classic" без правил). Розміри — у 1080-просторі.
const COMPOSITION_CSS = `
  /* докрутка (масштаб/поворот пальцем) тепер на .wrap разом із підзаголовком — див. WRAP_TRANSFORM у шаблоні */

  /* ліво/право/ширину плашки задає базовий {{WRAP_POS}} (симетричні відступи + fit-content);
     тут композиції керують лише вертикаллю (top/bottom нижче) */
  /* слово НЕ розбивається посеред (щоб не було «ЗАГОЛОВО»+«К»); переноситься лише між словами */
  .card.rvana .headline .l1, .card.rvana .headline .l2,
  .card.script .headline .l1, .card.script .headline .l2,
  .card.minimal .headline .l1, .card.minimal .headline .l2{ max-width:100%; text-wrap:balance; overflow-wrap:normal; word-break:keep-all; }

  /* Рвана — масивний текстовий шрифт стилю + заголовковий-курсив акцентом, ліворуч.
     Шрифти беруться зі СТИЛЮ (--font-body/--font-display) → зміна стилю змінює композицію. */
  .card.rvana .kicker{ left:70px; right:auto; text-align:left; }
  .card.rvana .wrap{ bottom:180px; }
  .card.rvana .headline{ line-height:0.9; }
  .card.rvana .headline .l1{ font-family:var(--font-body); font-weight:900; font-style:normal; font-size:138px; letter-spacing:-0.01em; text-transform:uppercase; }
  .card.rvana .headline .l2{ font-family:var(--font-display); font-style:italic; font-weight:var(--disp-weight); font-size:116px; line-height:0.95; letter-spacing:0; color:var(--accent); margin-top:2px; }
  .card.rvana .rule{ display:none; }
  .card.rvana .sub{ margin-top:32px; }
  .card.rvana .handle{ left:70px; right:auto; text-align:left; }

  /* Скрипт-акцент — заголовковий шрифт стилю акцентом (рукописний для скрипт-стилів) + текстовий-гротеск, по центру */
  .card.script .wrap{ bottom:auto; top:440px; }
  .card.script .headline{ line-height:0.98; }
  .card.script .headline .l1{ font-family:var(--font-display); font-weight:var(--disp-weight); font-style:var(--disp-style); font-size:150px; line-height:0.86; letter-spacing:0; color:var(--accent); }
  .card.script .headline .l2{ font-family:var(--font-body); font-weight:900; font-style:normal; font-size:74px; line-height:1; letter-spacing:0.02em; text-transform:uppercase; margin-top:12px; }
  .card.script .rule{ display:none; }
  .card.script .sub{ margin-top:40px; }

  /* Мінімал — один величезний блок ЗАГОЛОВКОВИМ шрифтом стилю (щоб виразно реагував на стиль),
     акцентне слово золоте, ліворуч */
  .card.minimal .kicker{ left:70px; right:auto; text-align:left; }
  .card.minimal .wrap{ bottom:auto; top:420px; }
  .card.minimal .headline{ line-height:0.92; }
  .card.minimal .headline .l1, .card.minimal .headline .l2{ font-family:var(--font-display); font-weight:var(--disp-weight); font-style:var(--disp-style); font-size:116px; letter-spacing:-0.02em; }
  .card.minimal .headline .l2{ margin-top:2px; }
  .card.minimal .rule{ display:none; }
  .card.minimal .sub{ margin-top:48px; }
  .card.minimal .handle{ left:70px; right:auto; text-align:left; }

  /* акцентне слово (*зірочки*) зберігає композиційний шрифт, лише колір золотий */
  .card.rvana .headline .ac, .card.script .headline .ac, .card.minimal .headline .ac{ font-family:inherit; font-weight:inherit; font-style:inherit; }
`;

// невідомий плейсхолдер лишаємо як є (одразу видно, що не заповнили)
export function fill(tpl, mapping) {
  return tpl.replace(PH, (whole, key) => (key in mapping ? String(mapping[key]) : whole));
}

// Головний вхід: тема + слайд + формат → готовий HTML-рядок (для srcdoc / snapdom).
// photoResolver за замовчуванням identity (URL уже data:/blob: з IndexedDB).
export function buildSlideHTML(theme, slide, fmt, photoResolver = (p) => p) {
  const base = themeMap(theme);
  const t = slide.type || "text";
  const tplKey = t === "blank" ? "text" : t; // «пустий» рендериться шаблоном text
  let tpl = TEMPLATES[tplKey];
  if (!tpl) throw new Error(`невідомий type '${t}' (cover|text|photo|blank)`);
  // обкладинка: додаємо клас композиції на .card + вбудовуємо композиційний CSS
  if (t === "cover") {
    tpl = tpl
      .replace('<div class="card">', '<div class="card {{LAYOUT}}">')
      .replace("</style>", COMPOSITION_CSS + "</style>");
  }
  const m = slideMap(base, slide, photoResolver, fmt);
  return fill(tpl, m);
}
