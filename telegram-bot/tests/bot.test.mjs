// End-to-end tests of the Rooyesh Telegram bot, driven in-process with a validating fake Bot API.
process.env.TZ = 'Asia/Tehran';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, fakeApi, T0 } from './helpers.mjs';
import { createStore } from '../src/store.js';
import { parseDate } from '../src/jalali.js';

const clean = (h) => { assert.equal(h.hasErrorReply(), false, 'bot replied with an error'); assert.deepEqual(h.errors, []); };

test('start shows welcome, main keyboard and the today dashboard', async () => {
  const h = setup();
  await h.msg('/start');
  const first = h.api.calls.find((c) => c.method === 'sendMessage');
  assert.match(first.params.text, /رویش/);
  const kb = first.params.reply_markup.keyboard.flat().map((b) => b.text);
  for (const k of ['☀️ امروز', '🧭 از کجا شروع کنم؟', '🎯 اهداف', '⏱ تمرکز', '📚 یادگیری', '📓 دفتر', '🗓 مرور هفتگی', '⚙️ تنظیمات']) assert.ok(kb.includes(k), k);
  const today = h.lastText();
  assert.match(today, /کجا هستم؟/); assert.match(today, /چه چیزی امروز مهم است؟/);
  assert.equal(h.B.name, 'نهورام');
  await h.msg('/help'); assert.match(h.lastText(), /میان‌بُرها/);
  clean(h);
});

test('plain text → choose where to save; multi-line add; section capacity note', async () => {
  const h = setup();
  await h.msg('خواندن فصل ۳ کتاب');
  assert.match(h.lastText(), /کجا ثبتش کنم؟/);
  await h.tap('سه کار مهم امروز');
  assert.equal(h.S.tasks.length, 1);
  assert.equal(h.S.tasks[0].todayKey, '2026-03-14'); assert.equal(h.S.tasks[0].section, 'main');
  await h.press('add:main');
  await h.msg('کار دوم\n- کار سوم\n• کار چهارم');
  assert.equal(h.S.tasks.length, 4);
  assert.match(h.lastText(), /۳ کار اضافه شد/); assert.match(h.lastText(), /ظرفیت/);
  await h.press('add:-'); await h.msg('کاری برای بعد');
  assert.equal(h.S.tasks.at(-1).todayKey, undefined);
  await h.msg('ایدهٔ اپ یادگیری لغت'); await h.tap('ایده');
  assert.equal(h.S.ideas.length, 1);
  await h.msg('امروز حس خوبی داشتم'); await h.tap('دفتر');
  assert.match(h.S.journal[0].text, /حس خوبی/);
  await h.msg('هیچی'); await h.tap('هیچ‌کدام'); assert.equal(h.S.tasks.length, 5);
  await h.press('today');
  assert.match(h.lastText(), /خواندن فصل ۳ کتاب/); assert.ok(h.buttons().some((b) => /بقیهٔ کارهای باز \(۱\)/.test(b.text)));
  clean(h);
});

test('task details: priority, energy, estimate, Jalali due date, title, delete', async () => {
  const h = setup();
  await h.msg('/add گزارش پروژه');
  const t = h.S.tasks[0];
  await h.press('t:' + t.id);
  await h.press('tpr:' + t.id + ':high'); await h.press('ten:' + t.id + ':low'); await h.press('tes:' + t.id + ':50');
  assert.equal(t.priority, 'high'); assert.equal(t.energy, 'low'); assert.equal(t.estimate, 50);
  await h.press('dl:t:' + t.id); await h.msg('چیزی نامفهوم');
  assert.match(h.lastText(), /متوجه نشدم/);
  await h.msg('۱۴۰۵/۰۱/۰۵'); assert.equal(t.due, '2026-03-25');
  await h.press('dl:t:' + t.id); await h.msg('فردا'); assert.equal(t.due, '2026-03-15');
  await h.press('tti:' + t.id); await h.msg('گزارش نهایی'); assert.equal(t.title, 'گزارش نهایی');
  assert.match(h.lastText(), /اولویت: بالا/);
  await h.press('tdel:' + t.id); await h.press('tdelok:' + t.id);
  assert.equal(h.S.tasks.length, 0);
  clean(h);
});

