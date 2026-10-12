// End-to-end browser tests for the Nava web app (Playwright + Chromium).
// Run: node tests/e2e.mjs   (optional env: CHROMIUM=/path/to/chromium, SHOTS=dir)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serve } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.SHOTS || path.join(here, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHklEQVR4nGNgGAWjYBSMglEwCkbBKBgFo2AUDAoAAAQQAAFnRxwHAAAAAElFTkSuQmCC', 'base64');

let pass = 0, fail = 0; const failures = [];
async function step(name, fn) {
  try { await fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; failures.push(name); console.log('  ✖ ' + name + '\n      ' + String(e && e.message || e).split('\n').slice(0, 4).join('\n      ')); }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }

async function launch() {
  try { return await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}); }
  catch { return await chromium.launch({ executablePath: '/usr/local/bin/chromium' }); }
}
const browser = await launch();
const srv = await serve(0);
const BASE = 'http://127.0.0.1:' + srv.address().port + '/index.html';
const errors = [];
function watch(page, tag) {
  page.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ' console: ' + m.text()); });
}
const START = new Date(2026, 9, 11, 10, 0, 0);
const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('nava.v1')));
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function submitDialog(page) { await page.locator('#dlg button[type=submit]').click(); await page.waitForFunction(() => !document.getElementById('dlg').open); }

console.log('Nava web app — end-to-end tests');
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'fa-IR', timezoneId: 'Asia/Tehran', acceptDownloads: true, colorScheme: 'light' });
const page = await ctx.newPage(); watch(page, 'desktop');
await page.clock.install({ time: START });
await page.goto(BASE);

await step('loads with RTL layout, 7 sections in sidebar, no errors', async () => {
  assert(await page.title() === 'ناوا');
  assert(await page.getAttribute('html', 'dir') === 'rtl');
  assert(await page.locator('#nav-side .nav-item').count() === 7);
  assert(await page.locator('[data-testid=sections] section[data-section]').count() === 5, 'five default dashboard sections');
  assert(await page.getByRole('button', { name: 'الان از کجا شروع کنم؟' }).isVisible());
});

await step('suggestion with no tasks gives a friendly empty state', async () => {
  await page.getByRole('button', { name: 'الان از کجا شروع کنم؟' }).click();
  await page.getByText('هنوز کار بازی نداری').waitFor();
  await page.getByRole('button', { name: 'بستن', exact: true }).click();
});

await step('goal templates create the three example goals with their stages', async () => {
  await page.goto(BASE + '#goals');
  await page.getByRole('button', { name: 'شروع با نمونه‌ها' }).click();
  await page.locator('#dlg input[name=tpl][value="1"]').check();
  await page.locator('#dlg input[name=tpl][value="2"]').check();
  await submitDialog(page);
  assert(await page.locator('section[data-goal]').count() === 3, 'three goals');
  assert(await page.locator('section[data-goal]').first().locator('div[data-project]').count() === 5, 'five stages');
  await page.getByText('قبولی و پیشرفت در کارشناسی ارشد هوش مصنوعی').waitFor();
});

