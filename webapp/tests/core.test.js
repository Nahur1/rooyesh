// Unit tests for core.js — run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

function st() {
  const s = C.defaultState();
  s.projects.push({ id: 'p1', title: 'P', status: 'active' }, { id: 'p2', title: 'Paused', status: 'paused' });
  s.tasks.push(
    { id: 'a', title: 'low prio', priority: 'low', energy: 'low', estimate: 10, status: 'todo', createdAt: '1' },
    { id: 'b', title: 'high prio overdue', priority: 'high', energy: 'high', estimate: 90, due: '2026-10-01', status: 'todo', createdAt: '2' },
    { id: 'c', title: 'step 1', projectId: 'p1', priority: 'medium', status: 'done', order: 1, createdAt: '3', doneAt: '2026-10-11T08:00:00' },
    { id: 'd', title: 'step 2', projectId: 'p1', priority: 'medium', status: 'todo', order: 2, createdAt: '4' },
    { id: 'e', title: 'paused project step', projectId: 'p2', priority: 'high', status: 'todo', createdAt: '5' },
  );
  return s;
}

test('date helpers & Saturday week start', () => {
  assert.equal(C.weekStart('2026-10-11'), '2026-10-10');   // Sunday -> Saturday
  assert.equal(C.weekStart('2026-10-10'), '2026-10-10');   // Saturday itself
  assert.equal(C.weekStart('2026-10-16'), '2026-10-10');   // Friday -> same week
  assert.equal(C.weekStart('2026-10-17'), '2026-10-17');
  assert.equal(C.weekStart('2026-10-14', 1), '2026-10-12'); // Monday start
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(C.diffDays('2026-10-11', '2026-10-01'), 10);
  assert.ok(C.isValidKey('2026-10-11')); assert.ok(!C.isValidKey('x')); assert.ok(!C.isValidKey(''));
});

test('normalizeState repairs bad input', () => {
  assert.deepEqual(C.normalizeState(null).tasks, []);
  assert.deepEqual(C.normalizeState([1, 2]).goals, []);
  const n = C.normalizeState({ tasks: [null, { title: 'no id' }, { id: 'x', title: 'ok' }], settings: { focusMinutes: 9999, theme: 'neon', sections: { journal: false } }, learning: [{ id: 'l' }], timer: { foo: 1 } });
  assert.equal(n.tasks.length, 1);
  assert.equal(n.settings.focusMinutes, 25);
  assert.equal(n.settings.theme, 'system');
  assert.equal(n.settings.sections.journal, false);
  assert.equal(n.settings.sections.learning, true);
  assert.deepEqual(n.learning[0].questions, []);
  assert.equal(n.timer, null);
});

test('project progress and next step', () => {
  const s = st();
  assert.deepEqual(C.projectProgress(s, 'p1'), { done: 1, total: 2, pct: 50 });
  assert.equal(C.nextStep(s, 'p1').id, 'd');
  s.tasks.push({ id: 'f', title: 'step 3', projectId: 'p1', status: 'todo', order: 3, createdAt: '6' });
  s.projects[0].nextTaskId = 'f';
  assert.equal(C.nextStep(s, 'p1').id, 'f');
  s.tasks.find(t => t.id === 'f').status = 'done';
  assert.equal(C.nextStep(s, 'p1').id, 'd', 'falls back when chosen next step is done');
  assert.deepEqual(C.projectProgress(s, 'nope'), { done: 0, total: 0, pct: 0 });
  s.goals.push({ id: 'g', title: 'G', status: 'active' }); s.projects[0].goalId = 'g';
  s.projects.push({ id: 'p3', title: 'stage done', goalId: 'g', status: 'done' });
  const gp = C.goalProgress(s, 'g');
  assert.equal(gp.total, 3); assert.equal(gp.projects, 2); assert.equal(gp.pct, 84, 'average of 67% (2 of 3 steps) and 100%'); assert.equal(gp.finishedProjects, 1);
  assert.equal(C.goalNextStep(s, 'g').task.id, 'd');
});

test('suggestNext prefers urgent work, skips done/paused, adapts to energy', () => {
  const s = st();
  const r = C.suggestNext(s, { today: '2026-10-11', energy: 'medium' });
  assert.equal(r.task.id, 'b');
  assert.ok(r.reasons.some(x => x.startsWith('موعدش رد شده')), 'gentle wording for overdue');
  assert.ok(r.reasons.length <= 3);
  assert.equal(r.minutes, 50, 'long tasks are capped to a 50 minute session');
  const low = C.suggestNext(s, { today: '2026-10-11', energy: 'low', skip: ['b'] });
  assert.equal(low.task.id, 'a');
  assert.equal(low.minutes, 10);
  const all = C.suggestNext(s, { today: '2026-10-11', skip: ['a', 'b', 'd'] });
  assert.equal(all, null, 'paused-project task and done tasks are never suggested');
  s.tasks.find(t => t.id === 'a').todayKey = '2026-10-11';
  s.tasks.find(t => t.id === 'a').priority = 'high';
  assert.equal(C.suggestNext(s, { today: '2026-10-11', energy: 'low' }).task.id, 'a');
  assert.equal(C.suggestNext(C.defaultState(), { today: '2026-10-11' }), null);
});

