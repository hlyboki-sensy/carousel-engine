// render.js — растеризація слайда в PNG у браузері (заміна headless Chrome / render.sh).
//
// Стратегія (обґрунтування в плані):
//   • Рендеримо в ГОЛОВНОМУ документі через Shadow DOM — стилі шаблону (* , html,body,
//     .card…) ізольовані в shadow і не течуть на сторінку; :root → :host, щоб CSS-змінні
//     працювали у shadow.
//   • snapdom серіалізує DOM у SVG foreignObject → canvas: браузер малює СПРАВЖНІЙ CSS
//     (Didot italic, тіні, mix-blend, backdrop-filter, object-fit кроп, cutout-шар) →
//     експорт 1:1 з прев'ю.
//   • Шрифти — системні Apple (Didot/Helvetica Neue), тож нічого не фетчиться → canvas
//     не-tainted → toBlob() без SecurityError.
//   • Вивід рівно W×H незалежно від екрана: контейнер натурального розміру, snapdom scale:1.

const snapdom = () => window.snapdom;

// ── ЯКІСНЕ ГЛАДКЕ РОЗМИТТЯ ───────────────────────────────────────────────────
// Спільний двигун для applyBgBlur і applyFrost. Раніше обидві функції розмивали
// «дешевим трюком»: агресивний downscale у дрібний canvas (÷16 → ~67px) + bilinear
// upscale назад. Bilinear при розтягу ×16 дає видиму СІТКУ БЛОКІВ (між семплами
// інтерполяція лише лінійна → на великому коефіцієнті проступають ромби ~16px), а
// ctx.filter:blur, що мав це згладити, у foreignObject iOS Safari ненадійний. Плюс
// jpeg-стиснення додавало свій 8×8 DCT-блокінг. Разом = грубі квадрати у PNG.
//
// Рішення: СПРАВЖНІЙ гаус — 3 проходи box-blur по ImageData (getImageData/putImageData).
// 3× box ≈ гаусів профіль (центральна гранична теорема), працює ІДЕНТИЧНО скрізь
// (чиста арифметика по пікселях, не залежить від ctx.filter чи GPU iOS), гладкий без
// плиток навіть при великому радіусі. Працюємо на ПОМІРНО зменшеному canvas (макс
// сторона ~520px) заради швидкості — але БЕЗ екстремального ÷16, саме він давав блоки;
// далі гладкий upscale уже РОЗМИТОГО зображення (розмите масштабується без артефактів).

const BLUR_MAX_SIDE = 520; // робоча роздільність блюру: досить деталей, швидко на iPhone

// Радіуси 3 box-проходів, що апроксимують гаус зі стандартним відхиленням sigma
// (Wojciech Jarosz, «Fast Image Convolution»). Повертає 3 цілих радіуси.
function boxesForGauss(sigma, n = 3) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1); // ідеальна ширина вікна
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;    // до непарного (симетричне вікно)
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes = [];
  for (let i = 0; i < n; i++) sizes.push(((i < m ? wl : wu) - 1) / 2); // радіус = (вікно−1)/2
  return sizes;
}

// Один box-blur по горизонталі+вертикалі (розділюваний) через рухоме вікно —
// O(пікселі), не залежить від радіуса. Працює на плоскому Uint8 RGBA-масиві.
function boxBlur(src, dst, w, h, r) {
  if (r < 1) { dst.set(src); return; }
  boxBlurH(src, dst, w, h, r);
  boxBlurV(dst, src, w, h, r); // результат осідає назад у src
  dst.set(src);
}
function boxBlurH(src, dst, w, h, r) {
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let c = 0; c < 4; c++) {
      let acc = 0;
      // ініціалізуємо вікно з дзеркальним краєм (clamp), щоб краї не темніли
      for (let i = -r; i <= r; i++) {
        const xi = i < 0 ? 0 : i >= w ? w - 1 : i;
        acc += src[row + xi * 4 + c];
      }
      for (let x = 0; x < w; x++) {
        dst[row + x * 4 + c] = acc * norm;
        const xOut = x - r, xIn = x + r + 1;
        const io = xOut < 0 ? 0 : xOut;           // піксель, що виходить (clamp зліва)
        const ii = xIn >= w ? w - 1 : xIn;         // піксель, що входить (clamp справа)
        acc += src[row + ii * 4 + c] - src[row + io * 4 + c];
      }
    }
  }
}
function boxBlurV(src, dst, w, h, r) {
  const norm = 1 / (2 * r + 1);
  const stride = w * 4;
  for (let x = 0; x < w; x++) {
    const col = x * 4;
    for (let c = 0; c < 4; c++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        const yi = i < 0 ? 0 : i >= h ? h - 1 : i;
        acc += src[col + yi * stride + c];
      }
      for (let y = 0; y < h; y++) {
        dst[col + y * stride + c] = acc * norm;
        const yOut = y - r, yIn = y + r + 1;
        const io = yOut < 0 ? 0 : yOut;
        const ii = yIn >= h ? h - 1 : yIn;
        acc += src[col + ii * stride + c] - src[col + io * stride + c];
      }
    }
  }
}