await step('project with steps: progress, next step, reorder and mark done', async () => {
  await page.locator('.page-head').getByRole('button', { name: 'پروژهٔ جدید' }).click();
  await page.locator('#dlg input[name=title]').fill('ساخت سایت نمونه‌کار');
  const goalId = (await state(page)).goals.find((g) => g.title === 'کسب درآمد').id;
  await page.locator('#dlg select[name=goalId]').selectOption(goalId);
  await page.locator('#dlg input[name=deadline]').fill('2026-12-01');
  await page.locator('#dlg textarea[name=steps]').fill('طراحی صفحهٔ اصلی\nنوشتن متن معرفی\nانتشار سایت');
  await submitDialog(page);
  const proj = page.locator('div[data-project]', { hasText: 'ساخت سایت نمونه‌کار' });
  await proj.getByText('طراحی صفحهٔ اصلی').first().waitFor();
  await proj.locator('summary').click();
  await proj.locator('[data-task]', { hasText: 'طراحی صفحهٔ اصلی' }).locator('input.check').check();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('nava.v1')).tasks.some((t) => t.title === 'طراحی صفحهٔ اصلی' && t.status === 'done'));
  const proj2 = page.locator('div[data-project]', { hasText: 'ساخت سایت نمونه‌کار' });
  assert((await proj2.textContent()).includes('۱/۳'), 'shows 1/3');
  assert((await proj2.locator('.row').filter({ hasText: 'قدم بعدی:' }).textContent()).includes('نوشتن متن معرفی'), 'next step advanced');
  await proj2.locator('summary').click();
  await proj2.locator('[data-task]', { hasText: 'انتشار سایت' }).getByRole('button', { name: 'قدم بعدی شود' }).click();
  assert((await page.locator('div[data-project]', { hasText: 'ساخت سایت نمونه‌کار' }).locator('.row').filter({ hasText: 'قدم بعدی:' }).textContent()).includes('انتشار سایت'));
  const p3 = page.locator('div[data-project]', { hasText: 'ساخت سایت نمونه‌کار' });
  if (!(await p3.locator('details').evaluate((d) => d.open))) await p3.locator('summary').click();
  await p3.locator('[data-task]', { hasText: 'انتشار سایت' }).getByRole('button', { name: 'جابه‌جایی به بالا' }).click();
  const order = (await state(page)).tasks.filter((t) => t.projectId).sort((a, b) => a.order - b.order).map((t) => t.title);
  assert(order.indexOf('انتشار سایت') < order.indexOf('نوشتن متن معرفی'), 'step moved up: ' + order.join(','));
  await page.screenshot({ path: path.join(SHOTS, 'desktop-goals.png'), fullPage: false });
});

await step('task dialog: create a detailed task with estimate, energy and deadline', async () => {
  await page.goto(BASE + '#today');
  await page.locator('details[data-toggle=openOthers] summary').click();
  await page.getByRole('button', { name: 'کار جدید با جزئیات' }).click();
  await page.locator('#dlg input[name=title]').fill('خواندن مقالهٔ ترنسفورمر');
  await page.locator('#dlg select[name=priority]').selectOption('high');
  await page.locator('#dlg select[name=energy]').selectOption('low');
  await page.locator('#dlg input[name=estimate]').fill('20');
  await page.locator('#dlg input[name=due]').fill('2026-10-09');
  await submitDialog(page);
  const t = (await state(page)).tasks.find((x) => x.title === 'خواندن مقالهٔ ترنسفورمر');
  assert(t && t.estimate === 20 && t.energy === 'low' && t.due === '2026-10-09' && !t.todayKey);
  assert((await page.locator('[data-task]', { hasText: 'خواندن مقالهٔ ترنسفورمر' }).textContent()).includes('موعد گذشته'), 'gentle overdue tag');
});

await step('dashboard sections: inline add respects capacity', async () => {
  const main = page.locator('[data-section=main]');
  for (const title of ['تمرین درس یادگیری ماشین', 'ارسال رزومه', 'ورزش سبک']) {
    await main.locator('input[name=title]').fill(title);
    await main.locator('input[name=title]').press('Enter');
    await page.locator('[data-section=main] [data-task]', { hasText: title }).waitFor();
  }
  assert(await page.locator('[data-section=main] form').count() === 0, 'form hidden when section is full');
  assert((await page.locator('[data-section=main] .tag').first().textContent()).includes('۳ از ۳'));
  const uni = page.locator('[data-section=uni]');
  await uni.locator('input[name=title]').fill('حل تمرین آمار');
  await uni.locator('input[name=title]').press('Enter');
  await page.locator('[data-section=uni] [data-task]', { hasText: 'حل تمرین آمار' }).waitFor();
});

