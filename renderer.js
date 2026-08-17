const { ipcRenderer } = require('electron');

let state = {
  weekStart: null,
  shortTerm: [],
  longTerm: [],
  completed: []
};

let focusNewId = null;

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

  row.append(cb, text, note, del);
  return row;
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
  setupDrag();
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  await saveState(); // 把周切换后的归档结果落盘
  render();
  setup();
});
