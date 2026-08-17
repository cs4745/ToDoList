const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

let mainWindow;
let tray = null;
let isQuiting = false;

// 数据目录解析：优先用 exe 同目录（便携），若该目录不可写（如装在 Program Files）
// 则自动回退到用户数据目录 userData，保证数据一定能落盘、不会静默丢失。
let _resolvedDataDir = null;
function resolveDataDir() {
  if (_resolvedDataDir) return _resolvedDataDir;
  const portable = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
  const candidates = [portable];
  if (app.isPackaged) candidates.push(app.getPath('userData'));
  for (const dir of candidates) {
    try {
      const probe = path.join(dir, '.wb_writetest_' + process.pid);
      fs.writeFileSync(probe, '');
      fs.unlinkSync(probe);
      _resolvedDataDir = dir;
      return dir;
    } catch (e) {
      // 该目录不可写，尝试下一个候选
    }
  }
  _resolvedDataDir = portable; // 都不行时仍尝试便携目录（至少给出明确错误）
  return _resolvedDataDir;
}
function appDir() {
  return resolveDataDir();
}
function dataPath() {
  return path.join(appDir(), 'todos.json');
}
function boundsPath() {
  return path.join(appDir(), 'bounds.json');
}

const MIN_W = 300;
const MIN_H = 380;
const SNAP = 24;       // 距屏幕边缘多少像素内自动吸附
const SLIVER = 6;      // 吸附隐藏后留在屏幕内的可见宽度（便于鼠标滑到边缘唤出）
const REVEAL = 12;     // 鼠标距边缘多少像素内触发重新出现

// 吸附 / 停靠状态
let docked = null;        // 'left' | 'right' | 'top' | 'bottom' | null
let dockedBounds = null;  // 吸附后的「贴合」位置（非隐藏位置）
let hidden = false;       // 当前是否处于隐藏（仅留侧边一条）状态
let pollTimer = null;

// ---------- 窗口尺寸/位置持久化 ----------
function loadBounds() {
  try {
    const bp = boundsPath();
    if (fs.existsSync(bp)) {
      const b = JSON.parse(fs.readFileSync(bp, 'utf8'));
      if (b && typeof b.width === 'number') return b;
    }
  } catch (e) {}
  return null;
}

let boundsTimer = null;
function saveBoundsNow(b) {
  try { fs.writeFileSync(boundsPath(), JSON.stringify(b)); } catch (e) {}
}
function saveBoundsDebounced() {
  if (boundsTimer) clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    if (!mainWindow) return;
    // 停靠时保存「贴合」位置，而不是隐藏后的侧边位置
    const b = docked ? dockedBounds : mainWindow.getBounds();
    saveBoundsNow(b);
  }, 400);
}

// ---------- 边缘检测与停靠几何 ----------
function edgeOf(b) {
  const disp = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const area = disp.workArea;
  const dl = b.x - area.x;
  const dr = (area.x + area.width) - (b.x + b.width);
  const dt = b.y - area.y;
  const db = (area.y + area.height) - (b.y + b.height);
  const minH = Math.min(dl, dr);
  const minV = Math.min(dt, db);
  if (minH <= SNAP && minH <= minV) return dl <= dr ? 'left' : 'right';
  if (minV <= SNAP) return dt <= db ? 'top' : 'bottom';
  return null;
}

function flushBounds(edge, b, area) {
  const nb = { x: b.x, y: b.y, width: b.width, height: b.height };
  if (edge === 'left') nb.x = area.x;
  else if (edge === 'right') nb.x = area.x + area.width - b.width;
  else if (edge === 'top') nb.y = area.y;
  else if (edge === 'bottom') nb.y = area.y + area.height - b.height;
  return nb;
}