await step('day type + available time drive “where do I start?”', async () => {
  await page.getByRole('button', { name: 'کم‌انرژی' }).click();
  await page.getByRole('button', { name: '۳۰ دقیقه' }).click();
  const d = (await state(page)).days['2026-10-11'];
  assert(d.type === 'low' && d.available === 30, JSON.stringify(d));
  await page.getByRole('button', { name: 'الان از کجا شروع کنم؟' }).click();
  const sug = page.getByTestId('suggestion');
  await sug.waitFor();
  assert((await sug.locator('.task-name').textContent()).includes('خواندن مقالهٔ ترنسفورمر'), 'short, low-energy, overdue task wins: ' + await sug.locator('.task-name').textContent());
  assert(await sug.locator('.why li').count() >= 1);
  assert((await sug.getByRole('button', { name: /شروع تمرکز/ }).textContent()).includes('۲۰'));
  await sug.getByRole('button', { name: 'پیشنهاد دیگر' }).click();
  assert(!(await page.getByTestId('suggestion').locator('.task-name').textContent()).includes('خواندن مقالهٔ ترنسفورمر'), 'another suggestion');
  await page.screenshot({ path: path.join(SHOTS, 'desktop-today.png'), fullPage: true });
});

await step('plan day fills main section realistically and never overflows it', async () => {
  await page.getByTestId('suggestion').getByRole('button', { name: 'بستن' }).click();
  await page.getByRole('button', { name: 'معمولی' }).click();
  await page.getByRole('button', { name: 'چیدن برنامهٔ پیشنهادی' }).click();
  await page.locator('#toast.show').filter({ hasText: 'برنامهٔ امروز پر است' }).waitFor();
  await page.locator('[data-section=main] [data-task]', { hasText: 'ورزش سبک' }).getByRole('button', { name: 'برداشتن از امروز' }).click();
  await page.getByRole('button', { name: 'چیدن برنامهٔ پیشنهادی' }).click();
  await page.locator('#toast.show').filter({ hasText: 'کار برای امروز چیده شد' }).waitFor();
  const s = await state(page);
  const main = s.tasks.filter((t) => t.todayKey === '2026-10-11' && (t.section || 'main') === 'main' && t.status !== 'done');
  assert(main.length <= 3 && main.length >= 2, 'main has ' + main.length);
  assert(s.tasks.find((t) => t.title === 'ورزش سبک').status === 'todo', 'removed task still in list');
});

