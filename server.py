#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Веб-панель до движка каруселей.

Нічого не дублює: імпортує build.py і викликає ту саму верстку.
    тема + контент + шаблон  →  прев'ю (HTML) / експорт (PNG)

Додатково:
    /api/cutout      — вирізати об'єкт із фото (Apple Vision, bin/cutout)
    /api/split-text  — розкидати великий текст по слайдах (Opus 4.8, ключ із ../.env)

Запуск:
    python3 server.py            # http://127.0.0.1:8090
"""
import base64
import json
import os
import re
import subprocess
import time
import urllib.parse
import urllib.request
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# щоб `import build` працював незалежно від робочої теки запуску
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build  # той самий движок

ROOT = build.ROOT
THEMES = ROOT / "themes"
# uploads має бути записуваним (у .app корінь read-only) — перекривається через env
UPLOADS = Path(os.environ.get("CAROUSEL_UPLOADS") or (ROOT / "uploads"))
try:
    UPLOADS.mkdir(parents=True, exist_ok=True)
except Exception:
    pass
OUT = build.OUT
PANEL = ROOT / "panel.html"
BIN = ROOT / "bin"
ENV_FILE = ROOT.parent / ".env"
PORT = 8090

TEMPLATES = {
    t: (build.TPL / f"{t}.html").read_text(encoding="utf-8")
    for t in ("cover", "text", "photo")
}

# ── БЕЗПЕКА локального сервера ─────────────────────────────────────────────
# /file віддає ЛИШЕ медіа/шрифти — щоб чужа вкладка не прочитала ключі, .env, код, документи.
SERVE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".woff2", ".woff", ".ttf", ".otf"}
MAX_BODY = 25 * 1024 * 1024   # ліміт тіла запиту (проти локального DoS)

def origin_allowed(headers):
    """Проти CSRF/cross-site: дозволяємо запити без Origin (Electron/curl/навігація)
    або з localhost. Чужий сайт у браузері надішле Origin свого домену → відмова."""
    o = headers.get("Origin")
    if not o:
        return True
    try:
        return urllib.parse.urlparse(o).hostname in ("127.0.0.1", "localhost")
    except Exception:
        return False


def read_env(key):
    """Дістати ключ із ../.env без сторонніх залежностей."""
    v = os.environ.get(key)
    if v:
        return v.strip()
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def list_themes():
    out = []
    for p in sorted(THEMES.glob("*.json")):
        if p.name.startswith("_"):
            continue
        try:
            t = build.load(p)
        except Exception:
            continue
        out.append({
            "file": p.name,
            "name": t.get("name", p.stem),
            "accent": t.get("colors", {}).get("accent", "#FFD20E"),
            "kicker": t.get("kicker", ""),
            "handle": t.get("handle", ""),
        })
    return out


def photo_url(photo):
    """Для прев'ю в браузері фото віддаємо через /file?path=…"""
    if not photo:
        return ""
    if photo.startswith(("http://", "https://", "data:")):
        return photo
    p = Path(photo)
    if not p.is_absolute():
        p = (ROOT / photo).resolve()
    return "/file?path=" + urllib.parse.quote(str(p))


def build_preview(theme_file, slides, overrides):
    ov = overrides or {}
    theme = build.apply_overrides_to_theme(build.load(THEMES / theme_file), ov)
    base_map = build.theme_map(theme)
    fmt = ov.get("format", build.DEFAULT_FORMAT)
    htmls = []
    for slide in slides:
        t = slide.get("type", "text")
        tpl = "text" if t == "blank" else t   # «пустий» рендериться шаблоном text
        if tpl not in TEMPLATES:
            tpl = "text"
        m = build.slide_map(base_map, slide, photo_url, fmt)
        htmls.append(build.fill(TEMPLATES[tpl], m))
    return htmls


