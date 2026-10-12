/* Nava web app — UI layer. Data stays on this device (localStorage + IndexedDB). */
(function () {
  'use strict';
  var C = window.NavaCore, L = C.LABELS, esc = C.escapeHtml, fa = C.fa;
  var KEY = 'nava.v1';
  var $main = document.getElementById('main');
  var $dlg = document.getElementById('dlg');

  // ---------------- state ----------------
  function load() {
    try { return C.normalizeState(JSON.parse(localStorage.getItem(KEY) || 'null')); }
    catch (e) { return C.defaultState(); }
  }
  var S = load();
  var ui = { view: 'today', learnTab: 'resources', learnDetail: null, weekOffset: 0, suggestion: null, skip: [], journalDate: null,
    timerSel: { kind: 'work', taskId: '', learningId: '', minutes: null } };

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); return true; }
    catch (e) { toast('ذخیره ممکن نشد؛ فضای مرورگر پر است. از تنظیمات خروجی پشتیبان بگیر.'); return false; }
  }
  function commit() { save(); render(); }
  function now() { return Date.now(); }
  function today() { return C.dateKey(new Date()); }
  function byId(list, id) { return list.find(function (x) { return x.id === id; }); }
  function iso() { return new Date().toISOString(); }

  // ---------------- file store (IndexedDB) ----------------
  var FileStore = (function () {
    var dbp = null;
    function db() {
      if (!dbp) dbp = new Promise(function (res, rej) {
        if (!('indexedDB' in window)) return rej(new Error('IndexedDB unavailable'));
        var r = indexedDB.open('nava-files', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('files'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
      return dbp;
    }
    function tx(mode, fn) {
      return db().then(function (d) {
        return new Promise(function (res, rej) {
          var t = d.transaction('files', mode), req = fn(t.objectStore('files'));
          t.oncomplete = function () { res(req ? req.result : undefined); };
          t.onerror = function () { rej(t.error); };
          t.onabort = function () { rej(t.error); };
        });
      });
    }
    return {
      put: function (id, blob) { return tx('readwrite', function (s) { return s.put(blob, id); }); },
      get: function (id) { return tx('readonly', function (s) { return s.get(id); }); },
      del: function (id) { return tx('readwrite', function (s) { return s.delete(id); }); },
      clear: function () { return tx('readwrite', function (s) { return s.clear(); }); },
    };
  })();
  var urlCache = {};
  function fileUrl(id) {
    if (urlCache[id]) return Promise.resolve(urlCache[id]);
    return FileStore.get(id).then(function (b) { if (!b) return null; urlCache[id] = URL.createObjectURL(b); return urlCache[id]; });
  }

  // ---------------- helpers ----------------
  var ICONS = {
    close: '<path d="M6 6l12 12M18 6L6 18"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>',
    star: '<path d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4 7.2 18.9l.9-5.4-3.9-3.8 5.4-.8z"/>', up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>', more: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
    menu: '<path d="M5 7h14M5 12h14M5 17h14"/>',
  };
  function ico(n) { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICONS[n] + '</svg>'; }
  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function opt(value, label, selected) { return '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function opts(map, sel) { return Object.keys(map).map(function (k) { return opt(k, map[k], k === sel); }).join(''); }
  function field(label, html, cls) { return '<label class="field' + (cls ? ' ' + cls : '') + '"><span>' + esc(label) + '</span>' + html + '</label>'; }
  function input(name, value, attrs) { return '<input type="' + ((attrs && attrs.type) || 'text') + '" name="' + name + '" value="' + esc(value == null ? '' : value) + '"' + ((attrs && attrs.extra) || '') + '>'; }
  function dateInput(name, value, extra) {
    return '<input type="date" name="' + name + '" value="' + esc(value || '') + '"' + (extra || '') + '><span class="muted small date-hint" aria-live="polite">' + (C.isValidKey(value) ? esc(C.faDate(value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) : '') + '</span>';
  }
  document.addEventListener('input', function (e) {
    var el = e.target; if (el.type !== 'date') return;
    var h = el.nextElementSibling; if (h && h.classList.contains('date-hint')) h.textContent = C.isValidKey(el.value) ? C.faDate(el.value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
  });
  function textarea(name, value, extra) { return '<textarea name="' + name + '"' + (extra || '') + '>' + esc(value || '') + '</textarea>'; }
  function progress(pct, label) { return '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-label="' + esc(label || 'پیشرفت') + '"><i style="width:' + pct + '%"></i></div>'; }
  function empty(msg) { return '<div class="empty">' + msg + '</div>'; }
  function faDay(key) { return C.faDate(key, { weekday: 'long', day: 'numeric', month: 'long' }); }
  function faTime(isoStr) { try { return new Date(isoStr).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function projectName(id) { var p = byId(S.projects, id); return p ? p.title : ''; }
  function openTasks() { return S.tasks.filter(function (t) { return t.status !== 'done'; }); }
  function targetName(o) {
    if (o.taskId && byId(S.tasks, o.taskId)) return byId(S.tasks, o.taskId).title;
    if (o.learningId && byId(S.learning, o.learningId)) return byId(S.learning, o.learningId).title;
    return '';
  }

  // ---------------- dialogs ----------------
  var dlgH = null;
  function openDialog(o) {
    if ($dlg.open) $dlg.close();
    $dlg.innerHTML = '<form method="dialog"><header><h2 id="dlg-title">' + esc(o.title) + '</h2>' +
      '<button type="button" class="icon-btn" data-dlg="close" aria-label="بستن">' + ico('close') + '</button></header>' +
      '<div class="body">' + o.body + '</div><footer>' +
      (o.onSubmit ? '<button class="btn primary" type="submit">' + esc(o.submit || 'ذخیره') + '</button>' : '') +
      '<button type="button" class="btn" data-dlg="close">' + esc(o.cancelLabel || (o.onSubmit ? 'انصراف' : 'بستن')) + '</button>' +
      (o.danger ? '<span class="spacer"></span><button type="button" class="btn danger" data-dlg="danger">' + esc(o.danger.label) + '</button>' : '') +
      '</footer></form>';
    dlgH = o;
    $dlg.showModal();
    var first = $dlg.querySelector('.body [autofocus], .body input:not([type=checkbox]):not([type=radio]):not([type=file]), .body textarea, .body select');
    if (first) first.focus();
    if (o.onOpen) o.onOpen($dlg);
  }
  function closeDialog() { dlgH = null; if ($dlg.open) $dlg.close(); $dlg.innerHTML = ''; setTimeout(maybeShowPending, 0); }
  function cancelDialog() { var h = dlgH; closeDialog(); if (h && h.onCancel) h.onCancel(); }
  $dlg.addEventListener('submit', function (e) {
    e.preventDefault();
    var h = dlgH; if (!h || !h.onSubmit) return closeDialog();
    Promise.resolve(h.onSubmit(new FormData(e.target), e.target)).then(function (r) { if (r !== false && dlgH === h) closeDialog(); })
      .catch(function (err) { console.error(err); toast('خطا: ' + (err && err.message || err)); });
  });
  $dlg.addEventListener('click', function (e) {
    var b = e.target.closest('[data-dlg]');
    if (b) {
      if (b.dataset.dlg === 'close') cancelDialog();
      else if (b.dataset.dlg === 'danger') { var h = dlgH; dlgH = null; $dlg.close(); $dlg.innerHTML = ''; h.danger.run(); setTimeout(maybeShowPending, 0); }
      return;
    }
    handleAct(e);
  });
  $dlg.addEventListener('cancel', function (e) { e.preventDefault(); cancelDialog(); });
  function confirmDo(title, msg, label, fn) {
    openDialog({ title: title, body: '<p>' + msg + '</p>', submit: label || 'بله، حذف شود', onSubmit: function () { fn(); } });
  }

  // ---------------- navigation ----------------
  var NAV = [
    { id: 'today', label: 'امروز', ico: '☀️' },
    { id: 'goals', label: 'اهداف و پروژه‌ها', short: 'اهداف', ico: '🎯' },
    { id: 'focus', label: 'تایمر تمرکز', short: 'تمرکز', ico: '⏱️' },
    { id: 'review', label: 'مرور هفتگی', short: 'مرور', ico: '🗓️' },
    { id: 'learning', label: 'فضای یادگیری', short: 'یادگیری', ico: '📚', section: 'learning' },
    { id: 'journal', label: 'دفتر شخصی', short: 'دفتر', ico: '📓', section: 'journal' },
    { id: 'settings', label: 'تنظیمات', ico: '⚙️' },
  ];
  function navVisible() { return NAV.filter(function (n) { return !n.section || S.settings.sections[n.section] !== false; }); }
  function navBtn(n, short) {
    var label = short ? (n.short || n.label) : n.label;
    return '<button class="nav-item" data-act="go" data-v="' + n.id + '"' + (ui.view === n.id ? ' aria-current="page"' : '') + '><span class="ico" aria-hidden="true">' + n.ico + '</span><span' + (n.id === 'focus' ? ' data-focus-label' : '') + '>' + esc(label) + '</span></button>';
  }
  function renderNav() {
    document.getElementById('nav-side').innerHTML = navVisible().map(function (n) { return navBtn(n, false); }).join('');
    var main4 = NAV.slice(0, 4).map(function (n) { return navBtn(n, true); }).join('');
    var moreActive = ['learning', 'journal', 'settings'].indexOf(ui.view) !== -1;
    document.getElementById('nav-bottom').innerHTML = main4 + '<button class="nav-item" data-act="more"' + (moreActive ? ' aria-current="page"' : '') + '><span class="ico" aria-hidden="true">' + ico('menu') + '</span><span>بیشتر</span></button>';
  }
  function go(view) {
    if (!NAV.some(function (n) { return n.id === view; })) view = 'today';
    if (location.hash !== '#' + view) { location.hash = view; return; }
    var changed = ui.view !== view; ui.view = view;
    if (view !== 'learning') ui.learnDetail = null;
    render();
    if (changed) { window.scrollTo(0, 0); $main.focus({ preventScroll: true }); }
  }
  window.addEventListener('hashchange', function () { go(location.hash.slice(1) || 'today'); });

  // ---------------- task item ----------------
  function taskItem(t, o) {
    o = o || {};
    var tags = [];
    if (t.priority === 'high' && !o.inToday) tags.push('<span class="tag high">اولویت بالا</span>');
    if (t.projectId && projectName(t.projectId) && !o.inProject) tags.push('<span class="tag">' + esc(projectName(t.projectId)) + '</span>');
    if (t.estimate) tags.push('<span>' + fa(t.estimate) + ' دقیقه</span>');
    if (t.due && t.status !== 'done') {
      var d = C.diffDays(t.due, today());
      tags.push('<span class="tag ' + (d <= 0 ? 'warn' : '') + '">' + (d < 0 ? 'موعد گذشته' : d === 0 ? 'موعد امروز' : 'موعد: ' + esc(C.faDate(t.due, { day: 'numeric', month: 'long' }))) + '</span>');
    }
    if (t.status === 'doing') tags.push('<span class="tag accent">در حال انجام</span>');
    if (o.next) tags.push('<span class="tag ok">قدم بعدی</span>');
    return '<li class="item' + (t.status === 'done' ? ' done' : '') + '" data-task="' + esc(t.id) + '">' +
      '<input type="checkbox" class="check" data-chg="toggle-task" data-id="' + esc(t.id) + '"' + (t.status === 'done' ? ' checked' : '') + ' aria-label="انجام شد: ' + esc(t.title) + '">' +
      '<div class="grow"><button class="btn ghost" style="padding:0;min-height:0;color:inherit;font-weight:inherit;white-space:normal;text-align:start" data-act="edit-task" data-id="' + esc(t.id) + '"><span class="title">' + esc(t.title) + '</span></button>' +
      (tags.length ? '<div class="meta">' + tags.join('') + '</div>' : '') + '</div>' + (o.actions || '') + '</li>';
  }

  // ---------------- views ----------------
  var V = {};

  function daySections() { return S.settings.daySections; }
  function sectionOf(t) { var ids = daySections().map(function (x) { return x.id; }); return ids.indexOf(t.section) !== -1 ? t.section : ids[0]; }
  function todayTasks(t) { return S.tasks.filter(function (x) { return x.todayKey === t && (x.status !== 'done' || (x.doneAt && C.dateKey(new Date(x.doneAt)) === t)); }); }
  function dayCtx() {
    var t = today(), day = S.days[t] || {}, type = C.DAY_TYPES[day.type] || C.DAY_TYPES.normal;
    return { today: t, day: day, energy: type.energy, available: Number(day.available) || 0, dayType: day.type || 'normal' };
  }

  V.today = function () {
    var ctx = dayCtx(), t = ctx.today, day = ctx.day, st = C.dayStats(S, t);
    var mine = todayTasks(t);
    var others = openTasks().filter(function (x) { return x.todayKey !== t; });
    var hello = S.settings.name ? 'سلام ' + esc(S.settings.name) : 'سلام';
    var sug = ui.suggestion, hero;
    if (sug && sug.empty) {
      hero = '<p class="muted" style="margin:0">هنوز کار بازی نداری. یک کار کوچک اضافه کن تا بتوانم پیشنهاد بدهم.</p><div class="row"><button class="btn primary" data-act="new-task">افزودن کار</button><button class="btn ghost" data-act="close-suggest">بستن</button></div>';
    } else if (sug) {
      var task = byId(S.tasks, sug.taskId);
      if (!task || task.status === 'done') { ui.suggestion = null; return V.today(); }
      hero = '<div class="suggest" data-testid="suggestion"><div class="muted small">پیشنهاد من برای الان:</div><div class="task-name">' + esc(task.title) + '</div>' +
        '<ul class="why">' + sug.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' +
        '<div class="row"><button class="btn primary" data-act="start-suggested">شروع تمرکز ' + fa(sug.minutes) + ' دقیقه‌ای</button>' +
        (sug.remaining > 0 ? '<button class="btn" data-act="suggest-other">پیشنهاد دیگر</button>' : '') +
        '<button class="btn ghost" data-act="close-suggest">بستن</button></div></div>';
    } else {
      hero = '<p class="muted" style="margin:0">با توجه به اولویت‌ها، مهلت‌ها، انرژی و زمانی که داری، یک قدم مشخص و ساده پیشنهاد می‌دهم.</p><div><button class="btn primary big" data-act="suggest">الان از کجا شروع کنم؟</button></div>';
    }
    var typeChips = Object.keys(C.DAY_TYPES).map(function (k) { return '<button class="chip" data-act="set-daytype" data-v="' + k + '" aria-pressed="' + ((day.type || '') === k) + '">' + C.DAY_TYPES[k].label + '</button>'; }).join('');
    var timeChips = [[30, '۳۰ دقیقه'], [60, '۱ ساعت'], [120, '۲ ساعت'], [240, '۴ ساعت یا بیشتر']].map(function (x) { return '<button class="chip" data-act="set-available" data-v="' + x[0] + '" aria-pressed="' + (Number(day.available) === x[0]) + '">' + x[1] + '</button>'; }).join('');
    var moods = ['😞', '😕', '😐', '🙂', '😄'];
    var moodBtns = moods.map(function (m, i) { return '<button data-act="set-mood" data-v="' + (i + 1) + '" aria-pressed="' + (day.mood === i + 1) + '" aria-label="حال ' + fa(i + 1) + ' از ۵">' + m + '</button>'; }).join('');
    var cb = C.comeback(S, t);
    var banner = cb && !day.cbDismissed ? '<section class="card soft" data-testid="comeback" style="margin-bottom:16px"><h2 style="margin:0 0 4px">خوش برگشتی 🌱</h2><p style="margin:0 0 12px">' + fa(cb.gap) + ' روز از آخرین فعالیتت گذشته. لازم نیست چیزی را جبران کنی؛ کارها سر جایشان هستند. برای امروز یک برنامهٔ سبک و واقع‌بینانه بچینم؟</p>' +
      '<div class="row"><button class="btn primary" data-act="plan-light">برنامهٔ سبک بچین</button><button class="btn ghost" data-act="cb-dismiss">بعداً</button></div></section>' : '';
    var goals = S.goals.filter(function (g) { return (g.status || 'active') === 'active'; });
    var goalRows = goals.slice(0, 3).map(function (g) {
      var gp = C.goalProgress(S, g.id), ns = C.goalNextStep(S, g.id);
      return '<li class="item" style="align-items:flex-start"><div class="grow"><div class="row"><b class="grow" style="overflow-wrap:anywhere">' + esc(g.title) + '</b><span class="muted small">' + fa(gp.pct) + '٪</span></div>' +
        '<div style="margin:6px 0">' + progress(gp.pct, 'پیشرفت ' + g.title) + '</div><div class="small"><span class="muted">قدم بعدی: </span>' + (ns ? esc(ns.task.title) : '<span class="muted">مشخص نشده</span>') + '</div></div></li>';
    }).join('');
    var secs = daySections();
    var secCard = function (sec, i) {
      var list = mine.filter(function (x) { return sectionOf(x) === sec.id; });
      var openCount = list.filter(function (x) { return x.status !== 'done'; }).length;
      return '<section class="card" data-section="' + esc(sec.id) + '"' + (i === 0 ? ' style="grid-column:1/-1"' : '') + '><div class="row"><h3 style="margin:0" class="grow">' + esc(sec.title) + '</h3><span class="tag">' + fa(list.length) + ' از ' + fa(sec.limit) + '</span>' +
        '<button class="icon-btn" data-act="pick-today" data-sec="' + esc(sec.id) + '" aria-label="انتخاب از کارها برای ' + esc(sec.title) + '" title="انتخاب از کارها">' + ico('more') + '</button></div>' +
        (list.length ? '<ul class="list">' + list.map(function (x) { return taskItem(x, { inToday: true, actions: '<button class="icon-btn" data-act="unpin" data-id="' + esc(x.id) + '" aria-label="برداشتن از امروز" title="برداشتن از امروز">' + ico('close') + '</button>' }); }).join('') + '</ul>' : '') +
        (openCount < sec.limit ? '<form class="inline-form" data-form="add-today" data-sec="' + esc(sec.id) + '" style="margin-top:8px"><input type="text" name="title" placeholder="افزودن…" aria-label="افزودن به ' + esc(sec.title) + '" required maxlength="200"><button class="btn" type="submit">افزودن</button></form>' : '') +
        '</section>';
    };
    return '<div class="page-head"><div><h1>' + hello + '</h1><p class="sub">' + esc(C.faDate(t, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + '</p></div></div>' + banner +
      '<div class="grid grid-2">' +
        '<section class="card hero" aria-labelledby="h-start"><h2 class="hero-title" id="h-start">قدم بعدی چیست؟</h2>' + hero + '</section>' +
        '<section class="card"><h2>امروز چه روزی است؟</h2><div class="stack"><div class="chips" role="group" aria-label="نوع روز">' + typeChips + '</div>' +
        '<div><div class="muted small" id="lbl-time">زمان در دسترس</div><div class="chips" role="group" aria-labelledby="lbl-time">' + timeChips + '</div></div>' +
        '<div><div class="muted small" id="lbl-mood">حال‌وهوا</div><div class="mood" role="group" aria-labelledby="lbl-mood">' + moodBtns + '</div></div></div></section>' +
      '</div>' +
      '<section class="card" style="margin-top:16px" aria-labelledby="h-where"><div class="row"><h2 id="h-where" style="margin:0" class="grow">کجا هستم؟</h2><a class="btn sm ghost" href="#goals">همهٔ اهداف</a></div>' +
        '<div class="stats" style="margin:8px 0 4px"><div class="stat"><b data-testid="today-minutes">' + C.duration(st.minutes) + '</b><span>تمرکز امروز</span></div><div class="stat"><b>' + fa(st.tasksDone) + '</b><span>کار انجام‌شده</span></div><div class="stat"><b>' + fa(mine.filter(function (x) { return x.status !== 'done'; }).length) + '</b><span>باقی‌ماندهٔ برنامهٔ امروز</span></div></div>' +
        (S.timer ? '<p class="small" style="margin:8px 0 0"><a href="#focus">⏱️ یک جلسه در جریان است</a></p>' : '') +
        (goalRows ? '<ul class="list" style="margin-top:8px">' + goalRows + '</ul>' : '<p class="muted small" style="margin:8px 0 0">هنوز هدفی تعریف نکرده‌ای. <a href="#goals">یک هدف بساز</a> تا پیشرفتش را اینجا ببینی.</p>') + '</section>' +
      '<div class="row" style="margin:32px 0 12px"><h2 style="margin:0" class="grow">چه چیزی امروز مهم است؟</h2><button class="btn sm" data-act="plan-day">چیدن برنامهٔ پیشنهادی</button></div>' +
      '<div class="grid grid-2" data-testid="sections">' + secs.map(secCard).join('') + '</div>' +
      '<section class="card" style="margin-top:16px"><details class="more" style="border:0;margin:0;padding:0"' + (ui.openOthers ? ' open' : '') + ' data-toggle="openOthers"><summary>بقیهٔ کارهای باز (' + fa(others.length) + ')</summary>' +
        '<p class="muted small" style="margin:0 0 8px">کارهای انجام‌نشده سر جایشان می‌مانند؛ فقط چیزی را به امروز بیاور که واقعاً جا دارد.</p>' +
        (others.length ? '<ul class="list">' + others.map(function (x) { return taskItem(x, { actions: '<button class="btn sm" data-act="pin" data-id="' + esc(x.id) + '">به امروز</button>' }); }).join('') + '</ul>' : '<p class="muted small">کار دیگری نیست.</p>') +
        '<div class="row" style="margin-top:8px"><button class="btn sm" data-act="new-task">کار جدید با جزئیات</button></div></details></section>';
  };

  V.goals = function () {
    var goals = S.goals.slice().sort(function (a, b) { return (a.status === 'done') - (b.status === 'done'); });
    var orphan = S.projects.filter(function (p) { return !p.goalId || !byId(S.goals, p.goalId); });
    var html = '<div class="page-head"><div><h1>اهداف و پروژه‌ها</h1><p class="sub">هر هدف را به پروژه و قدم‌های کوچک تبدیل کن؛ فقط قدم بعدی مهم است.</p></div>' +
      '<div class="row"><button class="btn primary" data-act="new-goal">هدف جدید</button><button class="btn" data-act="new-project">پروژهٔ جدید</button><button class="btn ghost" data-act="templates">نمونه‌های آماده</button></div></div>';
    if (!goals.length && !orphan.length) return html + '<div class="empty stack" style="align-items:center">هنوز هدفی ثبت نشده. یک هدف بساز یا از نمونه‌ها شروع کن؛ بعداً همه‌چیز قابل تغییر است.<button class="btn primary" data-act="templates">شروع با نمونه‌ها</button></div>';
    html += '<div class="stack">' + goals.map(function (g) {
      var gp = C.goalProgress(S, g.id);
      var ps = S.projects.filter(function (p) { return p.goalId === g.id; });
      return '<section class="card" data-goal="' + esc(g.id) + '"><div class="row"><h2 style="margin:0">' + esc(g.title) + '</h2>' +
        '<span class="tag ' + (g.status === 'done' ? 'ok' : g.status === 'paused' ? 'warn' : 'accent') + '">' + L.goalStatus[g.status || 'active'] + '</span>' +
        (g.deadline ? '<span class="tag">تا ' + esc(C.faDate(g.deadline)) + '</span>' : '') + '<span class="spacer"></span>' +
        '<button class="btn sm" data-act="new-project" data-goal-id="' + esc(g.id) + '">+ پروژه</button><button class="icon-btn" data-act="edit-goal" data-id="' + esc(g.id) + '" aria-label="ویرایش هدف">' + ico('edit') + '</button></div>' +
        (g.why ? '<p class="muted" style="margin:8px 0 0">' + esc(g.why) + '</p>' : '') +
        '<div style="margin:12px 0 4px">' + progress(gp.pct, 'پیشرفت هدف') + '</div><div class="muted small">' + fa(gp.pct) + '٪ · ' + fa(gp.finishedProjects) + ' از ' + fa(gp.projects) + ' مرحله کامل · ' + fa(gp.done) + ' از ' + fa(gp.total) + ' قدم</div>' +
        (function () { var ns = C.goalNextStep(S, g.id); return ns ? '<div class="small" style="margin-top:6px"><span class="muted">قدم بعدی هدف: </span><b>' + esc(ns.task.title) + '</b></div>' : ''; })() +
        (ps.length ? '<div class="stack" style="margin-top:16px">' + ps.map(projectBlock).join('') + '</div>' : '<p class="muted small">هنوز پروژه‌ای برای این هدف نساخته‌ای.</p>') +
        '</section>';
    }).join('');
    if (orphan.length) html += '<section class="card"><h2>پروژه‌های بدون هدف</h2><div class="stack">' + orphan.map(projectBlock).join('') + '</div></section>';
    return html + '</div>';
  };
  function projectBlock(p) {
    var pr = C.projectProgress(S, p.id), ns = C.nextStep(S, p.id), ts = C.projectTasks(S, p.id);
    return '<div class="card soft" data-project="' + esc(p.id) + '"><div class="row"><h3 style="margin:0">' + esc(p.title) + '</h3>' +
      (p.status && p.status !== 'active' ? '<span class="tag ' + (p.status === 'done' ? 'ok' : 'warn') + '">' + L.goalStatus[p.status] + '</span>' : '') + (p.deadline ? '<span class="tag">تا ' + esc(C.faDate(p.deadline, { day: 'numeric', month: 'long' })) + '</span>' : '') + '<span class="spacer"></span>' +
      '<span class="muted small">' + fa(pr.done) + '/' + fa(pr.total) + '</span><button class="icon-btn" data-act="edit-project" data-id="' + esc(p.id) + '" aria-label="ویرایش پروژه">' + ico('edit') + '</button></div>' +
      '<div style="margin:8px 0">' + progress(pr.pct, 'پیشرفت پروژه') + '</div>' +
      '<div class="muted small" style="margin-bottom:6px">' + fa(pr.pct) + '٪</div>' +
      (ns ? '<div class="row"><span class="muted small">قدم بعدی:</span><b class="grow" style="overflow-wrap:anywhere">' + esc(ns.title) + '</b><button class="btn sm primary" data-act="focus-task" data-id="' + esc(ns.id) + '">شروع</button></div>'
        : (pr.total ? '<p class="small" style="color:var(--ok);margin:0">همهٔ قدم‌ها انجام شده 🎉</p>' : '<p class="muted small" style="margin:0">قدم اول را اضافه کن.</p>')) +
      '<details class="more"><summary>قدم‌ها (' + fa(ts.length) + ')</summary><ul class="list">' +
      ts.map(function (t, i) { return taskItem(t, { inProject: true, next: ns && ns.id === t.id, actions: ((t.status !== 'done' && !(ns && ns.id === t.id)) ? '<button class="icon-btn" data-act="set-next" data-id="' + esc(t.id) + '" aria-label="قدم بعدی شود" title="قدم بعدی شود">' + ico('star') + '</button>' : '') +
        (i > 0 ? '<button class="icon-btn" data-act="step-up" data-id="' + esc(t.id) + '" aria-label="جابه‌جایی به بالا" title="جابه‌جایی به بالا">' + ico('up') + '</button>' : '') }); }).join('') +
      '</ul><form class="inline-form" data-form="add-step" data-project="' + esc(p.id) + '" style="margin-top:8px"><input type="text" name="title" placeholder="قدم کوچک بعدی…" aria-label="قدم جدید" required maxlength="200"><button class="btn" type="submit">افزودن قدم</button></form></details></div>';
  }

  V.focus = function () {
    var tabs = '<div class="tabs" role="tablist">' + [['timer', 'تایمر'], ['report', 'گزارش زمان']].map(function (x) { return '<button class="tab" role="tab" data-act="focus-tab" data-v="' + x[0] + '" aria-selected="' + ((ui.focusTab || 'timer') === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>';
    var head = '<div class="page-head"><div><h1>تایمر تمرکز</h1><p class="sub">زمان دلخواهت را بگذار؛ در پایان، علاوه بر زمان، نتیجه و چیزی را که ساختی هم ثبت کن.</p></div></div>' + tabs;
    if (ui.focusTab === 'report') return head + reportView();
    var t = S.timer, sel = ui.timerSel, pomo = S.settings.pomodoro;
    var mins = sel.minutes || pomo.focus;
    var brk = sel.breakMin || pomo.shortBreak;
    var left, offer = '';
    if (!t && ui.offerBreak) {
      offer = '<div class="suggest" style="margin-bottom:16px" data-testid="break-offer"><b>وقت استراحت ☕</b><p style="margin:4px 0 12px">' + (ui.offerBreak.long ? 'استراحت بلند' : 'استراحت کوتاه') + ' — ' + fa(ui.offerBreak.minutes) + ' دقیقه. از پشت میز بلند شو و کمی آب بخور.</p>' +
        '<div class="row"><button class="btn primary" data-act="break-start">شروع استراحت</button><button class="btn ghost" data-act="break-skip">رد کردن</button></div></div>';
    }
    if (!t) {
      var presets = [15, 25, 45, 60, 90]; if (presets.indexOf(pomo.focus) === -1) presets.unshift(pomo.focus);
      var taskOpts = opt('', '— بدون انتخاب —', !sel.taskId) + openTasks().map(function (x) { return opt(x.id, x.title + (x.projectId ? ' · ' + projectName(x.projectId) : ''), x.id === sel.taskId); }).join('');
      var learnOpts = opt('', '— بدون انتخاب —', !sel.learningId) + S.learning.filter(function (l) { return l.status !== 'done'; }).map(function (l) { return opt(l.id, l.title, l.id === sel.learningId); }).join('');
      left = offer + ringHtml(mins * 60000, 1, 'آماده') +
        '<div class="stack"><div><div class="muted small" id="lbl-dur">مدت تمرکز (دقیقه)</div><div class="chips" role="group" aria-labelledby="lbl-dur">' +
        presets.map(function (p) { return '<button class="chip" data-act="preset" data-v="' + p + '" aria-pressed="' + (mins === p) + '">' + fa(p) + '</button>'; }).join('') +
        '<input type="number" id="focus-min" min="1" max="300" value="' + mins + '" style="width:96px" aria-label="مدت دلخواه تمرکز به دقیقه" data-chg="custom-min"></div></div>' +
        '<div class="row"><label class="field" style="width:150px"><span>استراحت بعدش (دقیقه)</span><input type="number" id="break-min" min="1" max="120" value="' + brk + '" data-chg="break-min"></label>' +
        '<p class="muted small" style="margin:0;flex:1;min-width:180px">الگوی تو: ' + fa(pomo.focus) + ' دقیقه تمرکز، ' + fa(pomo.shortBreak) + ' دقیقه استراحت، و بعد از هر ' + fa(pomo.longEvery) + ' جلسه ' + fa(pomo.longBreak) + ' دقیقه استراحت بلند. <a href="#settings">تغییر الگو</a></p></div>' +
        '<div><div class="muted small" id="lbl-kind">نوع جلسه</div><div class="chips" role="group" aria-labelledby="lbl-kind">' +
        ['work', 'study'].map(function (k) { return '<button class="chip" data-act="kind" data-v="' + k + '" aria-pressed="' + (sel.kind === k) + '">' + L.kind[k] + '</button>'; }).join('') + '</div></div>' +
        (sel.kind === 'work' ? field('روی چه کاری؟', '<select id="focus-task" data-chg="sel-task">' + taskOpts + '</select>') : field('چه درس یا منبعی؟', '<select id="focus-learning" data-chg="sel-learning">' + learnOpts + '</select>')) +
        '<button class="btn primary big" data-act="timer-start">شروع تمرکز</button></div>';
    } else {
      var rem = C.timerRemaining(t, now()), isBreak = t.phase === 'break';
      var target = targetName(t);
      left = ringHtml(rem, rem / (t.plannedMin * 60000), isBreak ? (t.status === 'paused' ? 'استراحت · متوقف' : 'استراحت') : (t.status === 'paused' ? 'متوقف' : 'در حال تمرکز'), isBreak) +
        (target && !isBreak ? '<p style="text-align:center;margin:0 0 16px"><span class="muted small">روی: </span><b>' + esc(target) + '</b></p>' : '') +
        '<div class="timer-controls">' + (t.status === 'running' ? '<button class="btn" data-act="timer-pause">توقف موقت</button>' : '<button class="btn primary" data-act="timer-resume">ادامه</button>') +
        (isBreak ? '<button class="btn primary" data-act="break-end">پایان استراحت</button>' : '<button class="btn primary" data-act="timer-finish">پایان و ثبت نتیجه</button><button class="btn ghost" data-act="timer-cancel">لغو</button>') + '</div>';
    }
    var t0 = today();
    var todays = S.sessions.filter(function (s) { return C.dateKey(new Date(s.start)) === t0; }).reverse();
    var older = S.sessions.filter(function (s) { return C.dateKey(new Date(s.start)) !== t0; }).slice(-30).reverse();
    return head + '<div class="timer-wrap"><section class="card" aria-label="تایمر">' + left + '</section>' +
      '<section class="card"><h2>جلسات امروز</h2>' + (todays.length ? '<ul class="list" data-testid="sessions-today">' + todays.map(sessionItem).join('') + '</ul>' : '<p class="muted">هنوز جلسه‌ای ثبت نشده.</p>') +
      (older.length ? '<details class="more"><summary>جلسات قبلی</summary><ul class="list">' + older.map(sessionItem).join('') + '</ul></details>' : '') + '</section></div>';
  };
  function reportRange() {
    var r = ui.report || { range: 'week' }, t = today();
    if (r.range === 'today') return { from: t, to: t, label: 'امروز' };
    if (r.range === 'month') return { from: C.persianMonthStart(t), to: t, label: 'این ماه' };
    if (r.range === '30') return { from: C.addDays(t, -29), to: t, label: '۳۰ روز اخیر' };
    if (r.range === 'custom' && C.isValidKey(r.from) && C.isValidKey(r.to)) return r.from <= r.to ? { from: r.from, to: r.to, label: 'بازهٔ دلخواه' } : { from: r.to, to: r.from, label: 'بازهٔ دلخواه' };
    return { from: C.weekStart(t, S.settings.weekStartDay), to: t, label: 'این هفته' };
  }
  function reportView() {
    var r = ui.report || { range: 'week' }, rg = reportRange(), rep = C.rangeReport(S, rg.from, rg.to);
    var max = Math.max.apply(null, rep.groups.map(function (g) { return g.minutes; }).concat([1]));
    var kindLbl = { project: 'پروژه', learning: 'یادگیری', task: 'کار', free: 'آزاد' };
    return '<section class="card stack"><div class="chips" role="group" aria-label="بازهٔ گزارش">' + [['today', 'امروز'], ['week', 'این هفته'], ['month', 'این ماه'], ['30', '۳۰ روز اخیر'], ['custom', 'بازهٔ دلخواه']].map(function (x) {
        return '<button class="chip" data-act="report-range" data-v="' + x[0] + '" aria-pressed="' + ((r.range || 'week') === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      (r.range === 'custom' ? '<form class="row" data-form="report-custom"><label class="field"><span>از</span>' + input('from', r.from || C.addDays(today(), -6), { type: 'date', extra: ' required' }) + '</label><label class="field"><span>تا</span>' + dateInput('to', r.to || today(), ' required') + '</label><button class="btn" type="submit" style="align-self:flex-end">نمایش</button></form>' : '') +
      '<p class="muted small" style="margin:0">' + esc(rg.label) + ': ' + esc(C.faDate(rg.from)) + (rg.from !== rg.to ? ' تا ' + esc(C.faDate(rg.to)) : '') + '</p>' +
      '<div class="stats" data-testid="report-stats"><div class="stat"><b>' + C.duration(rep.total) + '</b><span>زمان تمرکز</span></div><div class="stat"><b>' + fa(rep.sessions) + '</b><span>جلسه</span></div><div class="stat"><b>' + fa(rep.outputs.length) + '</b><span>خروجی</span></div><div class="stat"><b>' + fa(rep.doneTasks.length) + '</b><span>کار انجام‌شده</span></div></div></section>' +
      '<section class="card" style="margin-top:16px"><h2>زمان هر درس، پروژه یا فعالیت</h2>' + (rep.groups.length ? '<ul class="list" data-testid="report-groups">' + rep.groups.map(function (g) {
        return '<li class="item" style="align-items:flex-start"><div class="grow"><div class="row"><b class="grow" style="overflow-wrap:anywhere">' + esc(g.label) + '</b><span class="tag">' + kindLbl[g.kind] + '</span></div>' +
          '<div class="progress" style="margin:8px 0" aria-hidden="true"><i style="width:' + Math.round((g.minutes / max) * 100) + '%;background:var(--accent)"></i></div>' +
          '<div class="meta"><span>' + C.duration(g.minutes) + '</span><span>· ' + fa(g.sessions) + ' جلسه</span>' + (g.outputs ? '<span class="tag ok">' + fa(g.outputs) + ' خروجی</span>' : '') + '</div></div></li>';
      }).join('') + '</ul>' : '<p class="muted">در این بازه جلسه‌ای ثبت نشده.</p>') +
      (rep.outputs.length ? '<details class="more"><summary>نتیجه‌ها و خروجی‌های این بازه (' + fa(rep.outputs.length) + ')</summary><div class="stack">' + rep.outputs.slice().reverse().map(outputCard).join('') + '</div></details>' : '') + '</section>';
  }
  function ringHtml(ms, frac, status, isBreak) {
    var c = 2 * Math.PI * 54;
    return '<div class="ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="track" cx="60" cy="60" r="54"/><circle class="bar" id="ring-bar" cx="60" cy="60" r="54"' + (isBreak ? ' style="stroke:var(--ok)"' : '') + ' stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - Math.max(0, Math.min(1, frac)))).toFixed(1) + '"/></svg>' +
      '<div class="label"><div class="time" id="t-time" role="timer" aria-live="off">' + C.clock(ms) + '</div><div class="muted small">' + esc(status) + '</div></div></div>';
  }
  function sessionItem(s) {
    var outs = S.outputs.filter(function (o) { return o.sessionId === s.id; });
    var target = targetName(s);
    return '<li class="item"><div class="grow"><div class="title"><b>' + C.duration(s.minutes) + '</b> · ' + esc(L.kind[s.kind] || 'کار') + (target ? ' · ' + esc(target) : '') + '</div>' +
      '<div class="meta"><span>' + esc(C.faDate(C.dateKey(new Date(s.start)), { day: 'numeric', month: 'long' })) + ' · ' + esc(faTime(s.start)) + '</span>' + (outs.length ? '<span class="tag ok">' + fa(outs.length) + ' خروجی</span>' : '') + '</div>' +
      (s.note ? '<div class="small" style="margin-top:4px;overflow-wrap:anywhere">' + esc(s.note) + '</div>' : '') + '</div>' +
      '<button class="icon-btn" data-act="del-session" data-id="' + esc(s.id) + '" aria-label="حذف جلسه">' + ico('trash') + '</button></li>';
  }

  V.review = function () {
    var ws = C.weekStart(C.addDays(today(), ui.weekOffset * 7), S.settings.weekStartDay);
    var st = C.weekStats(S, ws);
    var rv = S.reviews.find(function (r) { return r.weekStart === ws; }) || {};
    var max = Math.max.apply(null, st.byDay.map(function (d) { return d.minutes; }).concat([1]));
    var bars = st.byDay.map(function (d) { return '<div class="b" title="' + esc(C.duration(d.minutes)) + '"><span>' + (d.minutes ? fa(d.minutes) : '') + '</span><i style="height:' + Math.round((d.minutes / max) * 80) + '%"></i><span>' + esc(C.faDate(d.key, { weekday: 'short' })) + '</span></div>'; }).join('');
    var past = S.reviews.filter(function (r) { return r.weekStart !== ws; }).sort(function (a, b) { return b.weekStart.localeCompare(a.weekStart); });
    var label = ui.weekOffset === 0 ? 'این هفته' : ui.weekOffset === -1 ? 'هفتهٔ گذشته' : fa(-ui.weekOffset) + ' هفته پیش';
    return '<div class="page-head"><div><h1>مرور هفتگی</h1><p class="sub">' + esc(label) + ': ' + esc(C.faDate(st.start, { day: 'numeric', month: 'long' })) + ' تا ' + esc(C.faDate(st.end, { day: 'numeric', month: 'long' })) + '</p></div>' +
      '<div class="row"><button class="btn sm" data-act="week" data-v="-1">→ هفتهٔ قبل</button>' + (ui.weekOffset < 0 ? '<button class="btn sm" data-act="week" data-v="1">هفتهٔ بعد ←</button><button class="btn sm ghost" data-act="week" data-v="0">این هفته</button>' : '') + '</div></div>' +
      '<section class="card"><h2>پیشرفت هفته</h2><div class="stats" data-testid="week-stats"><div class="stat"><b>' + C.duration(st.focusMinutes) + '</b><span>تمرکز</span></div><div class="stat"><b>' + fa(st.sessions) + '</b><span>جلسه</span></div>' +
      '<div class="stat"><b>' + fa(st.doneTasks.length) + '</b><span>کار انجام‌شده</span></div><div class="stat"><b>' + fa(st.outputs.length) + '</b><span>خروجی ساخته‌شده</span></div><div class="stat"><b>' + fa(st.activeDays) + ' از ۷</b><span>روز فعال</span></div>' +
      (st.avgMood ? '<div class="stat"><b>' + fa(st.avgMood) + ' از ۵</b><span>میانگین حال</span></div>' : '') + '</div>' +
      '<details class="more"><summary>زمان تمرکز هر روز</summary><div class="week-bars" aria-label="دقیقه‌های تمرکز روزهای هفته">' + bars + '</div></details></section>' +
      '<section class="card section" style="margin-top:16px"><h2>دستاوردهای هفته</h2>' +
      (st.doneTasks.length || st.outputs.length ? '<ul class="list">' + st.doneTasks.map(function (t) { return '<li class="item"><span aria-hidden="true">✅</span><div class="grow title">' + esc(t.title) + '</div></li>'; }).join('') +
        st.outputs.map(function (o) { return '<li class="item"><span aria-hidden="true">📦</span><div class="grow"><div class="title">' + esc(o.title) + '</div><div class="meta"><span class="tag ok">' + esc(L.outputType[o.type] || 'خروجی') + '</span></div></div></li>'; }).join('') + '</ul>'
        : '<p class="muted">در این هفته هنوز دستاوردی ثبت نشده. هر قدم کوچکی هم حساب است.</p>') + '</section>' +
      '<section class="card section" style="margin-top:16px"><h2>مرور و برنامهٔ هفتهٔ بعد</h2><form class="stack" data-form="review" data-week="' + ws + '">' +
      field('چه چیزهایی خوب پیش رفت؟', textarea('wentWell', rv.wentWell)) + field('با چه موانعی روبه‌رو شدم؟', textarea('obstacles', rv.obstacles)) +
      field('چه چیزی باید تغییر کند؟', textarea('change', rv.change)) + field('برنامه و سه اولویت هفتهٔ آینده', textarea('nextPlan', rv.nextPlan)) +
      '<div><button class="btn primary" type="submit">ذخیرهٔ مرور</button>' + (rv.updatedAt ? ' <span class="muted small">آخرین ذخیره: ' + esc(C.faDate(C.dateKey(new Date(rv.updatedAt)))) + '</span>' : '') + '</div></form></section>' +
      (past.length ? '<section class="card section" style="margin-top:16px"><details><summary style="cursor:pointer;min-height:44px;display:flex;align-items:center"><h2 style="margin:0">مرورهای قبلی (' + fa(past.length) + ')</h2></summary><div class="stack" style="margin-top:12px">' +
        past.map(function (r) { return '<div class="card soft"><b>هفتهٔ ' + esc(C.faDate(r.weekStart)) + '</b>' + ['wentWell', 'obstacles', 'change', 'nextPlan'].filter(function (k) { return r[k]; }).map(function (k) { return '<p class="small" style="margin:6px 0 0;white-space:pre-wrap"><span class="muted">' + { wentWell: 'خوب پیش رفت', obstacles: 'موانع', change: 'تغییر', nextPlan: 'برنامه' }[k] + ': </span>' + esc(r[k]) + '</p>'; }).join('') + '</div>'; }).join('') + '</div></details></section>' : '');
  };

  V.learning = function () {
    if (ui.learnDetail && byId(S.learning, ui.learnDetail)) return learningDetail(byId(S.learning, ui.learnDetail));
    var tabs = [['resources', 'منابع'], ['outputs', 'تمرین‌ها و خروجی‌ها'], ['ideas', 'ایده‌ها و مقالات']];
    var html = '<div class="page-head"><div><h1>فضای یادگیری</h1><p class="sub">ببین کجای مسیر هستی، قدم بعدی چیست و چه چیزی واقعاً ساخته‌ای.</p></div></div>' +
      '<div class="tabs" role="tablist">' + tabs.map(function (t) { return '<button class="tab" role="tab" data-act="learn-tab" data-v="' + t[0] + '" aria-selected="' + (ui.learnTab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (ui.learnTab === 'outputs') {
      var outs = S.outputs.slice().reverse();
      return html + '<div class="row" style="margin-bottom:16px"><button class="btn primary" data-act="new-output">ثبت تمرین یا خروجی</button></div>' +
        (outs.length ? '<div class="stack">' + outs.map(outputCard).join('') + '</div>' : empty('کدی که نوشتی، مسئله‌ای که حل کردی یا تصویر نتیجهٔ کارت را اینجا نگه دار.'));
    }
    if (ui.learnTab === 'ideas') {
      var ideas = S.ideas.slice().reverse();
      return html + '<div class="row" style="margin-bottom:16px"><button class="btn primary" data-act="new-idea">ایده یا مقالهٔ جدید</button></div>' +
        (ideas.length ? '<div class="card"><ul class="list">' + ideas.map(function (i) {
          var u = C.safeUrl(i.url);
          return '<li class="item"><span aria-hidden="true">' + (i.kind === 'article' ? '📄' : '💡') + '</span><div class="grow"><div class="title">' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(i.title) + '</a>' : esc(i.title)) + '</div>' +
            (i.text ? '<div class="small muted" style="white-space:pre-wrap">' + esc(i.text) + '</div>' : '') + '</div><button class="icon-btn" data-act="del-idea" data-id="' + esc(i.id) + '" aria-label="حذف">' + ico('trash') + '</button></li>';
        }).join('') + '</ul></div>' : empty('ایده‌ها و مقاله‌های مهم را اینجا نگه دار تا گم نشوند.'));
    }
    var res = S.learning.slice().sort(function (a, b) { var o = { learning: 0, planned: 1, paused: 2, done: 3 }; return (o[a.status] || 0) - (o[b.status] || 0); });
    return html + '<div class="row" style="margin-bottom:16px"><button class="btn primary" data-act="new-learning">منبع جدید</button></div>' +
      (res.length ? '<div class="grid grid-2">' + res.map(function (l) {
        var openQ = (l.questions || []).filter(function (q) { return !q.resolved; }).length;
        return '<section class="card stack" data-learning="' + esc(l.id) + '"><div class="row"><h3 style="margin:0" class="grow">' + esc(l.title) + '</h3><span class="tag">' + esc(L.learnType[l.type] || 'منبع') + '</span><span class="tag ' + (l.status === 'learning' ? 'accent' : l.status === 'done' ? 'ok' : '') + '">' + esc(L.learnStatus[l.status] || '') + '</span></div>' +
          (Number(l.progress) ? progress(Number(l.progress), 'پیشرفت منبع') : '') +
          '<div class="small"><span class="muted">آخرین جلسه: </span>' + (l.lastTopic ? esc(l.lastTopic) : '<span class="muted">—</span>') + '</div>' +
          '<div class="small"><span class="muted">قدم بعدی: </span>' + (l.nextStep ? '<b>' + esc(l.nextStep) + '</b>' : '<span class="muted">مشخص نشده</span>') + '</div>' +
          (openQ ? '<div class="small"><span class="tag warn">' + fa(openQ) + ' پرسش حل‌نشده</span></div>' : '') +
          '<div class="row"><button class="btn sm primary" data-act="study" data-id="' + esc(l.id) + '">شروع مطالعه</button><button class="btn sm" data-act="learn-open" data-id="' + esc(l.id) + '">جزئیات</button></div></section>';
      }).join('') + '</div>' : empty('دوره، کتاب یا مقاله‌ای که در حال یادگیری‌اش هستی را اضافه کن.'));
  };
  function learningDetail(l) {
    var qs = l.questions || [];
    var outs = S.outputs.filter(function (o) { return o.learningId === l.id; }).reverse();
    var mins = S.sessions.filter(function (s) { return s.learningId === l.id; }).reduce(function (a, s) { return a + (Number(s.minutes) || 0); }, 0);
    var u = C.safeUrl(l.link);
    return '<div class="page-head"><div><button class="btn ghost sm" data-act="learn-back">→ بازگشت به منابع</button><h1 style="margin-top:8px">' + esc(l.title) + '</h1>' +
      '<p class="sub">' + esc(L.learnType[l.type] || '') + ' · ' + esc(L.learnStatus[l.status] || '') + ' · ' + C.duration(mins) + ' مطالعه' + (u ? ' · <a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">لینک منبع</a>' : '') + '</p></div>' +
      '<div class="row"><button class="btn primary" data-act="study" data-id="' + esc(l.id) + '">شروع مطالعه</button><button class="btn" data-act="edit-learning" data-id="' + esc(l.id) + '">ویرایش</button></div></div>' +
      '<div class="grid grid-2"><section class="card stack"><h2>کجای مسیرم؟</h2>' + (Number(l.progress) ? progress(Number(l.progress)) + '<div class="muted small">' + fa(l.progress) + '٪</div>' : '') +
      '<div><span class="muted small">آخرین جلسه یا مبحث</span><div>' + (l.lastTopic ? esc(l.lastTopic) : '—') + '</div></div><div><span class="muted small">قدم بعدی</span><div><b>' + (l.nextStep ? esc(l.nextStep) : 'مشخص نشده') + '</b></div></div></section>' +
      '<section class="card"><h2>پرسش‌های حل‌نشده</h2><ul class="list">' + qs.map(function (q) {
        return '<li class="item' + (q.resolved ? ' done' : '') + '"><input type="checkbox" class="check" data-chg="toggle-q" data-id="' + esc(q.id) + '"' + (q.resolved ? ' checked' : '') + ' aria-label="حل شد"><div class="grow title">' + esc(q.text) + '</div><button class="icon-btn" data-act="del-q" data-id="' + esc(q.id) + '" aria-label="حذف پرسش">' + ico('close') + '</button></li>';
      }).join('') + '</ul><form class="inline-form" data-form="add-q" style="margin-top:8px"><input type="text" name="text" placeholder="پرسشی که هنوز جوابش را نمی‌دانی…" aria-label="پرسش جدید" required maxlength="300"><button class="btn" type="submit">افزودن</button></form></section></div>' +
      '<section class="card section" style="margin-top:16px"><h2>یادداشت‌های کوتاه</h2><form class="stack" data-form="learn-notes">' + textarea('notes', l.notes, ' aria-label="یادداشت‌ها" rows="5"') + '<div><button class="btn" type="submit">ذخیرهٔ یادداشت</button></div></form></section>' +
      '<section class="card section" style="margin-top:16px"><div class="row" style="margin-bottom:12px"><h2 style="margin:0" class="grow">تمرین‌ها و خروجی‌ها</h2><button class="btn sm" data-act="new-output" data-learning="' + esc(l.id) + '">ثبت خروجی</button></div>' +
      (outs.length ? '<div class="stack">' + outs.map(outputCard).join('') + '</div>' : '<p class="muted">هنوز خروجی‌ای برای این منبع ثبت نشده.</p>') + '</section>';
  }
  function outputCard(o) {
    var u = C.safeUrl(o.url), target = targetName(o);
    return '<div class="card" data-output="' + esc(o.id) + '"><div class="row"><b class="grow" style="overflow-wrap:anywhere">' + esc(o.title) + '</b><span class="tag ok">' + esc(L.outputType[o.type] || 'خروجی') + '</span>' +
      '<button class="icon-btn" data-act="del-output" data-id="' + esc(o.id) + '" aria-label="حذف خروجی">' + ico('trash') + '</button></div>' +
      '<div class="meta"><span>' + esc(C.faDate(C.dateKey(new Date(o.createdAt)))) + '</span>' + (target ? '<span>' + esc(target) + '</span>' : '') + '</div>' +
      (o.text ? (o.type === 'code' ? '<pre class="code"><code>' + esc(o.text) + '</code></pre>' : '<p style="white-space:pre-wrap;margin:8px 0 0">' + esc(o.text) + '</p>') : '') +
      (u ? '<p class="small" style="margin:8px 0 0"><a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(u) + '</a></p>' : '') +
      ((o.files || []).length ? '<div class="out-files">' + o.files.map(function (f) {
        return /^image\//.test(f.mime) ? '<button class="btn ghost" style="padding:0;min-height:0" data-act="open-file" data-id="' + esc(f.fileId) + '" data-name="' + esc(f.name) + '"><img data-file="' + esc(f.fileId) + '" alt="' + esc(f.name) + '"></button>'
          : '<button class="btn sm" data-act="open-file" data-id="' + esc(f.fileId) + '" data-name="' + esc(f.name) + '">📎 ' + esc(f.name) + '</button>';
      }).join('') + '</div>' : '') + '</div>';
  }

  V.journal = function () {
    var date = ui.journalDate || today();
    var j = S.journal.find(function (x) { return x.date === date; }) || {};
    var moods = ['😞', '😕', '😐', '🙂', '😄'];
    var radios = function (name, vals, cur, labels) {
      return vals.map(function (v, i) { return '<label class="chip" style="display:inline-flex;align-items:center;gap:6px"><input type="radio" name="' + name + '" value="' + (i + 1) + '"' + (Number(cur) === i + 1 ? ' checked' : '') + ' aria-label="' + esc(labels[i]) + '"> ' + v + '</label>'; }).join('');
    };
    var past = S.journal.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    return '<div class="page-head"><div><h1>دفتر شخصی</h1><p class="sub">فضایی آرام برای فکر کردن؛ جدا از فهرست کارها.</p></div></div>' +
      '<section class="card"><div class="row" style="margin-bottom:12px"><h2 style="margin:0" class="grow">' + esc(faDay(date)) + '</h2>' + (date !== today() ? '<button class="btn sm" data-act="journal-today">امروز</button>' : '') + '</div>' +
      '<form class="stack" data-form="journal" data-date="' + date + '">' +
      '<fieldset style="border:0;padding:0;margin:0"><legend class="muted small">حال روحی</legend><div class="chips">' + radios('mood', moods, j.mood, ['خیلی بد', 'بد', 'معمولی', 'خوب', 'عالی']) + '</div></fieldset>' +
      '<fieldset style="border:0;padding:0;margin:0"><legend class="muted small">انرژی</legend><div class="chips">' + radios('energy', ['۱', '۲', '۳', '۴', '۵'], j.energy, ['خیلی کم', 'کم', 'متوسط', 'زیاد', 'خیلی زیاد']) + '</div></fieldset>' +
      field('افکار و ایده‌ها', textarea('text', j.text, ' rows="4"')) + field('اتفاقات مهم امروز', textarea('events', j.events, ' rows="3"')) + field('آموخته‌های امروز', textarea('learned', j.learned, ' rows="3"')) +
      '<div><button class="btn primary" type="submit">ذخیره</button></div></form></section>' +
      (past.length ? '<section class="card section" style="margin-top:16px"><h2>یادداشت‌های قبلی</h2><ul class="list">' + past.map(function (x) {
        return '<li class="item"><span style="font-size:22px" aria-hidden="true">' + (moods[(x.mood || 3) - 1] || '📝') + '</span><div class="grow"><button class="btn ghost" style="padding:0;min-height:0;color:inherit" data-act="journal-open" data-v="' + esc(x.date) + '">' + esc(faDay(x.date)) + '</button>' +
          '<div class="small muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc((x.text || x.events || x.learned || '').split('\n')[0]) + '</div></div></li>';
      }).join('') + '</ul></section>' : '');
  };

  V.settings = function () {
    var s = S.settings, p = s.pomodoro, sg = s.suggest;
    var secRows = s.daySections.map(function (x, i) {
      return '<div class="row" data-sec-row="' + i + '"><input type="text" name="sec_title_' + i + '" value="' + esc(x.title) + '" aria-label="عنوان بخش ' + fa(i + 1) + '" required maxlength="80" style="flex:1;min-width:160px">' +
        '<label class="row small muted" style="gap:6px">ظرفیت<input type="number" name="sec_limit_' + i + '" value="' + x.limit + '" min="1" max="20" style="width:80px" aria-label="ظرفیت بخش ' + fa(i + 1) + '"></label>' +
        (i > 0 ? '<button type="button" class="icon-btn" data-act="sec-up" data-v="' + i + '" aria-label="جابه‌جایی به بالا">' + ico('up') + '</button>' : '<span style="width:44px"></span>') +
        (s.daySections.length > 1 ? '<button type="button" class="icon-btn" data-act="sec-del" data-v="' + i + '" aria-label="حذف بخش">' + ico('close') + '</button>' : '') + '</div>';
    }).join('');
    return '<div class="page-head"><div><h1>تنظیمات</h1><p class="sub">ناوا را مطابق سلیقه و روال خودت تنظیم کن.</p></div></div>' +
      '<form class="card stack" data-form="settings"><h2>ترجیحات</h2><div class="form-grid">' +
      field('نام (برای خوشامد)', input('name', s.name, { extra: ' maxlength="40"' })) +
      field('پوسته', '<select name="theme">' + opts({ system: 'هماهنگ با دستگاه', light: 'روشن', dark: 'تاریک' }, s.theme) + '</select>') +
      field('شروع هفته', '<select name="weekStartDay">' + opts({ 6: 'شنبه', 0: 'یکشنبه', 1: 'دوشنبه' }, String(s.weekStartDay)) + '</select>') + '</div>' +
      '<h3 style="margin-top:8px">الگوی پومودوروی من</h3><div class="form-grid">' +
      field('مدت تمرکز (دقیقه)', input('p_focus', p.focus, { type: 'number', extra: ' min="1" max="300" required' })) +
      field('استراحت کوتاه (دقیقه)', input('p_short', p.shortBreak, { type: 'number', extra: ' min="1" max="120" required' })) +
      field('استراحت بلند (دقیقه)', input('p_long', p.longBreak, { type: 'number', extra: ' min="1" max="180" required' })) +
      field('استراحت بلند بعد از چند جلسه؟', input('p_every', p.longEvery, { type: 'number', extra: ' min="1" max="12" required' })) + '</div>' +
      '<label class="switch"><input type="checkbox" name="sound"' + (s.sound ? ' checked' : '') + '> صدای ملایم پایان جلسه</label>' +
      '<h3 style="margin-top:8px">«الان از کجا شروع کنم؟» چه چیزهایی را در نظر بگیرد؟</h3>' +
      '<label class="switch"><input type="checkbox" name="sg_easy"' + (sg.easyStart ? ' checked' : '') + '> کارهایی که شروعشان ساده است جلوتر بیایند</label>' +
      '<label class="switch"><input type="checkbox" name="sg_goal"' + (sg.goalFocus ? ' checked' : '') + '> کارهایی که به اهداف فعالم کمک می‌کنند جلوتر بیایند</label>' +
      '<label class="switch"><input type="checkbox" name="sg_due"' + (sg.deadlines ? ' checked' : '') + '> مهلت‌ها در نظر گرفته شوند</label>' +
      '<h3 style="margin-top:8px">بخش‌های برنامه</h3><label class="switch"><input type="checkbox" name="sec_learning"' + (s.sections.learning !== false ? ' checked' : '') + '> فضای یادگیری</label>' +
      '<label class="switch"><input type="checkbox" name="sec_journal"' + (s.sections.journal !== false ? ' checked' : '') + '> دفتر شخصی</label>' +
      '<div><button class="btn primary" type="submit">ذخیرهٔ تنظیمات</button></div></form>' +
      '<form class="card section stack" style="margin-top:16px" data-form="day-sections"><h2>بخش‌های داشبورد امروز</h2><p class="muted small" style="margin:0">تعداد، عنوان و ظرفیت بخش‌ها را مطابق نیازت تغییر بده. بخش اول، بخش اصلی برنامهٔ پیشنهادی است.</p>' +
      secRows + '<div class="row"><button type="button" class="btn" data-act="sec-add">+ بخش جدید</button><button type="button" class="btn ghost" data-act="sec-reset">بازگشت به پیش‌فرض</button><span class="spacer"></span><button class="btn primary" type="submit">ذخیرهٔ بخش‌ها</button></div></form>' +
      '<section class="card section stack" style="margin-top:16px"><h2>داده‌ها و حریم خصوصی</h2><p class="muted" style="margin:0">همهٔ اطلاعات فقط روی همین مرورگر و دستگاه ذخیره می‌شود و به هیچ سروری فرستاده نمی‌شود. برای انتقال به دستگاه دیگر یا پشتیبان‌گیری، فایل پشتیبان بگیر.</p>' +
      '<div class="row"><button class="btn" data-act="export">دریافت فایل پشتیبان</button><label class="btn" style="cursor:pointer">بازیابی از فایل<input type="file" id="import-file" accept="application/json,.json" data-chg="import" hidden></label>' +
      '<span class="spacer"></span><button class="btn danger" data-act="wipe">پاک کردن همهٔ داده‌ها</button></div></section>';
  };

  // ---------------- dialog forms ----------------
  function taskDialog(t, preset) {
    var isNew = !t; t = t || Object.assign({ priority: 'medium', energy: 'medium', status: 'todo' }, preset || {});
    var projOpts = opt('', '— بدون پروژه —', !t.projectId) + S.projects.map(function (p) { return opt(p.id, p.title, p.id === t.projectId); }).join('');
    openDialog({
      title: isNew ? 'کار جدید' : 'ویرایش کار', submit: isNew ? 'افزودن' : 'ذخیره',
      body: field('عنوان', input('title', t.title, { extra: ' required maxlength="200" autofocus' })) +
        '<div class="form-grid">' + field('پروژه', '<select name="projectId">' + projOpts + '</select>') +
        field('وضعیت', '<select name="status">' + opts(L.status, t.status) + '</select>') +
        field('اولویت', '<select name="priority">' + opts(L.priority, t.priority) + '</select>') +
        field('انرژی لازم', '<select name="energy">' + opts(L.energy, t.energy) + '</select>') +
        field('زمان تقریبی (دقیقه)', input('estimate', t.estimate, { type: 'number', extra: ' min="0" max="600"' })) +
        field('موعد', dateInput('due', t.due)) + '</div>' +
        field('در برنامهٔ امروز', '<select name="todaySection">' + opt('', '— نه —', t.todayKey !== today()) + daySections().map(function (x) { return opt(x.id, x.title, t.todayKey === today() && sectionOf(t) === x.id); }).join('') + '</select>'),
      danger: isNew ? null : { label: 'حذف کار', run: function () { confirmDo('حذف کار', 'کار «' + esc(t.title) + '» حذف شود؟', null, function () { S.tasks = S.tasks.filter(function (x) { return x.id !== t.id; }); commit(); toast('کار حذف شد'); }); } },
      onSubmit: function (fd) {
        var title = String(fd.get('title') || '').trim(); if (!title) return false;
        var target = isNew ? { id: C.uid(), createdAt: iso(), order: Date.now() } : byId(S.tasks, t.id);
        var prevStatus = target.status;
        Object.assign(target, { title: title, projectId: fd.get('projectId') || null, status: fd.get('status'), priority: fd.get('priority'), energy: fd.get('energy'),
          estimate: Number(fd.get('estimate')) || 0, due: fd.get('due') || '', todayKey: fd.get('todaySection') ? today() : (target.todayKey === today() ? null : target.todayKey), section: fd.get('todaySection') || target.section || null });
        if (target.status === 'done' && prevStatus !== 'done') target.doneAt = iso();
        if (target.status !== 'done') target.doneAt = null;
        if (isNew) S.tasks.push(target);
        commit(); toast(isNew ? 'کار اضافه شد' : 'ذخیره شد');
      },
    });
  }
  function goalDialog(g) {
    var isNew = !g; g = g || { status: 'active' };
    openDialog({
      title: isNew ? 'هدف جدید' : 'ویرایش هدف', submit: isNew ? 'افزودن' : 'ذخیره',
      body: field('هدف', input('title', g.title, { extra: ' required maxlength="200" placeholder="مثلاً: مسلط شدن به جاوااسکریپت"' })) +
        field('چرا برایم مهم است؟', textarea('why', g.why, ' rows="3"')) +
        '<div class="form-grid">' + field('تا چه تاریخی؟', dateInput('deadline', g.deadline)) + field('وضعیت', '<select name="status">' + opts(L.goalStatus, g.status) + '</select>') + '</div>',
      danger: isNew ? null : { label: 'حذف هدف', run: function () { confirmDo('حذف هدف', 'هدف حذف شود؟ پروژه‌های آن باقی می‌مانند و به «بدون هدف» منتقل می‌شوند.', null, function () { S.goals = S.goals.filter(function (x) { return x.id !== g.id; }); S.projects.forEach(function (p) { if (p.goalId === g.id) p.goalId = null; }); commit(); }); } },
      onSubmit: function (fd) {
        var title = String(fd.get('title') || '').trim(); if (!title) return false;
        var target = isNew ? { id: C.uid(), createdAt: iso() } : byId(S.goals, g.id);
        Object.assign(target, { title: title, why: String(fd.get('why') || '').trim(), deadline: fd.get('deadline') || '', status: fd.get('status') });
        if (isNew) S.goals.push(target);
        commit(); toast(isNew ? 'هدف اضافه شد' : 'ذخیره شد');
      },
    });
  }
  function projectDialog(p, goalId) {
    var isNew = !p; p = p || { status: 'active', goalId: goalId || null };
    var gOpts = opt('', '— بدون هدف —', !p.goalId) + S.goals.map(function (g) { return opt(g.id, g.title, g.id === p.goalId); }).join('');
    openDialog({
      title: isNew ? 'پروژهٔ جدید' : 'ویرایش پروژه', submit: isNew ? 'افزودن' : 'ذخیره',
      body: field('نام پروژه', input('title', p.title, { extra: ' required maxlength="200"' })) +
        '<div class="form-grid">' + field('هدف', '<select name="goalId">' + gOpts + '</select>') + field('وضعیت', '<select name="status">' + opts(L.goalStatus, p.status) + '</select>') + field('مهلت (اختیاری)', dateInput('deadline', p.deadline)) + '</div>' +
        (isNew ? field('قدم‌های اول (هر خط یک قدم)', textarea('steps', '', ' rows="4" placeholder="نصب ابزارها\nخواندن فصل اول\nساخت نمونهٔ کوچک"')) : ''),
      danger: isNew ? null : { label: 'حذف پروژه', run: function () { confirmDo('حذف پروژه', 'پروژه و همهٔ قدم‌هایش حذف شوند؟', null, function () { S.projects = S.projects.filter(function (x) { return x.id !== p.id; }); S.tasks = S.tasks.filter(function (t) { return t.projectId !== p.id; }); commit(); }); } },
      onSubmit: function (fd) {
        var title = String(fd.get('title') || '').trim(); if (!title) return false;
        var target = isNew ? { id: C.uid(), createdAt: iso() } : byId(S.projects, p.id);
        Object.assign(target, { title: title, goalId: fd.get('goalId') || null, status: fd.get('status'), deadline: fd.get('deadline') || '' });
        if (isNew) {
          S.projects.push(target);
          String(fd.get('steps') || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (s, i) {
            S.tasks.push({ id: C.uid(), title: s.slice(0, 200), projectId: target.id, status: 'todo', priority: 'medium', energy: 'medium', estimate: 0, due: '', createdAt: iso(), order: Date.now() + i });
          });
        }
        commit(); toast(isNew ? 'پروژه ساخته شد' : 'ذخیره شد');
      },
    });
  }
  function learningDialog(l) {
    var isNew = !l; l = l || { type: 'course', status: 'learning', progress: 0 };
    openDialog({
      title: isNew ? 'منبع یادگیری جدید' : 'ویرایش منبع', submit: isNew ? 'افزودن' : 'ذخیره',
      body: field('عنوان', input('title', l.title, { extra: ' required maxlength="200" placeholder="مثلاً: دورهٔ پایتون مقدماتی"' })) +
        '<div class="form-grid">' + field('نوع', '<select name="type">' + opts(L.learnType, l.type) + '</select>') + field('وضعیت', '<select name="status">' + opts(L.learnStatus, l.status) + '</select>') +
        field('پیشرفت (٪)', input('progress', l.progress || 0, { type: 'number', extra: ' min="0" max="100"' })) + field('لینک (اختیاری)', input('link', l.link, { type: 'url', extra: ' placeholder="https://"' })) + '</div>' +
        field('آخرین جلسه یا مبحث مطالعه‌شده', input('lastTopic', l.lastTopic, { extra: ' maxlength="300"' })) + field('قدم بعدی برای ادامه', input('nextStep', l.nextStep, { extra: ' maxlength="300"' })),
      danger: isNew ? null : { label: 'حذف منبع', run: function () { confirmDo('حذف منبع', 'منبع حذف شود؟ خروجی‌های ثبت‌شده باقی می‌مانند.', null, function () { S.learning = S.learning.filter(function (x) { return x.id !== l.id; }); ui.learnDetail = null; commit(); }); } },
      onSubmit: function (fd) {
        var title = String(fd.get('title') || '').trim(); if (!title) return false;
        var target = isNew ? { id: C.uid(), createdAt: iso(), questions: [], notes: '' } : byId(S.learning, l.id);
        Object.assign(target, { title: title, type: fd.get('type'), status: fd.get('status'), progress: Math.max(0, Math.min(100, Number(fd.get('progress')) || 0)),
          link: String(fd.get('link') || '').trim(), lastTopic: String(fd.get('lastTopic') || '').trim(), nextStep: String(fd.get('nextStep') || '').trim(), updatedAt: iso() });
        if (isNew) S.learning.push(target);
        commit(); toast(isNew ? 'منبع اضافه شد' : 'ذخیره شد');
      },
    });
  }
  function outputFields(o) {
    o = o || {};
    return field('عنوان خروجی', input('out_title', o.title, { extra: (o.required ? ' required' : '') + ' maxlength="200" placeholder="مثلاً: تابع مرتب‌سازی، حل تمرین ۳"' })) +
      '<div class="form-grid">' + field('نوع', '<select name="out_type">' + opts(L.outputType, o.type || 'code') + '</select>') + field('لینک (اختیاری)', input('out_url', '', { type: 'url', extra: ' placeholder="https://"' })) + '</div>' +
      field('کد یا توضیح', '<textarea name="out_text" class="code" spellcheck="false" placeholder="کد، راه‌حل یا توضیح کوتاه…"></textarea>') +
      field('پیوست (کد، فایل پروژه، تصویر نتیجه — چند فایل مجاز است)', '<input type="file" name="out_files" multiple>');
  }
  function storeOutput(fd, link) {
    var title = String(fd.get('out_title') || '').trim();
    var text = String(fd.get('out_text') || '');
    var url = String(fd.get('out_url') || '').trim();
    var files = fd.getAll('out_files').filter(function (f) { return f && f.size > 0; });
    if (!title && !text.trim() && !url && !files.length) return Promise.resolve(null);
    var rec = Object.assign({ id: C.uid(), title: title || (files[0] && files[0].name) || 'خروجی بدون عنوان', type: fd.get('out_type') || 'code', text: text, url: url, files: [], createdAt: iso() }, link || {});
    return Promise.all(files.map(function (f) {
      var fid = C.uid();
      return FileStore.put(fid, f).then(function () { rec.files.push({ fileId: fid, name: f.name, mime: f.type || 'application/octet-stream', size: f.size }); });
    })).then(function () { S.outputs.push(rec); return rec; })
      .catch(function (e) { S.outputs.push(rec); toast('ذخیرهٔ پیوست ممکن نشد'); console.error(e); return rec; });
  }
  function outputDialog(learningId) {
    var lOpts = opt('', '— بدون منبع —', !learningId) + S.learning.map(function (l) { return opt(l.id, l.title, l.id === learningId); }).join('');
    openDialog({
      title: 'ثبت تمرین یا خروجی', submit: 'ثبت',
      body: outputFields({ required: true }) + field('مربوط به منبع یادگیری', '<select name="learningId">' + lOpts + '</select>'),
      onSubmit: function (fd) {
        return storeOutput(fd, { learningId: fd.get('learningId') || null }).then(function (r) { if (!r) { toast('چیزی برای ثبت وارد نشده'); return false; } commit(); toast('خروجی ثبت شد'); });
      },
    });
  }
  function ideaDialog() {
    openDialog({
      title: 'ایده یا مقالهٔ مهم', submit: 'ذخیره',
      body: field('عنوان', input('title', '', { extra: ' required maxlength="200"' })) + '<div class="form-grid">' + field('نوع', '<select name="kind">' + opts(L.ideaKind, 'idea') + '</select>') + field('لینک (اختیاری)', input('url', '', { type: 'url', extra: ' placeholder="https://"' })) + '</div>' + field('توضیح', textarea('text', '', ' rows="3"')),
      onSubmit: function (fd) {
        var title = String(fd.get('title') || '').trim(); if (!title) return false;
        S.ideas.push({ id: C.uid(), title: title, kind: fd.get('kind'), url: String(fd.get('url') || '').trim(), text: String(fd.get('text') || '').trim(), createdAt: iso() });
        commit(); toast('ذخیره شد');
      },
    });
  }
  function pickTodayDialog(secId) {
    var t = today(), list = openTasks().filter(function (x) { return x.todayKey !== t; });
    var sec = daySections().find(function (x) { return x.id === secId; }) || daySections()[0];
    if (!list.length) { toast('کار باز دیگری نیست؛ یک کار تازه اضافه کن'); return; }
    openDialog({
      title: 'افزودن به «' + sec.title + '»', submit: 'افزودن به امروز',
      body: '<p class="muted small" style="margin:0">ظرفیت این بخش: ' + fa(sec.limit) + ' کار.</p><div class="stack">' + list.map(function (x) {
        return '<label class="switch"><input type="checkbox" name="pick" value="' + esc(x.id) + '"> ' + esc(x.title) + (x.projectId ? ' <span class="muted small">· ' + esc(projectName(x.projectId)) + '</span>' : '') + '</label>';
      }).join('') + '</div>',
      onSubmit: function (fd) { fd.getAll('pick').forEach(function (id) { var x = byId(S.tasks, id); if (x) { x.todayKey = t; x.section = sec.id; } }); commit(); },
    });
  }
  var TEMPLATES = [
    { title: 'کسب درآمد', stages: ['یادگیری مهارت‌های موردنیاز', 'ساخت نمونه‌کار', 'تکمیل رزومه یا پروفایل کاری', 'پیدا کردن و گرفتن پروژه', 'انجام پروژه و دریافت درآمد'] },
    { title: 'قبولی و پیشرفت در کارشناسی ارشد هوش مصنوعی', stages: ['مرور مباحث پایه', 'مطالعهٔ دروس تخصصی', 'مطالعهٔ مقالات علمی', 'انجام تمرین‌ها و پروژه‌های مرتبط', 'آمادگی برای امتحان‌ها و ارزیابی پیشرفت'] },
    { title: 'توسعهٔ پروژهٔ شخصی', stages: ['تعریف مسئله و طراحی', 'تعیین امکانات و مراحل اجرا', 'پیاده‌سازی', 'آزمایش و اصلاح', 'تکمیل و انتشار نسخهٔ قابل استفاده'] },
  ];
  function templatesDialog() {
    openDialog({
      title: 'شروع با نمونه‌ها', submit: 'ساختن',
      body: '<p class="muted small" style="margin:0">هر نمونه یک هدف با مراحلش (به‌صورت پروژه) می‌سازد. بعد از ساخته شدن، مراحل را مطابق شرایط خودت تغییر بده و برای هر مرحله قدم‌های کوچک اضافه کن.</p><div class="stack">' +
        TEMPLATES.map(function (tp, i) { return '<label class="switch" style="align-items:flex-start"><input type="checkbox" name="tpl" value="' + i + '"' + (i === 0 ? ' checked' : '') + '><span><b>' + esc(tp.title) + '</b><br><span class="muted small">' + tp.stages.map(esc).join('، ') + '</span></span></label>'; }).join('') + '</div>',
      onSubmit: function (fd) {
        var n = 0;
        fd.getAll('tpl').forEach(function (i) {
          var tp = TEMPLATES[Number(i)]; if (!tp) return;
          var g = { id: C.uid(), title: tp.title, why: '', deadline: '', status: 'active', createdAt: iso() }; S.goals.push(g); n++;
          tp.stages.forEach(function (st, k) { S.projects.push({ id: C.uid(), title: st, goalId: g.id, status: 'active', deadline: '', createdAt: iso(), order: k }); });
        });
        if (!n) { toast('یک نمونه انتخاب کن'); return false; }
        commit(); toast(fa(n) + ' هدف ساخته شد');
      },
    });
  }
  function moreDialog() {
    openDialog({ title: 'بخش‌های دیگر', body: '<div class="stack">' + navVisible().slice(4).map(function (n) { return '<button class="btn" style="justify-content:flex-start" data-act="go" data-v="' + n.id + '">' + n.ico + ' ' + esc(n.label) + '</button>'; }).join('') + '</div>' });
  }

  // ---------------- focus timer ----------------
  function startTimer(minutes, meta) {
    if (S.timer) { toast('یک جلسه در جریان است'); go('focus'); return; }
    meta = Object.assign({ phase: 'focus' }, meta);
    if (meta.phase === 'focus') meta.breakMin = ui.timerSel.breakMin || null;
    ui.offerBreak = null;
    S.timer = C.timerStart(minutes, meta, now());
    if (meta.taskId) { var t = byId(S.tasks, meta.taskId); if (t && t.status === 'todo') t.status = 'doing'; }
    if (S.settings.sound) audioUnlock();
    if ('Notification' in window && Notification.permission === 'default') { try { Notification.requestPermission(); } catch (e) { /* ignore */ } }
    save(); go('focus'); render();
  }
  function finishTimer(natural) {
    var t = S.timer; if (!t) return;
    if (t.phase === 'break') {
      S.timer = null; save(); if (natural) { beep(); notify('استراحت تمام شد. آماده‌ای ادامه بدهی؟'); }
      toast('استراحت تمام شد؛ هر وقت آماده بودی ادامه بده'); render(); return;
    }
    var mins = natural ? t.plannedMin : C.timerElapsedMin(t, now());
    S.pending = { start: new Date(t.startedAt).toISOString(), end: iso(), minutes: mins, plannedMin: t.plannedMin, kind: t.kind || 'work', taskId: t.taskId || null, learningId: t.learningId || null, natural: !!natural, breakMin: t.breakMin || null };
    S.timer = null; save();
    if (natural) { beep(); notify(); }
    render();
    maybeShowPending();
  }
  function maybeShowPending() {
    if (!S.pending || $dlg.open) return;
    var p = S.pending, task = p.taskId && byId(S.tasks, p.taskId), learn = p.learningId && byId(S.learning, p.learningId);
    openDialog({
      title: p.natural ? 'آفرین! جلسه تمام شد' : 'ثبت نتیجهٔ جلسه', submit: 'ذخیرهٔ جلسه', cancelLabel: 'ذخیره بدون جزئیات',
      body: '<div class="form-grid">' + field('مدت (دقیقه)', input('minutes', p.minutes, { type: 'number', extra: ' min="0" max="600" required' })) +
        '<div class="field"><span>روی</span><div style="padding-top:10px">' + esc(task ? task.title : learn ? learn.title : 'جلسهٔ آزاد') + '</div></div></div>' +
        field('در این جلسه چه کردم؟', textarea('note', '', ' rows="2" placeholder="یک جملهٔ کوتاه کافی است"')) +
        (task ? '<label class="switch"><input type="checkbox" name="taskDone"> این کار تمام شد</label>' : '') +
        (learn ? '<div class="form-grid">' + field('آخرین مبحث مطالعه‌شده', input('lastTopic', learn.lastTopic, { extra: ' maxlength="300"' })) + field('قدم بعدی', input('nextStep', learn.nextStep, { extra: ' maxlength="300"' })) + '</div>' : '') +
        '<details class="more"' + (p.kind === 'study' || task ? ' open' : '') + '><summary>ثبت خروجی این جلسه (کد، فایل، تصویر…)</summary><div class="stack">' + outputFields({ type: p.kind === 'study' ? 'problem' : 'code' }) + '</div></details>',
      danger: { label: 'حذف این جلسه', run: function () { S.pending = null; commit(); toast('جلسه ثبت نشد'); } },
      onSubmit: function (fd) {
        var sess = { id: C.uid(), start: p.start, end: p.end, plannedMin: p.plannedMin, minutes: Math.max(0, Math.round(Number(fd.get('minutes')) || 0)), kind: p.kind, taskId: p.taskId, learningId: p.learningId, note: String(fd.get('note') || '').trim() };
        if (task && fd.get('taskDone')) { task.status = 'done'; task.doneAt = iso(); }
        if (learn) { learn.lastTopic = String(fd.get('lastTopic') || '').trim(); learn.nextStep = String(fd.get('nextStep') || '').trim(); learn.updatedAt = iso(); }
        return storeOutput(fd, { sessionId: sess.id, taskId: p.taskId, learningId: p.learningId }).then(function (out) {
          S.sessions.push(sess); S.pending = null; offerBreak(p); commit(); toast(out ? 'جلسه و خروجی ثبت شد' : 'جلسه ثبت شد');
        });
      },
      onCancel: function () {
        if (!S.pending) return;
        S.sessions.push({ id: C.uid(), start: p.start, end: p.end, plannedMin: p.plannedMin, minutes: p.minutes, kind: p.kind, taskId: p.taskId, learningId: p.learningId, note: '' });
        S.pending = null; offerBreak(p); commit(); toast('جلسه ثبت شد');
      },
    });
  }
  function offerBreak(p) {
    var nb = C.nextBreak(S, today());
    ui.offerBreak = { minutes: nb.long ? nb.minutes : (p.breakMin || nb.minutes), long: nb.long };
  }
  var actx = null;
  function audioUnlock() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) { actx = null; } }
  function beep() {
    if (!S.settings.sound) return;
    try {
      audioUnlock(); if (!actx) return;
      [0, 0.35, 0.7].forEach(function (d) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.frequency.value = 660; g.gain.setValueAtTime(0.0001, actx.currentTime + d);
        g.gain.exponentialRampToValueAtTime(0.2, actx.currentTime + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d + 0.3);
        o.connect(g); g.connect(actx.destination); o.start(actx.currentTime + d); o.stop(actx.currentTime + d + 0.32);
      });
    } catch (e) { /* ignore */ }
  }
  function notify(msg) { try { if ('Notification' in window && Notification.permission === 'granted') new Notification('ناوا', { body: msg || 'زمان جلسهٔ تمرکز تمام شد. چه چیزی ساختی؟', icon: 'icon.svg' }); } catch (e) { /* ignore */ } }
  var baseTitle = document.title;
  function tick() {
    var t = S.timer, mini = document.getElementById('mini-timer');
    var bl = document.querySelector('#nav-bottom [data-v="focus"] span:last-child');
    if (!t) { mini.hidden = true; document.title = baseTitle; if (bl) bl.textContent = 'تمرکز'; return; }
    if (C.timerDone(t, now())) { finishTimer(true); return; }
    var rem = C.timerRemaining(t, now()), clk = C.clock(rem);
    var el = document.getElementById('t-time'); if (el) el.textContent = clk;
    var bar = document.getElementById('ring-bar');
    if (bar) { var c = 2 * Math.PI * 54; bar.setAttribute('stroke-dashoffset', (c * (1 - rem / (t.plannedMin * 60000))).toFixed(1)); }
    mini.hidden = ui.view === 'focus';
    mini.innerHTML = '<a href="#focus" style="color:inherit;text-decoration:none"><span class="muted">' + (t.phase === 'break' ? 'استراحت' : t.status === 'paused' ? 'متوقف' : 'در حال تمرکز') + '</span><b>' + clk + '</b></a>';
    document.title = clk + ' · ناوا';
    if (bl) bl.textContent = clk;
  }

  // ---------------- export / import ----------------
  function blobToDataUrl(b) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; r.readAsDataURL(b); }); }
  function exportData() {
    var ids = []; S.outputs.forEach(function (o) { (o.files || []).forEach(function (f) { ids.push(f); }); });
    var files = {};
    return Promise.all(ids.map(function (f) {
      return FileStore.get(f.fileId).then(function (b) { if (b) return blobToDataUrl(b).then(function (d) { files[f.fileId] = { name: f.name, mime: f.mime, data: d }; }); }).catch(function () { /* skip */ });
    })).then(function () {
      var data = JSON.stringify({ app: 'nava', format: 1, exportedAt: iso(), state: S, files: files });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = 'nava-backup-' + today() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      toast('فایل پشتیبان آماده شد');
    });
  }
  function importData(file) {
    return file.text().then(function (txt) {
      var data = JSON.parse(txt);
      if (!data || data.app !== 'nava' || !data.state) throw new Error('این فایل پشتیبان ناوا نیست');
      var st = C.normalizeState(data.state);
      return FileStore.clear().catch(function () {}).then(function () {
        return Promise.all(Object.keys(data.files || {}).map(function (id) {
          return fetch(data.files[id].data).then(function (r) { return r.blob(); }).then(function (b) { return FileStore.put(id, b); }).catch(function () {});
        }));
      }).then(function () { S = st; urlCache = {}; applyTheme(); commit(); toast('اطلاعات بازیابی شد'); });
    }).catch(function (e) { toast('بازیابی ناموفق: ' + e.message); });
  }

  // ---------------- actions ----------------
  var ACT = {
    go: function (el) { closeDialog(); go(el.dataset.v); },
    more: function () { moreDialog(); },
    suggest: function () { ui.skip = []; suggest(); },
    'suggest-other': function () { if (ui.suggestion && ui.suggestion.taskId) ui.skip.push(ui.suggestion.taskId); suggest(); },
    'close-suggest': function () { ui.suggestion = null; render(); },
    'start-suggested': function () { var s = ui.suggestion; if (!s) return; ui.suggestion = null; startTimer(s.minutes, { kind: 'work', taskId: s.taskId }); },
    'set-daytype': function (el) { var t = today(), d = S.days[t] || {}; S.days[t] = Object.assign({}, d, { type: d.type === el.dataset.v ? null : el.dataset.v }); if (ui.suggestion && !ui.suggestion.empty) { ui.skip = []; suggest(true); return; } commit(); },
    'set-available': function (el) { var t = today(), d = S.days[t] || {}, v = Number(el.dataset.v); S.days[t] = Object.assign({}, d, { available: Number(d.available) === v ? null : v }); if (ui.suggestion && !ui.suggestion.empty) { ui.skip = []; suggest(true); return; } commit(); },
    'plan-day': function () { planToday(false); },
    'plan-light': function () { planToday(true); },
    'cb-dismiss': function () { var t = today(); S.days[t] = Object.assign({}, S.days[t], { cbDismissed: true }); commit(); },
    'set-mood': function (el) { var t = today(); S.days[t] = Object.assign({}, S.days[t], { mood: Number(el.dataset.v) }); commit(); },
    'new-task': function () { taskDialog(null); },
    'edit-task': function (el) { var t = byId(S.tasks, el.dataset.id); if (t) taskDialog(t); },
    'pick-today': function (el) { pickTodayDialog(el.dataset.sec); },
    pin: function (el) { var t = byId(S.tasks, el.dataset.id); if (t) { t.todayKey = today(); t.section = daySections()[0].id; commit(); toast('به «' + daySections()[0].title + '» اضافه شد'); } },
    unpin: function (el) { var t = byId(S.tasks, el.dataset.id); if (t) { t.todayKey = null; commit(); } },
    'sec-add': function () { harvestSections(); S.settings.daySections.push({ id: C.uid(), title: 'بخش جدید', limit: 3 }); commit(); var ins = document.querySelectorAll('[data-form="day-sections"] input[type=text]'); if (ins.length) { ins[ins.length - 1].focus(); ins[ins.length - 1].select(); } },
    'sec-del': function (el) {
      harvestSections(); var i = Number(el.dataset.v), arr = S.settings.daySections; if (arr.length < 2) return;
      var gone = arr.splice(i, 1)[0]; S.tasks.forEach(function (t) { if (t.section === gone.id) t.section = arr[0].id; }); commit(); toast('بخش حذف شد؛ کارهایش به «' + arr[0].title + '» رفت');
    },
    'sec-up': function (el) { harvestSections(); var i = Number(el.dataset.v), arr = S.settings.daySections; if (i < 1) return; var x = arr[i]; arr[i] = arr[i - 1]; arr[i - 1] = x; commit(); },
    'sec-reset': function () { confirmDo('بازگشت به پیش‌فرض', 'بخش‌های داشبورد به حالت اولیه برگردند؟', 'بله', function () { S.settings.daySections = C.defaultDaySections(); commit(); }); },
    'new-goal': function () { goalDialog(null); },
    'edit-goal': function (el) { goalDialog(byId(S.goals, el.dataset.id)); },
    'new-project': function (el) { projectDialog(null, el.dataset.goalId); },
    'edit-project': function (el) { projectDialog(byId(S.projects, el.dataset.id)); },
    'set-next': function (el) { var t = byId(S.tasks, el.dataset.id); var p = t && byId(S.projects, t.projectId); if (p) { p.nextTaskId = t.id; commit(); toast('قدم بعدی تعیین شد'); } },
    'step-up': function (el) {
      var t = byId(S.tasks, el.dataset.id); if (!t) return;
      var ts = C.projectTasks(S, t.projectId), i = ts.indexOf(t); if (i < 1) return;
      ts.forEach(function (x, k) { x.order = k; }); ts[i].order = i - 1; ts[i - 1].order = i; commit();
      var det = document.querySelector('[data-project="' + t.projectId + '"] details'); if (det) det.open = true;
    },
    templates: function () { templatesDialog(); },
    'focus-task': function (el) { var t = byId(S.tasks, el.dataset.id); if (!t) return; ui.timerSel = { kind: 'work', taskId: t.id, learningId: '', minutes: Number(t.estimate) > 0 ? Math.min(Number(t.estimate), 60) : null }; ui.focusTab = 'timer'; go('focus'); },
    preset: function (el) { ui.timerSel.minutes = Number(el.dataset.v); render(); },
    kind: function (el) { ui.timerSel.kind = el.dataset.v; render(); },
    'timer-start': function () {
      var inp = document.getElementById('focus-min'); var m = Number(inp && inp.value) || ui.timerSel.minutes || S.settings.pomodoro.focus;
      var bi = document.getElementById('break-min'); var bm = Math.round(Number(bi && bi.value)); if (bm >= 1 && bm <= 120) ui.timerSel.breakMin = bm;
      if (m < 1 || m > 300) { toast('مدت باید بین ۱ تا ۳۰۰ دقیقه باشد'); return; }
      var sel = ui.timerSel;
      startTimer(m, { kind: sel.kind, taskId: sel.kind === 'work' ? sel.taskId || null : null, learningId: sel.kind === 'study' ? sel.learningId || null : null });
    },
    'focus-tab': function (el) { ui.focusTab = el.dataset.v; render(); },
    'report-range': function (el) { ui.report = Object.assign({}, ui.report, { range: el.dataset.v }); render(); },
    'break-start': function () { var b = ui.offerBreak; if (!b) return; startTimer(b.minutes, { phase: 'break', kind: 'break' }); },
    'break-skip': function () { ui.offerBreak = null; render(); },
    'break-end': function () { finishTimer(false); },
    'timer-pause': function () { S.timer = C.timerPause(S.timer, now()); commit(); },
    'timer-resume': function () { S.timer = C.timerResume(S.timer, now()); commit(); },
    'timer-finish': function () { finishTimer(false); },
    'timer-cancel': function () { confirmDo('لغو جلسه', 'جلسهٔ فعلی بدون ثبت لغو شود؟', 'بله، لغو شود', function () { S.timer = null; commit(); }); },
    'del-session': function (el) { confirmDo('حذف جلسه', 'این جلسه حذف شود؟', null, function () { S.sessions = S.sessions.filter(function (s) { return s.id !== el.dataset.id; }); commit(); }); },
    week: function (el) { var v = Number(el.dataset.v); ui.weekOffset = v === 0 ? 0 : Math.min(0, ui.weekOffset + v); render(); },
    'learn-tab': function (el) { ui.learnTab = el.dataset.v; render(); },
    'new-learning': function () { learningDialog(null); },
    'edit-learning': function (el) { learningDialog(byId(S.learning, el.dataset.id)); },
    'learn-open': function (el) { ui.learnDetail = el.dataset.id; render(); window.scrollTo(0, 0); },
    'learn-back': function () { ui.learnDetail = null; render(); },
    study: function (el) { ui.timerSel = { kind: 'study', taskId: '', learningId: el.dataset.id, minutes: null }; ui.focusTab = 'timer'; go('focus'); },
    'del-q': function (el) { var l = byId(S.learning, ui.learnDetail); if (!l) return; l.questions = l.questions.filter(function (q) { return q.id !== el.dataset.id; }); commit(); },
    'new-output': function (el) { outputDialog(el.dataset.learning || (ui.learnDetail || '')); },
    'del-output': function (el) {
      confirmDo('حذف خروجی', 'این خروجی و پیوست‌هایش حذف شوند؟', null, function () {
        var o = byId(S.outputs, el.dataset.id); if (o) (o.files || []).forEach(function (f) { FileStore.del(f.fileId).catch(function () {}); });
        S.outputs = S.outputs.filter(function (x) { return x.id !== el.dataset.id; }); commit();
      });
    },
    'open-file': function (el) {
      FileStore.get(el.dataset.id).then(function (b) {
        if (!b) { toast('فایل پیدا نشد'); return; }
        var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = el.dataset.name || 'file';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      }).catch(function () { toast('خواندن فایل ممکن نشد'); });
    },
    'new-idea': ideaDialog,
    'del-idea': function (el) { S.ideas = S.ideas.filter(function (x) { return x.id !== el.dataset.id; }); commit(); },
    'journal-open': function (el) { ui.journalDate = el.dataset.v; render(); window.scrollTo(0, 0); },
    'journal-today': function () { ui.journalDate = null; render(); },
    export: function () { exportData().catch(function (e) { toast('خطا در خروجی: ' + e.message); }); },
    wipe: function () {
      confirmDo('پاک کردن همه‌چیز', 'همهٔ اهداف، کارها، جلسات، خروجی‌ها و یادداشت‌ها برای همیشه پاک شوند؟ پیشنهاد می‌شود اول فایل پشتیبان بگیری.', 'بله، همه پاک شود', function () {
        S = C.defaultState(); FileStore.clear().catch(function () {}); applyTheme(); commit(); toast('همهٔ داده‌ها پاک شد');
      });
    },
  };
  function planToday(light) {
    var c = dayCtx();
    var r = C.planDay(S, { today: c.today, dayType: c.dayType, available: c.available, light: light, skip: todayTasks(c.today).map(function (x) { return x.id; }) });
    var main = daySections()[0];
    var already = todayTasks(c.today).filter(function (x) { return sectionOf(x) === main.id && x.status !== 'done'; }).length;
    var room = Math.max(0, Math.min(main.limit, r.max) - already);
    var chosen = r.tasks.slice(0, room);
    chosen.forEach(function (x) { x.todayKey = c.today; x.section = main.id; });
    if (light) S.days[c.today] = Object.assign({}, S.days[c.today], { cbDismissed: true });
    commit();
    toast(chosen.length ? fa(chosen.length) + ' کار برای امروز چیده شد؛ حدود ' + C.duration(chosen.reduce(function (a, x) { return a + (Number(x.estimate) || 25); }, 0)) : (room ? 'کار بازی برای پیشنهاد نیست' : 'برنامهٔ امروز پر است؛ همین کافی است'));
  }
  function suggest(keepOpen) {
    var c = dayCtx();
    var base = { today: c.today, energy: c.energy, available: c.available };
    var r = C.suggestNext(S, Object.assign({ skip: ui.skip }, base));
    if (!r && ui.skip.length) { ui.skip = []; r = C.suggestNext(S, base); }
    ui.suggestion = r ? { taskId: r.task.id, reasons: r.reasons, minutes: r.minutes, remaining: r.remaining } : { empty: true };
    if (keepOpen) commit(); else render();
  }
  function handleAct(e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var fn = ACT[el.dataset.act]; if (!fn) return;
    e.preventDefault(); fn(el, e);
  }
  document.addEventListener('click', function (e) { if (e.target.closest('#dlg')) return; handleAct(e); });

  document.addEventListener('change', function (e) {
    var el = e.target, k = el.dataset && el.dataset.chg; if (!k) return;
    if (k === 'toggle-task') {
      var t = byId(S.tasks, el.dataset.id); if (!t) return;
      t.status = el.checked ? 'done' : 'todo'; t.doneAt = el.checked ? iso() : null;
      commit(); if (el.checked) toast('آفرین! یک قدم جلوتر');
    } else if (k === 'toggle-q') {
      var l = byId(S.learning, ui.learnDetail); var q = l && l.questions.find(function (x) { return x.id === el.dataset.id; });
      if (q) { q.resolved = el.checked; commit(); }
    } else if (k === 'custom-min') { var m = Number(el.value); if (m >= 1 && m <= 300) { ui.timerSel.minutes = Math.round(m); render(); } }
    else if (k === 'break-min') { var bm = Number(el.value); if (bm >= 1 && bm <= 120) ui.timerSel.breakMin = Math.round(bm); }
    else if (k === 'sel-task') { ui.timerSel.taskId = el.value; }
    else if (k === 'sel-learning') { ui.timerSel.learningId = el.value; }
    else if (k === 'import') { if (el.files[0]) importData(el.files[0]); el.value = ''; }
  });
  document.addEventListener('toggle', function (e) { var d = e.target; if (d.dataset && d.dataset.toggle) ui[d.dataset.toggle] = d.open; }, true);

  document.addEventListener('submit', function (e) {
    var f = e.target; if (f.closest('#dlg')) return;
    var kind = f.dataset.form; if (!kind) return;
    e.preventDefault();
    var fd = new FormData(f);
    if (kind === 'add-today') {
      var title = String(fd.get('title') || '').trim(); if (!title) return;
      var sec = f.dataset.sec, isFirst = daySections()[0].id === sec, isOpt = sec === 'optional' || sec === 'rest';
      S.tasks.push({ id: C.uid(), title: title.slice(0, 200), projectId: null, status: 'todo', priority: isFirst ? 'high' : isOpt ? 'low' : 'medium', energy: sec === 'rest' ? 'low' : 'medium', estimate: 0, due: '', todayKey: today(), section: sec, createdAt: iso(), order: Date.now() });
      commit(); focusSel('[data-form="add-today"][data-sec="' + sec + '"] input');
    } else if (kind === 'add-step') {
      var st = String(fd.get('title') || '').trim(); if (!st) return;
      var pid = f.dataset.project;
      S.tasks.push({ id: C.uid(), title: st.slice(0, 200), projectId: pid, status: 'todo', priority: 'medium', energy: 'medium', estimate: 0, due: '', createdAt: iso(), order: Date.now() });
      commit();
      var det = document.querySelector('[data-project="' + pid + '"] details'); if (det) det.open = true;
      focusSel('[data-form="add-step"][data-project="' + pid + '"] input');
    } else if (kind === 'report-custom') {
      ui.report = { range: 'custom', from: fd.get('from'), to: fd.get('to') }; render();
    } else if (kind === 'review') {
      var ws = f.dataset.week, rv = S.reviews.find(function (r) { return r.weekStart === ws; });
      var stats = C.weekStats(S, ws);
      var data = { wentWell: fd.get('wentWell'), obstacles: fd.get('obstacles'), change: fd.get('change'), nextPlan: fd.get('nextPlan'), updatedAt: iso(),
        stats: { focusMinutes: stats.focusMinutes, sessions: stats.sessions, tasksDone: stats.doneTasks.length, outputs: stats.outputs.length } };
      if (rv) Object.assign(rv, data); else S.reviews.push(Object.assign({ id: C.uid(), weekStart: ws, createdAt: iso() }, data));
      commit(); toast('مرور هفته ذخیره شد');
    } else if (kind === 'add-q') {
      var l = byId(S.learning, ui.learnDetail); var tx = String(fd.get('text') || '').trim(); if (!l || !tx) return;
      l.questions.push({ id: C.uid(), text: tx.slice(0, 300), resolved: false, createdAt: iso() }); commit(); focusSel('[data-form="add-q"] input');
    } else if (kind === 'learn-notes') {
      var l2 = byId(S.learning, ui.learnDetail); if (!l2) return; l2.notes = String(fd.get('notes') || ''); l2.updatedAt = iso(); commit(); toast('یادداشت ذخیره شد');
    } else if (kind === 'journal') {
      var date = f.dataset.date, j = S.journal.find(function (x) { return x.date === date; });
      var jd = { mood: Number(fd.get('mood')) || null, energy: Number(fd.get('energy')) || null, text: String(fd.get('text') || ''), events: String(fd.get('events') || ''), learned: String(fd.get('learned') || ''), updatedAt: iso() };
      if (j) Object.assign(j, jd); else S.journal.push(Object.assign({ id: C.uid(), date: date, createdAt: iso() }, jd));
      commit(); toast('در دفتر ثبت شد');
    } else if (kind === 'settings') {
      var num = function (k, lo, hi, d) { var v = Math.round(Number(fd.get(k))); return v >= lo && v <= hi ? v : d; };
      var pomo = { focus: num('p_focus', 1, 300, 25), shortBreak: num('p_short', 1, 120, 5), longBreak: num('p_long', 1, 180, 15), longEvery: num('p_every', 1, 12, 4) };
      Object.assign(S.settings, { name: String(fd.get('name') || '').trim(), theme: fd.get('theme'), weekStartDay: Number(fd.get('weekStartDay')), sound: !!fd.get('sound'),
        pomodoro: pomo, focusMinutes: pomo.focus, suggest: { easyStart: !!fd.get('sg_easy'), goalFocus: !!fd.get('sg_goal'), deadlines: !!fd.get('sg_due') },
        sections: { learning: !!fd.get('sec_learning'), journal: !!fd.get('sec_journal') } });
      ui.timerSel.minutes = null; ui.timerSel.breakMin = null; applyTheme(); commit(); toast('تنظیمات ذخیره شد');
    } else if (kind === 'day-sections') {
      harvestSections(); commit(); toast('بخش‌ها ذخیره شد');
    }
  });
  function harvestSections() {
    var f = document.querySelector('[data-form="day-sections"]'); if (!f) return;
    S.settings.daySections.forEach(function (x, i) {
      var ti = f.querySelector('[name="sec_title_' + i + '"]'), li = f.querySelector('[name="sec_limit_' + i + '"]');
      if (ti && ti.value.trim()) x.title = ti.value.trim().slice(0, 80);
      if (li) { var v = Math.round(Number(li.value)); if (v >= 1 && v <= 20) x.limit = v; }
    });
  }
  function focusSel(sel) { var el = document.querySelector(sel); if (el) el.focus(); }

  // ---------------- render ----------------
  function applyTheme() {
    var t = S.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  function render() {
    var nv = navVisible();
    if (!nv.some(function (n) { return n.id === ui.view; })) ui.view = 'today';
    renderNav();
    $main.innerHTML = (V[ui.view] || V.today)();
    $main.querySelectorAll('img[data-file]').forEach(function (img) { fileUrl(img.dataset.file).then(function (u) { if (u) img.src = u; }).catch(function () {}); });
    tick();
  }

  // storage sync across tabs
  window.addEventListener('storage', function (e) { if (e.key === KEY) { S = load(); applyTheme(); render(); } });

  applyTheme();
  ui.view = (location.hash || '#today').slice(1);
  if (!NAV.some(function (n) { return n.id === ui.view; })) ui.view = 'today';
  render();
  setInterval(tick, 500);
  document.addEventListener('visibilitychange', tick);
  if (S.timer && C.timerDone(S.timer, now())) finishTimer(true); else maybeShowPending();
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(function () {});

  window.__nava = { state: function () { return S; }, reload: function () { S = load(); render(); } };
})();
