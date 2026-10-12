/* Nava core — pure logic shared by UI and tests (no DOM access). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NavaCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 1;
  const PRIORITY_W = { high: 30, medium: 20, low: 10 };
  const LABELS = {
    priority: { high: 'بالا', medium: 'متوسط', low: 'پایین' },
    energy: { low: 'کم', medium: 'متوسط', high: 'زیاد' },
    status: { todo: 'انجام‌نشده', doing: 'در حال انجام', done: 'انجام‌شده' },
    goalStatus: { active: 'فعال', paused: 'متوقف', done: 'تکمیل‌شده' },
    learnType: { course: 'دوره', book: 'کتاب', article: 'مقاله', video: 'ویدیو', other: 'سایر' },
    learnStatus: { planned: 'برنامه‌ریزی‌شده', learning: 'در حال یادگیری', paused: 'متوقف', done: 'تمام‌شده' },
    outputType: { code: 'کد', problem: 'مسئلهٔ حل‌شده', project: 'فایل پروژه', image: 'تصویر نتیجه', note: 'یادداشت', link: 'لینک' },
    kind: { work: 'کار', study: 'مطالعه' },
    ideaKind: { idea: 'ایده', article: 'مقالهٔ مهم' },
  };

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 9); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateKey(d) {
    d = d instanceof Date ? d : new Date(d);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function parseKey(key) {
    const p = String(key).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2], 12, 0, 0);
  }
  function addDays(key, n) { const d = parseKey(key); d.setDate(d.getDate() + n); return dateKey(d); }
  function diffDays(a, b) { return Math.round((parseKey(a) - parseKey(b)) / 86400000); }
  /** Week start; default Saturday (6) as in the Iranian week. */
  function weekStart(key, startDay) {
    const s = startDay == null ? 6 : Number(startDay);
    const back = (parseKey(key).getDay() - s + 7) % 7;
    return addDays(key, -back);
  }
  function isValidKey(key) { return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && !isNaN(parseKey(key).getTime()); }

  const DAY_TYPES = {
    busy: { label: 'شلوغ', energy: 'medium', budget: 60, max: 2 },
    low: { label: 'کم‌انرژی', energy: 'low', budget: 90, max: 2 },
    normal: { label: 'معمولی', energy: 'medium', budget: 180, max: 3 },
    high: { label: 'پرانرژی', energy: 'high', budget: 300, max: 4 },
  };
  function defaultDaySections() {
    return [
      { id: 'main', title: 'سه کار مهم امروز', limit: 3 },
      { id: 'career', title: 'یک قدم برای آینده شغلی', limit: 1 },
      { id: 'uni', title: 'یک قدم برای دانشگاه', limit: 1 },
      { id: 'rest', title: 'زمان‌های استراحت و آزاد', limit: 3 },
      { id: 'optional', title: 'کارهای اختیاری یا کم‌اولویت', limit: 5 },
    ];
  }
  function clampInt(v, lo, hi, dflt) { v = Math.round(Number(v)); return isFinite(v) && v >= lo && v <= hi ? v : dflt; }

  function defaultState() {
    return {
      version: VERSION,
      settings: {
        name: '', theme: 'system', focusMinutes: 25, weekStartDay: 6, sound: true, sections: { learning: true, journal: true },
        pomodoro: { focus: 25, shortBreak: 5, longBreak: 15, longEvery: 4 },
        suggest: { easyStart: true, goalFocus: true, deadlines: true },
        daySections: defaultDaySections(),
      },
      goals: [], projects: [], tasks: [], sessions: [], learning: [], outputs: [], ideas: [], journal: [], reviews: [],
      days: {}, timer: null, pending: null,
    };
  }

  /** Accepts any parsed JSON and returns a structurally valid state. */
  function normalizeState(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
    const out = Object.assign({}, base);
    const rs = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    out.settings = Object.assign({}, base.settings, rs);
    out.settings.sections = Object.assign({}, base.settings.sections, rs.sections && typeof rs.sections === 'object' ? rs.sections : {});
    const fm = Number(out.settings.focusMinutes);
    out.settings.focusMinutes = fm >= 1 && fm <= 300 ? Math.round(fm) : 25;
    if (['system', 'light', 'dark'].indexOf(out.settings.theme) === -1) out.settings.theme = 'system';
    const bp = base.settings.pomodoro, rp = rs.pomodoro && typeof rs.pomodoro === 'object' ? rs.pomodoro : {};
    out.settings.pomodoro = { focus: clampInt(rp.focus, 1, 300, rs.focusMinutes ? out.settings.focusMinutes : bp.focus), shortBreak: clampInt(rp.shortBreak, 1, 120, bp.shortBreak),
      longBreak: clampInt(rp.longBreak, 1, 180, bp.longBreak), longEvery: clampInt(rp.longEvery, 1, 12, bp.longEvery) };
    out.settings.focusMinutes = out.settings.pomodoro.focus;
    out.settings.suggest = Object.assign({}, base.settings.suggest, rs.suggest && typeof rs.suggest === 'object' ? rs.suggest : {});
    const secs = Array.isArray(rs.daySections) ? rs.daySections.filter(function (x) { return x && x.id && String(x.title || '').trim(); }) : null;
    out.settings.daySections = (secs && secs.length ? secs : base.settings.daySections).map(function (x) { return { id: String(x.id), title: String(x.title).slice(0, 80), limit: clampInt(x.limit, 1, 20, 3) }; });
    const ws = Number(out.settings.weekStartDay);
    out.settings.weekStartDay = ws >= 0 && ws <= 6 ? Math.round(ws) : 6;
    ['goals', 'projects', 'tasks', 'sessions', 'learning', 'outputs', 'ideas', 'journal', 'reviews'].forEach(function (k) {
      out[k] = Array.isArray(raw[k]) ? raw[k].filter(function (x) { return x && typeof x === 'object' && x.id; }) : [];
    });
    out.learning.forEach(function (l) { if (!Array.isArray(l.questions)) l.questions = []; });
    out.outputs.forEach(function (o) { if (!Array.isArray(o.files)) o.files = []; });
    out.days = raw.days && typeof raw.days === 'object' && !Array.isArray(raw.days) ? raw.days : {};
    out.timer = raw.timer && typeof raw.timer === 'object' && raw.timer.endAt ? raw.timer : null;
    out.pending = raw.pending && typeof raw.pending === 'object' && raw.pending.start ? raw.pending : null;
    out.version = VERSION;
    return out;
  }

  // ---------- Projects & goals ----------
  function projectTasks(state, projectId) {
    return state.tasks.filter(function (t) { return t.projectId === projectId; })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0) || String(a.createdAt).localeCompare(String(b.createdAt)); });
  }
  function projectProgress(state, projectId) {
    const ts = projectTasks(state, projectId);
    const p = state.projects.find(function (x) { return x.id === projectId; });
    const done = ts.filter(function (t) { return t.status === 'done'; }).length;
    const pct = p && p.status === 'done' ? 100 : ts.length ? Math.round((done / ts.length) * 100) : 0;
    return { done: done, total: ts.length, pct: pct };
  }
  function nextStep(state, projectId) {
    const p = state.projects.find(function (x) { return x.id === projectId; });
    const ts = projectTasks(state, projectId).filter(function (t) { return t.status !== 'done'; });
    if (p && p.nextTaskId) {
      const chosen = ts.find(function (t) { return t.id === p.nextTaskId; });
      if (chosen) return chosen;
    }
    return ts.find(function (t) { return t.status === 'doing'; }) || ts[0] || null;
  }
  /** Goal progress = average progress of its projects (a project marked done counts 100%). */
  function goalProgress(state, goalId) {
    const g = state.goals.find(function (x) { return x.id === goalId; });
    const ps = state.projects.filter(function (p) { return p.goalId === goalId; });
    let done = 0, total = 0, sum = 0, finished = 0;
    ps.forEach(function (p) { const pr = projectProgress(state, p.id); done += pr.done; total += pr.total; sum += pr.pct; if (pr.pct === 100) finished++; });
    const pct = g && g.status === 'done' ? 100 : ps.length ? Math.round(sum / ps.length) : 0;
    return { done: done, total: total, pct: pct, projects: ps.length, finishedProjects: finished };
  }
  /** First actionable step across a goal's active projects. */
  function goalNextStep(state, goalId) {
    const ps = state.projects.filter(function (p) { return p.goalId === goalId && (p.status || 'active') === 'active'; });
    for (let i = 0; i < ps.length; i++) { const n = nextStep(state, ps[i].id); if (n) return { task: n, project: ps[i] }; }
    return null;
  }

  // ---------- “Where do I start now?” ----------
  function taskGoal(state, t) {
    if (!t.projectId) return null;
    const p = state.projects.find(function (x) { return x.id === t.projectId; });
    if (!p || !p.goalId) return null;
    const g = state.goals.find(function (x) { return x.id === p.goalId; });
    return g && (g.status || 'active') === 'active' ? g : null;
  }
  function scoreTask(state, t, ctx) {
    const today = ctx.today;
    const energy = ctx.energy || 'medium';
    const prefs = Object.assign({ easyStart: true, goalFocus: true, deadlines: true }, (state.settings && state.settings.suggest) || {});
    const available = Number(ctx.available) || 0;
    let score = PRIORITY_W[t.priority] || 20;
    const reasons = [];
    if (t.todayKey === today) { score += 25; reasons.push('جزو برنامهٔ امروز است'); }
    if (t.status === 'doing') { score += 15; reasons.push('قبلاً شروعش کرده‌ای و ادامه‌دادنش آسان‌تر است'); }
    if (prefs.deadlines && isValidKey(t.due) && isValidKey(today)) {
      const d = diffDays(t.due, today);
      if (d < 0) { score += 18; reasons.push('موعدش رد شده؛ با یک قدم کوچک دوباره راه می‌افتد'); }
      else if (d === 0) { score += 20; reasons.push('موعدش امروز است'); }
      else if (d <= 3) { score += 10; reasons.push('موعدش نزدیک است'); }
    }
    if (t.projectId) {
      const ns = nextStep(state, t.projectId);
      if (ns && ns.id === t.id) { score += 10; reasons.push('قدم بعدی یک پروژه است'); }
    }
    const g = prefs.goalFocus ? taskGoal(state, t) : null;
    if (g) { score += 8; reasons.push('به هدف «' + g.title + '» کمک می‌کند'); }
    const te = t.energy || 'medium';
    const est = Number(t.estimate) || 0;
    if (available) {
      if (est > available) score -= 25;
      else if (est) { score += 5; if (est <= available) reasons.push('در زمانی که داری جا می‌شود'); }
    }
    if (prefs.easyStart && est && est <= 25) { score += 6; reasons.push('کوتاه است و شروعش ساده است'); }
    if (energy === 'low') {
      if (te === 'high') score -= 20;
      if (te === 'low') { score += 12; reasons.push('با انرژی کمِ الان جور است'); }
      if (est && est <= 25) score += 4;
    } else if (energy === 'high') {
      if (te === 'high') { score += 12; reasons.push('برای انرژی بالای الان مناسب است'); }
    } else if (te === 'medium') {
      score += 4;
    }
    if (t.priority === 'high' && reasons.length === 0) reasons.push('اولویت بالایی دارد');
    return { score: score, reasons: reasons };
  }

  function rankTasks(state, ctx) {
    ctx = ctx || {};
    const skip = ctx.skip || [];
    return state.tasks.filter(function (t) {
      if (t.status === 'done' || skip.indexOf(t.id) !== -1) return false;
      if (t.optional && ctx.skipOptional) return false;
      if (t.projectId) {
        const p = state.projects.find(function (x) { return x.id === t.projectId; });
        if (p && p.status && p.status !== 'active') return false;
      }
      return true;
    }).map(function (t) {
      const s = scoreTask(state, t, ctx);
      return { task: t, score: s.score, reasons: s.reasons };
    }).sort(function (a, b) { return b.score - a.score || (Number(a.task.estimate) || 999) - (Number(b.task.estimate) || 999); });
  }

  function suggestNext(state, ctx) {
    ctx = ctx || {};
    const ranked = rankTasks(state, ctx);
    if (!ranked.length) return null;
    const best = ranked[0];
    if (!best.reasons.length) best.reasons.push('بیشترین امتیاز را بین کارهای باز دارد');
    best.reasons = best.reasons.slice(0, 3);
    const est = Number(best.task.estimate) || 0;
    const cap = Number(ctx.available) > 0 ? Math.min(50, Number(ctx.available)) : 50;
    best.minutes = est > 0 ? Math.min(est, cap) : Math.min(ctx.energy === 'low' ? 15 : 25, cap);
    best.remaining = ranked.length - 1;
    return best;
  }

  /** Last day the user did anything (session, finished task, journal). */
  function lastActiveDay(state, beforeKey) {
    let last = '';
    const consider = function (k) { if (k && (!beforeKey || k < beforeKey) && k > last) last = k; };
    state.sessions.forEach(function (s) { if (s.start) consider(dateKey(new Date(s.start))); });
    state.tasks.forEach(function (t) { if (t.doneAt) consider(dateKey(new Date(t.doneAt))); });
    state.journal.forEach(function (j) { consider(j.date); });
    return last;
  }
  /** Gentle “welcome back” info when the user has been away 3+ days. */
  function comeback(state, today) {
    const last = lastActiveDay(state, today);
    if (!last) return null;
    const gap = diffDays(today, last);
    if (gap < 3) return null;
    const overdue = state.tasks.filter(function (t) { return t.status !== 'done' && isValidKey(t.due) && t.due < today; }).length;
    return { gap: gap, last: last, overdue: overdue };
  }

  /**
   * Realistic plan for today: picks a few tasks that fit the day's time budget and energy.
   * Unfinished tasks stay in the list; they are not all pushed into today.
   */
  function planDay(state, ctx) {
    const type = DAY_TYPES[ctx.dayType] || DAY_TYPES.normal;
    let budget = Number(ctx.available) > 0 ? Number(ctx.available) : type.budget;
    let max = type.max;
    if (ctx.light) { max = Math.max(1, max - 1); budget = Math.max(30, Math.round(budget * 0.6)); }
    const ranked = rankTasks(state, { today: ctx.today, energy: type.energy, available: budget, skip: ctx.skip, skipOptional: true });
    const picked = []; let used = 0;
    for (let i = 0; i < ranked.length && picked.length < max; i++) {
      const est = Number(ranked[i].task.estimate) || 25;
      if (used + est > budget && picked.length > 0) continue;
      if (est > budget && picked.length === 0 && ranked.length > 1 && i < ranked.length - 1) continue;
      picked.push(ranked[i]); used += est;
    }
    return { tasks: picked.map(function (r) { return r.task; }), minutes: used, budget: budget, max: max };
  }

  // ---------- Stats ----------
  function sessionDay(s) { return s.start ? dateKey(new Date(s.start)) : ''; }
  function sumMin(arr) { return arr.reduce(function (a, s) { return a + (Number(s.minutes) || 0); }, 0); }
  function dayStats(state, key) {
    const ss = state.sessions.filter(function (s) { return sessionDay(s) === key; });
    return {
      minutes: sumMin(ss), sessions: ss.length,
      tasksDone: state.tasks.filter(function (t) { return t.status === 'done' && t.doneAt && dateKey(new Date(t.doneAt)) === key; }).length,
    };
  }
  function weekStats(state, startKey) {
    const keys = [];
    for (let i = 0; i < 7; i++) keys.push(addDays(startKey, i));
    const inWeek = function (iso) { return !!iso && keys.indexOf(dateKey(new Date(iso))) !== -1; };
    const sessions = state.sessions.filter(function (s) { return inWeek(s.start); });
    const byDay = keys.map(function (k) { return { key: k, minutes: sumMin(sessions.filter(function (s) { return sessionDay(s) === k; })) }; });
    const journal = state.journal.filter(function (j) { return keys.indexOf(j.date) !== -1; });
    const avg = function (arr, f) {
      const v = arr.map(f).map(Number).filter(function (x) { return x > 0; });
      return v.length ? Math.round((v.reduce(function (a, b) { return a + b; }, 0) / v.length) * 10) / 10 : null;
    };
    return {
      start: startKey, end: keys[6], keys: keys,
      focusMinutes: sumMin(sessions),
      studyMinutes: sumMin(sessions.filter(function (s) { return s.kind === 'study'; })),
      sessions: sessions.length, byDay: byDay,
      doneTasks: state.tasks.filter(function (t) { return t.status === 'done' && inWeek(t.doneAt); }),
      outputs: state.outputs.filter(function (o) { return inWeek(o.createdAt); }),
      avgMood: avg(journal, function (j) { return j.mood; }),
      avgEnergy: avg(journal, function (j) { return j.energy; }),
      activeDays: byDay.filter(function (d) { return d.minutes > 0; }).length,
    };
  }

  /** Time spent per project / learning resource / activity in [from, to]. */
  function rangeReport(state, fromKey, toKey) {
    const inRange = function (iso) { if (!iso) return false; const k = dateKey(new Date(iso)); return k >= fromKey && k <= toKey; };
    const sessions = state.sessions.filter(function (s) { return inRange(s.start); });
    const groups = {};
    const find = function (list, id) { return list.find(function (x) { return x.id === id; }); };
    sessions.forEach(function (s) {
      let key = 'free', label = 'جلسهٔ آزاد', kind = 'free';
      const task = s.taskId && find(state.tasks, s.taskId);
      const learn = s.learningId && find(state.learning, s.learningId);
      if (learn) { key = 'l:' + learn.id; label = learn.title; kind = 'learning'; }
      else if (task && task.projectId && find(state.projects, task.projectId)) { const p = find(state.projects, task.projectId); key = 'p:' + p.id; label = p.title; kind = 'project'; }
      else if (task) { key = 't:' + task.id; label = task.title; kind = 'task'; }
      const g = groups[key] || (groups[key] = { key: key, label: label, kind: kind, minutes: 0, sessions: 0, outputs: 0 });
      g.minutes += Number(s.minutes) || 0; g.sessions += 1;
      g.outputs += state.outputs.filter(function (o) { return o.sessionId === s.id; }).length;
    });
    const list = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return b.minutes - a.minutes; });
    return { from: fromKey, to: toKey, total: sumMin(sessions), sessions: sessions.length, groups: list,
      outputs: state.outputs.filter(function (o) { return inRange(o.createdAt); }),
      doneTasks: state.tasks.filter(function (t) { return t.status === 'done' && inRange(t.doneAt); }) };
  }
  /** First day of the Persian (Jalali) month containing key. */
  function persianMonthStart(key) {
    let k = key;
    try {
      const f = new Intl.DateTimeFormat('en-u-ca-persian', { day: 'numeric' });
      for (let i = 0; i < 32; i++) { if (parseInt(f.format(parseKey(k)).replace(/\D/g, ''), 10) === 1) return k; k = addDays(k, -1); }
    } catch (e) { /* fall through */ }
    return key.slice(0, 8) + '01';
  }
  /** Short or long break according to the user's pomodoro pattern. */
  function nextBreak(state, today) {
    const p = state.settings.pomodoro;
    const n = state.sessions.filter(function (s) { return s.start && dateKey(new Date(s.start)) === today && (s.kind === 'work' || s.kind === 'study'); }).length;
    const long = n > 0 && n % p.longEvery === 0;
    return { minutes: long ? p.longBreak : p.shortBreak, long: long, count: n };
  }

  // ---------- Timer (timestamp based, survives reloads and sleeping tabs) ----------
  function timerStart(minutes, meta, now) {
    const m = Math.min(300, Math.max(1, Math.round(Number(minutes)) || 25));
    return Object.assign({ status: 'running', plannedMin: m, startedAt: now, endAt: now + m * 60000, remainingMs: m * 60000 }, meta || {});
  }
  function timerRemaining(t, now) {
    if (!t) return 0;
    if (t.status === 'paused') return Math.max(0, t.remainingMs);
    return Math.max(0, t.endAt - now);
  }
  function timerPause(t, now) {
    if (!t || t.status !== 'running') return t;
    return Object.assign({}, t, { status: 'paused', remainingMs: Math.max(0, t.endAt - now) });
  }
  function timerResume(t, now) {
    if (!t || t.status !== 'paused') return t;
    return Object.assign({}, t, { status: 'running', endAt: now + t.remainingMs });
  }
  function timerElapsedMin(t, now) {
    if (!t) return 0;
    return Math.max(0, Math.round((t.plannedMin * 60000 - timerRemaining(t, now)) / 60000));
  }
  function timerDone(t, now) { return !!t && t.status === 'running' && now >= t.endAt; }

  // ---------- Formatting ----------
  function fa(n) { return Number(n || 0).toLocaleString('fa-IR'); }
  function faDigits(s) { return String(s).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }
  function duration(min) {
    min = Math.round(Number(min) || 0);
    const h = Math.floor(min / 60), m = min % 60;
    if (!h) return fa(m) + ' دقیقه';
    if (!m) return fa(h) + ' ساعت';
    return fa(h) + ' ساعت و ' + fa(m) + ' دقیقه';
  }
  /** Persian (Jalali) date, assembled in natural Persian order: «یکشنبه ۱۹ مهر ۱۴۰۵». */
  function faDate(key, opts) {
    opts = opts || { day: 'numeric', month: 'long', year: 'numeric' };
    try {
      const parts = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-arabext', opts).formatToParts(parseKey(key));
      const get = function (t) { const p = parts.find(function (x) { return x.type === t; }); return p ? p.value : ''; };
      const out = [get('weekday'), get('day'), get('month'), get('year')].filter(Boolean).join(' ');
      return faDigits(out.replace(/\s*ه\.ش\.?$/, ''));
    } catch (e) { return faDigits(key); }
  }
  function clock(ms) { const s = Math.ceil(ms / 1000); return faDigits(pad(Math.floor(s / 60)) + ':' + pad(s % 60)); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function safeUrl(u) { u = String(u || '').trim(); return /^(https?:|mailto:)/i.test(u) ? u : ''; }

  return {
    VERSION: VERSION, LABELS: LABELS, DAY_TYPES: DAY_TYPES, defaultDaySections: defaultDaySections, goalNextStep: goalNextStep,
    rankTasks: rankTasks, planDay: planDay, comeback: comeback, lastActiveDay: lastActiveDay, rangeReport: rangeReport, persianMonthStart: persianMonthStart, nextBreak: nextBreak, taskGoal: taskGoal, uid: uid, dateKey: dateKey, parseKey: parseKey, addDays: addDays, diffDays: diffDays,
    weekStart: weekStart, isValidKey: isValidKey, defaultState: defaultState, normalizeState: normalizeState,
    projectTasks: projectTasks, projectProgress: projectProgress, nextStep: nextStep, goalProgress: goalProgress,
    scoreTask: scoreTask, suggestNext: suggestNext, dayStats: dayStats, weekStats: weekStats,
    timerStart: timerStart, timerRemaining: timerRemaining, timerPause: timerPause, timerResume: timerResume,
    timerElapsedMin: timerElapsedMin, timerDone: timerDone,
    fa: fa, faDigits: faDigits, duration: duration, faDate: faDate, clock: clock, escapeHtml: escapeHtml, safeUrl: safeUrl,
  };
});