test('suggestion respects energy/time, gives reasons and alternatives', async () => {
  const h = setup();
  await h.msg('/start');
  h.S.tasks.push(
    { id: 'hard', title: 'پیاده‌سازی مدل', status: 'todo', priority: 'high', energy: 'high', estimate: 90, createdAt: '' },
    { id: 'easy', title: 'مرور یادداشت‌ها', status: 'todo', priority: 'medium', energy: 'low', estimate: 15, createdAt: '' },
    { id: 'mid', title: 'ایمیل استاد', status: 'todo', priority: 'medium', energy: 'medium', estimate: 20, createdAt: '' });
  await h.press('day'); await h.press('dt:low'); await h.press('av:30');
  assert.equal(h.S.days['2026-03-14'].type, 'low'); assert.equal(h.S.days['2026-03-14'].available, 30);
  await h.press('next');
  assert.match(h.lastText(), /مرور یادداشت‌ها/); assert.match(h.lastText(), /چرا؟/);
  assert.match(h.lastText(), /انرژی کمِ الان/);
  await h.tap('پیشنهاد دیگر');
  assert.doesNotMatch(h.lastText(), /<b>مرور یادداشت‌ها<\/b>/);
  await h.tap('انجامش دادم');
  assert.equal(h.S.tasks.filter((t) => t.status === 'done').length, 1);
  clean(h);
});

test('plan the day; gentle comeback after 3+ days with a lighter plan', async () => {
  const h = setup();
  for (let i = 0; i < 6; i++) h.S.tasks.push({ id: 't' + i, title: 'کار ' + i, status: 'todo', priority: i < 2 ? 'high' : 'medium', energy: 'medium', estimate: 30, createdAt: '' });
  h.S.tasks.push({ id: 'old', title: 'کار قدیمی', status: 'done', doneAt: new Date(T0 - 5 * 86400000).toISOString(), createdAt: '' });
  await h.press('today');
  assert.match(h.lastText(), /خوش برگشتی/); assert.match(h.lastText(), /۵ روز/);
  await h.tap('برنامهٔ سبک');
  const planned = h.S.tasks.filter((t) => t.todayKey === '2026-03-14');
  assert.ok(planned.length >= 1 && planned.length <= 2, 'light plan has at most 2 tasks, got ' + planned.length);
  assert.equal(h.S.tasks.filter((t) => t.status !== 'done' && !t.todayKey).length, 6 - planned.length, 'the rest stay in the list');
  assert.doesNotMatch(h.lastText(), /خوش برگشتی/);
  const h2 = setup();
  for (let i = 0; i < 6; i++) h2.S.tasks.push({ id: 't' + i, title: 'کار ' + i, status: 'todo', priority: 'medium', energy: 'medium', estimate: 30, createdAt: '' });
  await h2.press('plan');
  assert.equal(h2.S.tasks.filter((t) => t.todayKey).length, 3);
  await h2.press('plan'); assert.match(h2.lastText(), /پر است/);
  await h2.press('tick'); await h2.tap(/^☐/);
  assert.equal(h2.S.tasks.filter((t) => t.status === 'done').length, 1);
  await h2.press('rest'); await h2.tap(/^➕/);
  assert.equal(h2.S.tasks.filter((t) => t.todayKey).length, 4);
  clean(h); clean(h2);
});

test('goals: template, stages, steps, progress, next step, deadline, status, delete', async () => {
  const h = setup();
  await h.press('goals'); await h.tap('نمونه‌های آماده'); await h.press('tpl:1');
  const g = h.S.goals[0];
  assert.equal(g.title, 'قبولی و پیشرفت در کارشناسی ارشد هوش مصنوعی');
  assert.equal(h.S.projects.filter((p) => p.goalId === g.id).length, 5);
  const p = h.S.projects[0];
  await h.press('p:' + p.id); await h.press('ns:' + p.id);
  await h.msg('جبر خطی فصل ۱\nآمار و احتمال\nبهینه‌سازی');
  assert.equal(h.S.tasks.length, 3);
  assert.match(h.lastText(), /قدم بعدی: <b>جبر خطی فصل ۱/);
  await h.tap('جبر خطی');
  assert.match(h.lastText(), /۳۳٪/); assert.match(h.lastText(), /قدم بعدی: <b>آمار و احتمال/);
  await h.press('nxs:' + p.id); await h.tap('بهینه‌سازی');
  assert.match(h.lastText(), /قدم بعدی: <b>بهینه‌سازی/);
  await h.press('dl:p:' + p.id); await h.msg('۱۴۰۵/۰۲/۱۰');
  assert.equal(p.deadline, '2026-04-30');
  await h.press('g:' + g.id);
  assert.match(h.lastText(), /پیشرفت: ۷٪/); assert.match(h.lastText(), /قدم بعدی: <b>بهینه‌سازی/);
  await h.press('gw:' + g.id); await h.msg('برای کار در حوزهٔ هوش مصنوعی');
  assert.equal(g.why, 'برای کار در حوزهٔ هوش مصنوعی');
  await h.press('gs:' + g.id + ':paused'); assert.equal(g.status, 'paused');
  await h.press('ps:' + p.id + ':done'); assert.equal(p.status, 'done');
  await h.press('ng'); await h.msg('کسب درآمد'); assert.equal(h.S.goals.length, 2);
  await h.press('np:' + h.S.goals[1].id); await h.msg('ساخت نمونه‌کار');
  assert.equal(h.S.projects.at(-1).goalId, h.S.goals[1].id);
  await h.press('gdel:' + g.id); await h.press('gdelok:' + g.id);
  assert.equal(h.S.goals.length, 1); assert.equal(h.S.tasks.length, 0); assert.equal(h.S.projects.length, 1);
  clean(h);
});