// Гаусів blur канви/зображення радіусом radius (у пікселях ПОВНОГО розміру src).
// Повертає НОВУ canvas того ж розміру, що src, із гладко розмитим вмістом.
// Всередині: помірний downscale → 3× box-blur по ImageData → гладкий upscale.
function gaussBlurCanvas(srcCanvasOrImg, srcW, srcH, radius) {
  // 1) робоча (зменшена) роздільність: не дрібніша за BLUR_MAX_SIDE по більшій стороні
  const maxSide = Math.max(srcW, srcH);
  const k = maxSide > BLUR_MAX_SIDE ? BLUR_MAX_SIDE / maxSide : 1; // коеф. зменшення (≤1)
  const ww = Math.max(2, Math.round(srcW * k));
  const wh = Math.max(2, Math.round(srcH * k));

  const work = document.createElement("canvas"); work.width = ww; work.height = wh;
  const wctx = work.getContext("2d", { willReadFrequently: true });
  wctx.imageSmoothingEnabled = true; wctx.imageSmoothingQuality = "high";
  wctx.drawImage(srcCanvasOrImg, 0, 0, ww, wh);

  // 2) радіус масштабуємо в робочу роздільність; sigma ≈ radius для м'якого гауса
  const rWork = Math.max(0.5, radius * k);
  if (rWork >= 1) {
    const img = wctx.getImageData(0, 0, ww, wh);
    const a = img.data;
    const b = new Uint8ClampedArray(a.length);
    const boxes = boxesForGauss(rWork, 3); // 3 проходи ≈ справжній гаус
    for (const r of boxes) boxBlur(a, b, ww, wh, Math.round(r));
    wctx.putImageData(img, 0, 0);
  }

  // 3) гладкий upscale уже РОЗМИТОГО (розмите тягнеться без плиток) до повного розміру
  const out = document.createElement("canvas"); out.width = srcW; out.height = srcH;
  const octx = out.getContext("2d");
  octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = "high";
  octx.drawImage(work, 0, 0, srcW, srcH);
  return out;
}
// ─────────────────────────────────────────────────────────────────────────────

// Витягти CSS і тіло зі згенерованого повного HTML-документа слайда.
function parseSlide(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let css = Array.from(doc.querySelectorAll("style")).map((s) => s.textContent).join("\n");
  css = css.replace(/:root/g, ":host"); // shadow-скоуп CSS-змінних
  return { css, body: doc.body.innerHTML };
}

// Розмити ВЕСЬ фон (окремий ефект від плашки-скла). CSS filter:blur на .photo не
// растеризується в iOS foreignObject → розмиваємо фото canvas-ом і підміняємо src готовим
// зображенням (кроп/зум .photo лишається — transform застосується до розмитого фото).
async function applyBgBlur(root) {
  const photo = root.querySelector(".photo[data-bgblur]");
  if (!photo) return;
  const blur = num(photo.dataset.bgblur, 0);
  const src = photo.getAttribute("src");
  if (!blur || !src) return;
  if (!photo.complete || !photo.naturalWidth) {
    await new Promise((res) => {
      photo.addEventListener("load", res, { once: true });
      photo.addEventListener("error", res, { once: true });
      setTimeout(res, 1500);
    });
  }
  const iw = photo.naturalWidth, ih = photo.naturalHeight;
  if (!iw || !ih) return;
  // радіус blur масштабуємо з 1080-простору у натуральний розмір фото
  const bpx = blur * (iw / 1080);
  // ГЛАДКЕ розмиття: 3× box-blur по ImageData (див. gaussBlurCanvas) — справжній гаус,
  // ідентичний у прев'ю і PNG, без квадратиків навіть при сильному радіусі. Замінив
  // колишній ÷2 downscale + поетапний bilinear-upscale (саме він давав блокінг).
  const c = gaussBlurCanvas(photo, iw, ih, bpx);
  // ставимо готове (розмите) зображення; дочекатися нового src через load-подію з таймаутом.
  // PNG (не jpeg): jpeg-стиснення додавало власний 8×8 DCT-блокінг поверх гладкого блюру.
  await new Promise((res) => {
    photo.onload = photo.onerror = res;
    photo.src = c.toDataURL("image/png");
    setTimeout(res, 2000);
  });
}

