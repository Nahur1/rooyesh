'use strict';
// rooyesh desktop shell (Electron). Serves the offline web app from a private app:// origin.
const { app, BrowserWindow, Menu, shell, protocol, net, session, dialog, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const APP_ID = 'ir.rooyesh.desktop';
const ROOT = path.join(__dirname, 'app');
const ORIGIN = 'app://nava'; // Legacy origin preserves existing browser storage.
app.setPath('userData', path.join(app.getPath('appData'), 'Nava')); // Preserve the installed profile.

app.setAppUserModelId(APP_ID); // needed for Windows notifications
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function readState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; }
}
function saveState() {
  if (!win || win.isDestroyed()) return;
  try { fs.writeFileSync(stateFile(), JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() })); } catch { /* ignore */ }
}

function isExternal(url) { return /^(https?:|mailto:|tel:)/i.test(url); }

function createWindow() {
  const st = readState();
  win = new BrowserWindow({
    width: (st.bounds && st.bounds.width) || 1280,
    height: (st.bounds && st.bounds.height) || 860,
    x: st.bounds && st.bounds.x, y: st.bounds && st.bounds.y,
    minWidth: 360, minHeight: 520,
    title: 'رویش',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#191919' : '#F4F1EA',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, backgroundThrottling: false, // keep the focus timer accurate when minimized
    },
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', saveState);

  // Links to the web open in the user's browser; the app never navigates away from itself.
  win.webContents.setWindowOpenHandler(({ url }) => { if (isExternal(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN + '/')) { e.preventDefault(); if (isExternal(url)) shell.openExternal(url); }
  });

  // Right-click menu for text editing (Persian labels).
  win.webContents.on('context-menu', (_e, p) => {
    const items = [];
    if (p.isEditable) {
      items.push({ label: 'برش', role: 'cut', enabled: p.editFlags.canCut },
        { label: 'کپی', role: 'copy', enabled: p.editFlags.canCopy },
        { label: 'چسباندن', role: 'paste', enabled: p.editFlags.canPaste },
        { type: 'separator' }, { label: 'انتخاب همه', role: 'selectAll' });
    } else if (p.selectionText && p.selectionText.trim()) {
      items.push({ label: 'کپی', role: 'copy' });
    }
    if (p.linkURL && isExternal(p.linkURL)) {
      if (items.length) items.push({ type: 'separator' });
      items.push({ label: 'باز کردن لینک در مرورگر', click: () => shell.openExternal(p.linkURL) });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  win.loadURL(ORIGIN + '/index.html');
}

// Minimal menu: keeps standard shortcuts (copy/paste, zoom, reload, full screen) without a visible bar.
function buildMenu() {
  const tpl = [
    { label: 'رویش', submenu: [{ label: 'خروج', role: 'quit' }] },
    { label: 'ویرایش', submenu: [
      { label: 'واگرد', role: 'undo' }, { label: 'ازنو', role: 'redo' }, { type: 'separator' },
      { label: 'برش', role: 'cut' }, { label: 'کپی', role: 'copy' }, { label: 'چسباندن', role: 'paste' }, { label: 'انتخاب همه', role: 'selectAll' },
    ] },
    { label: 'نما', submenu: [
      { label: 'بارگذاری دوباره', role: 'reload' }, { type: 'separator' },
      { label: 'بزرگ‌نمایی', role: 'zoomIn' }, { label: 'کوچک‌نمایی', role: 'zoomOut' }, { label: 'اندازهٔ اصلی', role: 'resetZoom' },
      { type: 'separator' }, { label: 'تمام‌صفحه', role: 'togglefullscreen' },
    ] },
    { label: 'راهنما', submenu: [{ label: 'دربارهٔ رویش', click: () => dialog.showMessageBox(win, {
      type: 'info', title: 'دربارهٔ رویش', message: 'رویش ' + app.getVersion(),
      detail: 'دستیار آرام برای کارها، اهداف، تمرکز و یادگیری.\nهمهٔ داده‌ها فقط روی همین کامپیوتر ذخیره می‌شوند:\n' + app.getPath('userData'),
    }) }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (u.host !== 'nava' || !file.startsWith(ROOT + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // Allow notifications (focus timer end); deny everything else.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'notifications'));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'notifications');
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
