// Місток між панеллю (renderer) і рендером усередині Electron (main).
// Панель викликає window.karusel.exportPng(...) — і PNG малює вбудований Chromium,
// без зовнішнього Google Chrome. Якщо цього API немає (звичайний браузер) —
// панель сама відкочується на старий шлях (сервер + render.sh).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('karusel', {
  isDesktop: true,
  exportPng: (payload) => ipcRenderer.invoke('karusel:export', payload),
});