await step('focus: start from suggestion, pause survives reload, resume', async () => {
  await page.getByRole('button', { name: 'الان از کجا شروع کنم؟' }).click();
  const name = (await page.getByTestId('suggestion').locator('.task-name').textContent()).trim();
  await page.getByTestId('suggestion').getByRole('button', { name: /شروع تمرکز/ }).click();
  await page.waitForURL(/#focus/);
  await page.getByRole('button', { name: 'توقف موقت' }).waitFor();
  assert((await page.locator('.timer-wrap').textContent()).includes(name));
  await page.clock.fastForward(5 * 60000);
  await page.getByRole('button', { name: 'توقف موقت' }).click();
  const t1 = await page.locator('#t-time').textContent();
  await page.reload();
  await page.getByRole('button', { name: 'ادامه' }).waitFor();
  assert((await page.locator('#t-time').textContent()) === t1, 'same remaining after reload: ' + t1);
  await page.getByRole('button', { name: 'ادامه' }).click();
  await page.locator('#mini-timer').waitFor({ state: 'hidden' });
  await page.screenshot({ path: path.join(SHOTS, 'desktop-focus-running.png') });
  page.__task = name;
});

await step('timer end → record result with code, files and done; break offer follows', async () => {
  await page.clock.fastForward(40 * 60000);
  await page.locator('#dlg[open]').waitFor();
  assert((await page.locator('#dlg h2').textContent()).includes('جلسه تمام شد'));
  await page.locator('#dlg textarea[name=note]').fill('بخش اول را تمام کردم');
  await page.locator('#dlg input[name=out_title]').fill('اسکریپت آزمایشی');
  await page.locator('#dlg textarea[name=out_text]').fill('def hello():\n    return "<b>سلام</b>"');
  await page.locator('#dlg input[name=out_files]').setInputFiles([{ name: 'result.png', mimeType: 'image/png', buffer: PNG }, { name: 'main.py', mimeType: 'text/x-python', buffer: Buffer.from('print(1)') }]);
  await page.locator('#dlg input[name=taskDone]').check();
  await page.screenshot({ path: path.join(SHOTS, 'desktop-session-result.png') });
  await submitDialog(page);
  const s = await state(page);
  assert(s.sessions.length === 1 && s.sessions[0].note === 'بخش اول را تمام کردم', 'session saved');
  assert(s.sessions[0].minutes >= 15, 'minutes = planned: ' + s.sessions[0].minutes);
  assert(s.outputs.length === 1 && s.outputs[0].files.length === 2 && s.outputs[0].sessionId === s.sessions[0].id, 'output with 2 files');
  assert(s.tasks.find((t) => t.title === page.__task).status === 'done', 'task done');
  await page.getByTestId('break-offer').waitFor();
  assert((await page.getByTestId('sessions-today').textContent()).includes('۱ خروجی'));
});

await step('break timer runs and ends without creating a session', async () => {
  await page.getByRole('button', { name: 'شروع استراحت' }).click();
  await page.getByRole('button', { name: 'پایان استراحت' }).waitFor();
  assert((await page.locator('.ring').textContent()).includes('استراحت'));
  await page.clock.fastForward(6 * 60000);
  await page.getByRole('button', { name: 'شروع تمرکز' }).waitFor();
  assert((await state(page)).sessions.length === 1);
});

await step('time report: per project/activity for today, week, month and custom range', async () => {
  await page.getByRole('tab', { name: 'گزارش زمان' }).click();
  await page.getByTestId('report-groups').waitFor();
  assert(await page.getByTestId('report-groups').locator('li').count() === 1);
  await page.getByRole('group', { name: 'بازهٔ گزارش' }).getByRole('button', { name: 'امروز', exact: true }).click();
  assert((await page.getByTestId('report-stats').textContent()).includes('۱'));
  await page.getByRole('button', { name: 'این ماه' }).click();
  await page.getByRole('button', { name: 'بازهٔ دلخواه' }).click();
  await page.locator('form[data-form=report-custom] input[name=from]').fill('2026-10-01');
  await page.locator('form[data-form=report-custom] input[name=to]').fill('2026-10-05');
  await page.getByRole('button', { name: 'نمایش' }).click();
  await page.getByText('در این بازه جلسه‌ای ثبت نشده.').waitFor();
  await page.getByRole('button', { name: 'این هفته' }).click();
  await page.screenshot({ path: path.join(SHOTS, 'desktop-report.png') });
  await page.getByRole('tab', { name: 'تایمر' }).click();
});

await step('learning: resource, questions, notes, study session updates last topic & next step', async () => {
  await page.goto(BASE + '#learning');
  await page.getByRole('button', { name: 'منبع جدید' }).click();
  await page.locator('#dlg input[name=title]').fill('دورهٔ یادگیری عمیق');
  await page.locator('#dlg select[name=type]').selectOption('course');
  await page.locator('#dlg input[name=progress]').fill('30');
  await page.locator('#dlg input[name=lastTopic]').fill('شبکه‌های کانولوشنی');
  await submitDialog(page);
  await page.getByRole('button', { name: 'جزئیات' }).click();
  await page.locator('form[data-form=add-q] input').fill('چرا Batch Norm پایداری می‌دهد؟');
  await page.locator('form[data-form=add-q] input').press('Enter');
  await page.getByText('چرا Batch Norm پایداری می‌دهد؟').waitFor();
  await page.locator('[data-chg=toggle-q]').check();
  await page.locator('form[data-form=learn-notes] textarea').fill('یادداشت کوتاه');
  await page.getByRole('button', { name: 'ذخیرهٔ یادداشت' }).click();
  let l = (await state(page)).learning[0];
  assert(l.questions[0].resolved === true && l.notes === 'یادداشت کوتاه');
  await page.locator('.page-head').getByRole('button', { name: 'شروع مطالعه' }).click();
  await page.waitForURL(/#focus/);
  assert(await page.locator('#focus-learning').inputValue() === l.id, 'resource preselected');
  await page.locator('#focus-min').fill('1');
  await page.locator('#focus-min').dispatchEvent('change');
  await page.getByRole('button', { name: 'شروع تمرکز' }).click();
  await page.clock.fastForward(30000);
  await page.getByRole('button', { name: 'پایان و ثبت نتیجه' }).click();
  await page.locator('#dlg[open]').waitFor();
  await page.locator('#dlg input[name=lastTopic]').fill('فصل ۴: RNN');
  await page.locator('#dlg input[name=nextStep]').fill('تمرین LSTM');
  await submitDialog(page);
  l = (await state(page)).learning[0];
  assert(l.lastTopic === 'فصل ۴: RNN' && l.nextStep === 'تمرین LSTM');
  const ss = (await state(page)).sessions;
  assert(ss.length === 2 && ss[1].kind === 'study' && ss[1].learningId === l.id);
});

await step('outputs tab shows code safely and previews the attached image', async () => {
  await page.goto(BASE + '#learning');
  await page.getByRole('tab', { name: 'تمرین‌ها و خروجی‌ها' }).click();
  await page.locator('pre.code').waitFor();
  assert((await page.locator('pre.code').textContent()).includes('<b>سلام</b>'), 'code shown as text');
  await page.waitForFunction(() => { const i = document.querySelector('img[data-file]'); return i && i.complete && i.naturalWidth === 16; });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /main\.py/ }).click()]);
  assert(dl.suggestedFilename() === 'main.py');
  await page.getByRole('button', { name: 'ثبت تمرین یا خروجی' }).click();
  await page.locator('#dlg input[name=out_title]').fill('حل مسئلهٔ ۳');
  await page.locator('#dlg select[name=out_type]').selectOption('problem');
  await submitDialog(page);
  assert((await state(page)).outputs.length === 2);
  await page.getByRole('tab', { name: 'ایده‌ها و مقالات' }).click();
  await page.getByRole('button', { name: 'ایده یا مقالهٔ جدید' }).click();
  await page.locator('#dlg input[name=title]').fill('Attention Is All You Need');
  await page.locator('#dlg select[name=kind]').selectOption('article');
  await page.locator('#dlg input[name=url]').fill('https://arxiv.org/abs/1706.03762');
  await submitDialog(page);
  assert(await page.locator('a[href="https://arxiv.org/abs/1706.03762"]').count() === 1);
  await page.getByRole('tab', { name: 'منابع' }).click();
  await page.screenshot({ path: path.join(SHOTS, 'desktop-learning.png') });
});