def export_png(theme_file, slides, overrides):
    """Пише тимчасові тему+контент і проганяє штатний build.py + render.sh."""
    ov = overrides or {}
    theme = build.apply_overrides_to_theme(build.load(THEMES / theme_file), ov)
    tmp_theme = THEMES / "_panel.json"
    tmp_theme.write_text(json.dumps(theme, ensure_ascii=False, indent=2), encoding="utf-8")

    # фото/вирізане зберігаємо як абсолютні шляхи — build.to_file_url зробить file://
    norm_slides = []
    for s in slides:
        s = dict(s)
        for key in ("photo", "cutout"):
            if s.get(key):
                p = Path(s[key])
                if not p.is_absolute():
                    p = (ROOT / s[key]).resolve()
                s[key] = str(p)
        norm_slides.append(s)
    content = {"name": "panel", "format": ov.get("format", build.DEFAULT_FORMAT),
               "slides": norm_slides}
    tmp_content = ROOT / "content" / "_panel.json"
    tmp_content.write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")

    subprocess.run(
        ["python3", "build.py", "themes/_panel.json", "content/_panel.json"],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    subprocess.run(["bash", "render.sh"], cwd=ROOT, check=True, capture_output=True, text=True)
    pngs = sorted(str(p) for p in OUT.glob("*.png"))
    return pngs


def ensure_cutout_bin():
    exe = BIN / "cutout"
    if exe.exists():
        return exe
    # спробувати скомпілювати
    subprocess.run(["bash", str(BIN / "build-cutout.sh")], cwd=ROOT,
                   check=True, capture_output=True, text=True)
    if not exe.exists():
        raise RuntimeError("не вдалося скомпілювати bin/cutout")
    return exe


def do_cutout(src_path):
    """Вирізає головний об'єкт → PNG з альфою. Повертає абсолютний шлях."""
    exe = ensure_cutout_bin()
    src = Path(src_path)
    if not src.is_absolute():
        src = (ROOT / src_path).resolve()
    if not src.exists():
        raise FileNotFoundError(str(src))
    UPLOADS.mkdir(exist_ok=True)
    dest = UPLOADS / (src.stem + "_cutout.png")
    r = subprocess.run([str(exe), str(src), str(dest)], capture_output=True, text=True)
    if r.returncode == 3:
        raise RuntimeError("об'єкт на фото не знайдено")
    if r.returncode != 0:
        raise RuntimeError((r.stderr or "cutout failed").strip())
    return str(dest.resolve())


GEMINI_MODEL = "gemini-2.5-flash"


def split_engine():
    """Який рушій розкидання тексту активний: Gemini (пріоритет) → Opus → None."""
    if read_env("GEMINI_API_KEY"):
        return "gemini"
    if read_env("ANTHROPIC_API_KEY"):
        return "opus"
    return None


def _split_prompt(text, count):
    n_hint = f"рівно {count}" if count else "оптимальну кількість (звичайно 5–8)"
    return (
        "Ти — редактор Instagram-каруселей українською. Розбий поданий текст на "
        f"{n_hint} слайдів-тез. Кожен слайд: коротка ТЕЗА (1–3 слова, суть слайда) і "
        "ТЕКСТ (1–2 живих речення). Збережи зміст і тон автора, не додавай нічого від себе. "
        "Поверни ЛИШЕ JSON-масив об'єктів виду "
        '[{"ТЕЗА":"...","ТЕКСТ":"..."}] без markdown і пояснень.\n\nТЕКСТ:\n' + text
    )


def _parse_slides(raw, who):
    # витягнути JSON-масив навіть якщо модель обгорнула у ```json
    mt = re.search(r"\[.*\]", raw, re.S)
    if not mt:
        raise RuntimeError(f"{who} повернув неочікуваний формат")
    return [{"type": "text",
             "ТЕЗА": str(it.get("ТЕЗА", "")).strip(),
             "ТЕКСТ": str(it.get("ТЕКСТ", "")).strip()}
            for it in json.loads(mt.group(0))]


def _ssl_ctx():
    """Надійна перевірка сертифікатів (свіжий Python на macOS часто без кореневих)."""
    try:
        import ssl, certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        import ssl
        return ssl.create_default_context()


def _post_json(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
                                 headers={**headers, "content-type": "application/json"},
                                 method="POST")
    with urllib.request.urlopen(req, timeout=90, context=_ssl_ctx()) as resp:
        return json.loads(resp.read())


def split_text_gemini(text, count=None, key=None):
    """Розкидає текст по слайдах через Gemini (Google AI Studio).
    key — ключ від користувача (майстер у панелі); якщо нема — беремо з .env."""
    key = (key or "").strip() or read_env("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("немає ключа Gemini — встав свій у майстрі «🔑 Свій ключ Gemini»")
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{GEMINI_MODEL}:generateContent")
    body = {
        "contents": [{"parts": [{"text": _split_prompt(text, count)}]}],
        "generationConfig": {"temperature": 0.7, "responseMimeType": "application/json"},
    }
    data = _post_json(url, body, {"x-goog-api-key": key})
    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    raw = "".join(p.get("text", "") for p in parts)
    return _parse_slides(raw, "Gemini")


def split_text_opus(text, count=None):
    """Розкидає текст по слайдах через Opus 4.8. Повертає список {ТЕЗА,ТЕКСТ}."""
    key = read_env("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("немає ANTHROPIC_API_KEY у .env — додай рядок ANTHROPIC_API_KEY=sk-...")
    data = _post_json(
        "https://api.anthropic.com/v1/messages",
        {"model": "claude-opus-4-8", "max_tokens": 4000,
         "messages": [{"role": "user", "content": _split_prompt(text, count)}]},
        {"x-api-key": key, "anthropic-version": "2023-06-01"},
    )
    raw = "".join(part.get("text", "") for part in data.get("content", []))
    return _parse_slides(raw, "Opus")


def split_text(text, count=None, key=None):
    """Диспетчер: ключ користувача (Gemini) → пріоритет; інакше .env (Gemini/Opus)."""
    if key and key.strip():
        return split_text_gemini(text, count, key)   # свій ключ із майстра
    eng = split_engine()
    if eng == "gemini":
        return split_text_gemini(text, count)
    if eng == "opus":
        return split_text_opus(text, count)
    raise RuntimeError("немає ключа Gemini — встав свій у майстрі «🔑 Свій ключ Gemini»")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        n = int(self.headers.get("Content-Length", 0))
        if n > MAX_BODY:
            raise ValueError("payload завеликий")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/":
            return self._send(200, PANEL.read_text(encoding="utf-8"),
                              "text/html; charset=utf-8")
        if u.path == "/api/themes":
            return self._send(200, list_themes())
        if u.path == "/api/config":
            eng = split_engine()
            return self._send(200, {"hasKey": bool(eng), "engine": eng,
                                    "formats": list(build.FORMATS.keys())})
        if u.path == "/file":
            if not origin_allowed(self.headers):
                return self._send(403, {"error": "forbidden"})
            q = urllib.parse.parse_qs(u.query)
            return self._serve_file(Path(q.get("path", [""])[0]))
        if u.path.startswith("/uploads/"):
            # роздача завантажених ассетів за іменем (шрифти — з розширенням у шляху,
            # щоб @font-face і headless-рендер їх коректно тягнули)
            name = Path(urllib.parse.unquote(u.path[len("/uploads/"):])).name
            return self._serve_file(UPLOADS / name)
        if u.path.startswith("/textures/"):
            # реальні текстури тла (папір тощо) — і для прев'ю, і для headless-рендера
            name = Path(urllib.parse.unquote(u.path[len("/textures/"):])).name
            return self._serve_file(ROOT / "textures" / name)
        return self._send(404, {"error": "not found"})

    def _serve_file(self, p):
        if not p.exists() or not p.is_file():
            return self._send(404, {"error": "not found"})
        ext = p.suffix.lower()
        if ext not in SERVE_EXT:                      # лише медіа/шрифти — не секрети/код/документи
            return self._send(403, {"error": "forbidden file type"})
        ctype = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                 ".webp": "image/webp", ".gif": "image/gif",
                 ".woff2": "font/woff2", ".woff": "font/woff",
                 ".ttf": "font/ttf", ".otf": "font/otf"}.get(ext, "application/octet-stream")
        data = p.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")   # без CORS * — чужий сайт не прочитає
        self.end_headers()
        return self.wfile.write(data)

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if not origin_allowed(self.headers):          # проти CSRF з чужої вкладки
            return self._send(403, {"error": "forbidden"})
        try:
            if u.path == "/api/preview":
                d = self._read_json()
                htmls = build_preview(d["theme"], d["slides"], d.get("overrides"))
                return self._send(200, {"htmls": htmls})
            if u.path == "/api/upload":
                d = self._read_json()
                UPLOADS.mkdir(exist_ok=True)
                name = Path(d["name"]).name
                raw = d["dataUrl"].split(",", 1)[-1]
                dest = UPLOADS / name
                dest.write_bytes(base64.b64decode(raw))
                return self._send(200, {"path": str(dest.resolve())})
            if u.path == "/api/cutout":
                d = self._read_json()
                path = do_cutout(d["path"])
                return self._send(200, {"path": path})
            if u.path == "/api/split-text":
                d = self._read_json()
                slides = split_text(d.get("text", ""), d.get("count"), d.get("key"))
                return self._send(200, {"slides": slides})
            if u.path == "/api/export":
                d = self._read_json()
                pngs = export_png(d["theme"], d["slides"], d.get("overrides"))
                return self._send(200, {"pngs": pngs, "out": str(OUT.resolve())})
            if u.path == "/api/open":
                subprocess.run(["open", str(OUT.resolve())])
                return self._send(200, {"ok": True})
        except Exception as e:
            return self._send(500, {"error": str(e)})
        return self._send(404, {"error": "not found"})


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    print(f"Карусель-панель: http://127.0.0.1:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