test('focus timer: pause/resume, natural end, session result with code, file and photo outputs, break', async () => {
  const h = setup();
  await h.msg('/add حل تمرین‌های فصل ۲');
  const t = h.S.tasks[0];
  await h.msg('⏱ تمرکز'); assert.match(h.lastText(), /تایمر تمرکز/);
  await h.press('fm:25'); await h.press('ft:25:' + t.id);
  assert.equal(h.S.timer.status, 'running'); assert.equal(t.status, 'doing');
  h.advance(10); await h.press('tp'); assert.equal(h.S.timer.status, 'paused'); assert.match(h.lastText(), /۱۵:۰۰/);
  h.advance(30); await h.press('tr'); assert.match(h.lastText(), /۱۵:۰۰/);
  h.advance(14); await h.bot.tick(); assert.ok(h.S.timer, 'not yet finished');
  h.advance(1); await h.bot.tick();
  assert.equal(h.S.timer, null); assert.match(h.lastText(), /جلسه تمام شد/);
  await h.msg('سه تمرین اول را حل کردم');
  assert.match(h.lastText(), /خروجی‌ای ساختی/);
  await h.msg('def solve(x):\n    return x * 2');
  await h.msg(null, { document: { file_id: 'DOC1', file_name: 'hw2.py', mime_type: 'text/x-python', file_size: 120 }, caption: 'کد تمرین ۲' });
  await h.msg(null, { photo: [{ file_id: 'P_small', file_size: 10 }, { file_id: 'P_big', file_size: 900 }], caption: 'نمودار نتیجه' });
  await h.msg('https://github.com/me/hw');
  assert.equal(h.S.pending.outputs.length, 4);
  await h.tap('تمام');
  assert.match(h.lastText(), /تمام شد؟/);
  await h.press('ss:td:1');
  assert.equal(t.status, 'done');
  assert.equal(h.S.sessions.length, 1);
  const s = h.S.sessions[0];
  assert.equal(s.minutes, 25); assert.equal(s.taskId, t.id); assert.equal(s.note, 'سه تمرین اول را حل کردم');
  const outs = h.S.outputs;
  assert.deepEqual(outs.map((o) => o.type), ['code', 'code', 'image', 'link']);
  assert.ok(outs.every((o) => o.sessionId === s.id && o.taskId === t.id));
  assert.equal(outs[2].files[0].telegramFileId, 'P_big');
  assert.match(h.lastText(), /استراحت/);
  await h.tap('شروع استراحت ۵');
  assert.equal(h.S.timer.phase, 'break');
  h.advance(5); await h.bot.tick();
  assert.equal(h.S.timer, null); assert.match(h.lastText(), /استراحت تمام شد/);
  assert.equal(h.S.sessions.length, 1, 'breaks are not logged as focus');
  clean(h);
});