await step('journal: mood, energy and notes saved and listed', async () => {
  await page.goto(BASE + '#journal');
  await page.locator('input[name=mood][value="4"]').check();
  await page.locator('input[name=energy][value="2"]').check();
  await page.locator('form[data-form=journal] textarea[name=text]').fill('امروز آرام‌تر کار کردم.');
  await page.locator('form[data-form=journal] textarea[name=learned]').fill('شروع کوچک کمک می‌کند.');
  await page.getByRole('button', { name: 'ذخیره', exact: true }).click();
  const j = (await state(page)).journal[0];
  assert(j.mood === 4 && j.energy === 2 && j.date === '2026-10-11');
  await page.getByText('یادداشت‌های قبلی').waitFor();
  await page.screenshot({ path: path.join(SHOTS, 'desktop-journal.png') });
});

await step('weekly review: stats, achievements, saved reflection persists after reload', async () => {
  await page.goto(BASE + '#review');
  const stats = await page.getByTestId('week-stats').textContent();
  assert(stats.includes('۲') && stats.includes('خروجی'), stats);
  await page.getByText('اسکریپت آزمایشی').waitFor();
  await page.locator('textarea[name=wentWell]').fill('هر روز کمی پیش رفتم');
  await page.locator('textarea[name=obstacles]').fill('خستگی عصرها');
  await page.locator('textarea[name=nextPlan]').fill('۱. فصل ۵\n۲. رزومه');
  await page.getByRole('button', { name: 'ذخیرهٔ مرور' }).click();
  await page.reload();
  assert(await page.locator('textarea[name=obstacles]').inputValue() === 'خستگی عصرها');
  await page.getByRole('button', { name: '→ هفتهٔ قبل' }).click();
  assert(await page.locator('textarea[name=obstacles]').inputValue() === '', 'previous week is separate');
  await page.getByRole('button', { name: 'این هفته' }).click();
  await page.screenshot({ path: path.join(SHOTS, 'desktop-review.png'), fullPage: true });
});

