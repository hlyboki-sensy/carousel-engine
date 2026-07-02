// Карусель-панель — десктоп-обгортка.
// Застосунок сам піднімає движок (server.py) і показує панель у власному вікні.
// Експорт PNG тепер малює ВБУДОВАНИЙ Chromium (offscreen capturePage) —
// зовнішній Google Chrome більше не потрібен.
const { app, BrowserWindow, shell, Menu, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');

const ENGINE = path.join(__dirname, '..');   // тека carousel-engine
const URL = 'http://127.0.0.1:8090';
let serverProc = null;
let win = null;

function ping(cb) {
  const req = http.get(URL + '/api/config', r => { r.resume(); cb(true); });
  req.on('error', () => cb(false));
  req.setTimeout(600, () => { req.destroy(); cb(false); });
}

function startServer() {
  // записувані теки поза .app (корінь застосунку read-only)
  const uploads = path.join(app.getPath('userData'), 'uploads');
  const out = path.join(app.getPath('userData'), 'out');
  const frozen = path.join(process.resourcesPath || '', 'carousel-server');
  if (fs.existsSync(frozen)) {
    // ЗІБРАНИЙ .app: заморожений сервер + вшитий движок (системний Python НЕ потрібен)
    const env = { ...process.env,
      CAROUSEL_ROOT: path.join(process.resourcesPath, 'engine'),
      CAROUSEL_UPLOADS: uploads, CAROUSEL_OUT: out };
    serverProc = spawn(frozen, [], { env, stdio: 'ignore' });
  } else {
    // РОЗРОБКА (npm start): системний python3 + движок поряд
    const env = { ...process.env, CAROUSEL_UPLOADS: uploads, CAROUSEL_OUT: out };
    serverProc = spawn('python3', ['server.py'], { cwd: ENGINE, env, stdio: 'ignore' });
  }
  serverProc.on('error', e => console.error('server spawn error:', e));
}

function waitForServer(done, tries = 0) {
  ping(up => {
    if (up) return done();
    if (tries > 80) return done(new Error('движок не піднявся за 20с'));
    setTimeout(() => waitForServer(done, tries + 1), 250);
  });
}

// ── РЕНДЕР PNG УСЕРЕДИНІ ЗАСТОСУНКУ (замість зовнішнього Chrome/render.sh) ──
// Панель надсилає готові HTML слайдів (ті самі, що в прев'ю) + розмір.
// Малюємо офскрін-вікном, зберігаємо в user-writable теку, відкриваємо у Finder.
ipcMain.handle('karusel:export', async (_e, { htmls, w, h }) => {
  const rwin = new BrowserWindow({
    show: false, width: w, height: h, useContentSize: true,
    webPreferences: { offscreen: true, sandbox: false }
  });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dir = path.join(os.homedir(), 'Downloads', 'Карусель-експорт', stamp);
  fs.mkdirSync(dir, { recursive: true });
  const paths = [];
  try {
    for (let i = 0; i < htmls.length; i++) {
      await rwin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmls[i]));
      await rwin.webContents.executeJavaScript(
        'Promise.all([document.fonts.ready, ...[...document.images].map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r}))])' +
        '.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true)))))'
      ).catch(() => {});
      // ФІКСУЄМО полотно рендеру ТОЧНО w×h — ПІСЛЯ завантаження (виклик ДО loadURL → SIGSEGV).
      // Без цього на різних Маках capturePage брав різний розмір → текст «їхав».
      try {
        rwin.webContents.enableDeviceEmulation({
          screenPosition: 'desktop', screenSize: { width: w, height: h },
          viewSize: { width: w, height: h }, viewPosition: { x: 0, y: 0 },
          deviceScaleFactor: 1, scale: 1
        });
      } catch (e) {}
      await new Promise(r => setTimeout(r, 300));
      let img = await rwin.webContents.capturePage();
      const sz = img.getSize();
      // ключовий фікс: перевіряємо І ширину, І висоту (раніше лише ширину → на деяких Маках кадр «їхав»)
      if (sz.width !== w || sz.height !== h) img = img.resize({ width: w, height: h, quality: 'best' });
      const p = path.join(dir, String(i + 1).padStart(2, '0') + '.png');
      fs.writeFileSync(p, img.toPNG());
      paths.push(p);
    }
  } finally { rwin.destroy(); }
  if (paths.length) shell.showItemInFolder(paths[0]);
  return { dir, count: paths.length };
});

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 960, minWidth: 1040, minHeight: 680,
    title: 'Карусель-панель · Глибокі сенси',
    backgroundColor: '#fafafa',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
  });
  win.loadURL(URL);
  // зовнішні посилання (Instagram тощо) — у системному браузері, не в застосунку
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http') && !url.startsWith(URL)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ping(up => {
    if (up) createWindow();                       // движок уже піднятий — просто відкриваємо
    else { startServer(); waitForServer(() => createWindow()); }
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('quit', () => { if (serverProc) { try { serverProc.kill(); } catch (e) {} } });
