// Rooyesh Telegram bot — handlers, flows and screens. Data model = shared core (src/core.cjs).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { parseDate, normalizeDigits } from './jalali.js';
const C = createRequire(import.meta.url)('./core.cjs');
const L = C.LABELS;
const esc = (s) => C.escapeHtml(s);
const fa = C.fa;
const btn = (text, data) => ({ text, callback_data: data });
const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
const BTN = {
  today: '☀️ امروز', next: '🧭 از کجا شروع کنم؟', goals: '🎯 اهداف', focus: '⏱ تمرکز',
  learn: '📚 یادگیری', journal: '📓 دفتر', review: '🗓 مرور هفتگی', settings: '⚙️ تنظیمات',
};
const TEMPLATES = [
  { title: 'کسب درآمد', stages: ['یادگیری مهارت‌های موردنیاز', 'ساخت نمونه‌کار', 'تکمیل رزومه یا پروفایل کاری', 'پیدا کردن و گرفتن پروژه', 'انجام پروژه و دریافت درآمد'] },
  { title: 'قبولی و پیشرفت در کارشناسی ارشد هوش مصنوعی', stages: ['مرور مباحث پایه', 'مطالعهٔ دروس تخصصی', 'مطالعهٔ مقالات علمی', 'انجام تمرین‌ها و پروژه‌های مرتبط', 'آمادگی برای امتحان‌ها و ارزیابی پیشرفت'] },
  { title: 'توسعهٔ پروژهٔ شخصی', stages: ['تعریف مسئله و طراحی', 'تعیین امکانات و مراحل اجرا', 'پیاده‌سازی', 'آزمایش و اصلاح', 'تکمیل و انتشار نسخهٔ قابل استفاده'] },
];