await step('settings: customize dashboard sections (rename, capacity, add, reorder, delete)', async () => {
  await page.goto(BASE + '#settings');
  const f = page.locator('form[data-form=day-sections]');
  await f.locator('input[name=sec_title_1]').fill('یک قدم برای کسب درآمد');
  await f.locator('input[name=sec_limit_1]').fill('2');
  await f.getByRole('button', { name: '+ بخش جدید' }).click();
  assert(await f.locator('input[name=sec_title_1]').inputValue() === 'یک قدم برای کسب درآمد', 'unsaved edits kept when adding');
  await f.locator('input[name=sec_title_5]').fill('مطالعهٔ آزاد');
  await f.locator('[data-sec-row="5"]').getByRole('button', { name: 'جابه‌جایی به بالا' }).click();
  await f.locator('[data-sec-row="3"]').getByRole('button', { name: 'حذف بخش' }).click(); // delete "rest"
  await f.getByRole('button', { name: 'ذخیرهٔ بخش‌ها' }).click();
  const secs = (await state(page)).settings.daySections;
  assert(secs.length === 5 && secs[1].title === 'یک قدم برای کسب درآمد' && secs[1].limit === 2, JSON.stringify(secs));
  assert(secs.map((x) => x.title).indexOf('مطالعهٔ آزاد') === 3, secs.map((x) => x.title).join('|'));
  await page.goto(BASE + '#today');
  await page.getByRole('heading', { name: 'یک قدم برای کسب درآمد' }).waitFor();
  assert(await page.locator('[data-testid=sections] section[data-section]').count() === 5);
});

await step('settings: pomodoro pattern, suggestion prefs, theme and sections toggles', async () => {
  await page.goto(BASE + '#settings');
  const f = page.locator('form[data-form=settings]');
  await f.locator('input[name=name]').fill('ناهورام');
  await f.locator('input[name=p_focus]').fill('50');
  await f.locator('input[name=p_short]').fill('10');
  await f.locator('input[name=sg_easy]').uncheck();
  await f.locator('select[name=theme]').selectOption('dark');
  await f.locator('input[name=sec_journal]').uncheck();
  await f.getByRole('button', { name: 'ذخیرهٔ تنظیمات' }).click();
  assert(await page.getAttribute('html', 'data-theme') === 'dark');
  assert(await page.locator('#nav-side .nav-item').count() === 6, 'journal hidden');
  const s = (await state(page)).settings;
  assert(s.pomodoro.focus === 50 && s.pomodoro.shortBreak === 10 && s.suggest.easyStart === false);
  await page.goto(BASE + '#focus');
  assert(await page.locator('#focus-min').inputValue() === '50');
  assert(await page.locator('#break-min').inputValue() === '10');
  await page.goto(BASE + '#today');
  assert((await page.locator('h1').textContent()).includes('ناهورام'));
  await page.screenshot({ path: path.join(SHOTS, 'desktop-today-dark.png'), fullPage: true });
  await page.goto(BASE + '#settings');
  await page.locator('form[data-form=settings] select[name=theme]').selectOption('light');
  await page.locator('form[data-form=settings] input[name=sec_journal]').check();
  await page.getByRole('button', { name: 'ذخیرهٔ تنظیمات' }).click();
  await page.screenshot({ path: path.join(SHOTS, 'desktop-settings.png'), fullPage: true });
});