// Матове скло (frosted) для PNG/iOS: backdrop-filter не растеризується в iOS foreignObject,
// тож розмиваємо фон САМИМ canvas-ом (2D ctx.filter — растеризується в Safari), готове
// зображення підкладаємо під напівпрозоре тонування плашки. Точно вирівняно з фоном картки.
async function applyFrost(root, w, h) {
  const wraps = Array.from(root.querySelectorAll('.wrap[data-frost="1"]'));
  if (!wraps.length) return;
  // Джерело фону під плашкою: ФОТО (bgMode photo) АБО ФОТО-ТЕКСТУРА (matcha/coffee/kraft…).
  // Раніше frost працював лише з .photo → на текстурному тлі матове скло не застосовувалось.
  const photoEl = root.querySelector(".photo"); // ОРИГІНАЛ у DOM — джерело геометрії (data-pos/scale)
  let src = photoEl && photoEl.getAttribute("src");
  let fromTexture = false;
  if (!src) {
    const tex = root.querySelector(".texture");
    const bi = tex && getComputedStyle(tex).backgroundImage;
    const mm = bi && bi.match(/url\(["']?([^"')]+)["']?\)/);
    if (mm && !/svg|gradient/i.test(bi)) { src = mm[1]; fromTexture = true; } // лише фото-текстури, не CSS-візерунки
  }
  if (!src) return; // суцільний колір без зображення — лишаємо PLATE_BG тонування (нема деталей для розмиття)

  // ГЕОМЕТРІЯ береться з ОРИГІНАЛЬНОГО .photo (dataset), а не з елемента для малювання —
  // інакше на новому Image dataset порожній → масштаб 0/1 → розмите фото іншого масштабу за основне.
  const posX = fromTexture ? 0 : num(photoEl && photoEl.dataset.posx);
  const posY = fromTexture ? 0 : num(photoEl && photoEl.dataset.posy);
  const scale = fromTexture ? 1 : num(photoEl && photoEl.dataset.scale, 1);
  const rot = fromTexture ? 0 : num(photoEl && photoEl.dataset.rotate) * Math.PI / 180;

  // елемент для МАЛЮВАННЯ: фото вже в DOM; текстуру (чи незавантажене фото) довантажуємо окремим Image
  let img = photoEl;
  if (fromTexture || !photoEl || !photoEl.complete || !photoEl.naturalWidth) {
    img = new Image();
    await new Promise((res) => { img.onload = img.onerror = res; img.src = src; setTimeout(res, 1800); });
  }
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) return;

  // ГЕОМЕТРІЯ 1:1 з CSS .photo: box 116% (fromTexture=100%), object-fit:cover всередині box,
  // потім transform: translate(pos) scale() rotate() з origin у центрі картки. Малюємо ТУ Ж
  // послідовність афінних кроків, щоб піксель розмитого фону лягав точно під піксель основного.
  const box = fromTexture ? 1.0 : 1.16;
  const bw = box * w, bh = box * h;
  const cover = Math.max(bw / iw, bh / ih); // = object-fit:cover у 116%-боксі
  const dw = iw * cover, dh = ih * cover;

  // 1) СПЕРШУ малюємо фон різко у canvas ПОВНОГО розміру w×h з тією ж геометрією, що CSS —
  // піксель фону лягає точно під піксель основного фото. Ніякого downscale тут: агресивний
  // ÷16 + bilinear-upscale саме й давав сітку квадратів. Розмиття накладаємо окремим кроком.
  const base = document.createElement("canvas"); base.width = w; base.height = h;
  const bctx = base.getContext("2d");
  bctx.fillStyle = "#0c0a09"; bctx.fillRect(0, 0, w, h); // база, щоб краї blur не були прозорі
  bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = "high";
  bctx.save();
  // ПОРЯДОК як у CSS `translate(pos) scale() rotate()` з origin=центр картки:
  //   точка = центр + pos + R·S·(p − центр). Ставимо центр, ЗСУВ pos, ПОТІМ scale/rotate
  //   (translate у CSS іде першим і НЕ множиться на scale → окремий крок до scale).
  //   Раніше було translate(центр+pos)→scale — scale крутив і сам pos → розсинхрон при scale≠1.
  bctx.translate(w / 2 + posX, h / 2 + posY); // центр картки + пальцевий зсув фону (не масштабується)
  if (rot) bctx.rotate(rot);
  bctx.scale(scale, scale);
  bctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  bctx.restore();
  // 2) ГЛАДКЕ розмиття: 3× box-blur по ImageData (gaussBlurCanvas) — справжній гаус,
  // однаковий у прев'ю і PNG, без квадратиків. Радіус ≈ w/26 (для 1080 ≈ 40px) відтворює
  // силу колишнього ÷16-downscale, але гладко. gaussBlurCanvas сам зменшить до BLUR_MAX_SIDE.
  const c = gaussBlurCanvas(base, w, h, w / 26);
  // PNG замість jpeg: jpeg 0.82 додавав власний 8×8 DCT-блокінг поверх блюру = грубі квадрати.
  const blurURL = c.toDataURL("image/png");

  // Матриця картки → внутрішні координати .wrap. .frostbg — ДИТИНА .wrap, тож успадковує її
  // transform (translate+scale+rotate заголовка). Раніше bg позиціонувався в піксельних
  // координатах картки, але scale/rotate .wrap їх ще раз крутив → фон іншого масштабу +
  // прямокутник-«дубль» вилазив збоку. Тепер знімаємо ФАКТИЧНУ матрицю .wrap і застосовуємо до
  // bg ЇЇ ІНВЕРСІЮ → у підсумку bg повертається рівно в простір картки (scale/rotate скасовуються),
  // а left/top ставимо так, щоб (0,0) картки збігся з (0,0) розмитого фону. Працює однаково в
  // прев'ю і в snapdom (обидва читають той самий computed transform).
  for (const wrap of wraps) {
    const cs = getComputedStyle(wrap);
    const plate = cs.backgroundColor;            // напівпрозоре тонування (PLATE_BG)
    wrap.querySelectorAll(":scope > .frostbg").forEach((e) => e.remove()); // прибрати попереднє
    // fromCard: точка картки (px) → координати ВСЕРЕДИНІ .wrap (до її transform).
    // = inverse(wrapMatrix) · (cardPoint) − offset самого .wrap у картці.
    const inv = invWrapMatrix(cs.transform, wrap.offsetLeft, wrap.offsetTop);

    // Розмитий фон як <IMG>, а не background-image: snapdom НЕ серіалізує background-image
    // з великим data-URL у foreignObject (→ прев'ю з розмиттям, PNG без). <img> embed-иться надійно.
    const bg = document.createElement("img");
    bg.className = "frostbg"; bg.src = blurURL;
    // Позиція (0,0) + width×height у координатах картки; інверс-матриця нейтралізує transform .wrap.
    bg.style.cssText =
      `position:absolute;left:0;top:0;width:${w}px;height:${h}px;z-index:-2;pointer-events:none;` +
      `transform-origin:0 0;transform:${inv};`;
    const tint = document.createElement("div");
    tint.className = "frostbg";
    tint.style.cssText = `position:absolute;inset:0;background:${plate};z-index:-1;pointer-events:none;`;
    wrap.style.background = "transparent";   // тонування тепер окремим шаром tint
    wrap.style.overflow = "hidden";          // обрізати розмитий фон по межах плашки
    wrap.insertBefore(tint, wrap.firstChild);
    wrap.insertBefore(bg, wrap.firstChild);  // bg найглибше (z-index:-2), tint над ним, текст зверху
  }
}