test('focus: early stop logs real minutes; menu during result saves session; cancel logs nothing', async () => {
  const h = setup();
  await h.press('ff:25'); h.advance(10); await h.msg('/stop');
  assert.equal(h.S.pending.minutes, 10);
  await h.msg('☀️ امروز');
  assert.equal(h.S.sessions.length, 1); assert.equal(h.S.sessions[0].minutes, 10); assert.equal(h.B.flow, null);
  await h.press('ff:25'); h.advance(3); await h.press('tc'); await h.press('tcok');
  assert.equal(h.S.timer, null); assert.equal(h.S.sessions.length, 1);
  await h.press('ff:20'); h.advance(0.2); await h.press('te');
  assert.match(h.lastText(), /کمتر از یک دقیقه/); assert.equal(h.S.sessions.length, 1);
  await h.press('fmc'); await h.msg('۴۰۰'); assert.match(h.lastText(), /بین ۱ تا ۳۰۰/);
  await h.msg('۴۰'); await h.press('ff:40'); assert.equal(h.S.timer.plannedMin, 40);
  await h.press('ff:25'); assert.match(h.lastText(), /در جریان است/);
  await h.press('te'); await h.press('ss:discard'); assert.equal(h.S.sessions.length, 1);
  await h.msg('/focus 15'); await h.tap('جلسهٔ آزاد'); assert.equal(h.S.timer.plannedMin, 15);
  clean(h);
});

test('learning: resource, topic/next step after study session, questions, notes, outputs resend', async () => {
  const h = setup();
  await h.msg('📚 یادگیری'); await h.tap('منبع جدید');
  await h.msg('دورهٔ یادگیری ماشین\nhttps://example.com/ml');
  const l = h.S.learning[0];
  assert.equal(l.link, 'https://example.com/ml'); assert.equal(l.status, 'learning');
  await h.press('lf:' + l.id + ':notes'); await h.msg('گرادیان کاهشی را دوباره ببینم');
  await h.press('lpv:' + l.id + ':40'); assert.equal(l.progress, 40);
  await h.press('lsv:' + l.id + ':learning'); await h.press('lty:' + l.id + ':video'); assert.equal(l.type, 'video');
  await h.press('qadd:' + l.id); await h.msg('چرا نرخ یادگیری مهم است؟\nفرق L1 و L2؟');
  assert.equal(l.questions.length, 2);
  await h.tap('چرا نرخ'); assert.equal(l.questions[0].resolved, true);
  await h.press('fl:30:' + l.id); h.advance(30); await h.bot.tick();
  await h.press('ss:skipnote');
  await h.msg(null, { document: { file_id: 'NB1', file_name: 'linear.ipynb', mime_type: 'application/json', file_size: 2000 } });
  await h.press('ss:outs');
  assert.match(h.lastText(), /آخرین مبحثی/);
  await h.msg('رگرسیون خطی'); await h.msg('رگرسیون لجستیک');
  assert.equal(l.lastTopic, 'رگرسیون خطی'); assert.equal(l.nextStep, 'رگرسیون لجستیک');
  assert.equal(h.S.sessions[0].kind, 'study'); assert.equal(h.S.sessions[0].learningId, l.id);
  await h.press('l:' + l.id);
  assert.match(h.lastText(), /رگرسیون لجستیک/); assert.match(h.lastText(), /۳۰ دقیقه/); assert.match(h.lastText(), /فرق L1 و L2/);
  await h.press('lao:' + l.id); await h.msg(null, { photo: [{ file_id: 'IMG9', file_size: 50 }] }); await h.tap('تمام');
  assert.equal(h.S.outputs.filter((o) => o.learningId === l.id).length, 2);
  const before = h.api.calls.length;
  await h.press('o:' + h.S.outputs[0].id);
  const sent = h.api.calls.slice(before).find((c) => c.method === 'sendDocument');
  assert.equal(sent.params.document, 'NB1');
  await h.press('o:' + h.S.outputs[1].id);
  assert.ok(h.api.calls.slice(before).some((c) => c.method === 'sendPhoto' && c.params.photo === 'IMG9'));
  await h.press('ni:article'); await h.msg('https://arxiv.org/abs/1706.03762\nAttention is all you need');
  assert.equal(h.S.ideas[0].kind, 'article'); assert.equal(h.S.ideas[0].title, 'Attention is all you need');
  await h.msg('/idea اپ تمرین مصاحبه'); assert.equal(h.S.ideas.length, 2);
  await h.press('ldel:' + l.id); await h.press('ldelok:' + l.id); assert.equal(h.S.learning.length, 0);
  assert.equal(h.S.outputs.length, 2, 'outputs survive');
  clean(h);
});

