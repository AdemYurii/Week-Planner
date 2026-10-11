'use strict';

/* =========================================================
   Week planner: Sunday to Saturday schedule, revision goal,
   progress tracker. Everything is saved in this browser's
   localStorage, so changes survive closing the tab.
   ========================================================= */

const STORAGE_KEY = 'weekPlanner.v1';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_GOAL_MIN = 15 * 60;

const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- small helpers ---------- */
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function sundayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function fromMin(m) { m = ((m % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; }
function fmtDur(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
function shortDate(d) { return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
function subjectColor(name) {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 62% 48%)`;
}

/* ---------- state + storage ---------- */
function defaultState() {
  return { weekStart: isoDate(sundayOf(new Date())), goalMin: DEFAULT_GOAL_MIN, tasks: [], history: [] };
}

function sanitize(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;

  const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(t => {
    if (!t || typeof t.title !== 'string') return null;
    const day = Number(t.day), dur = Number(t.duration);
    if (!Number.isInteger(day) || day < 0 || day > 6) return null;
    if (!/^\d{2}:\d{2}$/.test(t.start)) return null;
    if (!Number.isFinite(dur) || dur <= 0) return null;
    return {
      id: typeof t.id === 'string' && t.id ? t.id : uid(),
      title: t.title.slice(0, 120),
      subject: typeof t.subject === 'string' ? t.subject.slice(0, 60) : '',
      day, start: t.start, duration: Math.round(dur),
      type: t.type === 'other' ? 'other' : 'revision',
      done: !!t.done
    };
  }).filter(Boolean) : [];

  const history = Array.isArray(raw.history) ? raw.history
    .filter(h => h && typeof h.weekStart === 'string' && Number.isFinite(h.doneMin) && Number.isFinite(h.goalMin))
    .map(h => ({ weekStart: h.weekStart, doneMin: h.doneMin, plannedMin: Number(h.plannedMin) || 0, goalMin: h.goalMin }))
    .slice(-12) : [];

  return {
    weekStart: /^\d{4}-\d{2}-\d{2}$/.test(raw.weekStart) ? raw.weekStart : base.weekStart,
    goalMin: Number.isFinite(raw.goalMin) && raw.goalMin >= 0 ? Math.round(raw.goalMin) : DEFAULT_GOAL_MIN,
    tasks, history
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : defaultState();
  } catch (e) {
    return defaultState();
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Could not save. Your browser is blocking local storage.');
  }
}

let state = load();
let editingId = null;
let lastFocusId = null;
let renderedDay = isoDate(new Date());

/* New week: archive last week's totals, untick everything, keep the tasks. */
function rollWeek() {
  const current = isoDate(sundayOf(new Date()));
  if (state.weekStart >= current) return false;

  const rev = state.tasks.filter(t => t.type === 'revision');
  const planned = sum(rev.map(t => t.duration));
  const done = sum(rev.filter(t => t.done).map(t => t.duration));
  if (planned > 0) {
    state.history.push({ weekStart: state.weekStart, doneMin: done, plannedMin: planned, goalMin: state.goalMin });
    state.history = state.history.slice(-12);
  }
  state.tasks.forEach(t => { t.done = false; });
  state.weekStart = current;
  save();
  return true;
}

/* ---------- derived numbers ---------- */
function stats() {
  const rev = state.tasks.filter(t => t.type === 'revision');
  const planned = sum(rev.map(t => t.duration));
  const done = sum(rev.filter(t => t.done).map(t => t.duration));
  const goal = state.goalMin;
  const denom = goal > 0 ? goal : planned;
  const subjects = new Map();
  rev.forEach(t => {
    const key = t.subject.trim() || 'General';
    const o = subjects.get(key) || { planned: 0, done: 0 };
    o.planned += t.duration;
    if (t.done) o.done += t.duration;
    subjects.set(key, o);
  });
  return {
    planned, done, goal, denom,
    pct: denom > 0 ? (done / denom) * 100 : 0,
    plannedPct: denom > 0 ? Math.min(100, (planned / denom) * 100) : 0,
    doneTasks: state.tasks.filter(t => t.done).length,
    totalTasks: state.tasks.length,
    activeDays: new Set(state.tasks.filter(t => t.done).map(t => t.day)).size,
    subjects
  };
}

function overlapIds(dayTasks) {
  const ids = new Set();
  for (let i = 0; i < dayTasks.length; i++) {
    for (let j = i + 1; j < dayTasks.length; j++) {
      const a = dayTasks[i], b = dayTasks[j];
      const as = toMin(a.start), ae = Math.min(1440, as + a.duration);
      const bs = toMin(b.start), be = Math.min(1440, bs + b.duration);
      if (as < be && bs < ae) { ids.add(a.id); ids.add(b.id); }
    }
  }
  return ids;
}

function encouragement(s) {
  if (s.totalTasks === 0) return 'Add your first session to get the week moving.';
  if (s.planned === 0) return 'Add a revision task so your goal has something to measure.';
  if (s.done === 0) return 'Nothing ticked yet. One 25-minute session is a good start.';
  const left = Math.max(0, s.denom - s.done);
  if (s.pct < 25) return 'You have started. Keep the next session close to this one.';
  if (s.pct < 50) return `A quarter done. ${fmtDur(left)} to go.`;
  if (s.pct < 75) return `Past halfway. ${fmtDur(left)} to go.`;
  if (s.pct < 100) return `Almost there. Just ${fmtDur(left)} left.`;
  return 'Goal reached. Anything extra is a bonus.';
}

/* ---------- rendering ---------- */
function render() {
  renderedDay = isoDate(new Date());
  renderHeader();
  renderProgress();
  renderWeek();
  renderSubjectOptions();

  if (lastFocusId) {
    const el = document.querySelector(`[data-toggle="${lastFocusId}"]`);
    if (el) el.focus();
    lastFocusId = null;
  }
}

function renderHeader() {
  const start = parseISO(state.weekStart);
  const end = addDays(start, 6);
  $('#weekRange').textContent =
    `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })} to ` +
    `${end.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

function renderProgress() {
  const s = stats();

  $('#headline').textContent = s.goal > 0
    ? `${fmtDur(s.done)} done of your ${fmtDur(s.goal)} goal`
    : `${fmtDur(s.done)} done of ${fmtDur(s.planned)} planned`;

  const bar = $('#bar');
  const donePct = Math.min(100, s.pct);
  $('#barDone').style.width = donePct + '%';
  $('#barPlanned').style.width = s.plannedPct + '%';
  bar.classList.toggle('full', donePct >= 100);
  bar.setAttribute('aria-valuenow', String(Math.round(donePct)));

  $('#message').textContent = encouragement(s);
  $('#statTasks').textContent = `${s.doneTasks} of ${s.totalTasks}`;
  $('#statDays').textContent = `${s.activeDays} of 7`;
  $('#statLeft').textContent = s.goal > 0
    ? (s.planned >= s.goal ? 'Covered' : fmtDur(s.goal - s.planned))
    : '-';

  const goalInput = $('#goalInput');
  if (document.activeElement !== goalInput) goalInput.value = +(state.goalMin / 60).toFixed(2);

  // subjects
  const subjList = $('#subjectList');
  if (s.subjects.size === 0) {
    subjList.innerHTML = '<li class="empty-note">Subjects appear here once you add revision tasks.</li>';
  } else {
    subjList.innerHTML = [...s.subjects.entries()]
      .sort((a, b) => b[1].planned - a[1].planned)
      .map(([name, v]) => {
        const pct = v.planned ? (v.done / v.planned) * 100 : 0;
        const c = subjectColor(name);
        return `<li style="--c:${c}">
          <div class="row-top">
            <span class="name"><i class="dot"></i>${esc(name)}</span>
            <span class="amt">${fmtDur(v.done)} of ${fmtDur(v.planned)}</span>
          </div>
          <div class="thin"><span style="width:${pct}%"></span></div>
        </li>`;
      }).join('');
  }

  // history
  const histList = $('#historyList');
  if (state.history.length === 0) {
    histList.innerHTML = '<li class="empty-note">Finished weeks will show up here.</li>';
  } else {
    histList.innerHTML = state.history.slice(-4).reverse().map(h => {
      const denom = h.goalMin > 0 ? h.goalMin : h.plannedMin;
      const pct = denom > 0 ? Math.min(100, (h.doneMin / denom) * 100) : 0;
      return `<li>
        <div class="row-top">
          <span class="name">Week of ${esc(shortDate(parseISO(h.weekStart)))}</span>
          <span class="amt">${fmtDur(h.doneMin)} of ${fmtDur(denom)}</span>
        </div>
        <div class="thin"><span style="width:${pct}%"></span></div>
      </li>`;
    }).join('');
  }
}

function taskHTML(t, overlaps) {
  const end = fromMin(toMin(t.start) + t.duration);
  const color = t.type === 'revision' ? subjectColor(t.subject.trim() || 'General') : 'var(--line-strong)';
  const chips = [];
  chips.push(`<span class="chip">${fmtDur(t.duration)}</span>`);
  if (t.type === 'revision') {
    chips.push(`<span class="chip" style="--c:${color}"><i class="dot"></i>${esc(t.subject.trim() || 'Revision')}</span>`);
  }
  if (overlaps.has(t.id)) chips.push('<span class="chip warn">Overlaps</span>');

  return `<li class="task ${t.done ? 'is-done' : ''}" style="--tc:${color}">
    <input type="checkbox" class="check" data-toggle="${t.id}" ${t.done ? 'checked' : ''}
           aria-label="Mark ${esc(t.title)} as done">
    <div class="task-body">
      <p class="task-title">${esc(t.title)}</p>
      <p class="task-time">${t.start} to ${end}</p>
      <div class="chips">${chips.join('')}</div>
    </div>
    <button type="button" class="edit-btn" data-edit="${t.id}" aria-label="Edit ${esc(t.title)}">Edit</button>
  </li>`;
}

function renderWeek() {
  const start = parseISO(state.weekStart);
  const todayIdx = state.weekStart === isoDate(sundayOf(new Date())) ? new Date().getDay() : -1;

  $('#week').innerHTML = DAYS.map((name, i) => {
    const dayTasks = state.tasks
      .filter(t => t.day === i)
      .sort((a, b) => toMin(a.start) - toMin(b.start) || a.title.localeCompare(b.title));
    const overlaps = overlapIds(dayTasks);
    const done = dayTasks.filter(t => t.done).length;
    const pct = dayTasks.length ? (done / dayTasks.length) * 100 : 0;
    const isToday = i === todayIdx;

    return `<article class="day ${isToday ? 'is-today' : ''}" aria-labelledby="day-${i}">
      <header class="day-head">
        <div>
          <h3 id="day-${i}">${name}</h3>
          <p class="day-date">${esc(shortDate(addDays(start, i)))}</p>
        </div>
        ${isToday ? '<span class="today-pill">Today</span>' : ''}
      </header>
      <div class="day-progress">
        <div class="mini"><span style="width:${pct}%"></span></div>
        <p>${dayTasks.length ? `${done} of ${dayTasks.length} done` : 'Nothing planned yet'}</p>
      </div>
      ${dayTasks.length
        ? `<ul class="tasks">${dayTasks.map(t => taskHTML(t, overlaps)).join('')}</ul>`
        : '<p class="empty">A free day. Add a session when you are ready.</p>'}
      <button type="button" class="add-day" data-add="${i}">Add task</button>
    </article>`;
  }).join('');
}

function renderSubjectOptions() {
  const names = [...new Set(state.tasks.filter(t => t.subject.trim()).map(t => t.subject.trim()))].sort();
  $('#subjectOptions').innerHTML = names.map(n => `<option value="${esc(n)}"></option>`).join('');
}

/* ---------- toast ---------- */
let toastTimer;
function toast(message, actionLabel, action) {
  const el = $('#toast');
  el.textContent = '';
  const span = document.createElement('span');
  span.textContent = message;
  el.append(span);
  if (actionLabel && action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = actionLabel;
    b.addEventListener('click', () => { action(); el.classList.remove('show'); });
    el.append(b);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), actionLabel ? 6000 : 3200);
}

/* ---------- task dialog ---------- */
const dlg = $('#taskDialog');
const fTitle = $('#fTitle'), fType = $('#fType'), fSubject = $('#fSubject');
const fDay = $('#fDay'), fStart = $('#fStart'), fDuration = $('#fDuration');

fDay.innerHTML = DAYS.map((d, i) => `<option value="${i}">${d}</option>`).join('');

function syncSubjectField() {
  $('#subjectField').hidden = fType.value !== 'revision';
}

function openDialog(task, day) {
  editingId = task ? task.id : null;
  $('#dialogTitle').textContent = task ? 'Edit task' : 'Add task';
  fTitle.value = task ? task.title : '';
  fType.value = task ? task.type : 'revision';
  fSubject.value = task ? task.subject : '';
  fDay.value = String(task ? task.day : day);
  fStart.value = task ? task.start : '09:00';
  fDuration.value = task ? task.duration : 60;
  $('#deleteBtn').hidden = !task;
  syncSubjectField();
  dlg.showModal();
  fTitle.focus();
}

fType.addEventListener('change', syncSubjectField);
$('#cancelBtn').addEventListener('click', () => dlg.close());

$('#taskForm').addEventListener('submit', e => {
  e.preventDefault();
  const title = fTitle.value.trim();
  if (!title) { fTitle.focus(); return; }

  const data = {
    title,
    type: fType.value,
    subject: fType.value === 'revision' ? fSubject.value.trim() : '',
    day: Number(fDay.value),
    start: fStart.value || '09:00',
    duration: Math.max(5, Math.round(Number(fDuration.value) || 0))
  };

  if (editingId) {
    const t = state.tasks.find(x => x.id === editingId);
    if (t) Object.assign(t, data);
    toast('Changes saved');
  } else {
    state.tasks.push({ id: uid(), done: false, ...data });
    toast('Task added');
  }
  save();
  render();
  dlg.close();
});

$('#deleteBtn').addEventListener('click', () => {
  const idx = state.tasks.findIndex(t => t.id === editingId);
  if (idx === -1) { dlg.close(); return; }
  const [removed] = state.tasks.splice(idx, 1);
  save();
  render();
  dlg.close();
  toast('Task deleted', 'Undo', () => {
    state.tasks.push(removed);
    save();
    render();
  });
});

/* ---------- page events ---------- */
$('#addBtn').addEventListener('click', () => {
  const todayIdx = state.weekStart === isoDate(sundayOf(new Date())) ? new Date().getDay() : 0;
  openDialog(null, todayIdx);
});

document.addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  if (add) { openDialog(null, Number(add.dataset.add)); return; }

  const edit = e.target.closest('[data-edit]');
  if (edit) {
    const t = state.tasks.find(x => x.id === edit.dataset.edit);
    if (t) openDialog(t, t.day);
    return;
  }

  // close the "More" menu on outside click
  const menu = $('#menu');
  if (menu.open && !menu.contains(e.target)) menu.open = false;
});