// Перерахувати transform розмитого фону .frostbg під ПОТОЧНИЙ transform .wrap. Викликається з
// app.js під час переносу/масштабу плашки пальцем на прев'ю — інакше bg лишається з матрицею на
// момент рендеру й «застигає» (не показує фон під новою позицією плашки). Легка операція (без canvas).
export function realignFrost(wrap) {
  if (!wrap) return;
  const bg = wrap.querySelector(":scope > img.frostbg");
  if (!bg) return;
  const cs = getComputedStyle(wrap);
  bg.style.transform = invWrapMatrix(cs.transform, wrap.offsetLeft, wrap.offsetTop);
}

// Побудувати CSS-transform для .frostbg (дитини .wrap), що повертає фон у координати КАРТКИ:
// матриця .wrap (M) множить усе всередині; хочемо, щоб bg у картці стояв у (0,0) картки без
// scale/rotate .wrap. Тобто bgTransform = translate(−offset) · M⁻¹, де offset — layout-позиція
// .wrap у картці (offsetLeft/Top; translate заголовка вже сидить у M, тож окремо НЕ віднімаємо).
// Повертаємо готовий рядок `matrix(a,b,c,d,e,f)`. Fallback: чистий зсув, якщо матрицю не зчитали.
function invWrapMatrix(transformStr, offLeft, offTop) {
  const m = parseMatrix(transformStr); // {a,b,c,d,e,f} у координатах КАРТКИ (translate заголовка всередині)
  if (!m) return `translate(${-offLeft}px,${-offTop}px)`; // без scale/rotate — простий зсув
  // M⁻¹ (2×2 + трансляція)
  const det = m.a * m.d - m.b * m.c || 1;
  const ia = m.d / det, ib = -m.b / det, ic = -m.c / det, id = m.a / det;
  const ie = -(ia * m.e + ic * m.f), if_ = -(ib * m.e + id * m.f);
  // translate(−offLeft,−offTop) ПЕРЕД M⁻¹: спершу переносимо (0,0) картки в локальний простір .wrap,
  // тоді знімаємо scale/rotate. Композиція T · M⁻¹ (T зліва) для колонкового вектора:
  //   e' = ie − (ia*offLeft + ic*offTop),  f' = if_ − (ib*offLeft + id*offTop)
  const e2 = ie - (ia * offLeft + ic * offTop);
  const f2 = if_ - (ib * offLeft + id * offTop);
  const r = (n) => (Math.abs(n) < 1e-4 ? 0 : +n.toFixed(6));
  return `matrix(${r(ia)},${r(ib)},${r(ic)},${r(id)},${r(e2)},${r(f2)})`;
}

