#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Движок каруселі. Збирає слайди з трьох незалежних частин:
    тема (themes/*.json) + контент (content/*.json) + шаблони (templates/*.html)

Запуск:
    python3 build.py [тема.json] [контент.json]
    (за замовчуванням: themes/hlyboki.json + content/example.json)

Результат: out/NN.html  →  далі render.sh зробить out/NN.png
out/_size.txt зберігає розмір формату «W H» для render.sh.

«Різні шрифти, різні кольори» = просто інша тема. Той самий контент.
"""
import html
import json
import os
import re
import sys
from pathlib import Path

# у зібраному .app корінь ресурсів (templates/themes/textures) приходить через env
# CAROUSEL_ROOT (engine у бандлі); при звичайному запуску — поряд із цим файлом.
_ENV_ROOT = os.environ.get("CAROUSEL_ROOT")
ROOT = Path(_ENV_ROOT).resolve() if _ENV_ROOT else Path(__file__).resolve().parent
TPL = ROOT / "templates"
# out — записувана тека; у .app корінь read-only, тож можна перекрити через env
OUT = Path(os.environ.get("CAROUSEL_OUT") or (ROOT / "out"))

# плейсхолдери {{...}} — латиниця для теми (FONT_DISPLAY), кирилиця для контенту (ЗАГ_1)
PH = re.compile(r"\{\{([A-Z0-9_А-ЯІЇЄҐ]+)\}\}")

# формати каруселі (ширина фіксована 1080)
FORMATS = {
    "3:4": (1080, 1440),
    "4:5": (1080, 1350),
    "1:1": (1080, 1080),
}
DEFAULT_FORMAT = "3:4"

# які типи слайдів можуть мати фонове фото
BG_PHOTO_TYPES = {"cover", "photo"}

# текстури тла — самодостатні (CSS/SVG, без зовнішніх файлів); накладаються шаром overlay
_NOISE = ("url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' "
          "width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' "
          "baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E"
          "%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")")
_PAPER = ("url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' "
          "width='220' height='220'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' "
          "baseFrequency='0.35' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E"
          "%3Crect width='100%25' height='100%25' filter='url(%23p)'/%3E%3C/svg%3E\")")
# реальні текстури-зображення роздаються сервером (/textures/), працюють і в прев'ю,
# і в headless-рендері (сервер піднятий під час експорту)
_TEX = "http://127.0.0.1:8090/textures"
TEXTURES = {
    # реальні фото-текстури = ПОВНОЦІННЕ насичене тло (як оригінальне фото): op 1, blend normal.
    # img=True → покриває картку; dark → чи потрібен світлий текст.
    "kraft":     {"bg": f"url('{_TEX}/paper-kraft.jpg')", "size": "cover", "op": "1", "blend": "normal", "img": True, "dark": False},
    "cream":     {"bg": f"url('{_TEX}/cream.jpg')",       "size": "cover", "op": "1", "blend": "normal", "img": True, "dark": False},
    "glaze":     {"bg": f"url('{_TEX}/glaze.jpg')",       "size": "cover", "op": "1", "blend": "normal", "img": True, "dark": False},
    "coffee":    {"bg": f"url('{_TEX}/coffee.jpg')",      "size": "cover", "op": "1", "blend": "normal", "img": True, "dark": True},
    "linen":     {"bg": f"url('{_TEX}/linen.jpg')",       "size": "cover", "op": "1", "blend": "normal", "img": True, "dark": False},
    "chocolate": {"bg": f"url('{_TEX}/chocolate.jpg')",   "size": "cover", "op": "1", "blend": "normal", "img": True, "dark": True},
    "matcha":    {"bg": f"url('{_TEX}/matcha.jpg')",      "size": "cover", "op": "1", "blend": "normal", "img": True, "dark": True},
    "flower":    {"bg": f"url('{_TEX}/flower.jpg')",      "size": "cover", "op": "1", "blend": "normal", "img": True, "dark": False},
    "leaf":      {"bg": f"url('{_TEX}/leaf.jpg')",        "size": "cover", "op": "1", "blend": "normal", "img": True, "dark": False},
    # згенеровані (CSS/SVG) — легкі патерни поверх кольору/фото
    "grain":    {"bg": _NOISE, "size": "140px", "op": "0.5", "blend": "overlay"},
    "dots":     {"bg": "radial-gradient(rgba(255,255,255,.9) 1.4px, transparent 1.6px)",
                 "size": "24px 24px", "op": "0.5", "blend": "overlay"},
    "grid":     {"bg": "linear-gradient(rgba(255,255,255,.7) 1px,transparent 1px),"
                       "linear-gradient(90deg,rgba(255,255,255,.7) 1px,transparent 1px)",
                 "size": "46px 46px", "op": "0.45", "blend": "overlay"},
    "diagonal": {"bg": "repeating-linear-gradient(45deg,rgba(255,255,255,.6) 0 1px,transparent 1px 13px)",
                 "size": "auto", "op": "0.4", "blend": "overlay"},
    "glow":     {"bg": "radial-gradient(circle at 50% 30%,rgba(255,255,255,.95),transparent 62%)",
                 "size": "cover", "op": "0.28", "blend": "overlay"},
}


SERIF_FALLBACK = '"Didot","Playfair Display","Bodoni 72","Hoefler Text",Georgia,serif'
SANS_FALLBACK = '"Helvetica Neue",Arial,sans-serif'
_FONT_EXT = {"woff2": "woff2", "woff": "woff", "ttf": "truetype", "otf": "opentype"}


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def format_wh(fmt):
    return FORMATS.get(fmt or DEFAULT_FORMAT, FORMATS[DEFAULT_FORMAT])


def _is_font_file(url):
    return url.split("?")[0].lower().rsplit(".", 1)[-1] in _FONT_EXT


def font_head(theme):
    """<head>-розмітка підключення шрифтів теми (може бути порожня).

    theme["fonts"] може містити:
        links: ["…css2?family=…"]              — таблиці стилів (Google Fonts тощо)
        faces: [{"family":"X","url":"…woff2"}] — прямі файли шрифтів → @font-face
    """
    f = theme.get("fonts", {}) or {}
    parts, seen = [], set()
    for url in f.get("links", []) or []:
        if url and url not in seen:
            seen.add(url)
            parts.append(f'<link rel="stylesheet" href="{url}">')
    faces = []
    for face in f.get("faces", []) or []:
        url, fam = face.get("url"), face.get("family", "")
        if not url or url in seen:
            continue
        seen.add(url)
        ext = url.split("?")[0].lower().rsplit(".", 1)[-1]
        faces.append(f"@font-face{{font-family:'{fam}';src:url('{url}') "
                     f"format('{_FONT_EXT.get(ext, 'woff2')}');font-display:swap;}}")
    if faces:
        parts.append("<style>" + "".join(faces) + "</style>")
    return "\n".join(parts)


def apply_overrides_to_theme(theme, ov):
    """Єдина точка застосування налаштувань панелі поверх теми — нею
    користуються і прев'ю, і експорт, тож шрифт/колір скрізь однакові.

    ov: accent, kicker, handle, fonts.
    fonts = {display:{name,url}, body:{name,url}} — назва гарнітури + (опц.) посилання
    (посилання на .css → <link>; на файл .woff2/.ttf/.otf → @font-face)."""
    theme = json.loads(json.dumps(theme))  # глибока копія, оригінал не чіпаємо
    ov = ov or {}
    # повна палітра стилю (пресет): накриваємо кольори теми, порожні — ігноруємо
    cols = ov.get("colors")
    if cols:
        tc = theme.setdefault("colors", {})
        for k, v in cols.items():
            if v:
                tc[k] = v
    if ov.get("accent"):
        theme.setdefault("colors", {})["accent"] = ov["accent"]
    if ov.get("kicker"):
        theme["kicker"] = ov["kicker"]
    if ov.get("handle"):
        theme["handle"] = ov["handle"]
    fonts = ov.get("fonts")
    if fonts:
        f = theme.setdefault("fonts", {})
        links = list(f.get("links", []) or [])
        faces = list(f.get("faces", []) or [])
        for slot, fallback in (("display", SERIF_FALLBACK), ("body", SANS_FALLBACK),
                               ("accent", SERIF_FALLBACK)):
            spec = fonts.get(slot) or {}
            name, url = spec.get("name"), spec.get("url")
            if name:
                f[slot] = f'"{name}",{fallback}'
            if url:
                (faces.append({"family": name or "", "url": url})
                 if _is_font_file(url) else links.append(url))
            # нарис шрифта: вага (100–900) і курсив — обираються на панелі
            w = spec.get("weight")
            if w:
                f[slot + "Weight"] = str(w)
            it = spec.get("italic")
            if it is not None:
                f[slot + "Style"] = "italic" if it else "normal"
        # колір акцентного слова (окремо від акценту-палітри)
        acol = (fonts.get("accent") or {}).get("color")
        if acol:
            theme["accentTextColor"] = acol
        f["links"], f["faces"] = links, faces
    return theme


def theme_map(theme):
    f, c = theme["fonts"], theme["colors"]
    return {
        "FONT_DISPLAY": f["display"],
        "FONT_BODY": f["body"],
        "FONT_LINKS": font_head(theme),
        # нарис: вага + курсив (за замовч. зберігають поточний вигляд шаблонів)
        "DISP_WEIGHT": str(f.get("displayWeight", "400")),
        "DISP_STYLE": f.get("displayStyle", "italic"),
        "BODY_WEIGHT": str(f.get("bodyWeight", "300")),
        "BODY_STYLE": f.get("bodyStyle", "normal"),
        # акцентне слово (обгорнуте *зірочками*): свій шрифт/колір/нарис
        "ACCENT_FONT": f.get("accent", f["display"]),
        "ACCENT_COLOR": theme.get("accentTextColor") or c["accent"],
        "ACCENT_WEIGHT": str(f.get("accentWeight", "inherit")),
        "ACCENT_STYLE": f.get("accentStyle", "inherit"),
        "ACCENT": c["accent"],
        "PHOTO_BG": c["photoBg"],
        "LIGHT_BG": c["lightBg"],
        "COVER_BG": c["coverBg"],
        "TEXT_ON_DARK": c["textOnDark"],
        "TEXT_ON_LIGHT": c["textOnLight"],
        "BODY_ON_LIGHT": c["bodyOnLight"],
        # колір основного тексту на темному/фото (за замовч. = колір тексту на темному)
        "BODY_ON_DARK": c.get("bodyOnDark", c["textOnDark"]),
        # приглушений колір кікера/хендла на текстових слайдах (за замовч. — темний)
        "MUTED_ON_LIGHT": c.get("mutedOnLight", "rgba(60,48,38,0.5)"),
        "MUTED_ON_DARK": c.get("mutedOnDark", "rgba(244,239,231,0.82)"),
        "KICKER": theme.get("kicker", ""),
        "HANDLE": theme.get("handle", ""),
    }


def _num(v, default):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


_ACCENT_RE = re.compile(r"\*([^*]+)\*")


def _accent_markup(s):
    """Слово(а) в *зірочках* → акцентний span. Напр.: 'тиша *між* словами'."""
    return _ACCENT_RE.sub(r'<span class="ac">\1</span>', s)


# українська типографіка: 1-2-літерні слова НЕ висять у кінці рядка → приклеюємо NBSP
_SHORT_RE = re.compile(r"(^|[\s ])([A-Za-zА-ЯІЇЄҐа-яіїєґ0-9']{1,2})[ \t]+(?=\S)")


def _glue_short_words(s):
    """Приклеює короткі слова (прийменники/сполучники) до наступного через нерозривний
    пробіл — типографічне правило, зашите в рушій. Не чіпає вже склеєне (&nbsp;/\\u00A0)."""
    prev = None
    while prev != s:
        prev = s
        s = _SHORT_RE.sub(lambda m: m.group(1) + m.group(2) + " ", s)
    return s


def _is_dark(hexcol):
    """Чи темний колір (для авто-контрасту тексту). Приймає #rgb/#rrggbb."""
    try:
        c = str(hexcol).lstrip("#")
        if len(c) == 3:
            c = "".join(ch * 2 for ch in c)
        r, g, b = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
        return (0.299 * r + 0.587 * g + 0.114 * b) < 140
    except Exception:
        return False


def slide_map(base, slide, photo_resolver, fmt=DEFAULT_FORMAT):
    """Єдине джерело істини для одного слайда: об'єднує тему й поля слайда
    у повний набір плейсхолдерів. Використовують і прев'ю, і експорт.

    photo_resolver(path) -> URL, придатний для поточного контексту
    (браузерне прев'ю або file:// для headless-рендера)."""
    t = slide.get("type", "text")
    w, h = format_wh(fmt)
    m = dict(base)

    # текстові та інші прямі поля
    for k, v in slide.items():
        if k in ("type", "photo", "cutout", "bgMode", "bgColor",
                 "posX", "posY", "scale", "rotate", "cutX", "cutY", "cutScale",
                 "textX", "textY", "textAlign", "plate", "plateOpacity", "texture", "_open",
                 "dim", "cutRotate", "textureOp",
                 "showKicker", "showRule", "showHandle"):
            continue
        # html.escape ПЕРЕД розміткою: текст користувача не може впорснути теги (self-XSS),
        # а «<», «&» більше не ламають верстку. Акцентні *зірочки* лишаються робочими.
        m[k] = _accent_markup(_glue_short_words(html.escape(v, quote=False))) if isinstance(v, str) else v

    m["W"] = str(w)
    m["H"] = str(h)

    # зсув текстового блоку (перетягування мишею в прев'ю), px
    m["TEXT_X"] = f"{_num(slide.get('textX'), 0):g}"
    m["TEXT_Y"] = f"{_num(slide.get('textY'), 0):g}"
    # вирівнювання тексту: left | center | right | justify
    align = slide.get("textAlign") or "center"
    m["TEXT_ALIGN"] = align if align in ("left", "center", "right", "justify") else "center"

    # ── тло ─────────────────────────────────────────────
    # фонове фото доступне на БУДЬ-ЯКОМУ типі слайда (default photo лише для cover/photo)
    bg_mode = slide.get("bgMode") or ("photo" if t in ("cover", "photo") else "color")
    # дефолтний колір картки за типом (коли не задано власний)
    default_card = {
        "cover": base.get("COVER_BG", "#cfc9c2"),
        "text": base.get("LIGHT_BG", "#d7d0c5"),
        "photo": base.get("PHOTO_BG", "#11151a"),
        "blank": base.get("LIGHT_BG", "#d7d0c5"),
    }.get(t, "#ffffff")
    m["CARD_BG"] = slide.get("bgColor") or default_card

    photo = slide.get("photo") or ""
    show_photo = bool(photo) and bg_mode == "photo"
    m["PHOTO"] = photo_resolver(photo) if show_photo else ""
    m["PHOTO_DISPLAY"] = "block" if show_photo else "none"
    m["GRAD_DISPLAY"] = "block" if show_photo else "none"
    # фон: зсув у px (translate, за замовч. 0 — центр), масштаб і поворот
    m["POS_X"] = f"{_num(slide.get('posX'), 0):g}"
    m["POS_Y"] = f"{_num(slide.get('posY'), 0):g}"
    m["SCALE"] = f"{_num(slide.get('scale'), 1):g}"
    m["ROTATE"] = f"{_num(slide.get('rotate'), 0):g}"

    # авто-контраст: на фото/темному тлі — світлий текст, на світлому — темний.
    # Фото-текстура покриває картку → її яскравість ВАЖЛИВІША за колір тла.
    tex = TEXTURES.get(slide.get("texture") or "")
    tex_op = _num(slide.get("textureOp"), float(tex["op"])) if tex else 0.0
    if tex and tex.get("img") and tex_op >= 0.6:
        on_dark = tex.get("dark", False)              # текстура домінує → її яскравість
    else:                                             # слабка текстура / прозора над фото → тло видно
        on_dark = show_photo or (bg_mode == "color" and _is_dark(m["CARD_BG"]))
    m["INK"] = base["TEXT_ON_DARK"] if on_dark else base["TEXT_ON_LIGHT"]
    m["BODY_INK"] = base.get("BODY_ON_DARK", base["TEXT_ON_DARK"]) if on_dark else base["BODY_ON_LIGHT"]
    m["META_INK"] = base.get("MUTED_ON_DARK", "rgba(255,250,248,0.9)") if on_dark \
        else base.get("MUTED_ON_LIGHT", "rgba(60,48,38,0.5)")

    # ── плашка (підложка) під текстом — щоб читалось поверх «складного» фото ──
    plate = slide.get("plate") or "none"
    op = _num(slide.get("plateOpacity"), 0.5)
    if plate == "dark":                       # темна підложка → світлий текст
        m["PLATE_BG"] = f"rgba(12,10,9,{op:g})"; m["PLATE_BLUR"] = "none"
        m["INK"] = base["TEXT_ON_DARK"]; m["BODY_INK"] = base["TEXT_ON_DARK"]
        m["META_INK"] = base.get("MUTED_ON_DARK", "rgba(255,250,248,0.9)")
    elif plate == "light":                    # світла підложка → темний текст
        m["PLATE_BG"] = f"rgba(247,244,239,{op:g})"; m["PLATE_BLUR"] = "none"
        m["INK"] = base["TEXT_ON_LIGHT"]; m["BODY_INK"] = base["BODY_ON_LIGHT"]
        m["META_INK"] = base.get("MUTED_ON_LIGHT", "rgba(60,48,38,0.5)")
    elif plate == "blur":                     # матове скло (frosted) → світлий текст
        b = op - 0.18 if op - 0.18 > 0.1 else 0.1
        m["PLATE_BG"] = f"rgba(16,14,13,{b:g})"; m["PLATE_BLUR"] = "blur(16px)"
        m["INK"] = base["TEXT_ON_DARK"]; m["BODY_INK"] = base["TEXT_ON_DARK"]
        m["META_INK"] = base.get("MUTED_ON_DARK", "rgba(255,250,248,0.9)")
    else:
        m["PLATE_BG"] = "transparent"; m["PLATE_BLUR"] = "none"
    m["PLATE_PAD"] = "0" if plate == "none" else "46px 54px"

    # ── вирізаний об'єкт (верхній шар, над текстом) ─────
    cut = slide.get("cutout") or ""
    m["CUTOUT"] = photo_resolver(cut) if cut else ""
    m["CUTOUT_DISPLAY"] = "block" if cut else "none"
    m["CUT_X"] = f"{_num(slide.get('cutX'), 50):g}"
    m["CUT_Y"] = f"{_num(slide.get('cutY'), 50):g}"
    m["CUT_SCALE"] = f"{_num(slide.get('cutScale'), 1):g}"
    m["CUT_ROTATE"] = f"{_num(slide.get('cutRotate'), 0):g}"

    # ── затемнення всього тла/фото (окремий шар над фото й текстурою) ──
    dim = _num(slide.get("dim"), 0)
    m["DIM"] = f"{dim:g}"
    m["DIM_DISPLAY"] = "block" if dim > 0 else "none"

    # ── текстура тла (overlay поверх кольору/фото, під текстом) ──
    # прозорість керується полем textureOp: 1 = лише текстура, менше = проступає фото
    if tex:
        m["TEXTURE"] = tex["bg"]; m["TEXTURE_SIZE"] = tex["size"]
        m["TEXTURE_OP"] = f"{tex_op:g}"; m["TEXTURE_DISPLAY"] = "block"
        m["TEXTURE_BLEND"] = tex.get("blend", "overlay")
    else:
        m["TEXTURE"] = "none"; m["TEXTURE_SIZE"] = "auto"
        m["TEXTURE_OP"] = "0"; m["TEXTURE_DISPLAY"] = "none"
        m["TEXTURE_BLEND"] = "overlay"

    # ── видимість службових написів (per-slide тумблери) ──────────────
    # «Пустий» слайд стартує без кікера/лінії/хендла; решта типів — з ними.
    # Відсутнє поле = дефолт за типом → старі проєкти рендеряться як раніше.
    default_show = t != "blank"
    show_kicker = slide.get("showKicker", default_show) and bool(m.get("KICKER"))
    show_handle = slide.get("showHandle", default_show) and bool(m.get("HANDLE"))
    show_rule = slide.get("showRule", default_show)
    m["KICKER_DISPLAY"] = "block" if show_kicker else "none"
    m["HANDLE_DISPLAY"] = "block" if show_handle else "none"
    m["RULE_DISPLAY"] = "inline-block" if show_rule else "none"

    return m


def fill(tpl, mapping):
    # невідомий плейсхолдер лишаємо як є — щоб одразу видно було, що не заповнили
    return PH.sub(lambda m: str(mapping.get(m.group(1), m.group(0))), tpl)


def to_file_url(photo, base):
    if not photo:
        return ""
    if photo.startswith(("http://", "https://", "file://")):
        return photo
    return (base / photo).resolve().as_uri()


def main():
    theme_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "themes/hlyboki.json"
    content_path = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "content/example.json"

    theme = load(theme_path)
    content = load(content_path)
    base = theme_map(theme)
    fmt = content.get("format", DEFAULT_FORMAT)
    assets = content_path.resolve().parent  # фото шукаємо відносно файлу контенту

    OUT.mkdir(exist_ok=True)
    for old in OUT.glob("*.html"):
        old.unlink()

    templates = {
        t: (TPL / f"{t}.html").read_text(encoding="utf-8")
        for t in ("cover", "text", "photo")
    }

    resolver = lambda p: to_file_url(p, assets)
    slides = content["slides"]
    for i, slide in enumerate(slides, 1):
        t = slide.get("type", "text")
        tpl_key = "text" if t == "blank" else t   # «пустий» рендериться шаблоном text
        if tpl_key not in templates:
            raise SystemExit(f"слайд {i}: невідомий type '{t}' (cover|text|photo|blank)")
        m = slide_map(base, slide, resolver, fmt)
        html = fill(templates[tpl_key], m)
        (OUT / f"{i:02d}.html").write_text(html, encoding="utf-8")

    w, h = format_wh(fmt)
    (OUT / "_size.txt").write_text(f"{w} {h}\n", encoding="utf-8")

    print(f"✓ зібрано {len(slides)} слайдів → {OUT}  ({w}×{h})")
    print(f"  тема: {theme.get('name')}  |  контент: {content_path.name}")
    print("  далі: bash render.sh")


if __name__ == "__main__":
    main()