test('reports (today/week/month/custom) and weekly review', async () => {
  const h = setup();
  await h.msg('/add کار الف');
  await h.press('ft:25:' + h.S.tasks[0].id); h.advance(25); await h.bot.tick(); await h.press('ss:skipnote'); await h.press('ss:outs'); await h.press('ss:td:0');
  await h.press('rep:today'); assert.match(h.lastText(), /۲۵ دقیقه/); assert.match(h.lastText(), /کار الف/);
  for (const r of ['week', 'month', '30']) { await h.press('rep:' + r); assert.match(h.lastText(), /گزارش زمان/); }
  await h.press('repc'); await h.msg('۱۰ روز پیش'); await h.msg('امروز');
  assert.match(h.lastText(), /بازهٔ دلخواه/); assert.match(h.lastText(), /۲۵ دقیقه/);
  await h.msg('🗓 مرور هفتگی'); assert.match(h.lastText(), /مرور هفتگی/); assert.match(h.lastText(), /۱ جلسه/);
  await h.tap('نوشتن مرور');
  await h.msg('هر روز کمی تمرین کردم'); await h.press('rvs'); await h.msg('خواب را منظم کنم'); await h.msg('پروژهٔ پایانی');
  const rv = h.S.reviews[0];
  assert.equal(rv.weekStart, '2026-03-14'); assert.equal(rv.wentWell, 'هر روز کمی تمرین کردم'); assert.equal(rv.obstacles, undefined);
  assert.equal(rv.change, 'خواب را منظم کنم'); assert.equal(rv.stats.focusMinutes, 25);
  await h.press('rv:-1'); assert.match(h.lastText(), /۱۶ اسفند تا ۲۲ اسفند/); assert.ok(h.buttons().some((b) => b.text.includes('هفتهٔ بعد')));
  clean(h);
});

test('journal: mood, energy, writing, history', async () => {
  const h = setup();
  await h.msg('📓 دفتر'); await h.press('jm:4'); await h.press('je:2');
  await h.press('jf:text'); await h.msg('کمی نگران امتحانم');
  await h.press('jf:learned'); await h.msg('مشتق جزئی');
  const j = h.S.journal[0];
  assert.equal(j.mood, 4); assert.equal(j.energy, 2); assert.equal(j.text, 'کمی نگران امتحانم'); assert.equal(j.learned, 'مشتق جزئی');
  assert.match(h.lastText(), /🙂/);
  h.advance(24 * 60); await h.press('jh'); await h.tap('🙂'); assert.match(h.lastText(), /مشتق جزئی/);
  clean(h);
});

test('settings: pomodoro, sections editor, suggestion prefs, section toggles, name', async () => {
  const h = setup();
  await h.msg('⚙️ تنظیمات'); await h.press('pom'); await h.press('pp:50:10:30:2');
  assert.deepEqual(h.S.settings.pomodoro, { focus: 50, shortBreak: 10, longBreak: 30, longEvery: 2 });
  await h.msg('/pomodoro ۴۵ ۱۰ ۲۵ ۳'); assert.equal(h.S.settings.pomodoro.focus, 45);
  await h.press('pomc'); await h.msg('1 2 3'); assert.match(h.lastText(), /چهار عدد/); await h.msg('30 5 20 4'); assert.equal(h.S.settings.pomodoro.longEvery, 4);
  await h.press('secs'); await h.press('sc:main'); await h.press('scl:main:1'); assert.equal(h.S.settings.daySections[0].limit, 4);
  await h.press('scr:main'); await h.msg('مهم‌ترین‌ها'); assert.equal(h.S.settings.daySections[0].title, 'مهم‌ترین‌ها');
  await h.press('sca'); await h.msg('کارهای خانه ۲');
  const ns = h.S.settings.daySections.at(-1); assert.equal(ns.title, 'کارهای خانه'); assert.equal(ns.limit, 2);
  await h.press('scu:' + ns.id); assert.equal(h.S.settings.daySections.at(-2).id, ns.id);
  await h.msg('/add کار'); h.S.tasks[0].section = ns.id;
  await h.press('scx:' + ns.id); await h.press('scxok:' + ns.id);
  assert.ok(!h.S.settings.daySections.some((s) => s.id === ns.id)); assert.equal(h.S.tasks[0].section, 'main');
  await h.press('screset'); assert.equal(h.S.settings.daySections.length, 5);
  await h.press('sg:goalFocus'); assert.equal(h.S.settings.suggest.goalFocus, false);
  await h.press('sect:journal'); assert.equal(h.S.settings.sections.journal, false);
  const kbMsg = h.api.calls.filter((c) => c.params.reply_markup && c.params.reply_markup.keyboard).at(-1);
  assert.ok(!kbMsg.params.reply_markup.keyboard.flat().some((b) => b.text === '📓 دفتر'));
  await h.press('nm'); await h.msg('نهورام'); assert.equal(h.S.settings.name, 'نهورام');
  clean(h);
});