test('day and week stats', () => {
  const s = st();
  s.sessions.push(
    { id: 's1', start: new Date(2026, 9, 11, 9).toISOString(), minutes: 25, kind: 'work' },
    { id: 's2', start: new Date(2026, 9, 12, 9).toISOString(), minutes: 40, kind: 'study' },
    { id: 's3', start: new Date(2026, 9, 3, 9).toISOString(), minutes: 99, kind: 'work' },
  );
  s.outputs.push({ id: 'o1', createdAt: new Date(2026, 9, 11, 10).toISOString(), files: [] });
  s.journal.push({ id: 'j1', date: '2026-10-11', mood: 4, energy: 3 }, { id: 'j2', date: '2026-10-12', mood: 5 });
  const d = C.dayStats(s, '2026-10-11');
  assert.equal(d.minutes, 25); assert.equal(d.sessions, 1); assert.equal(d.tasksDone, 1);
  const w = C.weekStats(s, '2026-10-10');
  assert.equal(w.focusMinutes, 65); assert.equal(w.studyMinutes, 40); assert.equal(w.sessions, 2);
  assert.equal(w.outputs.length, 1); assert.equal(w.doneTasks.length, 1);
  assert.equal(w.avgMood, 4.5); assert.equal(w.activeDays, 2); assert.equal(w.byDay.length, 7);
  assert.equal(w.byDay[1].minutes, 25);
});

test('timer is timestamp based: pause, resume, elapsed, done', () => {
  const t0 = 1_000_000;
  let t = C.timerStart(25, { taskId: 'x' }, t0);
  assert.equal(t.plannedMin, 25); assert.equal(t.taskId, 'x');
  assert.equal(C.timerRemaining(t, t0 + 60000), 24 * 60000);
  t = C.timerPause(t, t0 + 5 * 60000);
  assert.equal(C.timerRemaining(t, t0 + 50 * 60000), 20 * 60000, 'paused timer does not run');
  assert.equal(C.timerDone(t, t0 + 99 * 60000), false);
  t = C.timerResume(t, t0 + 10 * 60000);
  assert.equal(C.timerElapsedMin(t, t0 + 12 * 60000), 7);
  assert.equal(C.timerDone(t, t0 + 30 * 60000), true);
  assert.equal(C.timerStart(0, {}, 0).plannedMin, 25);
  assert.equal(C.timerStart(999, {}, 0).plannedMin, 300);
});

test('formatting and safety helpers', () => {
  assert.equal(C.duration(95), '۱ ساعت و ۳۵ دقیقه');
  assert.equal(C.duration(120), '۲ ساعت');
  assert.equal(C.duration(5), '۵ دقیقه');
  assert.equal(C.clock(25 * 60000), '۲۵:۰۰');
  assert.equal(C.escapeHtml('<img src=x onerror="a">'), '&lt;img src=x onerror=&quot;a&quot;&gt;');
  assert.equal(C.safeUrl('javascript:alert(1)'), '');
  assert.equal(C.safeUrl(' https://a.b '), 'https://a.b');
  assert.match(C.faDate('2026-10-11'), /مهر/);
});

test('normalizeState keeps custom dashboard sections and pomodoro pattern', () => {
  const n = C.normalizeState({ settings: { daySections: [{ id: 'x', title: 'فقط یک بخش', limit: 99 }, { id: '', title: 'bad' }], pomodoro: { focus: 50, shortBreak: 10, longBreak: 0, longEvery: 3 } } });
  assert.deepEqual(n.settings.daySections, [{ id: 'x', title: 'فقط یک بخش', limit: 3 }]);
  assert.deepEqual(n.settings.pomodoro, { focus: 50, shortBreak: 10, longBreak: 15, longEvery: 3 });
  assert.equal(n.settings.focusMinutes, 50);
  assert.equal(C.normalizeState({ settings: { daySections: [] } }).settings.daySections.length, 5);
});

test('available time and goal link affect suggestions', () => {
  const s = C.defaultState();
  s.goals.push({ id: 'g', title: 'کسب درآمد', status: 'active' });
  s.projects.push({ id: 'p', title: 'نمونه‌کار', goalId: 'g', status: 'active' });
  s.tasks.push({ id: 'long', title: 'long', priority: 'medium', estimate: 120, status: 'todo' },
               { id: 'goal', title: 'goal step', projectId: 'p', priority: 'medium', estimate: 30, status: 'todo' });
  const r = C.suggestNext(s, { today: '2026-10-11', available: 30 });
  assert.equal(r.task.id, 'goal');
  assert.ok(r.reasons.some(x => x.includes('کسب درآمد')));
  assert.equal(r.minutes, 30);
  s.settings.suggest.goalFocus = false;
  assert.ok(!C.suggestNext(s, { today: '2026-10-11', available: 30 }).reasons.some(x => x.includes('کسب درآمد')));
});

