const { ipcRenderer } = require('electron');

let state = {
  weekStart: null,
  shortTerm: [],
  longTerm: [],
  completed: []
};

let focusNewId = null;

// 拖拽排序状态
let draggedId = null;
let draggedCat = null;
let dragOverAfter = false;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function mondayOf(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // 周一=0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function weekRangeLabel() {
  const start = mondayOf(state.weekStart || new Date());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `本周 ${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
}

// ---------- 持久化 ----------
async function loadState() {
  const res = await ipcRenderer.invoke('load-todos');
  const data = res.success ? res.todos : null;
  state.dataDir = res.dataDir || '';
  // 若数据无法写入程序目录（如装在 Program Files），已回退到用户目录，提示一次
  if (res.fallback && res.dataDir) {
    setTimeout(() => toast('程序目录不可写，数据已改存到：\n' + res.dataDir), 500);
  }

  if (Array.isArray(data)) {
    // 兼容旧版按天存储的格式
    state = {
      weekStart: fmtDate(mondayOf(new Date())),
      shortTerm: data.map(migrateOld),
      longTerm: [],
      completed: []
    };
  } else if (data && typeof data === 'object') {
    state = {
      weekStart: data.weekStart || fmtDate(mondayOf(new Date())),
      shortTerm: Array.isArray(data.shortTerm) ? data.shortTerm : [],
      longTerm: Array.isArray(data.longTerm) ? data.longTerm : [],
      completed: Array.isArray(data.completed) ? data.completed : []
    };
  } else {
    state = { weekStart: fmtDate(mondayOf(new Date())), shortTerm: [], longTerm: [], completed: [] };
  }

  checkWeekRollover();
}

function migrateOld(t) {
  return {
    id: t.id || uid(),
    text: t.title || '',
    note: t.notes || '',
    done: !!t.completed,
    createdAt: t.createdAt || new Date().toISOString(),
    completedAt: t.completed ? (t.completedAt || new Date().toISOString()) : null
  };
}

function checkWeekRollover() {
  const cur = fmtDate(mondayOf(new Date()));
  if (state.weekStart !== cur) {
    archiveDone();
    state.weekStart = cur;
  }
}

async function saveState() {
  const res = await ipcRenderer.invoke('save-todos', state);
  if (res && res.success === false) {
    toast('保存失败：' + (res.error || '未知错误'));
  }
}

// 轻量提示条（无需额外 CSS）
function toast(msg) {
  let t = document.getElementById('wb-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'wb-toast';
    t.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);' +
      'background:rgba(20,20,20,.88);color:#fff;padding:8px 14px;border-radius:8px;' +
      'font-size:13px;line-height:1.5;z-index:9999;max-width:90%;white-space:pre-line;' +
      'pointer-events:none;opacity:0;transition:opacity .2s;box-shadow:0 4px 12px rgba(0,0,0,.25);';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 3200);
}

// 把已完成条目移动到「已完成」归档，并从当前列表移除
function archiveDone() {
  const move = (list, cat) => {
    const remaining = [];
    list.forEach((it) => {
      if (it.done) {
        state.completed.push({
          id: it.id,
          text: it.text,
          note: it.note || '',
          category: cat,
          createdAt: it.createdAt,
          completedAt: it.completedAt || new Date().toISOString()
        });
      } else {
        remaining.push(it);
      }
    });
    return remaining;
  };
  state.shortTerm = move(state.shortTerm, 'short');
  state.longTerm = move(state.longTerm, 'long');
}

// ---------- 渲染 ----------
function render() {
  document.getElementById('weekLabel').textContent = weekRangeLabel();
  document.getElementById('completedCount').textContent = state.completed.length;
  renderList('shortList', state.shortTerm, 'short');
  renderList('longList', state.longTerm, 'long');
  if (focusNewId) {
    const el = document.querySelector(`[data-id="${focusNewId}"] .todo-text`);
    if (el) el.focus();
    focusNewId = null;
  }
}

function renderList(elId, items, category) {
  const el = document.getElementById(elId);
  el.innerHTML = '';
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'list-empty';
    empty.textContent = '暂无，点右侧「+ 添加」';
    el.appendChild(empty);
    return;
  }
  items.forEach((it) => el.appendChild(createRow(it, category)));
}

function createRow(item, category) {
  const row = document.createElement('div');
  row.className = 'todo-row' + (item.done ? ' done' : '');
  row.dataset.id = item.id;

  const handle = document.createElement('div');
  handle.className = 'todo-handle';
  handle.textContent = '☰';
  handle.title = '拖动调整顺序';
  handle.draggable = true;
  handle.addEventListener('dragstart', (e) => onDragStart(e, item, category, row));
  handle.addEventListener('dragend', (e) => onDragEnd(e, row));

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'todo-check';
  cb.checked = item.done;
  cb.title = '完成打勾';
  cb.addEventListener('change', () => toggleDone(item, category));

  const text = document.createElement('input');
  text.type = 'text';
  text.className = 'todo-text';
  text.value = item.text;
  text.placeholder = '任务内容…';
  text.addEventListener('input', () => { item.text = text.value; saveState(); });
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter') text.blur(); });

  const note = document.createElement('input');
  note.type = 'text';
  note.className = 'todo-note';
  note.value = item.note || '';
  note.placeholder = '备注/进度';
  note.title = '备注或进度';
  note.addEventListener('input', () => { item.note = note.value; saveState(); });
  note.addEventListener('keydown', (e) => { if (e.key === 'Enter') note.blur(); });

  const del = document.createElement('button');
  del.className = 'todo-del';
  del.textContent = '×';
  del.title = '删除';
  del.addEventListener('click', () => deleteItem(item, category));

  row.append(handle, cb, text, note, del);

  row.addEventListener('dragover', (e) => onDragOver(e, item, row));
  row.addEventListener('dragleave', (e) => onDragLeave(e, row));
  row.addEventListener('drop', (e) => onDrop(e, item, category, row));

  return row;
}

// ---------- 拖拽排序 ----------
function clearDropMarkers() {
  document.querySelectorAll('.drop-before, .drop-after')
    .forEach(r => r.classList.remove('drop-before', 'drop-after'));
}
function clearDragState() {
  document.querySelectorAll('.dragging').forEach(r => r.classList.remove('dragging'));
  clearDropMarkers();
  draggedId = null;
  draggedCat = null;
}

function onDragStart(e, item, category, row) {
  e.stopPropagation();
  draggedId = item.id;
  draggedCat = category;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', item.id); } catch (_) {}
  setTimeout(() => row.classList.add('dragging'), 0);
}

function onDragOver(e, item, row) {
  if (!draggedId || draggedId === item.id) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const r = row.getBoundingClientRect();
  const after = (e.clientY - r.top) > r.height / 2;
  dragOverAfter = after;
  clearDropMarkers();
  row.classList.add(after ? 'drop-after' : 'drop-before');
}

function onDragLeave(e, row) {
  if (row.contains(e.relatedTarget)) return; // 仍在行内移动
  row.classList.remove('drop-before', 'drop-after');
}

function onDrop(e, item, category, row) {
  e.preventDefault();
  row.classList.remove('drop-before', 'drop-after');
  if (!draggedId) return;
  const after = dragOverAfter;
  const srcId = draggedId, srcCat = draggedCat;
  clearDragState();
  if (srcId === item.id && srcCat === category) return;
  moveItem(srcId, srcCat, item.id, category, after);
}

function onDragEnd() {
  clearDragState();
}

async function moveItem(srcId, srcCat, targetId, targetCat, after) {
  if (srcId === targetId) return;
  const srcList = srcCat === 'short' ? state.shortTerm : state.longTerm;
  const tgtList = targetCat === 'short' ? state.shortTerm : state.longTerm;
  const from = srcList.findIndex(t => t.id === srcId);
  if (from < 0) return;
  const [moved] = srcList.splice(from, 1);
  let to;
  if (targetId == null) {
    to = tgtList.length;
  } else {
    to = tgtList.findIndex(t => t.id === targetId);
    if (to < 0) to = tgtList.length;
    if (after) to += 1;
  }
  tgtList.splice(to, 0, moved);
  await saveState();
  render();
}

// ---------- 操作 ----------
async function toggleDone(item, category) {
  item.done = !item.done;
  item.completedAt = item.done ? new Date().toISOString() : null;
  await saveState();
  render();
}

async function deleteItem(item, category) {
  if (!confirm('确定删除该条目？')) return;
  const list = category === 'short' ? state.shortTerm : state.longTerm;
  const i = list.findIndex((t) => t.id === item.id);
  if (i >= 0) list.splice(i, 1);
  await saveState();
  render();
}

async function addItem(category) {
  const item = {
    id: uid(),
    text: '',
    note: '',
    done: false,
    createdAt: new Date().toISOString(),
    completedAt: null
  };
  if (category === 'short') state.shortTerm.push(item);
  else state.longTerm.push(item);
  focusNewId = item.id;
  await saveState();
  render();
}

async function archiveNow() {
  archiveDone();
  await saveState();
  render();
}

// ---------- 导出每周工作内容为 HTML ----------
async function exportWeeklyHtml() {
  const payload = {
    weekStart: state.weekStart,
    shortTerm: state.shortTerm,
    longTerm: state.longTerm,
    completed: state.completed,
    weekLabel: weekRangeLabel()
  };
  const res = await ipcRenderer.invoke('export-weekly-html', payload);
  if (res && res.success) {
    toast('已导出到：\n' + res.path);
  } else if (res && res.canceled) {
    // 用户取消保存，静默处理
  } else {
    toast('导出失败：' + ((res && res.error) || '未知错误'));
  }
}

// ---------- 软件更新 ----------
async function checkUpdate() {
  const res = await ipcRenderer.invoke('check-for-updates');
  if (res && res.dev) {
    toast('开发模式下不检查更新（打包后生效）');
  } else if (res && res.success) {
    toast('正在检查更新…');
  } else {
    toast('检查更新失败：' + ((res && res.error) || '未知错误'));
  }
}

function onUpdateStatus(p) {
  if (!p) return;
  if (p.type === 'available') {
    toast('发现新版本 v' + (p.version || '') + '，开始下载…');
  } else if (p.type === 'not-available') {
    toast('已是最新版本 v' + (p.version || ''));
  } else if (p.type === 'progress') {
    toast('正在下载更新… ' + (p.percent || 0) + '%');
  } else if (p.type === 'downloaded') {
    toast('更新已下载，重启后生效');
  } else if (p.type === 'error') {
    toast('更新出错：' + (p.message || '未知错误'));
  }
}

// ---------- 已完成归档面板 ----------
function openCompleted() {
  const el = document.getElementById('completedList');
  el.innerHTML = '';
  const sorted = [...state.completed].sort((a, b) =>
    (b.completedAt || '').localeCompare(a.completedAt || ''));
  if (sorted.length === 0) {
    el.innerHTML = '<div class="list-empty">暂无已完成记录</div>';
  } else {
    sorted.forEach((c) => {
      const item = document.createElement('div');
      item.className = 'completed-item';

      const txt = document.createElement('div');
      txt.className = 'ci-text';
      txt.textContent = c.text || '(无内容)';

      const meta = document.createElement('div');
      meta.className = 'ci-meta';
      const cat = c.category === 'short' ? '短期' : '长期';
      meta.textContent = `${cat} · 添加 ${fmtDateTime(c.createdAt)} · 完成 ${fmtDateTime(c.completedAt)}`;

      const note = document.createElement('div');
      note.className = 'ci-note';
      note.textContent = c.note || '';
      if (!c.note) note.style.display = 'none';

      item.append(txt, note, meta);
      el.appendChild(item);
    });
  }
  document.getElementById('completedOverlay').classList.add('show');
}

function closeCompleted() {
  document.getElementById('completedOverlay').classList.remove('show');
}

// ---------- 设置面板 ----------
let statusTimer = null;
function setSettingsStatus(msg, isError) {
  const el = document.getElementById('settingsStatus');
  el.textContent = msg || '';
  el.classList.toggle('error', !!isError);
  if (statusTimer) clearTimeout(statusTimer);
  if (msg) {
    statusTimer = setTimeout(() => { el.textContent = ''; el.classList.remove('error'); }, 3000);
  }
}

async function openSettings() {
  const res = await ipcRenderer.invoke('get-autostart');
  const toggle = document.getElementById('autostartToggle');
  toggle.checked = !!(res && res.enabled);
  setSettingsStatus('');
  document.getElementById('settingsOverlay').classList.add('show');
}

function closeSettings() {
  document.getElementById('settingsOverlay').classList.remove('show');
}

async function onAutostartChange(e) {
  const enabled = e.target.checked;
  const res = await ipcRenderer.invoke('set-autostart', enabled);
  if (res && res.success) {
    if (res.dev) setSettingsStatus('开发模式下不写入注册表（打包后生效）');
    else setSettingsStatus(enabled ? '已开启开机启动' : '已关闭开机启动');
  } else {
    e.target.checked = !enabled;
    setSettingsStatus('设置失败：' + ((res && res.error) || '未知错误'), true);
  }
}

async function onCreateShortcut() {
  const res = await ipcRenderer.invoke('create-shortcut');
  if (res && res.success) {
    setSettingsStatus('已创建桌面快捷方式');
  } else {
    setSettingsStatus('创建失败：' + ((res && res.error) || '未知错误'), true);
  }
}

// ---------- 自定义拖拽（顶部菜单栏） ----------
function setupDrag() {
  const header = document.querySelector('.header');
  if (!header) return;
  let dragging = false;

  header.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return; // 按钮不触发拖拽
    dragging = true;
    try { header.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });

  header.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    ipcRenderer.send('drag-delta', { dx: e.movementX || 0, dy: e.movementY || 0 });
  });

  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    try { header.releasePointerCapture(e.pointerId); } catch (_) {}
    ipcRenderer.send('drag-end');
  };
  header.addEventListener('pointerup', end);
  header.addEventListener('pointercancel', end);
}

// ---------- 初始化 ----------
function setup() {
  document.getElementById('minimizeBtn').addEventListener('click', () => {
    ipcRenderer.invoke('minimize-window');
  });
  document.getElementById('closeBtn').addEventListener('click', () => {
    ipcRenderer.invoke('close-window');
  });
  document.querySelectorAll('.add-inline').forEach((btn) => {
    btn.addEventListener('click', () => addItem(btn.dataset.cat));
  });
  document.getElementById('archiveBtn').addEventListener('click', archiveNow);
  document.getElementById('exportBtn').addEventListener('click', exportWeeklyHtml);
  document.getElementById('updateBtn').addEventListener('click', checkUpdate);
  ipcRenderer.on('update-status', (e, p) => onUpdateStatus(p));
  document.getElementById('completedBtn').addEventListener('click', openCompleted);
  document.getElementById('closeOverlay').addEventListener('click', closeCompleted);
  document.getElementById('completedOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'completedOverlay') closeCompleted();
  });
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('closeSettings').addEventListener('click', closeSettings);
  document.getElementById('settingsOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'settingsOverlay') closeSettings();
  });
  document.getElementById('autostartToggle').addEventListener('change', onAutostartChange);
  document.getElementById('shortcutBtn').addEventListener('click', onCreateShortcut);
  // 列表容器：拖到列表空白/空列表时，把条目追加到该列表末尾
  ['shortList', 'longList'].forEach((id) => {
    const cat = id === 'shortList' ? 'short' : 'long';
    const el = document.getElementById(id);
    el.addEventListener('dragover', (e) => {
      if (!draggedId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    el.addEventListener('drop', async (e) => {
      if (!draggedId) return;
      if (e.target.id !== id) return; // 仅当落在容器自身（而非某行）上
      e.preventDefault();
      const srcId = draggedId, srcCat = draggedCat;
      clearDragState();
      await moveItem(srcId, srcCat, null, cat, true);
    });
  });
  setupDrag();
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  await saveState(); // 把周切换后的归档结果落盘
  render();
  setup();
});