function hiddenBounds(edge, flush, area) {
  const nb = { x: flush.x, y: flush.y, width: flush.width, height: flush.height };
  if (edge === 'left') nb.x = area.x - flush.width + SLIVER;
  else if (edge === 'right') nb.x = area.x + area.width - SLIVER;
  else if (edge === 'top') nb.y = area.y - flush.height + SLIVER;
  else if (edge === 'bottom') nb.y = area.y + area.height - SLIVER;
  return nb;
}

// 鼠标是否处于「该边缘 + 窗口对应跨度」范围内（用于唤出）
function cursorReveals(edge, area, winB) {
  const cp = screen.getCursorScreenPoint();
  if (edge === 'left' || edge === 'right') {
    const xOK = edge === 'left'
      ? cp.x <= area.x + REVEAL
      : cp.x >= area.x + area.width - REVEAL;
    const yOK = cp.y >= winB.y - 60 && cp.y <= winB.y + winB.height + 60;
    return xOK && yOK;
  } else {
    const yOK = edge === 'top'
      ? cp.y <= area.y + REVEAL
      : cp.y >= area.y + area.height - REVEAL;
    const xOK = cp.x >= winB.x - 60 && cp.x <= winB.x + winB.width + 60;
    return yOK && xOK;
  }
}

function startPoll() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (!docked || !mainWindow) { stopPoll(); return; }
    const b = mainWindow.getBounds();
    const disp = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    const area = disp.workArea;
    const reveal = cursorReveals(docked, area, b) || mainWindow.isFocused();
    if (reveal) {
      if (hidden) { mainWindow.setBounds(dockedBounds); hidden = false; }
    } else {
      if (!hidden) { mainWindow.setBounds(hiddenBounds(docked, dockedBounds, area)); hidden = true; }
    }
  }, 150);
}

function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// 拖动结束：判定是否贴边 → 吸附并隐藏，否则正常保存
function onDragEnd() {
  const b = mainWindow.getBounds();
  const disp = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const area = disp.workArea;
  const edge = edgeOf(b);
  if (edge) {
    const flush = flushBounds(edge, b, area);
    docked = edge;
    dockedBounds = flush;
    hidden = false;
    mainWindow.setBounds(flush);
    mainWindow.setBounds(hiddenBounds(edge, flush, area));
    hidden = true;
    saveBoundsNow(flush);
    startPoll();
  } else {
    docked = null;
    stopPoll();
    saveBoundsNow(b);
  }
}

function isValidPos(x, y, w, h) {
  if (x == null || y == null) return false;
  const disp = screen.getDisplayMatching({ x, y, width: w, height: h });
  return !!(disp && disp.bounds);
}

function createWindow() {
  const saved = loadBounds();

  const opts = {
    width: saved ? Math.max(MIN_W, saved.width) : 400,
    height: saved ? Math.max(MIN_H, saved.height) : 600,
    minWidth: MIN_W,
    minHeight: MIN_H,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  };

  if (saved && isValidPos(saved.x, saved.y, opts.width, opts.height)) {
    opts.x = saved.x;
    opts.y = saved.y;
  }

  mainWindow = new BrowserWindow(opts);
  mainWindow.loadFile('index.html');

  // 自定义拖拽（在 renderer 中通过 pointer 事件 + movementX/Y 实现，避免与系统拖拽冲突）
  mainWindow.on('resized', saveBoundsDebounced);
  mainWindow.on('move', saveBoundsDebounced);

  // 点击 × 不直接退出，而是收进系统托盘（避免丢失入口）
  mainWindow.on('close', (e) => {
    if (!isQuiting) {
      e.preventDefault();
      hideToTray();
    }
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });

  if (!tray) createTray();
}

// ---------- 系统托盘 ----------
function showWindow() {
  if (!mainWindow) return;
  if (docked && dockedBounds) {
    mainWindow.setBounds(dockedBounds);
    hidden = false;
  }
  mainWindow.show();
  mainWindow.focus();
  if (docked) startPoll();
}

