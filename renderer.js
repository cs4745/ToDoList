const { ipcRenderer } = require('electron');

let todos = [];
let currentWeekOffset = 0;
let editingTodoId = null;

const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

document.addEventListener('DOMContentLoaded', async () => {
  await loadTodos();
  renderWeek();
  setupEventListeners();
});

async function loadTodos() {
  const result = await ipcRenderer.invoke('load-todos');
  if (result.success) {
    todos = result.todos || [];
  }
}

async function saveTodos() {
  await ipcRenderer.invoke('save-todos', todos);
}

function getWeekDates(offset = 0) {
  const today = new Date();
  const currentDay = today.getDay();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - currentDay + (offset * 7));
  startOfWeek.setHours(0, 0, 0, 0);

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + i);
    dates.push(date);
  }
  return dates;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function renderWeek() {
  const dates = getWeekDates(currentWeekOffset);
  const startDate = dates[0];
  const endDate = dates[6];
  const weekDisplay = `${startDate.getMonth() + 1}月${startDate.getDate()}日 - ${endDate.getMonth() + 1}月${endDate.getDate()}日`;
  document.getElementById('currentWeek').textContent = weekDisplay;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  document.getElementById('weekInfo').textContent = `今天: ${formatDate(today)}`;

  const container = document.getElementById('daysContainer');
  container.innerHTML = '';

  dates.forEach((date) => {
    const dateStr = formatDate(date);
    const isToday = date.getTime() === today.getTime();
    const dayTodos = todos.filter(todo => todo.date === dateStr);

    const dayCard = document.createElement('div');
    dayCard.className = `day-card ${isToday ? 'today' : ''}`;
    
    dayCard.innerHTML = `
      <div class="day-header">
        <span class="day-name">${weekDays[date.getDay()]}</span>
        <span class="day-date">${date.getMonth() + 1}/${date.getDate()}</span>
      </div>
      <div class="todos-list" data-date="${dateStr}">
        ${dayTodos.map(todo => renderTodoItem(todo)).join('')}
      </div>
    `;
    
    container.appendChild(dayCard);
  });

  updateDateSelect();
}

function renderTodoItem(todo) {
  return `
    <div class="todo-item ${todo.completed ? 'completed' : ''}" data-id="${todo.id}">
      <input type="checkbox" class="todo-checkbox" ${todo.completed ? 'checked' : ''} onclick="toggleTodo('${todo.id}')">
      <div class="todo-content">
        <div class="todo-title">${escapeHtml(todo.title)}</div>
        ${todo.notes ? `<div class="todo-notes">${escapeHtml(todo.notes)}</div>` : ''}
      </div>
      <div class="todo-actions">
        <button class="todo-action-btn" onclick="editTodo('${todo.id}')" title="编辑">✏️</button>
        <button class="todo-action-btn" onclick="deleteTodo('${todo.id}')" title="删除">🗑️</button>
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateDateSelect() {
  const select = document.getElementById('todoDate');
  const dates = getWeekDates(currentWeekOffset);
  select.innerHTML = dates.map(date => {
    const dateStr = formatDate(date);
    return `<option value="${dateStr}">${weekDays[date.getDay()]} ${date.getMonth() + 1}/${date.getDate()}</option>`;
  }).join('');
}

function setupEventListeners() {
  document.getElementById('minimizeBtn').addEventListener('click', () => {
    ipcRenderer.invoke('minimize-window');
  });

  document.getElementById('closeBtn').addEventListener('click', () => {
    ipcRenderer.invoke('close-window');
  });

  document.getElementById('prevWeek').addEventListener('click', () => {
    currentWeekOffset--;
    renderWeek();
  });

  document.getElementById('nextWeek').addEventListener('click', () => {
    currentWeekOffset++;
    renderWeek();
  });

  document.getElementById('addTodoBtn').addEventListener('click', () => {
    editingTodoId = null;
    document.getElementById('modalTitle').textContent = '添加待办事项';
    document.getElementById('todoTitle').value = '';
    document.getElementById('todoNotes').value = '';
    const today = formatDate(new Date());
    document.getElementById('todoDate').value = today;
    document.getElementById('todoModal').classList.add('show');
  });

  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);

  document.getElementById('saveBtn').addEventListener('click', saveTodo);
}

function closeModal() {
  document.getElementById('todoModal').classList.remove('show');
  editingTodoId = null;
}

window.toggleTodo = async function(id) {
  const todo = todos.find(t => t.id === id);
  if (todo) {
    todo.completed = !todo.completed;
    await saveTodos();
    renderWeek();
  }
}

window.editTodo = function(id) {
  const todo = todos.find(t => t.id === id);
  if (todo) {
    editingTodoId = id;
    document.getElementById('modalTitle').textContent = '编辑待办事项';
    document.getElementById('todoTitle').value = todo.title;
    document.getElementById('todoNotes').value = todo.notes || '';
    document.getElementById('todoDate').value = todo.date;
    document.getElementById('todoModal').classList.add('show');
  }
}

window.deleteTodo = async function(id) {
  if (confirm('确定要删除这个待办事项吗？')) {
    todos = todos.filter(t => t.id !== id);
    await saveTodos();
    renderWeek();
  }
}

async function saveTodo() {
  const title = document.getElementById('todoTitle').value.trim();
  const notes = document.getElementById('todoNotes').value.trim();
  const date = document.getElementById('todoDate').value;

  if (!title) {
    alert('请输入待办事项');
    return;
  }

  if (editingTodoId) {
    const todo = todos.find(t => t.id === editingTodoId);
    if (todo) {
      todo.title = title;
      todo.notes = notes;
      todo.date = date;
    }
  } else {
    const newTodo = {
      id: Date.now().toString(),
      title,
      notes,
      date,
      completed: false,
      createdAt: new Date().toISOString()
    };
    todos.push(newTodo);
  }

  await saveTodos();
  renderWeek();
  closeModal();
}