document.addEventListener('change', e => {
  const box = e.target.closest('[data-toggle]');
  if (!box) return;
  const t = state.tasks.find(x => x.id === box.dataset.toggle);
  if (!t) return;

  const before = stats();
  t.done = box.checked;
  const after = stats();
  save();
  lastFocusId = t.id;
  render();

  if (t.done) {
    const dayTasks = state.tasks.filter(x => x.day === t.day);
    if (before.pct < 100 && after.pct >= 100 && after.denom > 0) {
      toast('Weekly goal reached. Well done.');
    } else if (dayTasks.length > 1 && dayTasks.every(x => x.done)) {
      toast(`${DAYS[t.day]} is complete.`);
    }
  }
});

$('#goalInput').addEventListener('change', e => {
  const hours = Number(e.target.value);
  if (!Number.isFinite(hours) || hours < 0) { e.target.value = +(state.goalMin / 60).toFixed(2); return; }
  state.goalMin = Math.round(hours * 60);
  save();
  render();
});

/* ---------- menu actions ---------- */
function closeMenu() { $('#menu').open = false; }

$('#exportBtn').addEventListener('click', () => {
  closeMenu();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `week-planner-backup-${isoDate(new Date())}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup downloaded');
});

$('#importBtn').addEventListener('click', () => { closeMenu(); $('#importFile').click(); });

$('#importFile').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incoming = sanitize(JSON.parse(reader.result));
      if (!confirm('Replace your current planner with this backup?')) return;
      state = incoming;
      rollWeek();
      save();
      render();
      toast('Backup restored');
    } catch (err) {
      toast('That file is not a valid planner backup.');
    }
  };
  reader.readAsText(file);
});

$('#untickBtn').addEventListener('click', () => {
  closeMenu();
  if (!confirm('Untick every task for this week? Your tasks stay in place.')) return;
  state.tasks.forEach(t => { t.done = false; });
  save();
  render();
  toast('All tasks unticked');
});

$('#clearBtn').addEventListener('click', () => {
  closeMenu();
  if (!confirm('Delete all tasks and past-week history? This cannot be undone. Download a backup first if unsure.')) return;
  state = { ...defaultState(), goalMin: state.goalMin };
  save();
  render();
  toast('Planner cleared');
});

/* ---------- keep the page current ---------- */
function refreshClock() {
  if (isoDate(new Date()) === renderedDay) return;
  if (rollWeek()) toast('New week started. Last week was saved under Past weeks.');
  render();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshClock(); });
setInterval(refreshClock, 60 * 1000);

// Stay in sync if the planner is open in another tab.
window.addEventListener('storage', e => {
  if (e.key !== STORAGE_KEY) return;
  state = load();
  render();
});

/* ---------- start ---------- */
const rolled = rollWeek();
render();
if (rolled) toast('New week started. Last week was saved under Past weeks.');