function hideToTray() {
  if (!mainWindow) return;
  stopPoll(); // 收进托盘时冻结边缘吸附轮询
  mainWindow.hide();
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  try {
    tray = new Tray(iconPath);
  } catch (e) {
    try { tray = new Tray(nativeImage.createEmpty()); } catch (_) { tray = null; }
  }
  if (!tray) return;
  tray.setToolTip('每周待办');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示窗口', click: () => showWindow() },
    { type: 'separator' },
    { label: '退出', click: () => { isQuiting = true; app.quit(); } }
  ]));
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) hideToTray();
    else showWindow();
  });
  tray.on('double-click', () => showWindow());
}

app.on('ready', createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});

// ---------- 自定义拖拽 IPC ----------
ipcMain.on('drag-delta', (event, { dx, dy }) => {
  if (!mainWindow) return;
  // 开始拖动则解除停靠（先把停靠窗口从隐藏位恢复到贴合位，再跟随鼠标）
  if (docked) {
    docked = null;
    stopPoll();
    if (dockedBounds) { mainWindow.setBounds(dockedBounds); hidden = false; }
  }
  const b = mainWindow.getBounds();
  mainWindow.setBounds({ x: b.x + dx, y: b.y + dy, width: b.width, height: b.height });
});

ipcMain.on('drag-end', () => {
  if (mainWindow) onDragEnd();
});

// ---------- 数据持久化（便携：保存在 exe 同目录） ----------
function migrateIfNeeded() {
  if (app.isPackaged) {
    const old = path.join(app.getPath('userData'), 'todos.json');
    const dp = dataPath();
    if (!fs.existsSync(dp) && fs.existsSync(old)) {
      try { fs.copyFileSync(old, dp); } catch (e) {}
    }
  }
}

ipcMain.handle('save-todos', async (event, todos) => {
  try {
    fs.writeFileSync(dataPath(), JSON.stringify(todos, null, 2));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-todos', async () => {
  try {
    const dp = dataPath();
    migrateIfNeeded();
    const dataDir = path.dirname(dp);
    const portableDir = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
    const fallback = dataDir !== portableDir;
    if (fs.existsSync(dp)) {
      const data = fs.readFileSync(dp, 'utf8');
      return { success: true, todos: JSON.parse(data), dataDir, fallback };
    }
    return { success: true, todos: [], dataDir, fallback };
  } catch (error) {
    return { success: false, error: error.message, todos: [] };
  }
});

// 右上角关闭按钮 → 收进系统托盘（隐藏窗口，不退出程序）
ipcMain.handle('close-window', () => {
  hideToTray();
});

// 最小化按钮 → 最小化到任务栏
ipcMain.handle('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

// ---------- 设置：开机启动 ----------
ipcMain.handle('get-autostart', () => {
  try {
    const s = app.getLoginItemSettings();
    return { success: true, enabled: !!s.openAtLogin };
  } catch (e) {
    return { success: false, enabled: false, error: e.message };
  }
});

ipcMain.handle('set-autostart', (event, enabled) => {
  try {
    if (!app.isPackaged) {
      return { success: true, dev: true, enabled: !!enabled };
    }
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    return { success: true, enabled: !!enabled };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ---------- 设置：桌面快捷方式 ----------
ipcMain.handle('create-shortcut', async () => {
  try {
    const exePath = app.getPath('exe');
    const desktop = app.getPath('desktop');
    const linkPath = path.join(desktop, '每周待办.lnk');
    const workDir = path.dirname(exePath);
    const esc = (s) => s.replace(/'/g, "''");
    const ps =
      `$WshShell = New-Object -ComObject WScript.Shell; ` +
      `$Shortcut = $WshShell.CreateShortcut('${esc(linkPath)}'); ` +
      `$Shortcut.TargetPath = '${esc(exePath)}'; ` +
      `$Shortcut.WorkingDirectory = '${esc(workDir)}'; ` +
      `$Shortcut.IconLocation = '${esc(exePath)},0'; ` +
      `$Shortcut.Description = '每周待办'; ` +
      `$Shortcut.Save()`;
    await new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    return { success: true, path: linkPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