test('backup: export includes Telegram files; import into another account; web-app backups with files', async () => {
  const api = fakeApi();
  const h = setup({ api });
  api.files.set('DOC1', Buffer.from('print("hi")'));
  await h.msg('/add کار مهم'); await h.press('ff:25'); h.advance(25); await h.bot.tick(); await h.press('ss:skipnote');
  await h.msg(null, { document: { file_id: 'DOC1', file_name: 'a.py', mime_type: 'text/x-python', file_size: 11 } });
  await h.press('ss:outs');
  await h.msg('/export');
  const up = api.calls.find((c) => c.upload);
  assert.equal(up.method, 'sendDocument'); assert.match(up.upload.filename, /^rooyesh-backup-2026-03-14\.json$/);
  const data = JSON.parse(up.upload.buffer.toString());
  assert.equal(data.app, 'rooyesh'); assert.equal(data.state.tasks.length, 1);
  const fid = data.state.outputs[0].files[0].fileId;
  assert.ok(fid); assert.equal(Buffer.from(data.files[fid].data.split(',')[1], 'base64').toString(), 'print("hi")');
  // import into a different user
  api.files.set('BACKUP', up.upload.buffer);
  const other = setup({ api, dir: h.dir, user: 888 });
  await other.msg('/settings'); await other.press('imp');
  await other.msg(null, { document: { file_id: 'X', file_name: 'note.txt', file_size: 3 } });
  assert.match(other.lastText(), /json/);
  await other.msg(null, { document: { file_id: 'BACKUP', file_name: 'rooyesh-backup.json', file_size: up.upload.buffer.length } });
  assert.equal(other.S.tasks.length, 1); assert.equal(other.S.sessions.length, 1); assert.equal(other.B.flow, null);
  // local file is resent by upload
  const before = api.calls.length;
  other.S.outputs[0].files[0].telegramFileId = undefined;
  await other.press('o:' + other.S.outputs[0].id);
  const re = api.calls.slice(before).find((c) => c.upload);
  assert.equal(re.upload.buffer.toString(), 'print("hi")');
  // web-app style backup (files only as data URLs)
  const web = { app: 'rooyesh', format: 1, state: { tasks: [{ id: 'w1', title: 'از وب', status: 'todo' }], outputs: [{ id: 'o1', title: 'عکس', type: 'image', files: [{ fileId: 'f_web1', name: 'r.png', mime: 'image/png', size: 3 }] }] }, files: { f_web1: { name: 'r.png', mime: 'image/png', data: 'data:image/png;base64,' + Buffer.from('PNG').toString('base64') } } };
  api.files.set('WEB', Buffer.from(JSON.stringify(web)));
  await other.press('imp'); await other.msg(null, { document: { file_id: 'WEB', file_name: 'rooyesh-web.json', file_size: 300 } });
  assert.equal(other.S.tasks[0].title, 'از وب');
  assert.equal(fs.readFileSync(path.join(h.dir, 'files', '888', 'f_web1')).toString(), 'PNG');
  // Pre-rename backups remain readable after switching the export brand.
  web.app = 'nava';
  api.files.set('LEGACY', Buffer.from(JSON.stringify(web)));
  await other.press('imp'); await other.msg(null, { document: { file_id: 'LEGACY', file_name: 'legacy.json', file_size: 300 } });
  assert.equal(other.S.tasks[0].title, 'از وب');
  api.files.set('BAD', Buffer.from('{"hello":1}'));
  await other.press('imp'); await other.msg(null, { document: { file_id: 'BAD', file_name: 'x.json', file_size: 11 } });
  assert.match(other.lastText(), /پشتیبان رویش نیست/); assert.equal(other.S.tasks[0].title, 'از وب');
  await other.msg('لغو'); assert.equal(other.B.flow, null);
  // wipe
  await other.press('wipe'); await other.press('wipeok');
  assert.equal(other.S.tasks.length, 0); assert.ok(!fs.existsSync(path.join(h.dir, 'files', '888')));
  clean(h); clean(other);
});