let backupPath;
await step('backup export includes attachments; wipe; import restores everything', async () => {
  const before = await state(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'دریافت فایل پشتیبان' }).click()]);
  backupPath = path.join(SHOTS, '..', 'backup-test.json');
  await dl.saveAs(backupPath);
  const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  assert(data.app === 'nava' && Object.keys(data.files).length === 2, 'files in backup');
  await page.getByRole('button', { name: 'پاک کردن همهٔ داده‌ها' }).click();
  await submitDialog(page);
  assert((await state(page)).tasks.length === 0);
  await page.locator('#import-file').setInputFiles(backupPath);
  await page.locator('#toast.show').filter({ hasText: 'بازیابی شد' }).waitFor();
  const after = await state(page);
  assert(after.tasks.length === before.tasks.length && after.outputs.length === before.outputs.length && after.goals.length === before.goals.length);
  await page.goto(BASE + '#learning');
  await page.getByRole('tab', { name: 'تمرین‌ها و خروجی‌ها' }).click();
  await page.waitForFunction(() => { const i = document.querySelector('img[data-file]'); return i && i.complete && i.naturalWidth === 16; });
  await page.locator('#import-file').count(); // no-op
  fs.unlinkSync(backupPath);
});

await step('invalid backup file is rejected without data loss', async () => {
  await page.goto(BASE + '#settings');
  const n = (await state(page)).tasks.length;
  await page.locator('#import-file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await page.locator('#toast.show').filter({ hasText: 'بازیابی ناموفق' }).waitFor();
  assert((await state(page)).tasks.length === n);
});

await step('user text is escaped (no script injection)', async () => {
  await page.goto(BASE + '#today');
  const sec = page.locator('[data-testid=sections] section[data-section]').nth(3);
  await sec.locator('input[name=title]').fill('<img src=x onerror="window.__xss=1">');
  await sec.locator('input[name=title]').press('Enter');
  await page.waitForTimeout(100);
  assert(await page.evaluate(() => window.__xss) === undefined);
  assert(await page.getByText('<img src=x onerror="window.__xss=1">').count() === 1);
});

await step('delete task through dialog with confirmation', async () => {
  await page.locator('[data-task]', { hasText: '<img src=x' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'حذف کار' }).click();
  await submitDialog(page);
  assert(!(await state(page)).tasks.some((t) => t.title.startsWith('<img')));
});

await step('desktop views have no horizontal overflow', async () => {
  for (const v of ['today', 'goals', 'focus', 'review', 'learning', 'journal', 'settings']) {
    await page.goto(BASE + '#' + v); await page.waitForTimeout(50);
    assert(await noOverflow(page), 'overflow on ' + v);
  }
});
await ctx.close();

// ---- comeback after absence ----
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'fa-IR', timezoneId: 'Asia/Tehran' });
const p2 = await ctx2.newPage(); watch(p2, 'comeback');
await p2.clock.install({ time: START });
await p2.goto(BASE);
await step('welcome-back banner after 3+ days and a lighter plan', async () => {
  await p2.evaluate(() => {
    const tasks = [];
    for (let i = 0; i < 10; i++) tasks.push({ id: 't' + i, title: 'کار عقب‌افتاده ' + i, priority: 'high', energy: 'medium', estimate: 30, due: '2026-10-05', status: 'todo', createdAt: '2026-10-01T00:00:00Z', todayKey: '2026-10-06' });
    localStorage.setItem('nava.v1', JSON.stringify({ tasks, sessions: [{ id: 's', start: new Date(2026, 9, 6, 9).toISOString(), minutes: 30, kind: 'work' }] }));
  });
  await p2.reload();
  await p2.getByTestId('comeback').waitFor();
  assert((await p2.getByTestId('comeback').textContent()).includes('۵ روز'));
  assert(await p2.locator('[data-section=main] [data-task]').count() === 0, 'old days do not pile onto today');
  await p2.getByRole('button', { name: 'برنامهٔ سبک بچین' }).click();
  await p2.getByTestId('comeback').waitFor({ state: 'detached' });
  const n = await p2.locator('[data-section=main] [data-task]').count();
  assert(n >= 1 && n <= 2, 'light plan with ' + n + ' tasks');
  const st = await state(p2);
  assert(st.tasks.length === 10 && st.tasks.every((t) => t.status === 'todo'));
  await p2.screenshot({ path: path.join(SHOTS, 'desktop-comeback.png'), fullPage: true });
});
await ctx2.close();

