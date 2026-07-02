// Рендер слайдів у PNG ВСЕРЕДИНІ Electron (замість зовнішнього Chrome / render.sh).
// Читає готові out/NN.html (їх генерує build.py) + out/_size.txt → out/NN.png.
// Це ядро самодостатнього рендеру для Рівня 2: прев'ю й експорт малює один рушій.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
const ENGINE = path.join(__dirname, '..');
const OUT = path.join(ENGINE, 'out');

app.whenReady().then(async () => {
  try {
    const [w, h] = fs.readFileSync(path.join(OUT, '_size.txt'), 'utf-8').trim().split(/\s+/).map(Number);
    const files = fs.readdirSync(OUT).filter(f => /^\d+\.html$/.test(f)).sort();
    // ОДНЕ переюзоване офскрін-вікно (створювати нове на кожен слайд ламає offscreen)
    const win = new BrowserWindow({
      show: false, width: w, height: h, useContentSize: true,
      webPreferences: { offscreen: true, sandbox: false }
    });
    for (const f of files) {
      await win.loadFile(path.join(OUT, f));            // file:// origin → фото/шрифти вантажаться
      // чекаємо шрифти й зображення детерміновано (а не «на око»)
      await win.webContents.executeJavaScript(
        'Promise.all([document.fonts.ready, ...[...document.images].map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r}))]).then(()=>true)'
      ).catch(() => {});
      await new Promise(r => setTimeout(r, 250));
      let img = await win.webContents.capturePage();
      if (img.getSize().width !== w) img = img.resize({ width: w, height: h, quality: 'best' });
      fs.writeFileSync(path.join(OUT, f.replace('.html', '.png')), img.toPNG());
      console.log('✓', f, '→', f.replace('.html', '.png'), img.getSize().width + 'x' + img.getSize().height);
    }
    win.destroy();
    console.log('DONE', files.length, 'слайдів @', w + 'x' + h);
  } catch (e) { console.error('RENDER_FAIL', e.message); }
  app.quit();
});
