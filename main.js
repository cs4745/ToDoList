const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog } = require('electron');

// electron-builder 的 portable 目标会把自身解压到 Temp 临时目录再运行，
// 此时 app.getPath('exe') 指向 Temp 解压路径，而非用户存放 exe 的原始位置（E:\ToDolist 等）。
// electron-builder 通过环境变量 PORTABLE_EXECUTABLE_DIR / PORTABLE_EXECUTABLE_FILE 暴露原始位置，统一用这两个取值。
function originalExeFile() {
  return process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');
}
function originalExeDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  return path.dirname(originalExeFile());
}
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
  const portable = originalExeDir();
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

  // 防护：若程序是从临时目录（Temp）运行的（常见于压缩包内直接双击、网盘/聊天窗口直接打开），
  // 数据、开机启动、快捷方式都会指向临时路径，系统清理后全部失效。弹窗提醒用户从正式位置启动。
  if (isRunningInTemp()) {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '程序正运行在临时目录',
      message:
        '当前程序是从 Windows 临时文件夹（Temp）启动的，并非你存放 exe 的正式位置。\n\n' +
        '这会导致：\n' +
        '• 数据（todos.json）保存在临时目录，系统清理或重启后丢失\n' +
        '• 若开启「开机启动」，启动项会指向临时路径，重启后失效\n\n' +
        '请关闭本程序，直接到你存放 exe 的正式目录（例如 E:\\ToDolist）双击启动。',
      buttons: ['知道了']
    });
  }
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

// 检测是否从临时目录（Temp）运行：临时目录不能作为正式使用位置
function isRunningInTemp() {
  try {
    const tmp = app.getPath('temp');
    const exe = originalExeFile();
    const rel = path.relative(tmp, exe);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  } catch (e) {
    return false;
  }
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

// 从「解压到 Temp 的运行副本」抢救已有数据：旧版本把数据写在了 Temp 解压目录，
// 切换到正确的原始 exe 目录后，把那份 todos.json 复制过来（不覆盖已有数据）。
function migrateFromRunningTempIfNeeded(dp) {
  if (fs.existsSync(dp)) return;
  try {
    const runningDir = path.dirname(app.getPath('exe')); // 当前运行的解压后 Temp 目录
    const runningData = path.join(runningDir, 'todos.json');
    if (runningData !== dp && fs.existsSync(runningData)) {
      fs.copyFileSync(runningData, dp);
    }
  } catch (e) {}
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
    migrateFromRunningTempIfNeeded(dp);
    const dataDir = path.dirname(dp);
    const portableDir = originalExeDir();
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
    app.setLoginItemSettings({ openAtLogin: !!enabled, path: originalExeFile() });
    return { success: true, enabled: !!enabled };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ---------- 设置：桌面快捷方式 ----------
ipcMain.handle('create-shortcut', async () => {
  try {
    const exePath = originalExeFile();
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

// ---------- 导出每周工作内容为 HTML ----------
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function fmtD(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtDT(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${fmtD(s)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function buildWeeklyHtml(p) {
  p = p || {};
  const weekLabel = p.weekLabel || '';
  const short = Array.isArray(p.shortTerm) ? p.shortTerm : [];
  const long = Array.isArray(p.longTerm) ? p.longTerm : [];
  const completed = (Array.isArray(p.completed) ? p.completed : [])
    .slice()
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));

  const rowHtml = (it) => {
    const done = it.done ? 'done' : '';
    const mark = it.done ? '✓' : '○';
    const note = it.note ? `<span class="note">${escapeHtml(it.note)}</span>` : '';
    return `<li class="${done}"><span class="mark">${mark}</span><span class="text">${escapeHtml(it.text)}</span>${note}</li>`;
  };
  const completedHtml = completed.map((c) => {
    const cat = c.category === 'short' ? '本周' : '长期';
    return `<li><span class="text">${escapeHtml(c.text || '')}</span><span class="meta">${cat} · 完成 ${fmtDT(c.completedAt)}</span></li>`;
  }).join('');
  const now = fmtDT(new Date().toISOString());

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>每周工作内容 · ${escapeHtml(weekLabel)}</title>
<style>
  body { font-family: 'Segoe UI','Microsoft YaHei',sans-serif; background:#f4f6f9; color:#212529; margin:0; padding:32px; }
  .wrap { max-width:760px; margin:0 auto; background:#fff; border-radius:14px; box-shadow:0 8px 32px rgba(0,0,0,.08); padding:32px 36px; }
  h1 { font-size:22px; margin:0 0 4px; }
  .week { color:#667eea; font-size:14px; margin-bottom:24px; }
  h2 { font-size:16px; margin:24px 0 12px; padding-left:10px; border-left:4px solid #667eea; }
  ul { list-style:none; margin:0; padding:0; }
  li { display:flex; align-items:baseline; gap:10px; padding:8px 10px; border-radius:8px; }
  li:nth-child(odd) { background:#f8f9fa; }
  .mark { color:#667eea; font-weight:700; width:16px; flex:0 0 auto; }
  li.done .mark, li.done .text { color:#adb5bd; text-decoration:line-through; }
  .text { flex:1; }
  .note { color:#868e96; font-size:12px; }
  .meta { color:#adb5bd; font-size:12px; }
  .empty { color:#adb5bd; font-size:13px; padding:8px 10px; }
  .foot { margin-top:28px; color:#adb5bd; font-size:12px; text-align:right; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>每周工作内容</h1>
    <div class="week">${escapeHtml(weekLabel)} · 导出时间 ${escapeHtml(now)}</div>
    <h2>本周任务</h2>
    ${short.length ? `<ul>${short.map(rowHtml).join('')}</ul>` : '<div class="empty">暂无</div>'}
    <h2>长期任务</h2>
    ${long.length ? `<ul>${long.map(rowHtml).join('')}</ul>` : '<div class="empty">暂无</div>'}
    <h2>已完成归档（${completed.length}）</h2>
    ${completed.length ? `<ul>${completedHtml}</ul>` : '<div class="empty">暂无已完成记录</div>'}
    <div class="foot">由「每周待办」生成</div>
  </div>
</body>
</html>`;
}

ipcMain.handle('export-weekly-html', async (event, payload) => {
  try {
    const html = buildWeeklyHtml(payload);
    const stamp = (payload && payload.weekStart) ? payload.weekStart : fmtD(new Date().toISOString());
    const defaultName = `每周工作内容_${stamp}.html`;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出每周工作内容',
      defaultPath: defaultName,
      filters: [{ name: 'HTML 网页', extensions: ['html'] }]
    });
    if (canceled || !filePath) return { success: false, canceled: true };
    fs.writeFileSync(filePath, html, 'utf8');
    return { success: true, path: filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