test('privacy: allowed-users list, group chats ignored', async () => {
  const h = setup({ allowed: [777] });
  await h.msg('/start', {}, 999);
  assert.match(h.lastText(), /شخصی است/); assert.match(h.lastText(), /999/);
  assert.ok(!fs.existsSync(path.join(h.dir, 'user-999.json')));
  await h.press('today', 1, 999);
  assert.ok(h.api.calls.at(-1).method === 'answerCallbackQuery');
  await h.msg('/start', {}, 777, 'group'); assert.match(h.lastText(), /گفت‌وگوی خصوصی/);
  await h.msg('/start'); assert.match(h.lastText(), /کجا هستم/);
  clean(h);
});

test('persistence across restarts, including a running timer', async () => {
  const h = setup();
  await h.msg('/add کار ماندگار'); await h.press('ff:25');
  await h.store.flush();
  const raw = JSON.parse(fs.readFileSync(path.join(h.dir, 'user-777.json'), 'utf8'));
  assert.equal(raw.state.tasks[0].title, 'کار ماندگار'); assert.ok(raw.state.timer);
  const h2 = setup({ dir: h.dir, clock: h.clock });
  assert.ok(h2.bot.timers.has(777));
  h2.advance(26); await h2.bot.tick();
  assert.match(h2.lastText(), /جلسه تمام شد/);
  assert.equal(h2.api.calls.find((c) => c.method === 'sendMessage').params.chat_id, 777);
  const s2 = createStore(h.dir); assert.equal(s2.get(777).state.tasks.length, 1);
  clean(h2);
});

test('robustness: stale ids, unknown buttons, odd input and a crawl of every reachable button', async () => {
  const h = setup();
  for (const d of ['g:nope', 'p:nope', 't:nope', 'l:nope', 'o:nope', 'done:nope', 'st:nope', 'tpl:99', 'xx', '', 'lpv:x:50', 'qr:a:b', 'scl:zz:1', 'jd:2020-01-01', 'ss:outs', 'rvs', 'aodone', 'setnx:zz', 'pp:a:b:c:d', 'brk:abc']) await h.press(d);
  await h.msg(null, { sticker: { file_id: 'S' } });
  await h.msg('x'.repeat(5000)); await h.tap('سه کار مهم');
  assert.equal(h.S.tasks[0].title.length, 200);
  await h.msg('<b>تگ</b> & "quote"'); await h.tap('فهرست کارها'); assert.equal(h.S.tasks[1].title, '<b>تگ</b> & "quote"');
  await h.press('tpl:0'); await h.press('tpl:2'); await h.press('nl'); await h.msg('کتاب <پایتون>');
  await h.press('ff:25'); h.advance(25); await h.bot.tick(); await h.press('ss:skipnote'); await h.press('ss:outs');
  // breadth-first crawl over buttons (destructive confirmations excluded)
  const seen = new Set(), queue = ['today', 'goals', 'focus', 'learn', 'journal', 'rv:0', 'settings', 'next', 'outs', 'ideas', 'rep:week'];
  let presses = 0;
  while (queue.length && presses < 700) {
    const d = queue.shift(); if (seen.has(d)) continue; seen.add(d);
    if (/^(wipeok|gdelok|pdelok|tdelok|ldelok|odelok|scxok|tcok|idel|exp|imp)/.test(d)) continue;
    await h.press(d); presses++;
    if (h.B.flow) await h.msg('لغو');
    for (const b of h.buttons()) if (!seen.has(b.callback_data)) queue.push(b.callback_data);
  }
  assert.ok(presses > 120, 'crawled ' + presses);
  clean(h);
});

test('Jalali date parsing', () => {
  assert.equal(parseDate('۱۴۰۵/۰۱/۰۱'), '2026-03-21');
  assert.equal(parseDate('1404/12/29'), '2026-03-20');
  assert.equal(parseDate('1403/12/30'), '2025-03-20'); // leap year
  assert.equal(parseDate('1404/12/30'), null);
  assert.equal(parseDate('فردا', '2026-03-14'), '2026-03-15');
  assert.equal(parseDate('پس‌فردا', '2026-03-14'), '2026-03-16');
  assert.equal(parseDate('دیروز', '2026-03-14'), '2026-03-13');
  assert.equal(parseDate('۳ روز دیگر', '2026-03-30'), '2026-04-02');
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseDate('2026-02-28'), '2026-02-28');
});