// ---- mobile ----
const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fa-IR', timezoneId: 'Asia/Tehran' });
const m = await ctx3.newPage(); watch(m, 'mobile');
await m.clock.install({ time: START });
await m.goto(BASE);
await step('mobile: bottom navigation, “more” sheet, no horizontal overflow on any view', async () => {
  assert(await m.locator('#nav-bottom').isVisible() && !(await m.locator('.sidebar').isVisible()));
  await m.locator('#nav-bottom').getByRole('button', { name: 'بیشتر' }).click();
  await m.locator('#dlg').getByRole('button', { name: /فضای یادگیری/ }).click();
  await m.waitForURL(/#learning/);
  assert(!(await m.locator('#dlg').evaluate((d) => d.open)));
  await m.evaluate(() => {
    localStorage.setItem('nava.v1', JSON.stringify({ goals: [{ id: 'g', title: 'قبولی و پیشرفت در کارشناسی ارشد هوش مصنوعی با یک عنوان بسیار طولانی برای آزمون شکستن خط', status: 'active' }],
      projects: [{ id: 'p', title: 'مرور مباحث پایه', goalId: 'g', status: 'active' }],
      tasks: [{ id: 'a', title: 'یک کار با عنوان خیلی خیلی طولانی که باید در صفحهٔ موبایل بدون بیرون‌زدگی شکسته شود', projectId: 'p', priority: 'high', estimate: 30, due: '2026-10-11', status: 'todo', todayKey: '2026-10-11', section: 'main' }] }));
  });
  await m.reload();
  for (const v of ['today', 'goals', 'focus', 'review', 'learning', 'journal', 'settings']) {
    await m.goto(BASE + '#' + v); await m.waitForTimeout(50);
    assert(await noOverflow(m), 'overflow on mobile ' + v);
    if (v === 'today' || v === 'focus' || v === 'goals') await m.screenshot({ path: path.join(SHOTS, 'mobile-' + v + '.png'), fullPage: v !== 'focus' });
  }
  await m.goto(BASE + '#today');
  await m.locator('[data-task]').first().getByRole('button').first().click();
  await m.locator('#dlg[open]').waitFor();
  await m.screenshot({ path: path.join(SHOTS, 'mobile-dialog.png') });
  assert(await noOverflow(m));
});
await ctx3.close();

// ---- file:// (double-click index.html) ----
const ctx4 = await browser.newContext();
const f = await ctx4.newPage(); watch(f, 'file');
await f.goto(pathToFileURL(path.join(here, '..', 'index.html')).href);
await step('works when opened directly from disk (file://)', async () => {
  await f.locator('[data-section=main] input[name=title]').fill('تست فایل');
  await f.locator('[data-section=main] input[name=title]').press('Enter');
  await f.locator('[data-task]', { hasText: 'تست فایل' }).waitFor();
  await f.reload();
  await f.locator('[data-task]', { hasText: 'تست فایل' }).waitFor();
});
await ctx4.close();

await step('no JavaScript errors in any session', async () => { assert(errors.length === 0, errors.join('\n')); });

await browser.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed: ' + failures.join(' | ')); process.exit(1); }