test('planDay builds a realistic, lighter plan without dumping the backlog', () => {
  const s = C.defaultState();
  for (let i = 0; i < 12; i++) s.tasks.push({ id: 't' + i, title: 'task ' + i, priority: i < 4 ? 'high' : 'medium', estimate: 40, due: i < 6 ? '2026-10-01' : '', status: 'todo' });
  const normal = C.planDay(s, { today: '2026-10-11', dayType: 'normal' });
  assert.equal(normal.tasks.length, 3); assert.ok(normal.minutes <= normal.budget);
  const busy = C.planDay(s, { today: '2026-10-11', dayType: 'busy' });
  assert.ok(busy.tasks.length <= 2 && busy.minutes <= 60);
  const light = C.planDay(s, { today: '2026-10-11', dayType: 'normal', light: true });
  assert.ok(light.tasks.length < normal.tasks.length, 'comeback plan is lighter');
  assert.equal(s.tasks.filter(t => t.status !== 'done').length, 12, 'unfinished tasks stay in the list');
  const huge = C.defaultState(); huge.tasks.push({ id: 'h', title: 'big', estimate: 500, status: 'todo' });
  assert.equal(C.planDay(huge, { today: '2026-10-11', dayType: 'busy' }).tasks.length, 1, 'still offers one step even if nothing fits');
  const opt = C.defaultState(); opt.tasks.push({ id: 'o', title: 'opt', optional: true, status: 'todo' });
  assert.equal(C.planDay(opt, { today: '2026-10-11' }).tasks.length, 0);
});

test('comeback detects a 3+ day gap gently', () => {
  const s = C.defaultState();
  assert.equal(C.comeback(s, '2026-10-11'), null, 'new users get no banner');
  s.sessions.push({ id: 'a', start: new Date(2026, 9, 7, 10).toISOString(), minutes: 20 });
  s.tasks.push({ id: 'x', title: 'x', status: 'todo', due: '2026-10-08' });
  assert.deepEqual(C.comeback(s, '2026-10-11'), { gap: 4, last: '2026-10-07', overdue: 1 });
  assert.equal(C.comeback(s, '2026-10-09'), null);
  s.sessions.push({ id: 'b', start: new Date(2026, 9, 11, 9).toISOString(), minutes: 20 });
  assert.equal(C.comeback(s, '2026-10-11').gap, 4, 'activity earlier today does not hide the welcome');
});

test('rangeReport groups time per project, resource and task', () => {
  const s = C.defaultState();
  s.projects.push({ id: 'p', title: 'سایت' });
  s.learning.push({ id: 'l', title: 'یادگیری ماشین', questions: [] });
  s.tasks.push({ id: 't1', title: 'a', projectId: 'p', status: 'todo' }, { id: 't2', title: 'b', status: 'todo' });
  const d = (day, h) => new Date(2026, 9, day, h).toISOString();
  s.sessions.push({ id: 's1', start: d(10, 9), minutes: 30, taskId: 't1' }, { id: 's2', start: d(11, 9), minutes: 45, learningId: 'l' },
    { id: 's3', start: d(11, 11), minutes: 20, taskId: 't2' }, { id: 's4', start: d(11, 12), minutes: 10 }, { id: 's5', start: d(1, 9), minutes: 999, taskId: 't1' });
  s.outputs.push({ id: 'o', sessionId: 's2', createdAt: d(11, 10), files: [] });
  const r = C.rangeReport(s, '2026-10-10', '2026-10-11');
  assert.equal(r.total, 105); assert.equal(r.sessions, 4);
  assert.deepEqual(r.groups.map(g => [g.kind, g.label, g.minutes]), [['learning', 'یادگیری ماشین', 45], ['project', 'سایت', 30], ['task', 'b', 20], ['free', 'جلسهٔ آزاد', 10]]);
  assert.equal(r.groups[0].outputs, 1);
});

test('pomodoro break pattern and Persian month start', () => {
  const s = C.defaultState();
  s.settings.pomodoro = { focus: 25, shortBreak: 5, longBreak: 20, longEvery: 2 };
  const day = (h) => ({ id: 'x' + h, start: new Date(2026, 9, 11, h).toISOString(), minutes: 25, kind: 'work' });
  s.sessions.push(day(8));
  assert.deepEqual(C.nextBreak(s, '2026-10-11'), { minutes: 5, long: false, count: 1 });
  s.sessions.push(day(9));
  assert.deepEqual(C.nextBreak(s, '2026-10-11'), { minutes: 20, long: true, count: 2 });
  assert.equal(C.persianMonthStart('2026-10-11'), '2026-09-23'); // 1 Mehr 1405
  assert.equal(C.persianMonthStart('2026-09-23'), '2026-09-23');
});