export function createBot({ api, store, allowed = [], now = () => Date.now(), log = console }) {
  const today = () => C.dateKey(new Date(now()));
  const iso = () => new Date(now()).toISOString();
  const byId = (list, id) => list.find((x) => x.id === id);
  const timers = new Set(store.allIds().filter((id) => { const r = store.get(id); return r.state.timer || r.state.pending; }));

  function mainKb(S) {
    const sec = S.settings.sections;
    const rows = [[{ text: BTN.today }, { text: BTN.next }], [{ text: BTN.goals }, { text: BTN.focus }]];
    const r3 = []; if (sec.learning !== false) r3.push({ text: BTN.learn }); if (sec.journal !== false) r3.push({ text: BTN.journal });
    if (r3.length) rows.push(r3);
    rows.push([{ text: BTN.review }, { text: BTN.settings }]);
    return { keyboard: rows, resize_keyboard: true, is_persistent: true };
  }

  // ---------- sending ----------
  async function send(ctx, text, rows, opts = {}) {
    text = cut(text, 4000);
    const markup = rows ? { inline_keyboard: rows } : (opts.main ? mainKb(ctx.S) : undefined);
    if (ctx.msgId && !opts.fresh && rows !== undefined && !opts.main) {
      try { return await api.call('editMessageText', { chat_id: ctx.chatId, message_id: ctx.msgId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: markup }); }
      catch (e) { if (/not modified/i.test(e.message)) return null; /* fall back to a new message */ }
    }
    return api.call('sendMessage', { chat_id: ctx.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: markup });
  }
  const say = (ctx, text, rows) => send(ctx, text, rows, { fresh: true });
  function setFlow(ctx, type, data = {}) { ctx.B.flow = Object.assign({ type }, data); }
  function clearFlow(ctx) { ctx.B.flow = null; }
  async function ask(ctx, type, data, question, extraRows) {
    setFlow(ctx, type, data);
    await say(ctx, question + '\n<i>برای انصراف «لغو» بفرست.</i>', extraRows || null);
  }
  function persist(ctx) { return store.save(ctx.uid); }

  // ---------- day helpers ----------
  const sections = (S) => S.settings.daySections;
  const sectionOf = (S, t) => { const ids = sections(S).map((x) => x.id); return ids.includes(t.section) ? t.section : ids[0]; };
  const todayTasks = (S) => { const t = today(); return S.tasks.filter((x) => x.todayKey === t && (x.status !== 'done' || (x.doneAt && C.dateKey(new Date(x.doneAt)) === t))); };
  const openTasks = (S) => S.tasks.filter((t) => t.status !== 'done');
  function dayCtx(S) {
    const t = today(), day = S.days[t] || {}, type = C.DAY_TYPES[day.type] || C.DAY_TYPES.normal;
    return { today: t, day, energy: type.energy, available: Number(day.available) || 0, dayType: day.type || 'normal' };
  }
  function targetName(S, o) {
    const t = o.taskId && byId(S.tasks, o.taskId); if (t) return t.title;
    const l = o.learningId && byId(S.learning, o.learningId); return l ? l.title : '';
  }
  function newTask(S, title, extra = {}) {
    const t = Object.assign({ id: C.uid(), title: cut(title, 200), projectId: null, status: 'todo', priority: 'medium', energy: 'medium', estimate: 0, due: '', createdAt: iso(), order: nextOrder() }, extra);
    S.tasks.push(t); return t;
  }
  let lastOrder = 0;
  function nextOrder() { lastOrder = Math.max(now(), lastOrder + 1); return lastOrder; }
  function availLabel(m) { return m >= 240 ? '۴ ساعت یا بیشتر' : m >= 60 ? fa(m / 60) + ' ساعت' : fa(m) + ' دقیقه'; }

  // ---------- screens: today ----------
  async function showToday(ctx, note) {
    const S = ctx.S, d = dayCtx(S), st = C.dayStats(S, d.today), mine = todayTasks(S);
    const lines = [];
    if (note) lines.push(note, '');
    lines.push('☀️ <b>' + esc(C.faDate(d.today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + '</b>');
    lines.push(d.day.type || d.day.available
      ? 'روز ' + (d.day.type ? C.DAY_TYPES[d.day.type].label : 'معمولی') + (d.day.available ? ' · زمان در دسترس: ' + availLabel(d.day.available) : '')
      : '<i>نوع روز و زمانی که داری را مشخص کن تا پیشنهادها واقعی‌تر شوند.</i>');
    const cb = C.comeback(S, d.today);
    if (cb && !d.day.cbDismissed) lines.push('', '🌱 <b>خوش برگشتی!</b> ' + fa(cb.gap) + ' روز از آخرین فعالیتت گذشته. لازم نیست چیزی را جبران کنی؛ کارها سر جایشان هستند. یک برنامهٔ سبک بچینم؟');
    lines.push('', '<b>کجا هستم؟</b>', 'تمرکز امروز: ' + C.duration(st.minutes) + ' · انجام‌شده: ' + fa(st.tasksDone));
    S.goals.filter((g) => (g.status || 'active') === 'active').slice(0, 3).forEach((g) => {
      const gp = C.goalProgress(S, g.id), ns = C.goalNextStep(S, g.id);
      lines.push('🎯 ' + esc(g.title) + ' — ' + fa(gp.pct) + '٪' + (ns ? ' · قدم بعدی: ' + esc(ns.task.title) : ''));
    });
    lines.push('', '<b>چه چیزی امروز مهم است؟</b>');
    const empty = [];
    sections(S).forEach((sec) => {
      const list = mine.filter((x) => sectionOf(S, x) === sec.id);
      if (!list.length) { empty.push(sec.title); return; }
      lines.push('<b>' + esc(sec.title) + '</b> (' + fa(list.length) + ' از ' + fa(sec.limit) + ')');
      list.forEach((x) => lines.push((x.status === 'done' ? '  ✅ <s>' : '  ▫️ ') + esc(x.title) + (x.status === 'done' ? '</s>' : '')));
    });
    if (empty.length) lines.push('<i>بخش‌های خالی: ' + empty.map(esc).join('، ') + '</i>');
    const others = openTasks(S).filter((x) => x.todayKey !== d.today).length;
    const rows = [];
    if (cb && !d.day.cbDismissed) rows.push([btn('🌱 برنامهٔ سبک بچین', 'plan:light'), btn('بعداً', 'cbx')]);
    rows.push([btn(BTN.next, 'next')]);
    rows.push([btn('🗓 چیدن برنامهٔ پیشنهادی', 'plan'), btn('➕ افزودن', 'add')]);
    rows.push([btn('✅ تیک زدن کارها', 'tick'), btn('🌤 نوع روز و زمان', 'day')]);
    if (others) rows.push([btn('📋 بقیهٔ کارهای باز (' + fa(others) + ')', 'rest')]);
    return send(ctx, lines.join('\n'), rows);
  }

  async function showNext(ctx, skip) {
    const S = ctx.S, d = dayCtx(S);
    ctx.B.skip = skip ? (ctx.B.skip || []).concat(skip) : [];
    let r = C.suggestNext(S, { today: d.today, energy: d.energy, available: d.available, skip: ctx.B.skip });
    if (!r && ctx.B.skip.length) { ctx.B.skip = []; r = C.suggestNext(S, { today: d.today, energy: d.energy, available: d.available }); }
    if (!r) return send(ctx, 'هنوز کار بازی نداری. یک کار کوچک بنویس و بفرست تا اضافه‌اش کنم؛ بعد می‌توانم پیشنهاد بدهم.', [[btn('➕ افزودن کار', 'add')]]);
    const t = r.task, p = t.projectId && byId(S.projects, t.projectId);
    const text = '🧭 <b>پیشنهاد من برای الان:</b>\n\n<b>' + esc(t.title) + '</b>' + (p ? '\n<i>' + esc(p.title) + '</i>' : '') + '\n\nچرا؟\n' + r.reasons.map((x) => '• ' + esc(x)).join('\n');
    const rows = [[btn('▶️ شروع تمرکز ' + fa(r.minutes) + ' دقیقه‌ای', 'ft:' + r.minutes + ':' + t.id)], [btn('✅ انجامش دادم', 'done:' + t.id)]];
    if (r.remaining > 0) rows[1].push(btn('🔄 پیشنهاد دیگر', 'nx:' + t.id));
    rows.push([btn('⬅️ امروز', 'today')]);
    return send(ctx, text, rows);
  }

  function planToday(ctx, light) {
    const S = ctx.S, d = dayCtx(S);
    const r = C.planDay(S, { today: d.today, dayType: d.dayType, available: d.available, light, skip: todayTasks(S).map((x) => x.id) });
    const main = sections(S)[0];
    const already = todayTasks(S).filter((x) => sectionOf(S, x) === main.id && x.status !== 'done').length;
    const room = Math.max(0, Math.min(main.limit, r.max) - already);
    const chosen = r.tasks.slice(0, room);
    chosen.forEach((x) => { x.todayKey = d.today; x.section = main.id; });
    if (light) S.days[d.today] = Object.assign({}, S.days[d.today], { cbDismissed: true });
    if (chosen.length) return '🗓 ' + fa(chosen.length) + ' کار برای امروز چیده شد؛ حدود ' + C.duration(chosen.reduce((a, x) => a + (Number(x.estimate) || 25), 0)) + '. بقیهٔ کارها سر جایشان می‌مانند.';
    return room ? 'کار بازی برای پیشنهاد نیست.' : 'برنامهٔ امروز پر است؛ همین کافی است 🌿';
  }

  function showAdd(ctx) {
    const rows = sections(ctx.S).map((s) => [btn(s.title, 'add:' + s.id)]);
    rows.push([btn('فقط به فهرست کارها (نه امروز)', 'add:-')], [btn('⬅️ امروز', 'today')]);
    return send(ctx, '➕ کار جدید را به کدام بخش اضافه کنم؟', rows);
  }

  function showTick(ctx) {
    const mine = todayTasks(ctx.S);
    if (!mine.length) return send(ctx, 'برنامهٔ امروز خالی است. با «چیدن برنامهٔ پیشنهادی» یا «افزودن» شروع کن.', [[btn('🗓 چیدن برنامه', 'plan'), btn('➕ افزودن', 'add')], [btn('⬅️ امروز', 'today')]]);
    const rows = mine.slice(0, 20).map((x) => [btn((x.status === 'done' ? '✅ ' : '☐ ') + cut(x.title, 36), 'tg:' + x.id), btn('⚙️', 't:' + x.id), btn('✖️', 'unpin:' + x.id)]);
    rows.push([btn('⬅️ امروز', 'today')]);
    return send(ctx, 'روی هر کار بزن تا انجام‌شده/انجام‌نشده شود. ⚙️ = جزئیات · ✖️ = برداشتن از امروز (کار در فهرست می‌ماند).', rows);
  }

  function showDay(ctx) {
    const d = dayCtx(ctx.S);
    const rows = [Object.keys(C.DAY_TYPES).map((k) => btn((d.day.type === k ? '● ' : '') + C.DAY_TYPES[k].label, 'dt:' + k)),
      [30, 60, 120, 240].map((m) => btn((Number(d.day.available) === m ? '● ' : '') + availLabel(m), 'av:' + m)),
      MOODS.map((m, i) => btn((d.day.mood === i + 1 ? '●' : '') + m, 'md:' + (i + 1))),
      [btn('⬅️ امروز', 'today')]];
    return send(ctx, '🌤 <b>امروز چه روزی است؟</b>\nردیف اول: نوع روز · ردیف دوم: زمان در دسترس · ردیف سوم: حال‌وهوا', rows);
  }

  function showRest(ctx, page = 0) {
    const t = today(), list = openTasks(ctx.S).filter((x) => x.todayKey !== t);
    const per = 12, slice = list.slice(page * per, page * per + per);
    const rows = slice.map((x) => [btn('➕ ' + cut(x.title, 34) + (x.due && x.due < t ? ' ⏳' : ''), 'pin:' + x.id), btn('⚙️', 't:' + x.id), btn('✅', 'rd:' + x.id)]);
    const nav = [];
    if (page > 0) nav.push(btn('→ قبلی', 'rest:' + (page - 1)));
    if ((page + 1) * per < list.length) nav.push(btn('بعدی ←', 'rest:' + (page + 1)));
    if (nav.length) rows.push(nav);
    rows.push([btn('⬅️ امروز', 'today')]);
    return send(ctx, '📋 <b>بقیهٔ کارهای باز</b> (' + fa(list.length) + ')\nکارهای انجام‌نشده سر جایشان می‌مانند؛ فقط چیزی را به امروز بیاور (➕) که واقعاً جا دارد.', rows);
  }

  // ---------- screens: goals & projects ----------
  function showGoals(ctx) {
    const S = ctx.S, lines = ['🎯 <b>اهداف و پروژه‌ها</b>'];
    if (!S.goals.length && !S.projects.length) lines.push('', 'هنوز هدفی نداری. یک هدف بساز یا از نمونه‌ها شروع کن؛ بعداً همه‌چیز قابل تغییر است.');
    const rows = [];
    S.goals.forEach((g) => {
      const gp = C.goalProgress(S, g.id);
      lines.push('', (g.status === 'done' ? '✅ ' : g.status === 'paused' ? '⏸ ' : '• ') + '<b>' + esc(g.title) + '</b> — ' + fa(gp.pct) + '٪' + (g.deadline ? ' · تا ' + esc(C.faDate(g.deadline)) : ''));
      rows.push([btn('🎯 ' + cut(g.title, 40), 'g:' + g.id)]);
    });
    const orphan = S.projects.filter((p) => !p.goalId || !byId(S.goals, p.goalId));
    if (orphan.length) { lines.push('', '<b>پروژه‌های بدون هدف</b>'); orphan.forEach((p) => { lines.push('• ' + esc(p.title) + ' — ' + fa(C.projectProgress(S, p.id).pct) + '٪'); rows.push([btn('📁 ' + cut(p.title, 40), 'p:' + p.id)]); }); }
    rows.push([btn('➕ هدف جدید', 'ng'), btn('📁 پروژهٔ بدون هدف', 'np:-')], [btn('📋 نمونه‌های آماده', 'tpl')]);
    return send(ctx, lines.join('\n'), rows);
  }
  function showGoal(ctx, id) {
    const S = ctx.S, g = byId(S.goals, id); if (!g) return showGoals(ctx);
    const gp = C.goalProgress(S, g.id), ps = S.projects.filter((p) => p.goalId === g.id), ns = C.goalNextStep(S, g.id);
    const lines = ['🎯 <b>' + esc(g.title) + '</b>', 'وضعیت: ' + L.goalStatus[g.status || 'active'] + (g.deadline ? ' · مهلت: ' + esc(C.faDate(g.deadline)) : ''),
      'پیشرفت: ' + fa(gp.pct) + '٪ · ' + fa(gp.finishedProjects) + ' از ' + fa(gp.projects) + ' مرحله کامل'];
    if (g.why) lines.push('<i>' + esc(g.why) + '</i>');
    if (ns) lines.push('➡️ قدم بعدی: <b>' + esc(ns.task.title) + '</b>');
    lines.push('');
    const rows = [];
    ps.forEach((p) => {
      const pr = C.projectProgress(S, p.id), n = C.nextStep(S, p.id);
      lines.push((pr.pct === 100 ? '✅ ' : '▫️ ') + esc(p.title) + ' — ' + fa(pr.pct) + '٪' + (n ? '\n      قدم بعدی: ' + esc(n.title) : ''));
      rows.push([btn('📁 ' + cut(p.title, 40), 'p:' + p.id)]);
    });
    if (!ps.length) lines.push('<i>هنوز مرحله/پروژه‌ای ندارد.</i>');
    rows.push([btn('➕ مرحله/پروژه', 'np:' + g.id), btn('📅 مهلت', 'dl:g:' + g.id)]);
    rows.push([btn(g.status === 'done' ? '↩️ فعال شود' : '✔️ تکمیل شد', 'gs:' + g.id + ':' + (g.status === 'done' ? 'active' : 'done')), btn(g.status === 'paused' ? '▶️ ادامه' : '⏸ توقف', 'gs:' + g.id + ':' + (g.status === 'paused' ? 'active' : 'paused'))]);
    rows.push([btn('✏️ چرا مهم است؟', 'gw:' + g.id), btn('🗑 حذف', 'gdel:' + g.id)], [btn('⬅️ اهداف', 'goals')]);
    return send(ctx, lines.join('\n'), rows);
  }
  function showProject(ctx, id) {
    const S = ctx.S, p = byId(S.projects, id); if (!p) return showGoals(ctx);
    const pr = C.projectProgress(S, p.id), n = C.nextStep(S, p.id), ts = C.projectTasks(S, p.id);
    const lines = ['📁 <b>' + esc(p.title) + '</b>', 'وضعیت: ' + L.goalStatus[p.status || 'active'] + ' · پیشرفت: ' + fa(pr.pct) + '٪ (' + fa(pr.done) + ' از ' + fa(pr.total) + ' قدم)' + (p.deadline ? ' · مهلت: ' + esc(C.faDate(p.deadline)) : '')];
    lines.push(n ? '➡️ قدم بعدی: <b>' + esc(n.title) + '</b>' : (pr.total ? '🎉 همهٔ قدم‌ها انجام شده.' : '<i>قدم اول را اضافه کن.</i>'));
    const rows = ts.slice(0, 15).map((t) => [btn((t.status === 'done' ? '✅ ' : n && n.id === t.id ? '➡️ ' : '☐ ') + cut(t.title, 40), 'st:' + t.id)]);
    if (n) rows.push([btn('▶️ شروع قدم بعدی', 'fs:' + n.id), btn('⭐ تعیین قدم بعدی', 'nxs:' + p.id)]);
    rows.push([btn('➕ قدم‌های جدید', 'ns:' + p.id), btn('📅 مهلت', 'dl:p:' + p.id)]);
    rows.push([btn(p.status === 'done' ? '↩️ فعال شود' : '✔️ تکمیل شد', 'ps:' + p.id + ':' + (p.status === 'done' ? 'active' : 'done')), btn(p.status === 'paused' ? '▶️ ادامه' : '⏸ توقف', 'ps:' + p.id + ':' + (p.status === 'paused' ? 'active' : 'paused'))]);
    rows.push([btn('🗑 حذف پروژه', 'pdel:' + p.id), btn('⬅️ ' + (p.goalId && byId(S.goals, p.goalId) ? 'هدف' : 'اهداف'), p.goalId && byId(S.goals, p.goalId) ? 'g:' + p.goalId : 'goals')]);
    return send(ctx, lines.join('\n') + (ts.length ? '\n\n<i>روی هر قدم بزن تا انجام‌شده/انجام‌نشده شود.</i>' : ''), rows);
  }
  function showTemplates(ctx) {
    const rows = TEMPLATES.map((t, i) => [btn('📋 ' + t.title, 'tpl:' + i)]); rows.push([btn('⬅️ اهداف', 'goals')]);
    return send(ctx, '📋 <b>نمونه‌های آماده</b>\nهر نمونه یک هدف با مراحلش می‌سازد؛ بعد مراحل را مطابق شرایط خودت تغییر بده.\n\n' + TEMPLATES.map((t) => '<b>' + esc(t.title) + '</b>\n' + t.stages.map((s) => '  ▫️ ' + esc(s)).join('\n')).join('\n\n'), rows);
  }

  // ---------- focus timer ----------
  const clockAt = (ms) => new Date(ms).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  function timerText(S) {
    const t = S.timer, rem = C.timerRemaining(t, now()), isBreak = t.phase === 'break';
    const target = targetName(S, t);
    return (isBreak ? '☕ <b>استراحت</b>' : '⏱ <b>جلسهٔ تمرکز</b>') + (t.status === 'paused' ? ' (متوقف)' : '') +
      '\nزمان باقی‌مانده: ' + C.clock(rem) + ' از ' + fa(t.plannedMin) + ' دقیقه' + (target && !isBreak ? '\nروی: <b>' + esc(target) + '</b>' : '') +
      (t.status === 'running' ? '\nپایان حدود ساعت ' + clockAt(t.endAt) : '');
  }
  function timerRows(S) {
    const t = S.timer, isBreak = t.phase === 'break';
    return [[t.status === 'running' ? btn('⏸ توقف موقت', 'tp') : btn('▶️ ادامه', 'tr'), isBreak ? btn('⏹ پایان استراحت', 'te') : btn('⏹ پایان و ثبت نتیجه', 'te')], ...(isBreak ? [] : [[btn('✖️ لغو بدون ثبت', 'tc')]]), [btn('🔄 به‌روزرسانی', 'focus')]];
  }
  function showFocus(ctx) {
    const S = ctx.S;
    if (S.timer) return send(ctx, timerText(S), timerRows(S));
    const p = S.settings.pomodoro, presets = [...new Set([p.focus, 15, 25, 45, 60, 90])].slice(0, 6);
    const rows = [presets.map((m) => btn((m === p.focus ? '● ' : '') + fa(m), 'fm:' + m)), [btn('✏️ مدت دلخواه', 'fmc')], [btn('📊 گزارش زمان', 'rep:week')]];
    return send(ctx, '⏱ <b>تایمر تمرکز</b>\nمدت جلسه را انتخاب کن (دقیقه).\nالگوی تو: ' + fa(p.focus) + ' دقیقه تمرکز · ' + fa(p.shortBreak) + ' دقیقه استراحت · بعد از هر ' + fa(p.longEvery) + ' جلسه ' + fa(p.longBreak) + ' دقیقه استراحت بلند.', rows);
  }
  function showFocusTarget(ctx, min, taskId) {
    const S = ctx.S;
    if (taskId) return startTimer(ctx, min, { kind: 'work', taskId });
    const t = today();
    const tasks = openTasks(S).sort((a, b) => (b.todayKey === t) - (a.todayKey === t)).slice(0, 8);
    const rows = tasks.map((x) => [btn('🛠 ' + cut(x.title, 40), 'ft:' + min + ':' + x.id)]);
    S.learning.filter((l) => l.status !== 'done').slice(0, 5).forEach((l) => rows.push([btn('📚 ' + cut(l.title, 40), 'fl:' + min + ':' + l.id)]));
    rows.push([btn('جلسهٔ آزاد', 'ff:' + min)], [btn('⬅️ برگشت', 'focus')]);
    return send(ctx, '⏱ ' + fa(min) + ' دقیقه — روی چه کاری یا درسی؟', rows);
  }
  async function startTimer(ctx, min, meta) {
    const S = ctx.S;
    if (S.timer) return send(ctx, 'یک جلسه در جریان است.\n\n' + timerText(S), timerRows(S));
    const n = Math.round(Number(min)); if (!(n >= 1 && n <= 300)) return say(ctx, 'مدت باید بین ۱ تا ۳۰۰ دقیقه باشد.');
    if (S.pending) await finishSession(ctx, true);
    min = n;
    S.timer = C.timerStart(min, Object.assign({ phase: 'focus' }, meta), now());
    if (meta.taskId) { const t = byId(S.tasks, meta.taskId); if (t && t.status === 'todo') t.status = 'doing'; }
    ctx.B.chatId = ctx.chatId; ctx.B.offerBreak = null;
    timers.add(ctx.uid);
    return send(ctx, (meta.phase === 'break' ? '☕ استراحت شروع شد. از پشت میز بلند شو و کمی آب بخور.\n\n' : '🚀 شروع شد! فقط روی همین یک کار تمرکز کن.\n\n') + timerText(S), timerRows(S));
  }
  async function endFocus(ctx, natural) {
    const S = ctx.S, t = S.timer; if (!t) return showFocus(ctx);
    if (t.phase === 'break') {
      S.timer = null;
      return send(ctx, natural ? '⏰ استراحت تمام شد. هر وقت آماده بودی ادامه بده.' : 'استراحت تمام شد.', [[btn('▶️ جلسهٔ بعدی', 'focus'), btn('☀️ امروز', 'today')]], { fresh: natural });
    }
    const mins = natural ? t.plannedMin : C.timerElapsedMin(t, now());
    if (mins < 1) { S.timer = null; clearFlow(ctx); return send(ctx, 'جلسه کمتر از یک دقیقه بود و ثبت نشد. هر وقت آماده بودی دوباره شروع کن.', [[btn('⏱ تمرکز', 'focus'), btn('☀️ امروز', 'today')]]); }
    S.pending = { start: new Date(t.startedAt).toISOString(), end: iso(), minutes: mins, plannedMin: t.plannedMin, kind: t.kind || 'work', taskId: t.taskId || null, learningId: t.learningId || null, natural: !!natural, outputs: [] };
    S.timer = null;
    setFlow(ctx, 'session', { step: 'note' });
    const target = targetName(S, S.pending);
    return send(ctx, (natural ? '🎉 <b>آفرین! جلسه تمام شد.</b>' : '⏹ <b>جلسه پایان یافت.</b>') + '\n' + C.duration(mins) + (target ? ' روی «' + esc(target) + '»' : '') +
      '\n\n✍️ در این جلسه چه کردی؟ یک جملهٔ کوتاه بنویس.', [[btn('رد کردن', 'ss:skipnote')], [btn('🗑 این جلسه ثبت نشود', 'ss:discard')]], { fresh: natural });
  }
  function askOutputs(ctx) {
    ctx.B.flow.step = 'outputs';
    const n = ctx.S.pending.outputs.length;
    return say(ctx, '📦 <b>خروجی‌ای ساختی؟</b>\nکد را به‌صورت متن، یا فایل پروژه، عکس نتیجه یا لینک بفرست. می‌توانی چند پیام بفرستی.' + (n ? '\nتا الان: ' + fa(n) + ' خروجی' : ''),
      [[btn(n ? '✅ تمام' : 'خروجی ندارم', 'ss:outs')]]);
  }
  async function sessionNext(ctx) {
    const S = ctx.S, p = S.pending, f = ctx.B.flow;
    const task = p.taskId && byId(S.tasks, p.taskId), learn = p.learningId && byId(S.learning, p.learningId);
    if (f.step === 'outputs') {
      if (task && task.status !== 'done') { f.step = 'taskdone'; return say(ctx, 'کار «' + esc(task.title) + '» تمام شد؟', [[btn('✅ بله، تمام شد', 'ss:td:1'), btn('هنوز نه', 'ss:td:0')]]); }
      f.step = 'taskdone';
    }
    if (f.step === 'taskdone' && learn) { f.step = 'topic'; return say(ctx, '📚 آخرین مبحثی که در «' + esc(learn.title) + '» خواندی چه بود؟' + (learn.lastTopic ? '\n<i>قبلی: ' + esc(learn.lastTopic) + '</i>' : ''), [[btn('رد کردن', 'ss:skip')]]); }
    if (f.step === 'topic' && learn) { f.step = 'next'; return say(ctx, '➡️ قدم بعدی برای ادامهٔ یادگیری چیست؟', [[btn('رد کردن', 'ss:skip')]]); }
    return finishSession(ctx);
  }
  async function finishSession(ctx, quiet) {
    const S = ctx.S, p = S.pending; if (!p) return null;
    const sess = { id: C.uid(), start: p.start, end: p.end, plannedMin: p.plannedMin, minutes: p.minutes, kind: p.kind, taskId: p.taskId, learningId: p.learningId, note: p.note || '' };
    S.sessions.push(sess);
    p.outputs.forEach((o) => S.outputs.push(Object.assign(o, { sessionId: sess.id, taskId: p.taskId, learningId: p.learningId })));
    S.pending = null; if (ctx.B.flow && ctx.B.flow.type === 'session') clearFlow(ctx);
    if (quiet) return sess;
    const nb = C.nextBreak(S, today());
    ctx.B.offerBreak = nb.minutes;
    return say(ctx, '✅ جلسه ثبت شد: ' + C.duration(sess.minutes) + (p.outputs.length ? ' · ' + fa(p.outputs.length) + ' خروجی' : '') + '\n\n☕ وقت ' + (nb.long ? 'استراحت بلند' : 'استراحت') + ' است: ' + fa(nb.minutes) + ' دقیقه.',
      [[btn('☕ شروع استراحت ' + fa(nb.minutes) + ' دقیقه', 'brk:' + nb.minutes), btn('رد کردن', 'today')]]);
  }
  function outputFromMessage(S, msg, kind) {
    const base = { id: C.uid(), createdAt: iso(), files: [], text: '', url: '' };
    if (msg.photo && msg.photo.length) {
      const ph = msg.photo[msg.photo.length - 1];
      return Object.assign(base, { title: cut(msg.caption || 'تصویر نتیجه', 120), type: 'image', files: [{ telegramFileId: ph.file_id, name: 'photo.jpg', mime: 'image/jpeg', size: ph.file_size || 0 }] });
    }
    if (msg.document) {
      const d = msg.document;
      return Object.assign(base, { title: cut(msg.caption || d.file_name || 'فایل', 120), type: /^image\//.test(d.mime_type || '') ? 'image' : /\.(py|js|ts|java|c|cpp|cs|go|rs|rb|php|ipynb|html|css|sql|sh)$/i.test(d.file_name || '') ? 'code' : 'project',
        files: [{ telegramFileId: d.file_id, name: d.file_name || 'file', mime: d.mime_type || 'application/octet-stream', size: d.file_size || 0 }] });
    }
    const text = String(msg.text || '').trim(); if (!text) return null;
    if (/^https?:\/\/\S+$/i.test(text)) return Object.assign(base, { title: cut(text, 80), type: 'link', url: text });
    const code = /\n|[{};=<>()]|def |function |class |import /.test(text);
    return Object.assign(base, { title: cut(text.split('\n')[0], 60), type: code ? 'code' : (kind === 'study' ? 'problem' : 'note'), text });
  }

  // ---------- reports & weekly review ----------
  function reportRange(S, range) {
    const t = today();
    if (range === 'today') return { from: t, to: t, label: 'امروز' };
    if (range === 'month') return { from: C.persianMonthStart(t), to: t, label: 'این ماه' };
    if (range === '30') return { from: C.addDays(t, -29), to: t, label: '۳۰ روز اخیر' };
    return { from: C.weekStart(t, S.settings.weekStartDay), to: t, label: 'این هفته' };
  }
  function reportText(S, rg) {
    const r = C.rangeReport(S, rg.from, rg.to);
    const kind = { project: '📁', learning: '📚', task: '🛠', free: '🕊' };
    const lines = ['📊 <b>گزارش زمان — ' + esc(rg.label) + '</b>', esc(C.faDate(rg.from)) + (rg.from !== rg.to ? ' تا ' + esc(C.faDate(rg.to)) : ''), '',
      'تمرکز: <b>' + C.duration(r.total) + '</b> · ' + fa(r.sessions) + ' جلسه · ' + fa(r.outputs.length) + ' خروجی · ' + fa(r.doneTasks.length) + ' کار انجام‌شده'];
    if (r.groups.length) { lines.push('', '<b>زمان هر درس، پروژه یا فعالیت</b>'); r.groups.forEach((g) => lines.push(kind[g.kind] + ' ' + esc(g.label) + ': ' + C.duration(g.minutes) + ' (' + fa(g.sessions) + ' جلسه' + (g.outputs ? '، ' + fa(g.outputs) + ' خروجی' : '') + ')')); }
    else lines.push('', '<i>در این بازه جلسه‌ای ثبت نشده.</i>');
    return lines.join('\n');
  }
  function showReport(ctx, range, custom) {
    const rg = custom || reportRange(ctx.S, range);
    const rows = [[btn('امروز', 'rep:today'), btn('این هفته', 'rep:week'), btn('این ماه', 'rep:month')], [btn('۳۰ روز اخیر', 'rep:30'), btn('📅 بازهٔ دلخواه', 'repc')], [btn('⬅️ تمرکز', 'focus')]];
    return send(ctx, reportText(ctx.S, rg), rows);
  }
  function showReview(ctx, offset = 0) {
    const S = ctx.S, ws = C.weekStart(C.addDays(today(), offset * 7), S.settings.weekStartDay), st = C.weekStats(S, ws);
    const rv = S.reviews.find((r) => r.weekStart === ws) || {};
    const lines = ['🗓 <b>مرور هفتگی</b> — ' + esc(C.faDate(st.start, { day: 'numeric', month: 'long' })) + ' تا ' + esc(C.faDate(st.end, { day: 'numeric', month: 'long' })), '',
      '<b>پیشرفت</b>: ' + C.duration(st.focusMinutes) + ' تمرکز · ' + fa(st.sessions) + ' جلسه · ' + fa(st.doneTasks.length) + ' کار انجام‌شده · ' + fa(st.outputs.length) + ' خروجی · ' + fa(st.activeDays) + ' روز فعال' + (st.avgMood ? ' · میانگین حال ' + fa(st.avgMood) + ' از ۵' : '')];
    if (st.doneTasks.length || st.outputs.length) {
      lines.push('', '<b>دستاوردها</b>');
      st.doneTasks.slice(0, 15).forEach((t) => lines.push('✅ ' + esc(t.title)));
      st.outputs.slice(0, 10).forEach((o) => lines.push('📦 ' + esc(o.title) + ' (' + esc(L.outputType[o.type] || 'خروجی') + ')'));
    } else lines.push('', '<i>این هفته هنوز دستاوردی ثبت نشده؛ هر قدم کوچکی هم حساب است.</i>');
    const Q = { wentWell: 'خوب پیش رفت', obstacles: 'موانع', change: 'باید تغییر کند', nextPlan: 'برنامهٔ هفتهٔ بعد' };
    const has = Object.keys(Q).filter((k) => rv[k]);
    if (has.length) { lines.push('', '<b>مرور تو</b>'); has.forEach((k) => lines.push('• ' + Q[k] + ': ' + esc(rv[k]))); }
    const rows = [[btn(has.length ? '✍️ بازنویسی مرور' : '✍️ نوشتن مرور', 'rvw:' + ws)], [btn('→ هفتهٔ قبل', 'rv:' + (offset - 1))].concat(offset < 0 ? [btn('هفتهٔ بعد ←', 'rv:' + (offset + 1))] : []), [btn('📊 گزارش زمان', 'rep:week')]];
    return send(ctx, lines.join('\n'), rows);
  }
  const REVIEW_Q = [['wentWell', 'چه چیزهایی این هفته خوب پیش رفت؟'], ['obstacles', 'با چه موانعی روبه‌رو شدی؟'], ['change', 'چه چیزی باید تغییر کند؟'], ['nextPlan', 'برنامه و سه اولویت هفتهٔ آینده چیست؟']];

  // ---------- task details ----------
  function showTask(ctx, id) {
    const S = ctx.S, t = byId(S.tasks, id); if (!t) return showToday(ctx, 'این کار دیگر وجود ندارد.');
    const p = t.projectId && byId(S.projects, t.projectId), td = today();
    const sec = sections(S).find((x) => x.id === sectionOf(S, t));
    const lines = ['🛠 <b>' + esc(t.title) + '</b>', 'وضعیت: ' + L.status[t.status] + (t.todayKey === td ? ' · در برنامهٔ امروز (' + esc(sec ? sec.title : '') + ')' : ''),
      'اولویت: ' + L.priority[t.priority || 'medium'] + ' · انرژی لازم: ' + L.energy[t.energy || 'medium'] + ' · زمان: ' + (Number(t.estimate) ? C.duration(t.estimate) : 'نامشخص'),
      'مهلت: ' + (t.due ? esc(C.faDate(t.due)) + (t.due < td && t.status !== 'done' ? ' ⏳' : '') : 'ندارد') + (p ? '\nپروژه: ' + esc(p.title) : '')];
    const mark = (cur, v, label) => (cur === v ? '● ' : '') + label;
    const rows = [
      ['high', 'medium', 'low'].map((v) => btn(mark(t.priority || 'medium', v, 'اولویت ' + L.priority[v]), 'tpr:' + t.id + ':' + v)),
      ['low', 'medium', 'high'].map((v) => btn(mark(t.energy || 'medium', v, 'انرژی ' + L.energy[v]), 'ten:' + t.id + ':' + v)),
      [10, 25, 50, 90].map((m) => btn(mark(Number(t.estimate) || 0, m, fa(m) + ' دقیقه'), 'tes:' + t.id + ':' + m)),
      [btn('📅 مهلت', 'dl:t:' + t.id), btn('✏️ عنوان', 'tti:' + t.id), t.todayKey === td ? btn('➖ از امروز', 'unpin:' + t.id) : btn('☀️ به امروز', 'pin:' + t.id)],
      [btn(t.status === 'done' ? '↩️ برگردان' : '✅ انجام شد', 'tg:' + t.id), btn('▶️ تمرکز', 'fs:' + t.id), btn('🗑 حذف', 'tdel:' + t.id)],
      [p ? btn('⬅️ پروژه', 'p:' + p.id) : btn('⬅️ امروز', 'today')]];
    return send(ctx, lines.join('\n'), rows);
  }
  function addTasks(ctx, text, secId) {
    const S = ctx.S, titles = String(text).split('\n').map((x) => x.replace(/^[\s\-•*▫️☐\d.)]+/u, '').trim()).filter(Boolean).slice(0, 30);
    const extra = secId ? { todayKey: today(), section: secId } : {};
    const made = titles.map((x) => newTask(S, x, Object.assign({}, extra)));
    if (!made.length) return say(ctx, 'متنی برای کار پیدا نکردم.');
    const sec = secId && sections(S).find((x) => x.id === secId);
    const over = sec ? todayTasks(S).filter((x) => sectionOf(S, x) === sec.id && x.status !== 'done').length - sec.limit : 0;
    const rows = made.length === 1 ? [[btn('⚙️ اولویت، انرژی، مهلت', 't:' + made[0].id)]] : [];
    rows.push([btn('➕ باز هم', 'add:' + (secId || '-')), btn('☀️ امروز', 'today')]);
    return say(ctx, '✅ ' + (made.length === 1 ? '«' + esc(made[0].title) + '»' : fa(made.length) + ' کار') + ' اضافه شد' + (sec ? ' به «' + esc(sec.title) + '»' : ' به فهرست کارها') + '.' +
      (over > 0 ? '\n<i>این بخش از ظرفیت ' + fa(sec.limit) + ' تایی‌اش بیشتر شد؛ اشکالی ندارد، ولی شاید بهتر باشد یکی را به روز دیگری بسپاری.</i>' : ''), rows);
  }

  // ---------- learning ----------
  const learnIcon = { course: '🎓', book: '📖', article: '📰', video: '🎬', other: '📌' };
  function showLearn(ctx) {
    const S = ctx.S, list = S.learning.slice().sort((a, b) => (a.status === 'done') - (b.status === 'done'));
    const lines = ['📚 <b>فضای یادگیری</b>'];
    if (!list.length) lines.push('', 'هنوز منبعی اضافه نکرده‌ای. دوره، کتاب، مقاله یا ویدیویی که می‌خوانی را اضافه کن تا ادامه‌اش همیشه معلوم باشد.');
    list.forEach((l) => {
      const open = (l.questions || []).filter((q) => !q.resolved).length;
      lines.push('', learnIcon[l.type || 'other'] + ' <b>' + esc(l.title) + '</b> — ' + L.learnStatus[l.status || 'learning'] + ' · ' + fa(l.progress || 0) + '٪' +
        (l.nextStep ? '\n   ➡️ ' + esc(l.nextStep) : '') + (open ? '\n   ❓ ' + fa(open) + ' سؤال باز' : ''));
    });
    const rows = list.slice(0, 20).map((l) => [btn(learnIcon[l.type || 'other'] + ' ' + cut(l.title, 40), 'l:' + l.id)]);
    rows.push([btn('➕ منبع جدید', 'nl')], [btn('📦 خروجی‌ها و تمرین‌ها', 'outs'), btn('💡 ایده‌ها و مقالات', 'ideas')]);
    return send(ctx, lines.join('\n'), rows);
  }
  function showLearnItem(ctx, id) {
    const S = ctx.S, l = byId(S.learning, id); if (!l) return showLearn(ctx);
    const qs = l.questions || [], open = qs.filter((q) => !q.resolved), outs = S.outputs.filter((o) => o.learningId === l.id);
    const mins = S.sessions.filter((s) => s.learningId === l.id).reduce((a, s) => a + (Number(s.minutes) || 0), 0);
    const lines = [learnIcon[l.type || 'other'] + ' <b>' + esc(l.title) + '</b>', L.learnType[l.type || 'other'] + ' · ' + L.learnStatus[l.status || 'learning'] + ' · پیشرفت ' + fa(l.progress || 0) + '٪ · ' + C.duration(mins) + ' مطالعه',
      '', '📍 آخرین مبحث: ' + (l.lastTopic ? esc(l.lastTopic) : '—'), '➡️ قدم بعدی: ' + (l.nextStep ? '<b>' + esc(l.nextStep) + '</b>' : 'مشخص نشده')];
    if (l.link) lines.push('🔗 ' + esc(l.link));
    if (l.notes) lines.push('', '📝 <b>یادداشت‌ها</b>', esc(cut(l.notes, 1200)));
    if (open.length) { lines.push('', '❓ <b>سؤال‌های حل‌نشده</b>'); open.slice(0, 8).forEach((q) => lines.push('• ' + esc(q.text))); }
    if (outs.length) lines.push('', '📦 ' + fa(outs.length) + ' خروجی/تمرین ثبت شده');
    const rows = [[btn('▶️ شروع مطالعه (' + fa(S.settings.pomodoro.focus) + ' دقیقه)', 'fl:' + S.settings.pomodoro.focus + ':' + l.id)],
      [btn('📍 آخرین مبحث', 'lf:' + l.id + ':lastTopic'), btn('➡️ قدم بعدی', 'lf:' + l.id + ':nextStep')],
      [btn('📈 پیشرفت', 'lp:' + l.id), btn('🔖 وضعیت و نوع', 'lst:' + l.id), btn('🔗 لینک', 'lf:' + l.id + ':link')],
      [btn('📝 یادداشت', 'lf:' + l.id + ':notes'), btn('❓ سؤال‌ها (' + fa(open.length) + ')', 'lq:' + l.id)],
      [btn('📦 خروجی‌ها (' + fa(outs.length) + ')', 'lo:' + l.id), btn('➕ ثبت تمرین/خروجی', 'lao:' + l.id)],
      [btn('🗑 حذف', 'ldel:' + l.id), btn('⬅️ یادگیری', 'learn')]];
    return send(ctx, lines.join('\n'), rows);
  }
  const LEARN_FIELDS = { lastTopic: 'آخرین جلسه یا مبحثی که خواندی چه بود؟', nextStep: 'قدم بعدی برای ادامهٔ این منبع چیست؟', link: 'لینک منبع را بفرست (یا «حذف»).', notes: 'یادداشت کوتاهت را بنویس؛ به یادداشت‌های قبلی اضافه می‌شود.', title: 'عنوان جدید را بنویس.' };
  function showLearnProgress(ctx, id) {
    const l = byId(ctx.S.learning, id); if (!l) return showLearn(ctx);
    const vals = [0, 10, 25, 40, 50, 60, 75, 90, 100];
    return send(ctx, '📈 پیشرفت «' + esc(l.title) + '» چند درصد است؟', [vals.slice(0, 5).map((v) => btn((Number(l.progress) === v ? '● ' : '') + fa(v), 'lpv:' + id + ':' + v)), vals.slice(5).map((v) => btn((Number(l.progress) === v ? '● ' : '') + fa(v), 'lpv:' + id + ':' + v)), [btn('⬅️ برگشت', 'l:' + id)]]);
  }
  function showLearnStatus(ctx, id) {
    const l = byId(ctx.S.learning, id); if (!l) return showLearn(ctx);
    const st = Object.keys(L.learnStatus).map((k) => btn((l.status === k ? '● ' : '') + L.learnStatus[k], 'lsv:' + id + ':' + k));
    const ty = Object.keys(L.learnType).map((k) => btn((l.type === k ? '● ' : '') + L.learnType[k], 'lty:' + id + ':' + k));
    return send(ctx, '🔖 وضعیت و نوع «' + esc(l.title) + '»', [st.slice(0, 2), st.slice(2), ty.slice(0, 3), ty.slice(3), [btn('✏️ تغییر عنوان', 'lf:' + id + ':title')], [btn('⬅️ برگشت', 'l:' + id)]]);
  }
  function showQuestions(ctx, id) {
    const l = byId(ctx.S.learning, id); if (!l) return showLearn(ctx);
    const qs = l.questions || [], done = qs.filter((q) => q.resolved).length;
    const rows = qs.filter((q) => !q.resolved).slice(0, 15).map((q) => [btn('✔️ ' + cut(q.text, 45), 'qr:' + id + ':' + q.id)]);
    rows.push([btn('➕ سؤال جدید', 'qadd:' + id)], [btn('⬅️ برگشت', 'l:' + id)]);
    return send(ctx, '❓ <b>سؤال‌های حل‌نشدهٔ «' + esc(l.title) + '»</b>\n' + (rows.length > 2 ? 'وقتی جواب سؤالی را پیدا کردی رویش بزن.' : 'سؤال بازی نداری.') + (done ? '\n<i>' + fa(done) + ' سؤال حل شده.</i>' : ''), rows);
  }
  function showOutputs(ctx, learningId) {
    const S = ctx.S, list = S.outputs.filter((o) => !learningId || o.learningId === learningId).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const icon = { code: '💻', problem: '🧩', project: '🗂', image: '🖼', note: '📝', link: '🔗' };
    const rows = list.slice(0, 15).map((o) => [btn((icon[o.type] || '📦') + ' ' + cut(o.title, 42), 'o:' + o.id)]);
    rows.push([btn('➕ ثبت خروجی', learningId ? 'lao:' + learningId : 'lao:-')], [btn('⬅️ برگشت', learningId ? 'l:' + learningId : 'learn')]);
    return send(ctx, '📦 <b>خروجی‌ها و تمرین‌ها</b> (' + fa(list.length) + ')\n' + (list.length ? 'روی هر مورد بزن تا محتوا یا فایلش را دوباره بفرستم.' : 'هنوز خروجی‌ای ثبت نشده. بعد از هر جلسهٔ تمرکز می‌توانی کد، فایل یا عکس نتیجه را بفرستی.'), rows);
  }
  async function sendOutput(ctx, id) {
    const S = ctx.S, o = byId(S.outputs, id); if (!o) return showOutputs(ctx);
    const target = targetName(S, o);
    const head = '📦 <b>' + esc(o.title) + '</b>\n' + esc(L.outputType[o.type] || 'خروجی') + ' · ' + esc(C.faDate(C.dateKey(new Date(o.createdAt)))) + (target ? ' · ' + esc(target) : '');
    let body = '';
    if (o.text) body += '\n\n' + (o.type === 'code' ? '<pre>' + esc(cut(o.text, 3400)) + '</pre>' : esc(cut(o.text, 3400)));
    if (o.url) body += '\n\n🔗 ' + esc(o.url);
    await say(ctx, head + body, [[btn('🗑 حذف', 'odel:' + o.id), btn('⬅️ خروجی‌ها', o.learningId ? 'lo:' + o.learningId : 'outs')]]);
    for (const f of o.files || []) {
      const isImg = /^image\//.test(f.mime || '') && /\.(jpe?g|png|webp)$/i.test(f.name || 'x.jpg');
      try {
        if (f.telegramFileId) { await api.call(isImg ? 'sendPhoto' : 'sendDocument', { chat_id: ctx.chatId, [isImg ? 'photo' : 'document']: f.telegramFileId, caption: cut(f.name, 200) }); continue; }
        const buf = readLocal(ctx.uid, f.fileId);
        if (!buf) { await say(ctx, '⚠️ فایل «' + esc(f.name) + '» در دسترس نیست.'); continue; }
        const r = await api.upload('sendDocument', { chat_id: ctx.chatId, caption: cut(f.name, 200) }, 'document', f.name || 'file', buf, f.mime || 'application/octet-stream');
        const doc = r && (r.document || (r.photo && r.photo[r.photo.length - 1]));
        if (doc && doc.file_id) f.telegramFileId = doc.file_id;
      } catch (e) { log.error && log.error('send file failed', e.message); await say(ctx, '⚠️ ارسال فایل «' + esc(f.name) + '» ممکن نشد.'); }
    }
    return null;
  }

  // ---------- local file storage (files imported from the web app backup) ----------
  const userDir = (uid) => path.join(store.dir, 'files', String(uid).replace(/[^0-9-]/g, ''));
  const safeName = (id) => String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  function readLocal(uid, fileId) { if (!safeName(fileId)) return null; try { return fs.readFileSync(path.join(userDir(uid), safeName(fileId))); } catch { return null; } }
  function writeLocal(uid, fileId, buf) { fs.mkdirSync(userDir(uid), { recursive: true }); fs.writeFileSync(path.join(userDir(uid), safeName(fileId)), buf); }
  function wipeLocal(uid) { fs.rmSync(userDir(uid), { recursive: true, force: true }); }

  // ---------- ideas ----------
  function showIdeas(ctx) {
    const S = ctx.S, list = S.ideas.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const lines = ['💡 <b>ایده‌ها و مقالات مهم</b>'];
    if (!list.length) lines.push('', 'ایده‌ای به ذهنت رسید؟ همین‌جا ثبتش کن تا گم نشود. (یا هر جا بنویس: /idea متن ایده)');
    list.slice(0, 20).forEach((i) => lines.push('', (i.kind === 'article' ? '📰 ' : '💡 ') + '<b>' + esc(i.title) + '</b>' + (i.text ? '\n' + esc(cut(i.text, 300)) : '') + (i.url ? '\n🔗 ' + esc(i.url) : '')));
    const rows = [[btn('💡 ایدهٔ جدید', 'ni:idea'), btn('📰 مقالهٔ مهم', 'ni:article')]];
    if (list.length) rows.push([btn('🗑 حذف یک مورد', 'ilist')]);
    rows.push([btn('⬅️ یادگیری', 'learn')]);
    return send(ctx, lines.join('\n'), rows);
  }
  function addIdea(S, text, kind) {
    const lines = String(text).trim().split('\n'), first = lines[0].trim();
    const url = (String(text).match(/https?:\/\/\S+/) || [])[0] || '';
    const idea = { id: C.uid(), title: cut(first === url && lines.length > 1 ? lines[1] : first, 150), kind: kind === 'article' ? 'article' : 'idea', url, text: lines.slice(1).join('\n').trim(), createdAt: iso() };
    S.ideas.push(idea); return idea;
  }

  // ---------- journal ----------
  const ENERGY = ['خیلی کم', 'کم', 'متوسط', 'خوب', 'زیاد'];
  const JFIELDS = { text: ['✍️ افکار و احساسات', 'امروز چه فکر یا احساسی داشتی؟'], events: ['📌 اتفاقات مهم', 'چه اتفاق مهمی امروز افتاد؟'], learned: ['💡 چه یاد گرفتم', 'امروز چه چیزی یاد گرفتی؟'] };
  function journalEntry(S, date, create) {
    let j = S.journal.find((x) => x.date === date);
    if (!j && create) { j = { id: C.uid(), date, createdAt: iso(), mood: null, energy: null, text: '', events: '', learned: '' }; S.journal.push(j); }
    return j;
  }
  function journalLines(j) {
    const out = [];
    if (j.mood) out.push('حال: ' + MOODS[j.mood - 1] + (j.energy ? ' · انرژی: ' + ENERGY[j.energy - 1] : ''));
    else if (j.energy) out.push('انرژی: ' + ENERGY[j.energy - 1]);
    Object.keys(JFIELDS).forEach((k) => { if (j[k]) out.push('', '<b>' + JFIELDS[k][0] + '</b>', esc(j[k])); });
    return out;
  }
  function showJournal(ctx) {
    const S = ctx.S, d = today(), j = journalEntry(S, d) || {};
    const lines = ['📓 <b>دفتر شخصی</b> — ' + esc(C.faDate(d, { weekday: 'long', day: 'numeric', month: 'long' })), '<i>فقط برای خودت؛ جایی ارسال نمی‌شود.</i>', ''];
    const body = journalLines(j);
    lines.push(...(body.length ? body : ['امروز هنوز چیزی ننوشته‌ای. حال و انرژی‌ات را بزن یا چند خط بنویس.']));
    const rows = [MOODS.map((m, i) => btn((j.mood === i + 1 ? '●' : '') + m, 'jm:' + (i + 1))),
      ENERGY.map((e, i) => btn((j.energy === i + 1 ? '●' : '') + '🔋' + fa(i + 1), 'je:' + (i + 1))),
      Object.keys(JFIELDS).map((k) => btn(JFIELDS[k][0], 'jf:' + k)),
      [btn('📜 روزهای قبل', 'jh'), btn('🗓 مرور هفتگی', 'rv:0')]];
    return send(ctx, lines.join('\n') + '\n\n<i>ردیف اول: حال · ردیف دوم: انرژی (۱ کم تا ۵ زیاد)</i>', rows);
  }
  function showJournalHistory(ctx) {
    const list = ctx.S.journal.filter((j) => j.date !== today()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
    const rows = list.map((j) => [btn((j.mood ? MOODS[j.mood - 1] + ' ' : '') + C.faDate(j.date, { weekday: 'short', day: 'numeric', month: 'long' }), 'jd:' + j.date)]);
    rows.push([btn('⬅️ دفتر', 'journal')]);
    return send(ctx, '📜 <b>نوشته‌های قبلی</b>' + (list.length ? '' : '\nهنوز نوشتهٔ قبلی‌ای نیست.'), rows);
  }
  function showJournalDay(ctx, date) {
    const j = journalEntry(ctx.S, date); if (!j) return showJournalHistory(ctx);
    return send(ctx, ['📓 <b>' + esc(C.faDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + '</b>', ''].concat(journalLines(j)).join('\n'), [[btn('⬅️ روزهای قبل', 'jh')]]);
  }

  // ---------- settings ----------
  function showSettings(ctx) {
    const s = ctx.S.settings, p = s.pomodoro, on = (v) => (v !== false ? '✅' : '⬜️');
    const lines = ['⚙️ <b>تنظیمات</b>', '', '👤 نام: ' + esc(s.name || ctx.B.name || '—'),
      '🍅 پومودورو: ' + fa(p.focus) + ' تمرکز · ' + fa(p.shortBreak) + ' استراحت · ' + fa(p.longBreak) + ' استراحت بلند هر ' + fa(p.longEvery) + ' جلسه',
      '🧩 بخش‌های امروز: ' + sections(ctx.S).map((x) => esc(x.title) + ' (' + fa(x.limit) + ')').join('، '),
      '', '🔒 داده‌ها فقط روی سرور خودِ این ربات ذخیره می‌شوند. هر وقت خواستی پشتیبان بگیر یا همه را پاک کن.'];
    const rows = [[btn('🍅 الگوی پومودورو', 'pom'), btn('🧩 بخش‌های امروز', 'secs')],
      [btn('🧭 معیارهای پیشنهاد', 'sug'), btn('👤 نام', 'nm')],
      [btn(on(s.sections.learning) + ' بخش یادگیری', 'sect:learning'), btn(on(s.sections.journal) + ' دفتر شخصی', 'sect:journal')],
      [btn('💾 گرفتن پشتیبان', 'exp'), btn('📥 بازیابی پشتیبان', 'imp')],
      [btn('🗑 پاک کردن همهٔ داده‌ها', 'wipe')]];
    return send(ctx, lines.join('\n'), rows);
  }
  const POM_PRESETS = [[25, 5, 15, 4], [50, 10, 30, 2], [90, 15, 30, 2], [15, 3, 10, 4]];
  function showPomodoro(ctx) {
    const p = ctx.S.settings.pomodoro, cur = [p.focus, p.shortBreak, p.longBreak, p.longEvery].join(':');
    const rows = POM_PRESETS.map((x) => [btn((x.join(':') === cur ? '● ' : '') + fa(x[0]) + ' / ' + fa(x[1]) + ' · بلند ' + fa(x[2]) + ' هر ' + fa(x[3]), 'pp:' + x.join(':'))]);
    rows.push([btn('✏️ الگوی دلخواه', 'pomc')], [btn('⬅️ تنظیمات', 'settings')]);
    return send(ctx, '🍅 <b>الگوی پومودورو</b>\nتمرکز / استراحت کوتاه · استراحت بلند هر چند جلسه\nفعلی: ' + fa(p.focus) + ' / ' + fa(p.shortBreak) + ' · بلند ' + fa(p.longBreak) + ' هر ' + fa(p.longEvery) + ' جلسه', rows);
  }
  function setPomodoro(S, nums) {
    const [f, sb, lb, le] = nums.map((x) => Math.round(Number(x)));
    if (!(f >= 1 && f <= 300 && sb >= 1 && sb <= 120 && lb >= 1 && lb <= 180 && le >= 1 && le <= 12)) return false;
    S.settings.pomodoro = { focus: f, shortBreak: sb, longBreak: lb, longEvery: le }; S.settings.focusMinutes = f; return true;
  }
  function showSections(ctx) {
    const rows = sections(ctx.S).map((x) => [btn(x.title + ' · ' + fa(x.limit), 'sc:' + x.id)]);
    rows.push([btn('➕ بخش جدید', 'sca'), btn('↩️ بخش‌های پیش‌فرض', 'screset')], [btn('⬅️ تنظیمات', 'settings')]);
    return send(ctx, '🧩 <b>بخش‌های صفحهٔ امروز</b>\nتعداد، نام و ظرفیت هر بخش دست خودت است. روی هر بخش بزن تا ویرایشش کنی.', rows);
  }
  function showSection(ctx, id) {
    const list = sections(ctx.S), x = list.find((s) => s.id === id); if (!x) return showSections(ctx);
    const rows = [[btn('➖', 'scl:' + id + ':-1'), btn('ظرفیت: ' + fa(x.limit), 'sc:' + id), btn('➕', 'scl:' + id + ':1')],
      [btn('⬆️ بالاتر', 'scu:' + id), btn('⬇️ پایین‌تر', 'scd:' + id)], [btn('✏️ تغییر نام', 'scr:' + id)].concat(list.length > 1 ? [btn('🗑 حذف بخش', 'scx:' + id)] : []), [btn('⬅️ بخش‌ها', 'secs')]];
    return send(ctx, '🧩 <b>' + esc(x.title) + '</b>\nظرفیت: ' + fa(x.limit) + ' کار' + (list[0].id === id ? '\n<i>این بخش اول است؛ «چیدن برنامهٔ پیشنهادی» کارها را در آن می‌گذارد.</i>' : ''), rows);
  }
  function showSuggestPrefs(ctx) {
    const s = ctx.S.settings.suggest, on = (v) => (v !== false ? '✅ ' : '⬜️ ');
    return send(ctx, '🧭 <b>معیارهای «از کجا شروع کنم؟»</b>\nاولویت، زمان در دسترس، انرژی و وضعیت کارها همیشه در نظر گرفته می‌شوند. این‌ها را هم می‌توانی روشن یا خاموش کنی:', [
      [btn(on(s.deadlines) + 'نزدیکی مهلت‌ها', 'sg:deadlines')], [btn(on(s.easyStart) + 'شروع آسان وقتی انرژی کم است', 'sg:easyStart')], [btn(on(s.goalFocus) + 'ارتباط با اهداف بلندمدت', 'sg:goalFocus')], [btn('⬅️ تنظیمات', 'settings')]]);
  }
  async function doExport(ctx) {
    const S = ctx.S, files = {}; let total = 0, skipped = 0;
    for (const o of S.outputs) for (const f of o.files || []) {
      try {
        let buf = f.fileId ? readLocal(ctx.uid, f.fileId) : null;
        if (!buf && f.telegramFileId && (f.size || 0) <= 15e6 && total < 40e6) {
          const info = await api.call('getFile', { file_id: f.telegramFileId });
          buf = await api.download(info.file_path);
          if (!f.fileId) f.fileId = 'tg' + C.uid();
          writeLocal(ctx.uid, f.fileId, buf);
        }
        if (buf && total + buf.length <= 40e6) { total += buf.length; files[f.fileId] = { name: f.name, mime: f.mime, data: 'data:' + (f.mime || 'application/octet-stream') + ';base64,' + buf.toString('base64') }; }
        else if (f.telegramFileId || f.fileId) skipped++;
      } catch (e) { skipped++; log.error && log.error('export file', e.message); }
    }
    const json = JSON.stringify({ app: 'rooyesh', format: 1, exportedAt: iso(), source: 'telegram-bot', state: S, files }, null, 1);
    await api.upload('sendDocument', { chat_id: ctx.chatId, caption: '💾 پشتیبان رویش — این فایل را در نسخهٔ وب (تنظیمات ← بازیابی) یا همین ربات می‌توانی بازیابی کنی.' + (skipped ? '\n⚠️ ' + fa(skipped) + ' فایل بزرگ داخل پشتیبان نیامد.' : '') }, 'document', 'rooyesh-backup-' + today() + '.json', Buffer.from(json), 'application/json');
    return null;
  }
  async function doImport(ctx, doc) {
    if (!doc || !/\.json$/i.test(doc.file_name || '') ) return say(ctx, 'لطفاً فایل پشتیبان با پسوند json بفرست (یا «لغو»).');
    if ((doc.file_size || 0) > 20e6) return say(ctx, 'این فایل از ۲۰ مگابایت بزرگ‌تر است و تلگرام اجازهٔ دریافتش را به ربات نمی‌دهد.');
    let data;
    try { const info = await api.call('getFile', { file_id: doc.file_id }); data = JSON.parse((await api.download(info.file_path)).toString('utf8')); }
    catch (e) { return say(ctx, 'خواندن فایل ممکن نشد: ' + esc(e.message)); }
    if (!data || (data.app !== 'rooyesh' && data.app !== 'nava') || !data.state) return say(ctx, 'این فایل پشتیبان رویش نیست. یک فایل دیگر بفرست یا «لغو».');
    const st = C.normalizeState(data.state);
    wipeLocal(ctx.uid);
    let n = 0;
    for (const [id, f] of Object.entries(data.files || {})) {
      const m = String(f && f.data || '').match(/^data:[^;,]*(;base64)?,(.*)$/s);
      if (!m || !safeName(id)) continue;
      writeLocal(ctx.uid, id, m[1] ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]))); n++;
    }
    ctx.rec.state = st; ctx.S = st; clearFlow(ctx);
    if (st.timer) timers.add(ctx.uid);
    await send(ctx, '📥 بازیابی انجام شد: ' + fa(st.tasks.length) + ' کار، ' + fa(st.goals.length) + ' هدف، ' + fa(st.sessions.length) + ' جلسه' + (n ? '، ' + fa(n) + ' فایل' : '') + '.', null, { main: true });
    return showToday(ctx);
  }

  // ---------- callback router ----------
  const confirmRows = (yes, no) => [[btn('بله، حذف شود', yes), btn('نه', no)]];
  async function onCallback(ctx, data) {
    const S = ctx.S, [k, a, b, c] = String(data).split(':');
    const T = (id) => byId(S.tasks, id);
    switch (k) {
      case 'today': ctx.B.lastScreen = null; return showToday(ctx);
      case 'next': return showNext(ctx);
      case 'nx': return showNext(ctx, a);
      case 'ft': { const n = Number(a); return b ? startTimer(ctx, n, { kind: 'work', taskId: b }) : showFocusTarget(ctx, n); }
      case 'fl': return startTimer(ctx, Number(a), { kind: 'study', learningId: b });
      case 'ff': return startTimer(ctx, Number(a), { kind: 'work' });
      case 'fm': return showFocusTarget(ctx, Number(a));
      case 'fmc': return ask(ctx, 'customMin', {}, '⏱ چند دقیقه؟ (عدد بین ۱ تا ۳۰۰)');
      case 'fs': { const t = T(a); if (!t) return showToday(ctx); return startTimer(ctx, Number(t.estimate) > 0 && Number(t.estimate) <= 90 ? Number(t.estimate) : S.settings.pomodoro.focus, { kind: 'work', taskId: t.id }); }
      case 'done': case 'tg': {
        const t = T(a); if (!t) return showToday(ctx);
        if (t.status === 'done') { t.status = 'todo'; t.doneAt = null; ctx.toast = 'برگشت به انجام‌نشده'; }
        else { t.status = 'done'; t.doneAt = iso(); ctx.toast = '✅ آفرین!'; }
        if (k === 'done') return showToday(ctx, '✅ «' + esc(t.title) + '» انجام شد. آفرین!');
        const back = ctx.B.lastScreen;
        return back === 'task' ? showTask(ctx, t.id) : showTick(ctx);
      }
      case 'rd': { const t = T(a); if (t) { t.status = 'done'; t.doneAt = iso(); ctx.toast = '✅ آفرین!'; } return showRest(ctx, 0); }
      case 'plan': return showToday(ctx, planToday(ctx, a === 'light'));
      case 'cbx': S.days[today()] = Object.assign({}, S.days[today()], { cbDismissed: true }); return showToday(ctx);
      case 'add': if (a === undefined) return showAdd(ctx);
        return ask(ctx, 'add', { section: a === '-' ? null : a }, '✍️ عنوان کار را بنویس. برای چند کار، هر کدام را در یک خط بنویس.');
      case 'tick': ctx.B.lastScreen = 'tick'; return showTick(ctx);
      case 'unpin': { const t = T(a); if (t) { t.todayKey = null; ctx.toast = 'از امروز برداشته شد'; } return ctx.B.lastScreen === 'task' && t ? showTask(ctx, t.id) : showTick(ctx); }
      case 'pin': { const t = T(a); if (t) { t.todayKey = today(); t.section = t.section && sections(S).some((x) => x.id === t.section) ? t.section : sections(S)[0].id; ctx.toast = 'به امروز اضافه شد'; } return ctx.B.lastScreen === 'task' && t ? showTask(ctx, t.id) : showRest(ctx); }
      case 'day': return showDay(ctx);
      case 'dt': case 'av': case 'md': {
        const d = Object.assign({}, S.days[today()]);
        if (k === 'dt' && C.DAY_TYPES[a]) d.type = a;
        if (k === 'av') d.available = Number(a) || 0;
        if (k === 'md') d.mood = Math.min(5, Math.max(1, Number(a) || 3));
        S.days[today()] = d;
        if (k === 'dt' && (a === 'busy' || a === 'low')) ctx.toast = 'برنامهٔ سبک‌تری پیشنهاد می‌دهم 🌿';
        return showDay(ctx);
      }
      case 'rest': ctx.B.lastScreen = 'rest'; return showRest(ctx, Number(a) || 0);
      case 't': ctx.B.lastScreen = 'task'; return showTask(ctx, a);
      case 'tpr': case 'ten': case 'tes': {
        const t = T(a); if (!t) return showToday(ctx);
        if (k === 'tpr' && L.priority[b]) t.priority = b;
        if (k === 'ten' && L.energy[b]) t.energy = b;
        if (k === 'tes') t.estimate = Number(b) || 0;
        return showTask(ctx, t.id);
      }
      case 'tti': return T(a) ? ask(ctx, 'taskTitle', { id: a }, '✏️ عنوان جدید کار را بنویس.') : showToday(ctx);
      case 'tdel': { const t = T(a); return t ? send(ctx, 'کار «' + esc(t.title) + '» حذف شود؟ (جلسه‌های ثبت‌شده باقی می‌مانند)', confirmRows('tdelok:' + a, 't:' + a)) : showToday(ctx); }
      case 'tdelok': { const t = T(a); S.tasks = S.tasks.filter((x) => x.id !== a); ctx.toast = 'حذف شد'; return t && t.projectId && byId(S.projects, t.projectId) ? showProject(ctx, t.projectId) : showToday(ctx); }
      case 'qa': {
        const text = ctx.B.draft; ctx.B.draft = null;
        if (!text || a === 'x') return send(ctx, 'باشه، چیزی ثبت نشد.', []);
        if (a === 'idea') { const i = addIdea(S, text, 'idea'); return send(ctx, '💡 ایده ثبت شد: «' + esc(i.title) + '»', [[btn('💡 ایده‌ها', 'ideas')]]); }
        if (a === 'j') { const j = journalEntry(S, today(), true); j.text = j.text ? j.text + '\n' + text : text; j.updatedAt = iso(); return send(ctx, '📓 در دفتر امروز نوشته شد.', [[btn('📓 دفتر', 'journal')]]); }
        ctx.msgId = null; return addTasks(ctx, text, a === '-' ? null : a);
      }
      // goals & projects
      case 'goals': return showGoals(ctx);
      case 'g': return showGoal(ctx, a);
      case 'p': return showProject(ctx, a);
      case 'ng': return ask(ctx, 'goal', {}, '🎯 هدف تازه چیست؟ (مثلاً: کسب درآمد از برنامه‌نویسی)');
      case 'np': return ask(ctx, 'project', { goalId: a === '-' ? null : a }, '📁 نام مرحله یا پروژه را بنویس. برای چند مرحله، هر کدام در یک خط.');
      case 'ns': return byId(S.projects, a) ? ask(ctx, 'steps', { projectId: a }, '➕ قدم‌ها را بنویس؛ هر قدم در یک خط. (به ترتیب انجام)') : showGoals(ctx);
      case 'nxs': {
        const p = byId(S.projects, a); if (!p) return showGoals(ctx);
        const rows = C.projectTasks(S, a).filter((t) => t.status !== 'done').slice(0, 15).map((t) => [btn(cut(t.title, 45), 'setnx:' + t.id)]);
        rows.push([btn('⬅️ پروژه', 'p:' + a)]);
        return send(ctx, '⭐ کدام قدم، قدم بعدی باشد؟', rows);
      }
      case 'setnx': {
        const t = T(a); if (!t || !t.projectId) return showGoals(ctx);
        const ts = C.projectTasks(S, t.projectId), first = ts.find((x) => x.status !== 'done');
        if (first && first.id !== t.id) t.order = (Number(first.order) || 0) - 1;
        ctx.toast = 'قدم بعدی تعیین شد'; return showProject(ctx, t.projectId);
      }
      case 'st': {
        const t = T(a); if (!t) return showGoals(ctx);
        if (t.status === 'done') { t.status = 'todo'; t.doneAt = null; } else { t.status = 'done'; t.doneAt = iso(); ctx.toast = '✅ قدم انجام شد'; }
        return t.projectId ? showProject(ctx, t.projectId) : showToday(ctx);
      }
      case 'dl': return ask(ctx, 'deadline', { kind: a, id: b }, '📅 مهلت را بنویس: تاریخ شمسی مثل ۱۴۰۵/۰۸/۱۰، یا «فردا»، «۱۰ روز دیگر». برای برداشتن مهلت: «حذف».');
      case 'gs': { const g = byId(S.goals, a); if (g && L.goalStatus[b]) g.status = b; return showGoal(ctx, a); }
      case 'ps': { const p = byId(S.projects, a); if (p && L.goalStatus[b]) p.status = b; return showProject(ctx, a); }
      case 'gw': return byId(S.goals, a) ? ask(ctx, 'why', { id: a }, '✏️ چرا این هدف برایت مهم است؟ (یا عنوان جدید را با «عنوان: ...» بفرست)') : showGoals(ctx);
      case 'gdel': { const g = byId(S.goals, a); return g ? send(ctx, 'هدف «' + esc(g.title) + '» حذف شود؟ مراحل و کارهایش هم حذف می‌شوند. (جلسه‌های ثبت‌شده می‌مانند)', confirmRows('gdelok:' + a, 'g:' + a)) : showGoals(ctx); }
      case 'gdelok': {
        const pids = S.projects.filter((p) => p.goalId === a).map((p) => p.id);
        S.tasks = S.tasks.filter((t) => !pids.includes(t.projectId)); S.projects = S.projects.filter((p) => p.goalId !== a); S.goals = S.goals.filter((g) => g.id !== a);
        ctx.toast = 'حذف شد'; return showGoals(ctx);
      }
      case 'pdel': { const p = byId(S.projects, a); return p ? send(ctx, 'پروژه «' + esc(p.title) + '» و قدم‌هایش حذف شود؟', confirmRows('pdelok:' + a, 'p:' + a)) : showGoals(ctx); }
      case 'pdelok': { const p = byId(S.projects, a); S.tasks = S.tasks.filter((t) => t.projectId !== a); S.projects = S.projects.filter((x) => x.id !== a); ctx.toast = 'حذف شد'; return p && p.goalId && byId(S.goals, p.goalId) ? showGoal(ctx, p.goalId) : showGoals(ctx); }
      case 'tpl': {
        if (a === undefined) return showTemplates(ctx);
        const tp = TEMPLATES[Number(a)]; if (!tp) return showTemplates(ctx);
        const g = { id: C.uid(), title: tp.title, status: 'active', deadline: '', why: '', createdAt: iso() }; S.goals.push(g);
        tp.stages.forEach((st, i) => S.projects.push({ id: C.uid(), title: st, goalId: g.id, status: 'active', deadline: '', createdAt: iso(), order: i }));
        ctx.toast = 'هدف ساخته شد'; return showGoal(ctx, g.id);
      }
      // focus
      case 'focus': return showFocus(ctx);
      case 'tp': if (S.timer) S.timer = C.timerPause(S.timer, now()); return showFocus(ctx);
      case 'tr': if (S.timer) S.timer = C.timerResume(S.timer, now()); return showFocus(ctx);
      case 'te': return endFocus(ctx, false);
      case 'tc': return S.timer ? send(ctx, 'جلسه بدون ثبت لغو شود؟', [[btn('بله، لغو شود', 'tcok'), btn('نه، ادامه', 'focus')]]) : showFocus(ctx);
      case 'tcok': S.timer = null; timers.delete(ctx.uid); return send(ctx, 'جلسه لغو شد و چیزی ثبت نشد.', [[btn('⏱ تمرکز', 'focus'), btn('☀️ امروز', 'today')]]);
      case 'brk': return startTimer(ctx, Number(a) || S.settings.pomodoro.shortBreak, { phase: 'break', kind: 'break' });
      case 'ss': {
        const f = ctx.B.flow;
        if (!S.pending || !f || f.type !== 'session') return send(ctx, 'این جلسه قبلاً ثبت شده.', [[btn('☀️ امروز', 'today')]]);
        if (a === 'discard') { S.pending = null; clearFlow(ctx); return send(ctx, 'باشه، این جلسه ثبت نشد.', [[btn('☀️ امروز', 'today')]]); }
        if (a === 'skipnote') { ctx.msgId = null; return askOutputs(ctx); }
        if (a === 'outs') return sessionNext(ctx);
        if (a === 'td') { const t = S.pending.taskId && T(S.pending.taskId); if (t && b === '1') { t.status = 'done'; t.doneAt = iso(); } return sessionNext(ctx); }
        if (a === 'skip') return sessionNext(ctx);
        return null;
      }
      case 'rep': return showReport(ctx, a);
      case 'repc': return ask(ctx, 'repc', { step: 'from' }, '📅 از چه تاریخی؟ (مثلاً ۱۴۰۵/۰۸/۰۱، «دیروز» یا «۱۰ روز پیش»)');
      case 'rv': return showReview(ctx, Math.min(0, Number(a) || 0));
      case 'rvw': ctx.msgId = null; setFlow(ctx, 'review', { weekStart: a, i: 0, data: {} }); return say(ctx, '✍️ <b>مرور هفته</b> (۱ از ۴)\n' + REVIEW_Q[0][1], [[btn('رد کردن', 'rvs')]]);
      case 'rvs': return ctx.B.flow && ctx.B.flow.type === 'review' ? reviewAnswer(ctx, '') : null;
      // learning
      case 'learn': return showLearn(ctx);
      case 'l': return showLearnItem(ctx, a);
      case 'nl': return ask(ctx, 'learnNew', {}, '📚 عنوان منبع را بنویس (مثلاً: دورهٔ یادگیری ماشین اندرو انجی). اگر لینک دارد، در خط دوم بفرست.');
      case 'lf': return byId(S.learning, a) && LEARN_FIELDS[b] ? ask(ctx, 'learnField', { id: a, field: b }, LEARN_FIELDS[b]) : showLearn(ctx);
      case 'lp': return showLearnProgress(ctx, a);
      case 'lpv': { const l = byId(S.learning, a); if (l) { l.progress = Math.max(0, Math.min(100, Number(b) || 0)); if (l.progress === 100) l.status = 'done'; l.updatedAt = iso(); } return showLearnItem(ctx, a); }
      case 'lst': return showLearnStatus(ctx, a);
      case 'lsv': { const l = byId(S.learning, a); if (l && L.learnStatus[b]) l.status = b; return showLearnStatus(ctx, a); }
      case 'lty': { const l = byId(S.learning, a); if (l && L.learnType[b]) l.type = b; return showLearnStatus(ctx, a); }
      case 'lq': return showQuestions(ctx, a);
      case 'qr': { const l = byId(S.learning, a), q = l && (l.questions || []).find((x) => x.id === b); if (q) { q.resolved = true; q.resolvedAt = iso(); ctx.toast = 'حل شد 🎉'; } return showQuestions(ctx, a); }
      case 'qadd': return byId(S.learning, a) ? ask(ctx, 'question', { id: a }, '❓ سؤالت را بنویس. (چند سؤال = چند خط)') : showLearn(ctx);
      case 'lo': return showOutputs(ctx, a);
      case 'outs': return showOutputs(ctx);
      case 'lao': return ask(ctx, 'addOut', { learningId: a === '-' ? null : a, n: 0 }, '📦 کد را به‌صورت متن، یا فایل، عکس نتیجه یا لینک بفرست. چند پیام هم می‌شود؛ در پایان «تمام» را بزن.', [[btn('✅ تمام', 'aodone')]]);
      case 'aodone': { const f = ctx.B.flow; clearFlow(ctx); const lid = f && f.learningId; return lid ? showLearnItem(ctx, lid) : showOutputs(ctx); }
      case 'o': return sendOutput(ctx, a);
      case 'odel': { const o = byId(S.outputs, a); return o ? send(ctx, 'خروجی «' + esc(o.title) + '» حذف شود؟', confirmRows('odelok:' + a, 'o:' + a)) : showOutputs(ctx); }
      case 'odelok': { const o = byId(S.outputs, a); S.outputs = S.outputs.filter((x) => x.id !== a); ctx.toast = 'حذف شد'; return showOutputs(ctx, o && o.learningId); }
      case 'ldel': { const l = byId(S.learning, a); return l ? send(ctx, 'منبع «' + esc(l.title) + '» حذف شود؟ خروجی‌ها و جلسه‌های ثبت‌شده باقی می‌مانند.', confirmRows('ldelok:' + a, 'l:' + a)) : showLearn(ctx); }
      case 'ldelok': S.learning = S.learning.filter((x) => x.id !== a); ctx.toast = 'حذف شد'; return showLearn(ctx);
      case 'ideas': return showIdeas(ctx);
      case 'ni': return ask(ctx, 'idea', { kind: a }, a === 'article' ? '📰 عنوان یا لینک مقاله را بفرست؛ توضیح را در خط‌های بعد بنویس.' : '💡 ایده‌ات را بنویس؛ خط اول عنوان است.');
      case 'ilist': { const rows = S.ideas.slice(-15).reverse().map((i) => [btn('🗑 ' + cut(i.title, 45), 'idel:' + i.id)]); rows.push([btn('⬅️ ایده‌ها', 'ideas')]); return send(ctx, 'کدام مورد حذف شود؟', rows); }
      case 'idel': S.ideas = S.ideas.filter((x) => x.id !== a); ctx.toast = 'حذف شد'; return showIdeas(ctx);
      // journal
      case 'journal': return showJournal(ctx);
      case 'jm': case 'je': { const j = journalEntry(S, today(), true); j[k === 'jm' ? 'mood' : 'energy'] = Math.min(5, Math.max(1, Number(a) || 3)); j.updatedAt = iso(); if (k === 'jm') S.days[today()] = Object.assign({}, S.days[today()], { mood: j.mood }); return showJournal(ctx); }
      case 'jf': return JFIELDS[a] ? ask(ctx, 'journal', { field: a }, JFIELDS[a][1] + '\n<i>به نوشتهٔ امروز اضافه می‌شود.</i>') : showJournal(ctx);
      case 'jh': return showJournalHistory(ctx);
      case 'jd': return showJournalDay(ctx, a);
      // settings
      case 'settings': return showSettings(ctx);
      case 'pom': return showPomodoro(ctx);
      case 'pp': setPomodoro(S, [a, b, c, String(data).split(':')[4]]); ctx.toast = 'الگو ذخیره شد'; return showPomodoro(ctx);
      case 'pomc': return ask(ctx, 'pomc', {}, '🍅 چهار عدد بفرست: تمرکز، استراحت کوتاه، استراحت بلند، تعداد جلسه تا استراحت بلند.\nمثلاً: <code>45 10 25 3</code>');
      case 'secs': return showSections(ctx);
      case 'sc': return showSection(ctx, a);
      case 'scl': { const x = sections(S).find((s) => s.id === a); if (x) x.limit = Math.max(1, Math.min(20, x.limit + (Number(b) || 0))); return showSection(ctx, a); }
      case 'scu': case 'scd': {
        const list = sections(S), i = list.findIndex((s) => s.id === a), j = k === 'scu' ? i - 1 : i + 1;
        if (i >= 0 && j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
        return showSection(ctx, a);
      }
      case 'scr': return ask(ctx, 'secName', { id: a }, '✏️ نام تازهٔ بخش را بنویس.');
      case 'scx': return sections(S).length > 1 ? send(ctx, 'این بخش حذف شود؟ کارهایش به بخش اول منتقل می‌شوند.', confirmRows('scxok:' + a, 'sc:' + a)) : showSections(ctx);
      case 'scxok': if (sections(S).length > 1) { S.settings.daySections = sections(S).filter((s) => s.id !== a); S.tasks.forEach((t) => { if (t.section === a) t.section = sections(S)[0].id; }); } return showSections(ctx);
      case 'sca': return ask(ctx, 'secAdd', {}, '➕ نام بخش جدید را بنویس. می‌توانی ظرفیت را هم بعدش بنویسی، مثلاً: «کارهای خانه 2»');
      case 'screset': S.settings.daySections = C.defaultDaySections(); ctx.toast = 'بخش‌های پیش‌فرض برگشت'; return showSections(ctx);
      case 'sug': return showSuggestPrefs(ctx);
      case 'sg': if (a in S.settings.suggest) S.settings.suggest[a] = S.settings.suggest[a] === false; return showSuggestPrefs(ctx);
      case 'sect': if (a === 'learning' || a === 'journal') { S.settings.sections[a] = S.settings.sections[a] === false; await send(ctx, (S.settings.sections[a] ? '✅ فعال شد: ' : '⬜️ پنهان شد: ') + (a === 'learning' ? 'یادگیری' : 'دفتر شخصی') + ' (منوی پایین به‌روز شد)', null, { main: true }); } return showSettings(ctx);
      case 'nm': return ask(ctx, 'name', {}, '👤 دوست داری چه صدایت کنم؟');
      case 'exp': return doExport(ctx);
      case 'imp': return ask(ctx, 'import', {}, '📥 فایل پشتیبان رویش (json) را بفرست — از همین ربات یا از نسخهٔ وب.\n⚠️ داده‌های فعلی ربات جایگزین می‌شوند.');
      case 'wipe': return send(ctx, '⚠️ همهٔ داده‌هایت (کارها، اهداف، جلسه‌ها، دفتر و …) برای همیشه پاک شود؟ پیشنهاد می‌کنم اول پشتیبان بگیری.', [[btn('💾 اول پشتیبان', 'exp')], [btn('بله، همه پاک شود', 'wipeok'), btn('نه', 'settings')]]);
      case 'wipeok': return wipeAll(ctx);
      default: return null;
    }
  }
  async function wipeAll(ctx) {
    await store.reset(ctx.uid); wipeLocal(ctx.uid); timers.delete(ctx.uid);
    const rec = store.get(ctx.uid); rec.bot.chatId = ctx.chatId;
    ctx.rec = rec; ctx.S = rec.state; ctx.B = rec.bot;
    return send(ctx, '🗑 همهٔ داده‌ها پاک شد. یک شروع تازه 🌱', null, { main: true });
  }
  async function reviewAnswer(ctx, text) {
    const f = ctx.B.flow, S = ctx.S;
    if (text) f.data[REVIEW_Q[f.i][0]] = cut(text, 2000);
    f.i += 1;
    if (f.i < REVIEW_Q.length) return say(ctx, '✍️ <b>مرور هفته</b> (' + fa(f.i + 1) + ' از ۴)\n' + REVIEW_Q[f.i][1], [[btn('رد کردن', 'rvs')]]);
    const ws = f.weekStart, st = C.weekStats(S, ws), rv = S.reviews.find((r) => r.weekStart === ws);
    const data = Object.assign({}, f.data, { updatedAt: iso(), stats: { focusMinutes: st.focusMinutes, sessions: st.sessions, tasksDone: st.doneTasks.length, outputs: st.outputs.length } });
    if (rv) Object.assign(rv, data); else S.reviews.push(Object.assign({ id: C.uid(), weekStart: ws, createdAt: iso() }, data));
    clearFlow(ctx);
    const off = Math.round(C.diffDays(ws, C.weekStart(today(), S.settings.weekStartDay)) / 7);
    await say(ctx, '🌿 مرور هفته ذخیره شد. همین که به هفته‌ات نگاه کردی، یعنی داری رشد می‌کنی.');
    ctx.msgId = null; return showReview(ctx, Math.min(0, off));
  }

  // ---------- message router ----------
  const HELP = ['🌿 <b>رویش — راهنمای کوتاه</b>', '',
    '☀️ <b>امروز</b>: کجا هستم، چه چیزی مهم است و قدم بعدی.', '🧭 <b>از کجا شروع کنم؟</b>: یک پیشنهاد با دلیل، بر اساس اولویت، انرژی، زمان، مهلت و اهداف.',
    '🎯 <b>اهداف</b>: هدف ← مرحله/پروژه ← قدم؛ با پیشرفت و قدم بعدی.', '⏱ <b>تمرکز</b>: تایمر با زمان دلخواه، توقف/ادامه، ثبت نتیجه و خروجی (کد، فایل، عکس).',
    '📚 <b>یادگیری</b>: منابع، آخرین مبحث، قدم بعدی، سؤال‌ها، یادداشت‌ها، ایده‌ها.', '📓 <b>دفتر</b>: حال، انرژی و نوشته‌های خصوصی.', '🗓 <b>مرور هفتگی</b> و 📊 گزارش زمان.', '',
    '<b>میان‌بُرها</b>', '• هر متنی بفرستی، می‌پرسم کجا ثبتش کنم.', '• /add متن — افزودن سریع کار به امروز', '• /idea متن — ثبت ایده', '• /focus 40 — شروع تمرکز ۴۰ دقیقه‌ای',
    '• /stop — پایان جلسه · /report — گزارش · /review — مرور هفته', '• /pomodoro 50 10 30 2 — الگوی پومودورو', '• /export — پشتیبان · /cancel یا «لغو» — انصراف'].join('\n');

  async function onFlow(ctx, msg, text) {
    const S = ctx.S, f = ctx.B.flow;
    const needText = () => say(ctx, 'لطفاً متن بفرست (یا «لغو»).');
    switch (f.type) {
      case 'add': if (!text) return needText(); clearFlow(ctx); return addTasks(ctx, text, f.section);
      case 'taskTitle': { if (!text) return needText(); const t = byId(S.tasks, f.id); clearFlow(ctx); if (t) t.title = cut(text, 200); return t ? showTask(ctx, t.id) : showToday(ctx); }
      case 'customMin': {
        const n = Math.round(Number(normalizeDigits(text)));
        if (!(n >= 1 && n <= 300)) return say(ctx, 'یک عدد بین ۱ تا ۳۰۰ بفرست.');
        clearFlow(ctx); return showFocusTarget(ctx, n);
      }
      case 'goal': {
        if (!text) return needText(); clearFlow(ctx);
        const g = { id: C.uid(), title: cut(text.split('\n')[0], 200), status: 'active', deadline: '', why: text.split('\n').slice(1).join('\n').trim(), createdAt: iso() }; S.goals.push(g);
        await say(ctx, '🎯 هدف «' + esc(g.title) + '» ساخته شد. حالا مراحل یا پروژه‌هایش را اضافه کن.'); return showGoal(ctx, g.id);
      }
      case 'project': {
        if (!text) return needText(); clearFlow(ctx);
        const gid = f.goalId && byId(S.goals, f.goalId) ? f.goalId : null, base = S.projects.filter((p) => p.goalId === gid).length;
        const made = text.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 20).map((title, i) => { const p = { id: C.uid(), title: cut(title, 200), goalId: gid, status: 'active', deadline: '', createdAt: iso(), order: base + i }; S.projects.push(p); return p; });
        return made.length === 1 ? showProject(ctx, made[0].id) : gid ? showGoal(ctx, gid) : showGoals(ctx);
      }
      case 'steps': {
        if (!text) return needText(); clearFlow(ctx);
        const p = byId(S.projects, f.projectId); if (!p) return showGoals(ctx);
        text.split('\n').map((x) => x.replace(/^[\s\-•*\d.)]+/, '').trim()).filter(Boolean).slice(0, 30).forEach((title) => newTask(S, title, { projectId: p.id }));
        return showProject(ctx, p.id);
      }
      case 'deadline': {
        const list = f.kind === 'g' ? S.goals : f.kind === 'p' ? S.projects : S.tasks, item = byId(list, f.id);
        if (!item) { clearFlow(ctx); return showGoals(ctx); }
        const clear = /^(حذف|پاک|ندارد|هیچ)$/.test(text.trim());
        const key = clear ? '' : parseDate(text, today());
        if (key === null) return say(ctx, 'این تاریخ را متوجه نشدم. مثل ۱۴۰۵/۰۸/۱۰ یا «فردا» بنویس (یا «لغو»).');
        clearFlow(ctx);
        if (f.kind === 't') item.due = key; else item.deadline = key;
        await say(ctx, key ? '📅 مهلت: ' + esc(C.faDate(key, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) : 'مهلت برداشته شد.');
        return f.kind === 'g' ? showGoal(ctx, item.id) : f.kind === 'p' ? showProject(ctx, item.id) : showTask(ctx, item.id);
      }
      case 'why': {
        if (!text) return needText(); clearFlow(ctx); const g = byId(S.goals, f.id); if (!g) return showGoals(ctx);
        const m = text.match(/^عنوان\s*[:：]\s*(.+)$/s); if (m) g.title = cut(m[1].trim(), 200); else g.why = cut(text, 1000);
        return showGoal(ctx, g.id);
      }
      case 'session': {
        const p = S.pending; if (!p) { clearFlow(ctx); return null; }
        if (f.step === 'note') { if (!text) return needText(); p.note = cut(text, 1000); return askOutputs(ctx); }
        if (f.step === 'outputs') {
          const o = outputFromMessage(S, msg, p.kind); if (!o) return say(ctx, 'این نوع پیام را نمی‌توانم به‌عنوان خروجی ثبت کنم؛ متن، فایل، عکس یا لینک بفرست.');
          p.outputs.push(o);
          return say(ctx, '📦 ثبت شد: «' + esc(o.title) + '» (' + esc(L.outputType[o.type]) + ')\nخروجی دیگری داری بفرست، وگرنه «تمام».', [[btn('✅ تمام', 'ss:outs')]]);
        }
        const learn = p.learningId && byId(S.learning, p.learningId);
        if (f.step === 'topic' && learn) { if (!text) return needText(); learn.lastTopic = cut(text, 300); learn.updatedAt = iso(); return sessionNext(ctx); }
        if (f.step === 'next' && learn) { if (!text) return needText(); learn.nextStep = cut(text, 300); learn.updatedAt = iso(); return sessionNext(ctx); }
        if (f.step === 'taskdone') return say(ctx, 'لطفاً یکی از دکمه‌ها را بزن.');
        return sessionNext(ctx);
      }
      case 'repc': {
        const key = parseDate(text, today());
        if (!key) return say(ctx, 'تاریخ را متوجه نشدم. مثل ۱۴۰۵/۰۸/۰۱ بنویس (یا «لغو»).');
        if (f.step === 'from') { f.step = 'to'; f.from = key; return say(ctx, '📅 تا چه تاریخی؟ (یا «امروز»)'); }
        clearFlow(ctx);
        const [from, to] = key < f.from ? [key, f.from] : [f.from, key];
        return showReport(ctx, null, { from, to, label: 'بازهٔ دلخواه' });
      }
      case 'review': if (!text) return needText(); return reviewAnswer(ctx, text);
      case 'learnNew': {
        if (!text) return needText(); clearFlow(ctx);
        const lines = text.split('\n').map((x) => x.trim()).filter(Boolean), link = lines.find((x) => /^https?:\/\//i.test(x)) || '';
        const title = lines.find((x) => x !== link) || link;
        const l = { id: C.uid(), title: cut(title, 200), type: /youtube|aparat|video/i.test(link) ? 'video' : 'course', status: 'learning', progress: 0, link, lastTopic: '', nextStep: '', notes: '', questions: [], createdAt: iso() };
        S.learning.push(l); return showLearnItem(ctx, l.id);
      }
      case 'learnField': {
        if (!text) return needText(); clearFlow(ctx); const l = byId(S.learning, f.id); if (!l) return showLearn(ctx);
        if (f.field === 'notes') l.notes = (l.notes ? l.notes + '\n' : '') + '— ' + text;
        else if (f.field === 'link') l.link = /^(حذف|پاک)$/.test(text.trim()) ? '' : (C.safeUrl(text.trim()) ? text.trim() : l.link);
        else l[f.field] = cut(text, f.field === 'title' ? 200 : 300);
        l.updatedAt = iso(); return showLearnItem(ctx, l.id);
      }
      case 'question': {
        if (!text) return needText(); clearFlow(ctx); const l = byId(S.learning, f.id); if (!l) return showLearn(ctx);
        text.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 10).forEach((q) => l.questions.push({ id: C.uid(), text: cut(q, 300), resolved: false, createdAt: iso() }));
        return showQuestions(ctx, l.id);
      }
      case 'addOut': {
        const o = outputFromMessage(S, msg, f.learningId ? 'study' : 'work'); if (!o) return say(ctx, 'متن، فایل، عکس یا لینک بفرست.');
        if (f.learningId) o.learningId = f.learningId;
        S.outputs.push(o); f.n = (f.n || 0) + 1;
        return say(ctx, '📦 ثبت شد: «' + esc(o.title) + '». باز هم بفرست یا «تمام».', [[btn('✅ تمام', 'aodone')]]);
      }
      case 'idea': { if (!text) return needText(); clearFlow(ctx); const i = addIdea(S, text, f.kind); await say(ctx, (i.kind === 'article' ? '📰' : '💡') + ' ثبت شد: «' + esc(i.title) + '»'); return showIdeas(ctx); }
      case 'journal': {
        if (!text) return needText(); clearFlow(ctx);
        const j = journalEntry(S, today(), true); j[f.field] = j[f.field] ? j[f.field] + '\n' + text : text; j.updatedAt = iso();
        return showJournal(ctx);
      }
      case 'pomc': {
        const nums = normalizeDigits(text).split(/[\s,،/]+/).filter(Boolean);
        if (nums.length !== 4 || !setPomodoro(S, nums)) return say(ctx, 'چهار عدد معتبر بفرست، مثلاً <code>45 10 25 3</code> (تمرکز ۱–۳۰۰، استراحت کوتاه ۱–۱۲۰، بلند ۱–۱۸۰، تعداد ۱–۱۲).');
        clearFlow(ctx); return showPomodoro(ctx);
      }
      case 'secName': { if (!text) return needText(); clearFlow(ctx); const x = sections(S).find((s) => s.id === f.id); if (x) x.title = cut(text.trim(), 80); return showSection(ctx, f.id); }
      case 'secAdd': {
        if (!text) return needText(); clearFlow(ctx);
        const m = normalizeDigits(text.trim()).match(/^(.*?)(?:\s+(\d{1,2}))?$/s), title = cut((m[1] || text).trim(), 80), limit = Math.max(1, Math.min(20, Number(m[2]) || 3));
        const id = 's' + C.uid(); S.settings.daySections.push({ id, title, limit }); return showSection(ctx, id);
      }
      case 'name': { if (!text) return needText(); clearFlow(ctx); S.settings.name = cut(text.trim(), 40); await say(ctx, 'خوشبختم، ' + esc(S.settings.name) + ' 🌿'); return showSettings(ctx); }
      case 'import': return doImport(ctx, msg.document);
      default: clearFlow(ctx); return null;
    }
  }

  async function onCommand(ctx, cmd, arg) {
    const S = ctx.S;
    switch (cmd) {
      case 'start': {
        const name = S.settings.name || ctx.B.name;
        const first = !S.tasks.length && !S.goals.length;
        await send(ctx, '🌿 ' + (name ? 'سلام ' + esc(name) + '!' : 'سلام!') + ' به <b>رویش</b> خوش آمدی.\n' +
          (first ? 'اینجا جای آرامی برای کارها، اهداف، تمرکز و رشد توست — بدون عجله و بدون احساس گناه.\n\nبرای شروع: یک کار کوچک بنویس و بفرست، یا از «🎯 اهداف» یک نمونهٔ آماده بردار. /help راهنماست.' : 'از منوی پایین هر بخشی را خواستی باز کن.'), null, { main: true });
        return showToday(ctx);
      }
      case 'help': return send(ctx, HELP, null, { main: true });
      case 'today': ctx.B.lastScreen = null; return showToday(ctx);
      case 'next': return showNext(ctx);
      case 'add': return arg ? addTasks(ctx, arg, sections(S)[0].id) : showAdd(ctx);
      case 'goals': return showGoals(ctx);
      case 'focus': {
        const n = Math.round(Number(normalizeDigits(arg)));
        if (arg && n >= 1 && n <= 300) return S.timer ? showFocus(ctx) : showFocusTarget(ctx, n);
        return showFocus(ctx);
      }
      case 'stop': return S.timer ? endFocus(ctx, false) : say(ctx, 'جلسهٔ فعالی نداری.', [[btn('⏱ شروع تمرکز', 'focus')]]);
      case 'learn': return showLearn(ctx);
      case 'journal': return showJournal(ctx);
      case 'review': return showReview(ctx, 0);
      case 'report': return showReport(ctx, 'week');
      case 'idea': if (!arg) return ask(ctx, 'idea', { kind: 'idea' }, '💡 ایده‌ات را بنویس.'); { const i = addIdea(S, arg, 'idea'); return say(ctx, '💡 ثبت شد: «' + esc(i.title) + '»', [[btn('💡 ایده‌ها', 'ideas')]]); }
      case 'settings': return showSettings(ctx);
      case 'export': return doExport(ctx);
      case 'pomodoro': {
        if (!arg) return showPomodoro(ctx);
        const nums = normalizeDigits(arg).split(/[\s,،/]+/).filter(Boolean);
        if (nums.length === 4 && setPomodoro(S, nums)) return showPomodoro(ctx);
        return say(ctx, 'نمونه: <code>/pomodoro 50 10 30 2</code>');
      }
      case 'deleteall': return send(ctx, '⚠️ همهٔ داده‌ها پاک شود؟', [[btn('💾 اول پشتیبان', 'exp')], [btn('بله، همه پاک شود', 'wipeok'), btn('نه', 'settings')]]);
      default: return say(ctx, 'این دستور را نمی‌شناسم. /help را ببین.');
    }
  }

  const KB = Object.fromEntries(Object.entries(BTN).map(([k, v]) => [v, k]));
  async function onMessage(ctx, msg) {
    const text = String(msg.text || msg.caption || '').trim();
    if (!ctx.B.name && msg.from) ctx.B.name = cut([msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '), 40);
    if (/^(\/cancel(@\w+)?|لغو|انصراف)$/i.test(text)) {
      const f = ctx.B.flow;
      if (f && f.type === 'session') { await finishSession(ctx, true); return send(ctx, 'باشه. جلسه با همین اطلاعات ثبت شد.', null, { main: true }); }
      clearFlow(ctx); ctx.B.draft = null;
      return send(ctx, 'لغو شد. 🌿', null, { main: true });
    }
    const cm = msg.text && msg.text.match(/^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
    const kbKey = msg.text && KB[text];
    if (cm || kbKey) {
      // menu/commands interrupt a pending text flow, except an unfinished session result which is saved as-is
      const f = ctx.B.flow;
      if (f && f.type === 'session') await finishSession(ctx, true);
      else if (f) clearFlow(ctx);
      if (cm) return onCommand(ctx, cm[1].toLowerCase(), (cm[2] || '').trim());
      const map = { today: showToday, next: showNext, goals: showGoals, focus: showFocus, learn: showLearn, journal: showJournal, review: (c) => showReview(c, 0), settings: showSettings };
      return map[kbKey](ctx);
    }
    if (ctx.B.flow) return onFlow(ctx, msg, text);
    if (msg.document || (msg.photo && msg.photo.length)) {
      const o = outputFromMessage(ctx.S, msg, 'work'); ctx.S.outputs.push(o);
      return say(ctx, '📦 به‌عنوان خروجی ذخیره شد: «' + esc(o.title) + '». هر وقت خواستی از «یادگیری ← خروجی‌ها» پیدایش کن.', [[btn('📦 خروجی‌ها', 'outs')]]);
    }
    if (!text) return say(ctx, 'این نوع پیام را نمی‌شناسم. /help');
    ctx.B.draft = cut(text, 3000);
    const rows = sections(ctx.S).map((s) => [btn('☀️ ' + s.title, 'qa:' + s.id)]);
    rows.push([btn('📋 فهرست کارها', 'qa:-'), btn('💡 ایده', 'qa:idea'), btn('📓 دفتر', 'qa:j')], [btn('✖️ هیچ‌کدام', 'qa:x')]);
    return say(ctx, '«' + esc(cut(text, 200)) + '»\nکجا ثبتش کنم؟', rows);
  }

  // ---------- update entry point ----------
  async function handleUpdate(u) {
    const cq = u.callback_query, msg = u.message;
    const from = cq ? cq.from : msg && msg.from; if (!from || from.is_bot) return;
    const chat = cq ? cq.message && cq.message.chat : msg.chat; if (!chat) return;
    if (chat.type !== 'private') { if (msg) await api.call('sendMessage', { chat_id: chat.id, text: 'رویش یک دستیار شخصی است و فقط در گفت‌وگوی خصوصی کار می‌کند.' }).catch(() => {}); return; }
    if (allowed.length && !allowed.includes(Number(from.id))) {
      if (cq) await api.call('answerCallbackQuery', { callback_query_id: cq.id, text: 'دسترسی ندارید' }).catch(() => {});
      else await api.call('sendMessage', { chat_id: chat.id, text: '🔒 این ربات شخصی است و فقط برای صاحبش کار می‌کند.\nشناسهٔ عددی شما: ' + from.id }).catch(() => {});
      return;
    }
    const rec = store.get(from.id);
    const ctx = { uid: from.id, chatId: chat.id, rec, S: rec.state, B: rec.bot, toast: null };
    rec.bot.chatId = chat.id;
    try {
      if (cq) {
        ctx.msgId = cq.message && cq.message.message_id;
        try { await onCallback(ctx, cq.data || ''); }
        finally { await api.call('answerCallbackQuery', Object.assign({ callback_query_id: cq.id }, ctx.toast ? { text: ctx.toast } : {})).catch(() => {}); }
      } else await onMessage(ctx, msg);
    } catch (e) {
      (log.error || console.error)('handler error', e && e.stack || e);
      await api.call('sendMessage', { chat_id: chat.id, text: 'مشکلی پیش آمد؛ لطفاً دوباره امتحان کن. 🙏' }).catch(() => {});
    }
    if (ctx.S.timer) timers.add(ctx.uid);
    await store.save(ctx.uid);
  }

  // ---------- timer scheduler ----------
  let ticking = false;
  async function tick() {
    if (ticking) return; ticking = true;
    try {
      for (const uid of [...timers]) {
        const rec = store.get(uid), S = rec.state;
        if (!S.timer) { timers.delete(uid); continue; }
        if (!C.timerDone(S.timer, now())) continue;
        const ctx = { uid, chatId: rec.bot.chatId || uid, rec, S, B: rec.bot };
        try { await endFocus(ctx, true); } catch (e) { (log.error || console.error)('tick error', e.message); }
        if (!S.timer) timers.delete(uid);
        await store.save(uid);
      }
    } finally { ticking = false; }
  }

  return { handleUpdate, tick, timers, HELP };
}

export const COMMANDS = [
  ['today', 'امروز'], ['next', 'از کجا شروع کنم؟'], ['add', 'افزودن کار'], ['focus', 'تایمر تمرکز'], ['stop', 'پایان جلسهٔ تمرکز'],
  ['goals', 'اهداف و پروژه‌ها'], ['learn', 'فضای یادگیری'], ['journal', 'دفتر شخصی'], ['review', 'مرور هفتگی'], ['report', 'گزارش زمان'],
  ['idea', 'ثبت ایده'], ['settings', 'تنظیمات'], ['export', 'گرفتن پشتیبان'], ['help', 'راهنما'], ['cancel', 'لغو'],
].map(([command, description]) => ({ command, description }));