// Розібрати computed transform ("none" | "matrix(a,b,c,d,e,f)" | "matrix3d(...)") у {a,b,c,d,e,f}.
function parseMatrix(str) {
  if (!str || str === "none") return null;
  const mm = str.match(/matrix\(([^)]+)\)/);
  if (mm) {
    const p = mm[1].split(",").map((n) => parseFloat(n.trim()));
    if (p.length === 6 && p.every(Number.isFinite)) return { a: p[0], b: p[1], c: p[2], d: p[3], e: p[4], f: p[5] };
  }
  const m3 = str.match(/matrix3d\(([^)]+)\)/); // 2D-проєкція 3D-матриці (беремо потрібні компоненти)
  if (m3) {
    const p = m3[1].split(",").map((n) => parseFloat(n.trim()));
    if (p.length === 16 && p.every(Number.isFinite)) return { a: p[0], b: p[1], c: p[4], d: p[5], e: p[12], f: p[13] };
  }
  return null;
}

function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

// Створити off-screen host із Shadow DOM, що містить готовий слайд W×H.
// Повертає { host, card, cleanup }. host лишається в DOM до cleanup().
export async function mountSlide(html, w, h) {
  const host = document.createElement("div");
  host.style.cssText =
    `position:fixed;left:0;top:0;width:${w}px;height:${h}px;` +
    `pointer-events:none;z-index:-1;opacity:0;overflow:hidden;`;
  const root = host.attachShadow({ mode: "open" });
  const { css, body } = parseSlide(html);
  root.innerHTML = `<style>${css}</style>${body}`;
  document.body.appendChild(host);
  try { await applyBgBlur(root); } catch (e) { console.warn("applyBgBlur fail:", e && e.message); }
  try { await applyFrost(root, w, h); }
  catch (e) { console.warn("applyFrost fail:", e && e.message, e); } // frost не має валити слайд
  const card = root.querySelector(".card");
  return { host, card, root, cleanup: () => host.remove() };
}

// Детерміновано дочекатися шрифтів і зображень (той самий gate, що в render-electron.js).
export async function waitReady(root) {
  try { await document.fonts.ready; } catch (e) {}
  const imgs = Array.from(root.querySelectorAll("img")).filter((i) => i.getAttribute("src"));
  await Promise.all(imgs.map((i) => (i.complete && i.naturalWidth ? 1 :
    new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 2500); })))); // таймаут проти гонки onload
  // пауза на застосування layout/шрифтів. setTimeout (а не rAF) — надійно і в фоновій
  // вкладці, де requestAnimationFrame заморожений.
  await new Promise((r) => setTimeout(r, 32));
}

// Головний вхід: HTML слайда → canvas рівно w×h.
export async function renderToCanvas(html, w, h) {
  const sd = snapdom();
  if (!sd) throw new Error("snapdom не завантажено (window.snapdom відсутній)");
  const { root, card, cleanup } = await mountSlide(html, w, h);
  try {
    await waitReady(root);
    // dpr:1 + scale:1 → canvas рівно w×h у фізичних пікселях (без множення на Retina екрана)
    const canvas = await sd.toCanvas(card, { scale: 1, dpr: 1, width: w, height: h, backgroundColor: null });
    return canvas;
  } finally {
    cleanup();
  }
}

export async function renderToBlob(html, w, h, type = "image/png", quality) {
  const canvas = await renderToCanvas(html, w, h);
  return await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob повернув null — canvas tainted?"))), type, quality)
  );
}
