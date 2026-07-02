// Карусель-панель — десктоп-обгортка (пілот).
// Застосунок сам піднімає движок (server.py) і показує панель у власному вікні.
// Це ПІЛОТ: рендер PNG поки йде через той самий Python + Chrome. Наступний крок —
// рендерити всередині Electron (щоб зовнішній Chrome і Python більше не були потрібні).

const { app, BrowserWindow, shell, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

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
  serverProc = spawn('python3', ['server.py'], { cwd: ENGINE, stdio: 'ignore' });
  serverProc.on('error', e => console.error('server spawn error:', e));
}

function waitForServer(done, tries = 0) {
  ping(up => {
    if (up) return done();
    if (tries > 80) return done(new Error('движок не піднявся за 20с'));
    setTimeout(() => waitForServer(done, tries + 1), 250);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 960, minWidth: 1040, minHeight: 680,
    title: 'Карусель-панель · Глибокі сенси',
    backgroundColor: '#fafafa',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true }
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
