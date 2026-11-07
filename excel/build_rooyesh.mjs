#!/usr/bin/env node
// Builder for Rooyesh.xlsx — Persian, right-to-left personal task & growth workbook.
// Run: node build_rooyesh.mjs   (writes Rooyesh.xlsx next to this file; previews in build/preview)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createXlsxSpec, addWorksheetSpec, writeCellValues, writeCellFormulas, applyRangeStyle, addExcelTable,
  addValidationRule, addConditionalStyle, defineWorkbookName, addCellNote, addChartSpec, buildXlsx,
} from '/skills/sheets/scripts/sheets_builder_runtime.mjs';
import { toGregorian } from '../telegram-bot/src/jalali.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SK = '/skills/sheets/scripts';
const OUT = path.join(HERE, 'Rooyesh.xlsx');
const BUILD = path.join(HERE, 'build');

// ---------- palette & fonts ----------
const FONT = 'Tahoma';
const COL = { ink: '2F3E36', sub: '6B7A72', head: '5E8C76', headInk: 'FFFFFF', band: 'E4EEE8', input: 'FFFBF0', calc: 'F2F5F3', line: 'D3DDD7', accent: '3F7A5E', warn: 'B5523B', soft: 'F7F9F7' };

// ---------- sheet names ----------
const SH = { guide: 'راهنما', today: 'امروز', goals: 'اهداف', proj: 'پروژه‌ها', tasks: 'کارها', sess: 'جلسات تمرکز', learn: 'یادگیری', outs: 'خروجی‌ها', ideas: 'ایده‌ها', jour: 'دفتر شخصی', week: 'مرور هفتگی', rep: 'گزارش', set: 'تنظیمات' };
const FIRST = 5; // first data row on data sheets (row 4 = headers)
const ROWS = { goals: 50, proj: 100, tasks: 300, sess: 500, learn: 100, outs: 300, ideas: 200, jour: 400, rev: 52 };
const last = (k) => FIRST + ROWS[k] - 1;
const q = (sheet) => (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(sheet) ? sheet : `'${sheet}'`); // quote only when needed (matches LibreOffice/Excel canonical form)
const rng = (sheet, col, k) => `${q(sheet)}!$${col}$${FIRST}:$${col}$${last(k)}`;
const G_ = (c) => rng(SH.goals, c, 'goals'), P_ = (c) => rng(SH.proj, c, 'proj'), T_ = (c) => rng(SH.tasks, c, 'tasks');
const S_ = (c) => rng(SH.sess, c, 'sess'), L_ = (c) => rng(SH.learn, c, 'learn'), O_ = (c) => rng(SH.outs, c, 'outs'), J_ = (c) => rng(SH.jour, c, 'jour');

// ---------- Jalali helpers (formula text) ----------
const FA_DIG = '۰۱۲۳۴۵۶۷۸۹', AR_DIG = '٠١٢٣٤٥٦٧٨٩';
function normF(ref) {
  let f = `${ref}&""`;
  for (let i = 0; i < 10; i++) f = `SUBSTITUTE(${f},"${FA_DIG[i]}","${i}")`;
  for (let i = 0; i < 10; i++) f = `SUBSTITUTE(${f},"${AR_DIG[i]}","${i}")`;
  return `TRIM(SUBSTITUTE(${f},"-","/"))`;
}
/** Jalali text (raw input + its normalized helper) → Gregorian serial; real Excel dates pass through. */
function j2gF(raw, n) {
  const M = `VALUE(MID(${n},6,FIND("/",${n},6)-6))`, D = `VALUE(MID(${n},FIND("/",${n},6)+1,2))`;
  return `IF(${raw}="","",IF(ISNUMBER(${raw}),${raw},IFERROR(INDEX(NR_D,MATCH(VALUE(LEFT(${n},4)),NR_Y,0))+IF(${M}<=6,(${M}-1)*31,186+(${M}-7)*30)+${D}-1+IF(OR(MID(${n},5,1)<>"/",${M}<1,${M}>12,${D}<1,${D}>IF(${M}<=6,31,30)),NA(),0),"تاریخ نامعتبر")))`;
}
/** Gregorian serial → Jalali text yyyy/mm/dd */
function g2jF(g) {
  const doy = `(${g}-LOOKUP(${g},NR_D))`;
  return `LOOKUP(${g},NR_D,NR_Y)&"/"&TEXT(IF(${doy}<186,INT(${doy}/31)+1,7+INT((${doy}-186)/30)),"00")&"/"&TEXT(IF(${doy}<186,MOD(${doy},31)+1,MOD(${doy}-186,30)+1),"00")`;
}
const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
function jLongF(g) { // «یکشنبه ۱۹ مهر ۱۴۰۵» style (Latin digits)
  const doy = `(${g}-LOOKUP(${g},NR_D))`;
  const m = `IF(${doy}<186,INT(${doy}/31)+1,7+INT((${doy}-186)/30))`, d = `IF(${doy}<186,MOD(${doy},31)+1,MOD(${doy}-186,30)+1)`;
  return `CHOOSE(WEEKDAY(${g}),"یکشنبه","دوشنبه","سه‌شنبه","چهارشنبه","پنجشنبه","جمعه","شنبه")&" "&${d}&" "&CHOOSE(${m},${MONTHS.map((x) => `"${x}"`).join(',')})&" "&LOOKUP(${g},NR_D,NR_Y)`;
}
function persianMonthStartF(g) {
  const nr = `LOOKUP(${g},NR_D)`, doy = `(${g}-${nr})`;
  return `${nr}+IF(${doy}<186,INT(${doy}/31)*31,186+INT((${doy}-186)/30)*30)`;
}

// ---------- generic helpers ----------
const colIdx = (c) => c.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const base = { fontFamily: FONT, fontSize: 10, fontColor: COL.ink, verticalAlign: 'center' };
function title(s, text, sub) {
  writeCellValues(s, 'B1:B2', [[text], [sub]]);
  applyRangeStyle(s, 'B1', { fontFamily: FONT, fontSize: 18, bold: true, fontColor: COL.ink });
  applyRangeStyle(s, 'B2', { fontFamily: FONT, fontSize: 10, fontColor: COL.sub, italic: true });
}
function sectionHead(s, range, text) {
  writeCellValues(s, range.split(':')[0], [[text]]);
  applyRangeStyle(s, range, { fontFamily: FONT, fontSize: 12, bold: true, fontColor: COL.accent, fill: COL.band, border: { color: COL.band } });
}

const helpers = {}; // sheet → hidden helper columns
const notes = [];

/**
 * Data sheet: columns [{c, h, w, kind:'in'|'f'|'hx', fmt, list|vrule, f:(r)=>formula, align, wrap}]
 * kind 'hx' = hidden helper formula column.
 */
function dataSheet(b, name, key, { titleText, sub, cols, sample = [], table, tab, freeze = 'C5' }) {
  const s = addWorksheetSpec(b, name, { freezePanes: freeze, showGridlines: false, tabColor: tab, columnWidths: Object.fromEntries([['A', 2], ...cols.map((c) => [c.c, c.w || 14])]), rowHeights: { 1: 30, 4: 38 } });
  const r0 = FIRST, r1 = last(key), lastCol = cols[cols.length - 1].c;
  applyRangeStyle(s, `A1:${lastCol}${r1}`, base);
  title(s, titleText, sub);
  writeCellValues(s, `B4:${lastCol}4`, [cols.slice(cols.findIndex((c) => c.c === 'B')).map((c) => c.h)]);
  writeCellValues(s, 'A4', [[' ']]);
  // formulas
  for (const c of cols) if (c.f) writeCellFormulas(s, `${c.c}${r0}:${c.c}${r1}`, Array.from({ length: r1 - r0 + 1 }, (_, i) => [c.f(r0 + i)]));
  // sample inputs
  sample.forEach((row, i) => {
    for (const [k, v] of Object.entries(row)) if (v !== undefined && v !== null && v !== '') writeCellValues(s, `${k}${r0 + i}`, [[v]]);
  });
  // styles
  applyRangeStyle(s, `B4:${lastCol}4`, { bold: true, fill: COL.head, fontColor: COL.headInk, align: 'center', wrapText: true, border: { color: COL.head } });
  for (const c of cols) {
    const R = `${c.c}${r0}:${c.c}${r1}`;
    const st = { border: { color: COL.line } };
    if (c.kind === 'f') { st.fill = COL.calc; st.fontColor = COL.sub; }
    if (c.kind === 'hx') { st.fontColor = '999999'; }
    if (c.fmt) st.numberFormat = c.fmt;
    st.align = c.align || (c.fmt && c.fmt !== '@' ? 'center' : 'right');
    if (c.wrap) st.wrapText = true;
    applyRangeStyle(s, R, st);
    if (c.kind === 'hx') applyRangeStyle(s, `${c.c}4`, { fill: 'B9C4BE' });
    if (c.list) addValidationRule(s, R, { type: 'list', values: c.list, allowBlank: true, error: 'یکی از گزینه‌های فهرست را انتخاب کنید.', errorTitle: 'رویش' });
    if (c.listRef) addValidationRule(s, R, { type: 'list', formula1: c.listRef, allowBlank: true, error: 'یکی از گزینه‌های فهرست را انتخاب کنید.', errorTitle: 'رویش' });
    if (c.vrule) addValidationRule(s, R, Object.assign({ allowBlank: true }, c.vrule));
    if (c.note) addCellNote(s, `${c.c}4`, c.note, { author: 'رویش' });
  }
  helpers[name] = cols.filter((c) => c.kind === 'hx').map((c) => c.c);
  if (table) addExcelTable(s, `B4:${lastCol}${r1}`, { name: table, style: 'TableStyleLight1' });
  return s;
}
const dateIn = (c, h = 'تاریخ (شمسی)') => ({ c, h, w: 13, kind: 'in', align: 'center', fmt: '@', note: 'تاریخ شمسی مثل 1405/07/19 (رقم فارسی هم قبول است). Ctrl+; هم تاریخ امروز را می‌گذارد.' });
const normCol = (c, src) => ({ c, h: 'کمکی: متن تاریخ', w: 8, kind: 'hx', f: (r) => normF(`${src}${r}`) });
const gregCol = (c, src, n) => ({ c, h: 'کمکی: تاریخ میلادی', w: 11, kind: 'hx', fmt: 'yyyy-mm-dd', f: (r) => j2gF(`${src}${r}`, `${n}${r}`) });
function badDateRule(s, inCol, gCol, key) {
  addConditionalStyle(s, `${inCol}${FIRST}:${inCol}${last(key)}`, { type: 'expression', formula: `$${gCol}${FIRST}="تاریخ نامعتبر"`, format: { fill: 'F6D5CC', font: { color: COL.warn, bold: true } } });
}

const LISTS = {
  taskStatus: ['انجام‌نشده', 'در حال انجام', 'انجام‌شده'], priority: ['بالا', 'متوسط', 'پایین'], energy: ['کم', 'متوسط', 'زیاد'], yesno: ['بله', 'خیر'],
  goalStatus: ['فعال', 'متوقف', 'تکمیل‌شده'], learnType: ['دوره', 'کتاب', 'مقاله', 'ویدیو', 'سایر'], learnStatus: ['برنامه‌ریزی‌شده', 'در حال یادگیری', 'متوقف', 'تمام‌شده'],
  outType: ['کد', 'مسئلهٔ حل‌شده', 'فایل پروژه', 'تصویر نتیجه', 'یادداشت', 'لینک'], kind: ['کار', 'مطالعه'], ideaKind: ['ایده', 'مقالهٔ مهم'], ideaStatus: ['جدید', 'در حال بررسی', 'انجام‌شده', 'کنار گذاشته'],
};

// =====================================================================
const b = createXlsxSpec({ creator: 'Rooyesh', activeSheet: SH.today });
// sheet order
const sGuide = addWorksheetSpec(b, SH.guide, { showGridlines: false, tabColor: '9DB8A9', columnWidths: { A: 2, B: 26, C: 90 } });
const sToday = addWorksheetSpec(b, SH.today, { showGridlines: false, tabColor: COL.accent, columnWidths: { A: 2, B: 36, C: 14, D: 16, E: 3, F: 34, G: 12, H: 40, I: 2 } });

// ---------- names ----------
const SET = (cell) => `${q(SH.set)}!${cell}`;
const NAMES = {
  TodayDate: SET('$C$5'), ComebackDays: SET('$C$6'), PomFocus: SET('$C$9'), PomShort: SET('$C$10'), PomLong: SET('$C$11'), PomEvery: SET('$C$12'),
  UseDeadline: SET('$C$15'), UseEasy: SET('$C$16'), UseGoal: SET('$C$17'),
  DayTypes: SET('$B$21:$B$24'), DT_Energy: SET('$C$21:$C$24'), DT_Budget: SET('$D$21:$D$24'), DT_Max: SET('$E$21:$E$24'),
  SecNames: SET('$B$28:$B$33'), SecCaps: SET('$C$28:$C$33'),
  NR_Y: SET('$B$37:$B$72'), NR_D: SET('$C$37:$C$72'),
  DayEnergy: SET('$C$76'), LastActive: SET('$C$77'), GapDays: SET('$C$78'), LightMode: SET('$C$79'), DayBudget: SET('$C$80'), DayMax: SET('$C$81'),
  DayType: `${q(SH.today)}!$C$4`, AvailMin: `${q(SH.today)}!$C$5`,
  RepFrom: `${q(SH.rep)}!$Z$4`, RepTo: `${q(SH.rep)}!$Z$5`, WeekStart: `${q(SH.week)}!$Z$4`,
  GoalIds: G_('A'), ProjIds: P_('A'), TaskIds: T_('A'), LearnIds: L_('A'),
};

// ---------- goals ----------
const sGoals = dataSheet(b, SH.goals, 'goals', {
  titleText: '🎯 اهداف', sub: 'هر هدف چند مرحله/پروژه دارد (برگهٔ پروژه‌ها) و هر مرحله چند قدم (برگهٔ کارها). پیشرفت و قدم بعدی خودکار حساب می‌شوند.', tab: 'C9A227', table: 'Goals',
  cols: [
    { c: 'A', h: 'شناسه', w: 7, kind: 'in', align: 'center', note: 'یک شناسهٔ کوتاه و یکتا، مثل G1. در پروژه‌ها با همین شناسه به هدف وصل می‌شوید.' },
    { c: 'B', h: 'عنوان هدف', w: 34, kind: 'in' }, { c: 'C', h: 'چرا برایم مهم است؟', w: 34, kind: 'in' },
    { c: 'D', h: 'وضعیت', w: 11, kind: 'in', list: LISTS.goalStatus, align: 'center' }, dateIn('E', 'مهلت (شمسی)'),
    { c: 'F', h: 'مراحل', w: 8, kind: 'f', fmt: '0', f: (r) => `IF(A${r}="","",COUNTIF(${P_('C')},A${r}))` },
    { c: 'G', h: 'مراحل کامل', w: 9, kind: 'f', fmt: '0', f: (r) => `IF(A${r}="","",COUNTIFS(${P_('C')},A${r},${P_('I')},1))` },
    { c: 'H', h: 'پیشرفت', w: 10, kind: 'f', fmt: '0%', f: (r) => `IF(A${r}="","",IF(D${r}="تکمیل‌شده",1,IF(F${r}=0,0,AVERAGEIF(${P_('C')},A${r},${P_('I')}))))` },
    { c: 'I', h: 'قدم بعدی', w: 34, kind: 'f', f: (r) => `IF(A${r}="","",IFERROR(INDEX(${T_('B')},MATCH(A${r}&"#"&TEXT(_xlfn.MINIFS(${T_('Z')},${T_('Y')},A${r}),"000000"),${T_('AA')},0)),"—"))` },
    { c: 'J', h: 'روز تا مهلت', w: 9, kind: 'f', fmt: '0', f: (r) => `IF(OR(A${r}="",NOT(ISNUMBER(L${r}))),"",L${r}-TodayDate)` },
    { c: 'K', h: 'زمان تمرکز (دقیقه)', w: 11, kind: 'f', fmt: '#,##0', f: (r) => `IF(A${r}="","",SUMIFS(${S_('E')},${S_('K')},A${r}))` },
    gregCol('L', 'E', 'M'), normCol('M', 'E'),
    { c: 'N', h: 'کمکی: دقیقه در بازهٔ گزارش', w: 8, kind: 'hx', f: (r) => `IF(A${r}="","",SUMIFS(${S_('E')},${S_('K')},A${r},${S_('N')},">="&RepFrom,${S_('N')},"<="&RepTo))` },
    { c: 'O', h: 'کمکی: رتبه', w: 8, kind: 'hx', f: (r) => `IF(OR(N${r}="",N${r}=0),"",N${r}+ROW()/1000000)` },
  ],
  sample: [
    { A: 'G1', B: 'کسب درآمد از برنامه‌نویسی', C: 'استقلال مالی و تجربهٔ کار واقعی', D: 'فعال', E: '1405/12/29' },
    { A: 'G2', B: 'قبولی و پیشرفت در ارشد هوش مصنوعی', C: 'علاقه به پژوهش و آیندهٔ شغلی', D: 'فعال', E: '1406/02/15' },
    { A: 'G3', B: 'توسعهٔ پروژهٔ شخصی: اپ یادگیری لغت', C: 'ساختن چیزی که خودم هر روز استفاده کنم', D: 'فعال' },
  ],
});
badDateRule(sGoals, 'E', 'L', 'goals');
addConditionalStyle(sGoals, `H${FIRST}:H${last('goals')}`, { type: 'dataBar', thresholds: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }], color: '8DB7A0' });

// ---------- projects ----------
const sProj = dataSheet(b, SH.proj, 'proj', {
  titleText: '📁 مراحل و پروژه‌ها', sub: 'ستون «هدف» را با شناسهٔ هدف پر کنید. «ترتیب» مشخص می‌کند کدام مرحله زودتر است.', tab: 'C9A227', table: 'Projects',
  cols: [
    { c: 'A', h: 'شناسه', w: 7, kind: 'in', align: 'center', note: 'شناسهٔ یکتا، مثل P1. در برگهٔ کارها با همین شناسه قدم‌ها را به این پروژه وصل کنید.' },
    { c: 'B', h: 'عنوان مرحله / پروژه', w: 34, kind: 'in' },
    { c: 'C', h: 'هدف', w: 8, kind: 'in', listRef: 'GoalIds', align: 'center' },
    { c: 'D', h: 'ترتیب', w: 7, kind: 'in', fmt: '0', vrule: { type: 'whole', operator: 'between', formula1: '0', formula2: '999', error: 'یک عدد صحیح بنویسید.' } },
    { c: 'E', h: 'وضعیت', w: 11, kind: 'in', list: LISTS.goalStatus, align: 'center' }, dateIn('F', 'مهلت (شمسی)'),
    { c: 'G', h: 'قدم‌ها', w: 7, kind: 'f', fmt: '0', f: (r) => `IF(A${r}="","",COUNTIF(${T_('C')},A${r}))` },
    { c: 'H', h: 'انجام‌شده', w: 8, kind: 'f', fmt: '0', f: (r) => `IF(A${r}="","",COUNTIFS(${T_('C')},A${r},${T_('E')},"انجام‌شده"))` },
    { c: 'I', h: 'پیشرفت', w: 10, kind: 'f', fmt: '0%', f: (r) => `IF(A${r}="","",IF(E${r}="تکمیل‌شده",1,IF(G${r}=0,0,H${r}/G${r})))` },
    { c: 'J', h: 'قدم بعدی', w: 32, kind: 'f', f: (r) => `IF(A${r}="","",IF(E${r}="متوقف","⏸ متوقف",IFERROR(INDEX(${T_('B')},MATCH(A${r}&"#"&TEXT(_xlfn.MINIFS(${T_('D')},${T_('C')},A${r},${T_('W')},1),"0000"),${T_('S')},0)),IF(AND(G${r}>0,H${r}=G${r}),"🎉 همهٔ قدم‌ها انجام شده",IF(E${r}="تکمیل‌شده","✔ تکمیل‌شده","— قدم اول را در برگهٔ کارها بنویسید")))))` },
    { c: 'K', h: 'نام هدف', w: 26, kind: 'f', f: (r) => `IF(C${r}="","",IFERROR(INDEX(${G_('B')},MATCH(C${r},${G_('A')},0)),"؟ شناسهٔ هدف پیدا نشد"))` },
    { c: 'L', h: 'زمان تمرکز (دقیقه)', w: 11, kind: 'f', fmt: '#,##0', f: (r) => `IF(A${r}="","",SUMIFS(${S_('E')},${S_('J')},A${r}))` },
    { c: 'M', h: 'روز تا مهلت', w: 9, kind: 'f', fmt: '0', f: (r) => `IF(OR(A${r}="",NOT(ISNUMBER(N${r}))),"",N${r}-TodayDate)` },
    gregCol('N', 'F', 'O'), normCol('O', 'F'),
    { c: 'P', h: 'کمکی: دقیقه در بازهٔ گزارش', w: 8, kind: 'hx', f: (r) => `IF(A${r}="","",SUMIFS(${S_('E')},${S_('J')},A${r},${S_('N')},">="&RepFrom,${S_('N')},"<="&RepTo))` },
    { c: 'Q', h: 'کمکی: رتبه', w: 8, kind: 'hx', f: (r) => `IF(OR(P${r}="",P${r}=0),"",P${r}+ROW()/1000000)` },
  ],
  sample: [
    ['P1', 'یادگیری مهارت‌های موردنیاز', 'G1', 1, 'تکمیل‌شده'], ['P2', 'ساخت نمونه‌کار', 'G1', 2, 'فعال', '1405/08/30'], ['P3', 'تکمیل رزومه و پروفایل کاری', 'G1', 3, 'فعال'],
    ['P4', 'پیدا کردن و گرفتن پروژه', 'G1', 4, 'فعال'], ['P5', 'انجام پروژه و دریافت درآمد', 'G1', 5, 'فعال'],
    ['P6', 'مرور مباحث پایه', 'G2', 1, 'فعال', '1405/09/15'], ['P7', 'مطالعهٔ دروس تخصصی', 'G2', 2, 'فعال'], ['P8', 'مطالعهٔ مقالات علمی', 'G2', 3, 'فعال'],
    ['P9', 'تمرین‌ها و پروژه‌های مرتبط', 'G2', 4, 'فعال'], ['P10', 'آمادگی برای امتحان‌ها', 'G2', 5, 'فعال'],
    ['P11', 'تعریف مسئله و طراحی', 'G3', 1, 'تکمیل‌شده'], ['P12', 'پیاده‌سازی نسخهٔ اول', 'G3', 2, 'فعال'], ['P13', 'آزمایش و انتشار', 'G3', 3, 'فعال'],
  ].map(([A, B, C, D, E, F]) => ({ A, B, C, D, E, F })),
});
badDateRule(sProj, 'F', 'N', 'proj');
addConditionalStyle(sProj, `I${FIRST}:I${last('proj')}`, { type: 'dataBar', thresholds: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }], color: '8DB7A0' });

// ---------- tasks ----------
const NS = (r) => `AC${r}`; // helper: is next step of its project
const sTasks = dataSheet(b, SH.tasks, 'tasks', {
  titleText: '🛠 کارها و قدم‌ها', sub: 'برای برنامهٔ امروز، «امروز؟» را «بله» کنید و بخش را انتخاب کنید. امتیاز و دلیل‌ها پایهٔ پیشنهاد «از کجا شروع کنم؟» هستند.', tab: '5E8C76', table: 'Tasks',
  cols: [
    { c: 'A', h: 'شناسه', w: 7, kind: 'in', align: 'center', note: 'شناسهٔ کوتاه و یکتا، مثل T1 (برای وصل کردن جلسه‌ها و خروجی‌ها).' },
    { c: 'B', h: 'عنوان کار / قدم', w: 36, kind: 'in' },
    { c: 'C', h: 'پروژه', w: 8, kind: 'in', listRef: 'ProjIds', align: 'center', note: 'اختیاری: شناسهٔ پروژه/مرحله. خالی = کار مستقل.' },
    { c: 'D', h: 'ترتیب', w: 7, kind: 'in', fmt: '0', note: 'ترتیب انجام قدم‌ها در پروژه. کوچک‌ترین عددِ انجام‌نشده = قدم بعدی.', vrule: { type: 'whole', operator: 'between', formula1: '0', formula2: '9999', error: 'یک عدد صحیح بنویسید.' } },
    { c: 'E', h: 'وضعیت', w: 12, kind: 'in', list: LISTS.taskStatus, align: 'center' },
    { c: 'F', h: 'اولویت', w: 8, kind: 'in', list: LISTS.priority, align: 'center' },
    { c: 'G', h: 'انرژی لازم', w: 9, kind: 'in', list: LISTS.energy, align: 'center' },
    { c: 'H', h: 'زمان تخمینی (دقیقه)', w: 10, kind: 'in', fmt: '0', vrule: { type: 'whole', operator: 'between', formula1: '0', formula2: '600', error: 'عدد دقیقه بین ۰ تا ۶۰۰.' } },
    dateIn('I', 'مهلت (شمسی)'),
    { c: 'J', h: 'امروز؟', w: 7, kind: 'in', list: LISTS.yesno, align: 'center' },
    { c: 'K', h: 'بخش امروز', w: 22, kind: 'in', listRef: 'SecNames', note: 'خالی = بخش اول. نام و ظرفیت بخش‌ها در برگهٔ تنظیمات.' },
    dateIn('L', 'تاریخ انجام (شمسی)'),
    { c: 'M', h: 'هدف', w: 22, kind: 'f', f: (r) => `IF(Y${r}="","",IFERROR(INDEX(${G_('B')},MATCH(Y${r},${G_('A')},0)),""))` },
    { c: 'N', h: 'روز تا مهلت', w: 8, kind: 'f', fmt: '0', f: (r) => `IF(OR(B${r}="",NOT(ISNUMBER(Q${r}))),"",Q${r}-TodayDate)` },
    { c: 'O', h: 'امتیاز پیشنهاد', w: 9, kind: 'f', fmt: '0', f: (r) => `IF(W${r}=0,"",IF(F${r}="بالا",30,IF(F${r}="پایین",5,15))+IF(J${r}="بله",15,0)+IF(E${r}="در حال انجام",8,0)+IF(AND(UseDeadline="بله",ISNUMBER(Q${r})),IF(Q${r}<TodayDate,18,IF(Q${r}=TodayDate,20,IF(Q${r}-TodayDate<=3,10,0))),0)+IF(${NS(r)},10,0)+IF(AND(UseGoal="بله",M${r}<>""),8,0)+IF(AvailMin>0,IF(H${r}>AvailMin,-25,IF(H${r}>0,5,0)),0)+IF(AND(UseEasy="بله",H${r}>0,H${r}<=25),6,0)+IF(DayEnergy="کم",IF(G${r}="زیاد",-20,0)+IF(G${r}="کم",12,0)+IF(AND(H${r}>0,H${r}<=25),4,0),IF(DayEnergy="زیاد",IF(G${r}="زیاد",12,0),IF(G${r}="متوسط",4,0)))-ROW()/100000)` },
    { c: 'P', h: 'چرا؟ (دلیل‌های پیشنهاد)', w: 44, kind: 'f', f: (r) => `IF(W${r}=0,"",IF(X${r}="",IF(F${r}="بالا","اولویت بالایی دارد","بیشترین امتیاز را بین کارهای باز دارد"),LEFT(X${r},LEN(X${r})-3)))` },
    gregCol('Q', 'I', 'U'),
    gregCol('R', 'L', 'V'),
    { c: 'S', h: 'کمکی: کلید پروژه', w: 8, kind: 'hx', f: (r) => `IF(OR(W${r}=0,C${r}=""),"",C${r}&"#"&TEXT(D${r},"0000"))` },
    { c: 'T', h: 'کمکی: کلید بخش', w: 8, kind: 'hx', f: (r) => `IF(AB${r}="","",AB${r}&"#"&COUNTIF(AB$${FIRST}:AB${r},AB${r}))` },
    normCol('U', 'I'), normCol('V', 'L'),
    { c: 'W', h: 'کمکی: باز و فعال', w: 6, kind: 'hx', fmt: '0', f: (r) => `IF(OR(B${r}="",E${r}="انجام‌شده"),0,IF(C${r}="",1,IF(IFERROR(INDEX(${P_('E')},MATCH(C${r},${P_('A')},0)),"فعال")="فعال",1,0)))` },
    { c: 'X', h: 'کمکی: دلیل‌ها', w: 8, kind: 'hx', f: (r) => `IF(W${r}=0,"",IF(J${r}="بله","جزو برنامهٔ امروز است · ","")&IF(E${r}="در حال انجام","نیمه‌کاره است و ادامه‌اش ساده‌تر است · ","")&IF(AND(UseDeadline="بله",ISNUMBER(Q${r})),IF(Q${r}<TodayDate,"موعدش رد شده؛ با یک قدم کوچک دوباره راه می‌افتد · ",IF(Q${r}=TodayDate,"موعدش امروز است · ",IF(Q${r}-TodayDate<=3,"موعدش نزدیک است · ",""))),"")&IF(${NS(r)},"قدم بعدی یک پروژه است · ","")&IF(AND(UseGoal="بله",M${r}<>""),"به هدف «"&M${r}&"» کمک می‌کند · ","")&IF(AND(AvailMin>0,H${r}>0,H${r}<=AvailMin),"در زمانی که داری جا می‌شود · ","")&IF(AND(UseEasy="بله",H${r}>0,H${r}<=25),"کوتاه است و شروعش ساده است · ","")&IF(AND(DayEnergy="کم",G${r}="کم"),"با انرژی کمِ الان جور است · ","")&IF(AND(DayEnergy="زیاد",G${r}="زیاد"),"برای انرژی بالای الان مناسب است · ",""))` },
    { c: 'Y', h: 'کمکی: شناسهٔ هدف', w: 6, kind: 'hx', f: (r) => `IF(C${r}="","",IFERROR(INDEX(${P_('C')},MATCH(C${r},${P_('A')},0))&"",""))` },
    { c: 'Z', h: 'کمکی: ترتیب کل', w: 8, kind: 'hx', f: (r) => `IF(OR(W${r}=0,Y${r}=""),"",IFERROR(INDEX(${P_('D')},MATCH(C${r},${P_('A')},0)),0)*1000+D${r})` },
    { c: 'AA', h: 'کمکی: کلید هدف', w: 8, kind: 'hx', f: (r) => `IF(Z${r}="","",Y${r}&"#"&TEXT(Z${r},"000000"))` },
    { c: 'AB', h: 'کمکی: بخش مؤثر', w: 8, kind: 'hx', f: (r) => `IF(AND(B${r}<>"",J${r}="بله"),IF(K${r}="",INDEX(SecNames,1),K${r}),"")` },
    { c: 'AC', h: 'کمکی: قدم بعدی؟', w: 6, kind: 'hx', f: (r) => `AND(S${r}<>"",S${r}=C${r}&"#"&TEXT(_xlfn.MINIFS(${T_('D')},${T_('C')},C${r},${T_('W')},1),"0000"))` },
  ],
  sample: [
    ['T1', 'یک دورهٔ کوتاه React را تمام کنم', 'P1', 1, 'انجام‌شده', 'بالا', 'زیاد', 120, '', '', '', '1405/07/05'],
    ['T2', 'طراحی صفحهٔ اصلی نمونه‌کار', 'P2', 1, 'انجام‌شده', 'بالا', 'متوسط', 90, '', '', '', '1405/07/14'],
    ['T3', 'پیاده‌سازی صفحهٔ پروژه‌ها در نمونه‌کار', 'P2', 2, 'در حال انجام', 'بالا', 'زیاد', 90, '1405/07/22', 'بله', 'سه کار مهم امروز'],
    ['T4', 'انتشار نمونه‌کار روی GitHub Pages', 'P2', 3, 'انجام‌نشده', 'متوسط', 'کم', 30],
    ['T5', 'به‌روزرسانی رزومهٔ انگلیسی', 'P3', 1, 'انجام‌نشده', 'متوسط', 'کم', 40, '', 'بله', 'یک قدم برای آینده شغلی'],
    ['T6', 'جبر خطی: فصل ۳ (مقادیر ویژه)', 'P6', 1, 'انجام‌شده', 'بالا', 'زیاد', 60, '', '', '', '1405/07/18'],
    ['T7', 'آمار و احتمال: حل ۱۰ تمرین', 'P6', 2, 'انجام‌نشده', 'بالا', 'متوسط', 50, '1405/07/20', 'بله', 'یک قدم برای دانشگاه'],
    ['T8', 'مرور یادداشت‌های بهینه‌سازی', 'P6', 3, 'انجام‌نشده', 'متوسط', 'کم', 20],
    ['T9', 'خلاصهٔ مقالهٔ Attention Is All You Need', 'P8', 1, 'انجام‌نشده', 'متوسط', 'متوسط', 45],
    ['T10', 'نوشتن فهرست امکانات اپ لغت', 'P12', 1, 'انجام‌شده', 'متوسط', 'کم', 25, '', '', '', '1405/07/19'],
    ['T11', 'ساخت صفحهٔ مرور لغت‌ها', 'P12', 2, 'انجام‌نشده', 'متوسط', 'زیاد', 90],
    ['T12', 'ایمیل به استاد راهنما دربارهٔ موضوع پایان‌نامه', '', '', 'انجام‌نشده', 'بالا', 'کم', 15, '1405/07/19', 'بله', 'سه کار مهم امروز'],
    ['T13', 'پیاده‌روی ۳۰ دقیقه‌ای', '', '', 'انجام‌نشده', 'متوسط', 'کم', 30, '', 'بله', 'زمان‌های استراحت و آزاد'],
    ['T14', 'مرتب کردن پوشهٔ دانلودها', '', '', 'انجام‌نشده', 'پایین', 'کم', 15, '', 'بله', 'کارهای اختیاری یا کم‌اولویت'],
  ].map(([A, B, C, D, E, F, G, H, I, J, K, L]) => ({ A, B, C, D, E, F, G, H, I, J, K, L })),
});
badDateRule(sTasks, 'I', 'Q', 'tasks'); badDateRule(sTasks, 'L', 'R', 'tasks');
addConditionalStyle(sTasks, `B${FIRST}:P${last('tasks')}`, { type: 'expression', formula: `$E${FIRST}="انجام‌شده"`, format: { font: { color: 'A3ADA7' } } });
addConditionalStyle(sTasks, `I${FIRST}:I${last('tasks')}`, { type: 'expression', formula: `AND(ISNUMBER($Q${FIRST}),$Q${FIRST}<TodayDate,$E${FIRST}<>"انجام‌شده")`, format: { font: { color: COL.warn, bold: true } } });
addConditionalStyle(sTasks, `J${FIRST}:K${last('tasks')}`, { type: 'expression', formula: `AND($J${FIRST}="بله",$E${FIRST}<>"انجام‌شده")`, format: { fill: 'E4EEE8' } });

// ---------- focus sessions ----------
const sSess = dataSheet(b, SH.sess, 'sess', {
  titleText: '⏱ جلسات تمرکز', sub: 'هر جلسه یک ردیف: تاریخ، ساعت شروع و پایان (یا مدت دستی)، روی چه کاری و نتیجه. Ctrl+Shift+; ساعت فعلی را می‌گذارد.', tab: '7FA7C9', table: 'Sessions',
  cols: [
    dateIn('A'),
    { c: 'B', h: 'شروع', w: 8, kind: 'in', fmt: 'hh:mm', vrule: { type: 'time', operator: 'between', formula1: '0', formula2: '0.999999', error: 'ساعت را مثل 09:30 بنویسید.' } },
    { c: 'C', h: 'پایان', w: 8, kind: 'in', fmt: 'hh:mm', vrule: { type: 'time', operator: 'between', formula1: '0', formula2: '0.999999', error: 'ساعت را مثل 10:15 بنویسید.' } },
    { c: 'D', h: 'مدت دستی (دقیقه)', w: 9, kind: 'in', fmt: '0', note: 'اختیاری؛ اگر پر شود به‌جای «پایان − شروع» حساب می‌شود.', vrule: { type: 'whole', operator: 'between', formula1: '1', formula2: '600', error: 'عدد دقیقه بین ۱ تا ۶۰۰.' } },
    { c: 'E', h: 'مدت (دقیقه)', w: 9, kind: 'f', fmt: '0', f: (r) => `IF(A${r}="","",IF(D${r}<>"",D${r},IF(OR(B${r}="",C${r}=""),"",ROUND(MOD(C${r}-B${r},1)*1440,0))))` },
    { c: 'F', h: 'نوع', w: 8, kind: 'in', list: LISTS.kind, align: 'center' },
    { c: 'G', h: 'کار', w: 7, kind: 'in', listRef: 'TaskIds', align: 'center', note: 'شناسهٔ کار (برگهٔ کارها) — زمان به پروژه و هدفش هم ثبت می‌شود.' },
    { c: 'H', h: 'منبع یادگیری', w: 8, kind: 'in', listRef: 'LearnIds', align: 'center', note: 'شناسهٔ منبع (برگهٔ یادگیری) برای جلسه‌های مطالعه.' },
    { c: 'I', h: 'روی چه چیزی؟', w: 32, kind: 'f', f: (r) => `IF(G${r}<>"",IFERROR(INDEX(${T_('B')},MATCH(G${r},${T_('A')},0)),"؟ شناسهٔ کار پیدا نشد"),IF(H${r}<>"",IFERROR(INDEX(${L_('B')},MATCH(H${r},${L_('A')},0)),"؟ شناسهٔ منبع پیدا نشد"),IF(A${r}="","","جلسهٔ آزاد")))` },
    { c: 'J', h: 'پروژه', w: 7, kind: 'f', align: 'center', f: (r) => `IF(G${r}="","",IFERROR(INDEX(${T_('C')},MATCH(G${r},${T_('A')},0))&"",""))` },
    { c: 'K', h: 'هدف', w: 7, kind: 'f', align: 'center', f: (r) => `IF(J${r}="","",IFERROR(INDEX(${P_('C')},MATCH(J${r},${P_('A')},0))&"",""))` },
    { c: 'L', h: 'نتیجهٔ جلسه (چه کردم؟)', w: 40, kind: 'in' },
    { c: 'M', h: 'خروجی (مسیر فایل یا لینک)', w: 28, kind: 'in' },
    gregCol('N', 'A', 'O'), normCol('O', 'A'),
  ],
  sample: [
    ['1405/07/14', 0.375, 0.4375, '', 'کار', 'T2', '', 'طرح صفحهٔ اصلی در Figma و پیاده‌سازی هدر', 'portfolio/home.html'],
    ['1405/07/15', 0.79167, 0.8125, '', 'مطالعه', '', 'L1', 'ویدیوی رگرسیون خطی و یادداشت‌برداری'],
    ['1405/07/16', 0.41667, 0.45833, '', 'کار', 'T3', '', 'ساختار کامپوننت کارت پروژه'],
    ['1405/07/17', 0.70833, 0.75, '', 'مطالعه', '', 'L2', 'فصل ۳ کتاب جبر خطی تا بخش ۳٫۲'],
    ['1405/07/18', 0.375, 0.41667, '', 'کار', 'T6', '', 'حل تمرین‌های مقادیر ویژه', 'notes/eigen.pdf'],
    ['1405/07/18', 0.4375, 0.45833, '', 'کار', 'T3', '', 'اتصال داده‌های پروژه‌ها'],
    ['1405/07/18', 0.83333, 0.85417, '', 'مطالعه', '', 'L3', 'خواندن بخش ۳ مقاله'],
    ['1405/07/19', 0.375, 0.39583, '', 'کار', 'T10', '', 'فهرست امکانات اپ لغت نوشته شد', 'docs/features.md'],
    ['1405/07/19', 0.40625, 0.42708, '', 'کار', 'T3', '', 'نسخهٔ اول صفحهٔ پروژه‌ها کار می‌کند'],
  ].map(([A, B, C, D, F, G, H, L, M]) => ({ A, B, C, D, F, G, H, L, M })),
});
badDateRule(sSess, 'A', 'N', 'sess');

// ---------- learning ----------
const sLearn = dataSheet(b, SH.learn, 'learn', {
  titleText: '📚 فضای یادگیری', sub: 'برای هر دوره، کتاب، مقاله یا ویدیو: آخرین مبحث و قدم بعدی را بنویسید تا ادامه دادن همیشه ساده باشد.', tab: '9C7FC9', table: 'Learning',
  cols: [
    { c: 'A', h: 'شناسه', w: 7, kind: 'in', align: 'center', note: 'شناسهٔ یکتا، مثل L1.' },
    { c: 'B', h: 'عنوان منبع', w: 32, kind: 'in' },
    { c: 'C', h: 'نوع', w: 8, kind: 'in', list: LISTS.learnType, align: 'center' },
    { c: 'D', h: 'وضعیت', w: 13, kind: 'in', list: LISTS.learnStatus, align: 'center' },
    { c: 'E', h: 'پیشرفت', w: 9, kind: 'in', fmt: '0%', vrule: { type: 'decimal', operator: 'between', formula1: '0', formula2: '1', error: 'درصد بین ۰٪ تا ۱۰۰٪.' } },
    { c: 'F', h: 'لینک', w: 22, kind: 'in' },
    { c: 'G', h: 'آخرین مبحث / جلسه', w: 26, kind: 'in' },
    { c: 'H', h: 'قدم بعدی', w: 26, kind: 'in' },
    { c: 'I', h: 'سؤال‌های حل‌نشده', w: 28, kind: 'in', wrap: true },
    { c: 'J', h: 'یادداشت‌های کوتاه', w: 28, kind: 'in', wrap: true },
    { c: 'K', h: 'زمان مطالعه (دقیقه)', w: 10, kind: 'f', fmt: '#,##0', f: (r) => `IF(A${r}="","",SUMIFS(${S_('E')},${S_('H')},A${r}))` },
    { c: 'L', h: 'خروجی‌ها', w: 8, kind: 'f', fmt: '0', f: (r) => `IF(A${r}="","",COUNTIF(${O_('E')},A${r}))` },
    { c: 'M', h: 'آخرین جلسه', w: 11, kind: 'f', align: 'center', f: (r) => `IF(A${r}="","",IF(N${r}=0,"—",${g2jF(`N${r}`)}))` },
    { c: 'N', h: 'کمکی: آخرین جلسه', w: 8, kind: 'hx', fmt: 'yyyy-mm-dd', f: (r) => `IF(A${r}="","",_xlfn.MAXIFS(${S_('N')},${S_('H')},A${r}))` },
    { c: 'O', h: 'کمکی: دقیقه در بازهٔ گزارش', w: 8, kind: 'hx', f: (r) => `IF(A${r}="","",SUMIFS(${S_('E')},${S_('H')},A${r},${S_('N')},">="&RepFrom,${S_('N')},"<="&RepTo))` },
    { c: 'P', h: 'کمکی: رتبه', w: 8, kind: 'hx', f: (r) => `IF(OR(O${r}="",O${r}=0),"",O${r}+ROW()/1000000)` },
  ],
  sample: [
    { A: 'L1', B: 'دورهٔ یادگیری ماشین (Andrew Ng)', C: 'دوره', D: 'در حال یادگیری', E: 0.35, F: 'https://www.coursera.org/specializations/machine-learning-introduction', G: 'رگرسیون خطی', H: 'رگرسیون لجستیک', I: 'چرا نرخ یادگیری خیلی بزرگ واگرا می‌شود؟', J: 'نمودار تابع هزینه را برای چند α رسم کنم' },
    { A: 'L2', B: 'کتاب جبر خطی (Gilbert Strang)', C: 'کتاب', D: 'در حال یادگیری', E: 0.4, G: 'فصل ۳، بخش ۳٫۲', H: 'بخش ۳٫۳ و تمرین‌های آخر فصل', I: 'شهود هندسی بردار ویژه؟' },
    { A: 'L3', B: 'مقالهٔ Attention Is All You Need', C: 'مقاله', D: 'در حال یادگیری', E: 0.6, F: 'https://arxiv.org/abs/1706.03762', G: 'بخش ۳ (معماری)', H: 'بخش ۵ (آموزش) و خلاصه‌نویسی' },
  ],
});
addConditionalStyle(sLearn, `E${FIRST}:E${last('learn')}`, { type: 'dataBar', thresholds: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }], color: 'B3A3D6' });

// ---------- outputs ----------
const sOuts = dataSheet(b, SH.outs, 'outs', {
  titleText: '📦 خروجی‌ها و تمرین‌ها', sub: 'کد، مسئلهٔ حل‌شده، فایل پروژه، تصویر نتیجه یا لینک. مسیر فایل روی کامپیوتر یا لینک را بنویسید؛ «باز کردن» مستقیم بازش می‌کند.', tab: '9C7FC9', table: 'Outputs',
  cols: [
    dateIn('A'), { c: 'B', h: 'عنوان', w: 32, kind: 'in' }, { c: 'C', h: 'نوع', w: 13, kind: 'in', list: LISTS.outType, align: 'center' },
    { c: 'D', h: 'کار', w: 7, kind: 'in', listRef: 'TaskIds', align: 'center' }, { c: 'E', h: 'منبع یادگیری', w: 8, kind: 'in', listRef: 'LearnIds', align: 'center' },
    { c: 'F', h: 'مسیر فایل یا لینک', w: 34, kind: 'in', note: 'مثلاً C:\\Projects\\hw2.py یا https://github.com/...' },
    { c: 'G', h: 'باز کردن', w: 11, kind: 'f', align: 'center', f: (r) => `IF(F${r}="","",HYPERLINK(F${r},"↗ باز کردن"))` },
    { c: 'H', h: 'توضیح یا کد کوتاه', w: 40, kind: 'in', wrap: true },
    { c: 'I', h: 'مربوط به', w: 30, kind: 'f', f: (r) => `IF(D${r}<>"",IFERROR(INDEX(${T_('B')},MATCH(D${r},${T_('A')},0)),"؟"),IF(E${r}<>"",IFERROR(INDEX(${L_('B')},MATCH(E${r},${L_('A')},0)),"؟"),""))` },
    gregCol('J', 'A', 'K'), normCol('K', 'A'),
  ],
  sample: [
    { A: '1405/07/14', B: 'صفحهٔ اصلی نمونه‌کار', C: 'فایل پروژه', D: 'T2', F: 'https://github.com/username/portfolio', H: 'نسخهٔ اول با HTML/CSS' },
    { A: '1405/07/15', B: 'نوت‌بوک رگرسیون خطی', C: 'کد', E: 'L1', F: 'ml/linear_regression.ipynb', H: 'w = w - alpha * grad' },
    { A: '1405/07/18', B: 'حل تمرین‌های مقادیر ویژه', C: 'مسئلهٔ حل‌شده', D: 'T6', F: 'notes/eigen.pdf' },
    { A: '1405/07/19', B: 'فهرست امکانات اپ لغت', C: 'یادداشت', D: 'T10', F: 'docs/features.md' },
  ],
});
badDateRule(sOuts, 'A', 'J', 'outs');

// ---------- ideas ----------
const sIdeas = dataSheet(b, SH.ideas, 'ideas', {
  titleText: '💡 ایده‌ها و مقالات مهم', sub: 'هر ایده یا مقاله‌ای که نباید گم شود.', tab: '9C7FC9', table: 'Ideas',
  cols: [dateIn('A'), { c: 'B', h: 'نوع', w: 11, kind: 'in', list: LISTS.ideaKind, align: 'center' }, { c: 'C', h: 'عنوان', w: 36, kind: 'in' }, { c: 'D', h: 'لینک', w: 30, kind: 'in' }, { c: 'E', h: 'توضیح', w: 44, kind: 'in', wrap: true }, { c: 'F', h: 'وضعیت', w: 13, kind: 'in', list: LISTS.ideaStatus, align: 'center' }],
  sample: [
    { A: '1405/07/12', B: 'ایده', C: 'اپ تمرین مصاحبهٔ برنامه‌نویسی', E: 'هر روز یک سؤال با تایمر', F: 'جدید' },
    { A: '1405/07/16', B: 'مقالهٔ مهم', C: 'BERT: Pre-training of Deep Bidirectional Transformers', D: 'https://arxiv.org/abs/1810.04805', F: 'در حال بررسی' },
  ],
});

// ---------- journal ----------
const sJour = dataSheet(b, SH.jour, 'jour', {
  titleText: '📓 دفتر شخصی', sub: 'فقط برای خودت. حال و انرژی از ۱ (کم) تا ۵ (زیاد).', tab: 'C97F8F', table: 'Journal',
  cols: [
    dateIn('A'),
    { c: 'B', h: 'حال (۱ تا ۵)', w: 9, kind: 'in', fmt: '0', vrule: { type: 'whole', operator: 'between', formula1: '1', formula2: '5', error: 'عددی بین ۱ تا ۵.' } },
    { c: 'C', h: 'انرژی (۱ تا ۵)', w: 9, kind: 'in', fmt: '0', vrule: { type: 'whole', operator: 'between', formula1: '1', formula2: '5', error: 'عددی بین ۱ تا ۵.' } },
    { c: 'D', h: 'افکار و احساسات', w: 40, kind: 'in', wrap: true }, { c: 'E', h: 'اتفاقات مهم', w: 32, kind: 'in', wrap: true }, { c: 'F', h: 'چه یاد گرفتم؟', w: 32, kind: 'in', wrap: true },
    gregCol('G', 'A', 'H'), normCol('H', 'A'),
  ],
  sample: [
    { A: '1405/07/16', B: 3, C: 2, D: 'کمی خسته بودم ولی جلسهٔ کوتاه کمک کرد.', F: 'کامپوننت‌ها را کوچک‌تر نگه دارم' },
    { A: '1405/07/18', B: 4, C: 4, D: 'روز پرانرژی؛ دو جلسهٔ خوب.', E: 'تمرین‌های جبر خطی تمام شد', F: 'شهود مقادیر ویژه' },
    { A: '1405/07/19', B: 4, C: 3, D: 'آرام شروع کردم.', E: 'فهرست امکانات اپ لغت نوشته شد' },
  ],
});
badDateRule(sJour, 'A', 'G', 'jour');
addConditionalStyle(sJour, `B${FIRST}:C${last('jour')}`, { type: 'colorScale', thresholds: [{ type: 'num', value: 1 }, { type: 'num', value: 3 }, { type: 'num', value: 5 }], colors: ['F3D9D2', 'F7F1DE', 'D5E8DC'] });

// ---------- weekly review ----------
const sWeek = addWorksheetSpec(b, SH.week, { showGridlines: false, tabColor: 'D9A35B', freezePanes: 'A3', columnWidths: { A: 2, B: 18, C: 26, D: 26, E: 26, F: 26, G: 14, H: 14, I: 3, Y: 8, Z: 11 }, rowHeights: Object.assign({ 1: 30, 26: 30, 20: 30, 21: 30, 22: 30, 23: 30, 44: 34 }, Object.fromEntries(Array.from({ length: 52 }, (_, i) => [45 + i, 32]))) });
{
  const s = sWeek; const W = 'WeekStart';
  applyRangeStyle(s, 'A1:H96', base);
  title(s, '🗓 مرور هفتگی', 'آمار هفته خودکار است. پایین صفحه برای هر هفته چند خط بنویس: چه خوب بود، موانع، چه باید تغییر کند.');
  writeCellValues(s, 'B4', [['شروع هفته (شمسی)']]);
  applyRangeStyle(s, 'B4', { bold: true });
  applyRangeStyle(s, 'C4', { fill: COL.input, border: { color: COL.line }, align: 'center', numberFormat: '@' });
  addCellNote(s, 'C4', 'خالی = هفتهٔ جاری. هر تاریخی از هفته را بنویسید؛ شنبهٔ همان هفته حساب می‌شود.', { author: 'رویش' });
  writeCellFormulas(s, 'D4', [[`"از "&${jLongF(W)}&" تا "&${jLongF(W + '+6')}`]]);
  applyRangeStyle(s, 'D4', { fontColor: COL.sub });
  writeCellFormulas(s, 'Y4:Z4', [[normF('C4'), `IF(ISNUMBER(Z3),Z3-MOD(WEEKDAY(Z3),7),TodayDate-MOD(WEEKDAY(TodayDate),7))`]]);
  writeCellFormulas(s, 'Z3', [[`IF(C4="",TodayDate,${j2gF('C4', 'Y4')})`]]);
  applyRangeStyle(s, 'Y3:Z4', { fontColor: '999999', numberFormat: 'yyyy-mm-dd' });
  writeCellValues(s, 'B6:G6', [['دقیقهٔ تمرکز', 'جلسه', 'کار انجام‌شده', 'خروجی', 'روز فعال', 'میانگین حال']]);
  writeCellFormulas(s, 'B7:G7', [['C17', 'E17', 'F17', 'G17', `SUMPRODUCT(--((C10:C16+E10:E16+F10:F16+G10:G16+(H10:H16<>""))>0))`, `IFERROR(AVERAGEIFS(${J_('B')},${J_('G')},">="&${W},${J_('G')},"<="&${W}+6),"—")`]]);
  applyRangeStyle(s, 'B6:G6', { fontColor: COL.sub, align: 'center', fill: COL.soft, border: { color: COL.line } });
  applyRangeStyle(s, 'B7:G7', { fontSize: 16, bold: true, fontColor: COL.accent, align: 'center', fill: COL.soft, border: { color: COL.line }, numberFormat: '#,##0' });
  applyRangeStyle(s, 'G7', { numberFormat: '0.0' });
  writeCellValues(s, 'B9:H9', [['روز', 'دقیقهٔ تمرکز', 'تاریخ', 'جلسه', 'کار انجام‌شده', 'خروجی', 'حال']]);
  const days = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
  writeCellValues(s, 'B10:B16', days.map((d) => [d]));
  writeCellFormulas(s, 'C10:H16', days.map((_, i) => {
    const d = `(${W}+${i})`;
    return [`SUMIFS(${S_('E')},${S_('N')},${d})`, g2jF(d), `COUNTIFS(${S_('N')},${d},${S_('E')},">0")`, `COUNTIFS(${T_('R')},${d})`, `COUNTIFS(${O_('J')},${d})`, `IFERROR(AVERAGEIFS(${J_('B')},${J_('G')},${d}),"")`];
  }));
  writeCellValues(s, 'B17', [['جمع هفته']]);
  writeCellFormulas(s, 'C17:H17', [['SUM(C10:C16)', '""', 'SUM(E10:E16)', 'SUM(F10:F16)', 'SUM(G10:G16)', 'IFERROR(AVERAGE(H10:H16),"")']]);
  applyRangeStyle(s, 'B9:H9', { bold: true, fill: COL.head, fontColor: COL.headInk, align: 'center' });
  applyRangeStyle(s, 'B10:H17', { border: { color: COL.line }, align: 'center' });
  applyRangeStyle(s, 'C10:C17', { numberFormat: '0' }); applyRangeStyle(s, 'E10:G17', { numberFormat: '0' }); applyRangeStyle(s, 'H10:H17', { numberFormat: '0.0' });
  applyRangeStyle(s, 'B17:H17', { bold: true, fill: COL.band });
  addConditionalStyle(s, 'C10:C16', { type: 'dataBar', thresholds: ['min', 'max'], color: '8DB7A0' });
  addChartSpec(s, 'column', `'${SH.week}'!B9:C16`, { title: 'دقیقهٔ تمرکز در هر روز هفته', anchor: 'C28', width: 9, height: 7, valueAxisTitle: 'دقیقه' });
  // this week's review (lookup)
  sectionHead(s, 'B19:H19', 'مرور نوشته‌شدهٔ این هفته');
  const Q = [['C', 'چه چیزهایی خوب پیش رفت؟'], ['D', 'با چه موانعی روبه‌رو شدم؟'], ['E', 'چه چیزی باید تغییر کند؟'], ['F', 'برنامه و اولویت‌های هفتهٔ بعد']];
  Q.forEach(([c, q], i) => {
    writeCellValues(s, `B${20 + i}`, [[q]]);
    writeCellFormulas(s, `C${20 + i}`, [[`IFERROR(INDEX($${c}$45:$${c}$96,MATCH(${W},$Z$45:$Z$96,0))&"","")&IF(ISNA(MATCH(${W},$Z$45:$Z$96,0)),"— هنوز ننوشته‌ای؛ در جدول پایین یک ردیف برای این هفته اضافه کن.","")`]]);
  });
  applyRangeStyle(s, 'B20:B23', { bold: true, fontColor: COL.sub, wrapText: true });
  // review log table
  const r0 = 45, r1 = 96;
  sectionHead(s, 'B43:H43', 'دفترچهٔ مرورهای هفتگی');
  writeCellValues(s, 'B44:H44', [['هفته (یک تاریخ شمسی)', 'چه چیزهایی خوب پیش رفت؟', 'با چه موانعی روبه‌رو شدم؟', 'چه چیزی باید تغییر کند؟', 'برنامهٔ هفتهٔ بعد', 'دقیقهٔ تمرکز', 'کار انجام‌شده']]);
  applyRangeStyle(s, 'B44:H44', { bold: true, fill: COL.head, fontColor: COL.headInk, align: 'center', wrapText: true });
  applyRangeStyle(s, `B${r0}:H${r1}`, Object.assign({}, base, { border: { color: COL.line } }));
  applyRangeStyle(s, `B${r0}:B${r1}`, { align: 'center', numberFormat: '@' });
  applyRangeStyle(s, `C${r0}:F${r1}`, { wrapText: true });
  applyRangeStyle(s, `G${r0}:H${r1}`, { fill: COL.calc, fontColor: COL.sub, align: 'center', numberFormat: '#,##0' });
  writeCellFormulas(s, `G${r0}:H${r1}`, Array.from({ length: r1 - r0 + 1 }, (_, i) => { const r = r0 + i; return [`IF(Z${r}="","",SUMIFS(${S_('E')},${S_('N')},">="&Z${r},${S_('N')},"<="&Z${r}+6))`, `IF(Z${r}="","",COUNTIFS(${T_('R')},">="&Z${r},${T_('R')},"<="&Z${r}+6))`]; }));
  writeCellFormulas(s, `Y${r0}:Z${r1}`, Array.from({ length: r1 - r0 + 1 }, (_, i) => { const r = r0 + i; return [normF(`B${r}`), `IF(B${r}="","",IFERROR(${j2gF(`B${r}`, `Y${r}`)}-MOD(WEEKDAY(${j2gF(`B${r}`, `Y${r}`)}),7),""))`]; }));
  applyRangeStyle(s, `Y${r0}:Z${r1}`, { fontColor: '999999', numberFormat: 'yyyy-mm-dd' });
  writeCellValues(s, 'Y44:Z44', [['کمکی', 'کمکی: شنبه']]);
  writeCellValues(s, `B${r0}:F${r0}`, [['1405/07/11', 'هر روز حداقل یک جلسهٔ کوتاه داشتم', 'شب‌ها دیر خوابیدم و صبح‌ها کم‌انرژی بودم', 'کارهای سنگین را به صبح‌های پرانرژی ببرم', 'تمام کردن صفحهٔ پروژه‌ها و فصل ۳ جبر']]);
  addValidationRule(s, 'C4', { type: 'textLength', operator: 'lessThanOrEqual', formula1: '12', allowBlank: true, error: 'تاریخ شمسی مثل 1405/07/19' });
  helpers[SH.week] = ['Y', 'Z'];
}

// ---------- report ----------
const sRep = addWorksheetSpec(b, SH.rep, { showGridlines: false, tabColor: 'D9A35B', columnWidths: { A: 2, B: 30, C: 12, D: 3, E: 30, F: 12, G: 3, H: 30, I: 12, Y: 8, Z: 11 }, rowHeights: { 1: 30 } });
{
  const s = sRep;
  applyRangeStyle(s, 'A1:I30', base);
  title(s, '📊 گزارش زمان', 'بازه را انتخاب کنید (خالی = از اول ماه شمسی جاری تا امروز). زمان هر هدف، پروژه و منبع یادگیری به‌ترتیب بیشترین.');
  writeCellValues(s, 'B4:B5', [['از تاریخ (شمسی)'], ['تا تاریخ (شمسی)']]);
  applyRangeStyle(s, 'B4:B5', { bold: true });
  applyRangeStyle(s, 'C4:C5', { fill: COL.input, border: { color: COL.line }, align: 'center', numberFormat: '@' });
  writeCellFormulas(s, 'Y4:Y5', [[normF('C4')], [normF('C5')]]);
  writeCellFormulas(s, 'Z4:Z5', [[`IF(C4="",${persianMonthStartF('TodayDate')},IFERROR(${j2gF('C4', 'Y4')}+0,${persianMonthStartF('TodayDate')}))`], [`IF(C5="",TodayDate,IFERROR(${j2gF('C5', 'Y5')}+0,TodayDate))`]]);
  applyRangeStyle(s, 'Y4:Z5', { fontColor: '999999', numberFormat: 'yyyy-mm-dd' });
  writeCellFormulas(s, 'E4:E5', [[`"← "&${jLongF('RepFrom')}`], [`"← "&${jLongF('RepTo')}&IF(RepTo<RepFrom,"  (⚠ «تا» قبل از «از» است)","")`]]);
  applyRangeStyle(s, 'E4:E5', { fontColor: COL.sub });
  const inR = (rng, col) => `${rng},">="&RepFrom,${rng},"<="&RepTo`;
  writeCellValues(s, 'B7:F7', [['دقیقهٔ تمرکز', 'جلسه', '', 'کار انجام‌شده', 'خروجی']]);
  writeCellFormulas(s, 'B8:F8', [[`SUMIFS(${S_('E')},${inR(S_('N'))})`, `COUNTIFS(${inR(S_('N'))},${S_('E')},">0")`, '""', `COUNTIFS(${inR(T_('R'))})`, `COUNTIFS(${inR(O_('J'))})`]]);
  writeCellValues(s, 'H7', [['تقسیم زمان']]);
  writeCellFormulas(s, 'H8', [[`"مطالعه: "&SUMIFS(${S_('E')},${inR(S_('N'))},${S_('F')},"مطالعه")&" د · کار: "&SUMIFS(${S_('E')},${inR(S_('N'))},${S_('F')},"<>مطالعه")&" د"`]]);
  applyRangeStyle(s, 'B7:H7', { fontColor: COL.sub, align: 'center' });
  applyRangeStyle(s, 'B8:F8', { fontSize: 16, bold: true, fontColor: COL.accent, align: 'center', numberFormat: '#,##0' });
  applyRangeStyle(s, 'H8', { align: 'center', bold: true, fontColor: COL.accent });
  applyRangeStyle(s, 'B7:I8', { fill: COL.soft });
  const blocks = [['B', 'C', 'زمان هر هدف', G_('O'), G_('B')], ['E', 'F', 'زمان هر مرحله / پروژه', P_('Q'), P_('B')], ['H', 'I', 'زمان هر منبع یادگیری', L_('P'), L_('B')]];
  for (const [t, m, head, key, names] of blocks) {
    writeCellValues(s, `${t}10:${m}11`, [[head, ''], ['عنوان', 'دقیقه']]);
    applyRangeStyle(s, `${t}10:${m}10`, { bold: true, fontSize: 12, fontColor: COL.accent, fill: COL.band });
    applyRangeStyle(s, `${t}11:${m}11`, { bold: true, fill: COL.head, fontColor: COL.headInk, align: 'center' });
    writeCellFormulas(s, `${t}12:${m}26`, Array.from({ length: 15 }, (_, i) => [`IFERROR(INDEX(${names},MATCH(LARGE(${key},${i + 1}),${key},0)),"")`, `IFERROR(ROUND(LARGE(${key},${i + 1}),0),"")`]));
    applyRangeStyle(s, `${t}12:${m}26`, { border: { color: COL.line } });
    applyRangeStyle(s, `${m}12:${m}26`, { numberFormat: '#,##0', align: 'center' });
    addConditionalStyle(s, `${m}12:${m}26`, { type: 'dataBar', thresholds: [{ type: 'num', value: 0 }, 'max'], color: '8DB7A0' });
  }
  writeCellValues(s, 'B28', [['جلسه‌های بدون پروژه (آزاد یا کار مستقل) — دقیقه:']]);
  writeCellFormulas(s, 'C28', [[`SUMIFS(${S_('E')},${inR(S_('N'))},${S_('J')},"",${S_('H')},"")`]]);
  applyRangeStyle(s, 'B28', { fontColor: COL.sub }); applyRangeStyle(s, 'C28', { bold: true, align: 'center', numberFormat: '#,##0' });
  addValidationRule(s, 'C4:C5', { type: 'textLength', operator: 'lessThanOrEqual', formula1: '12', allowBlank: true, error: 'تاریخ شمسی مثل 1405/07/01' });
  helpers[SH.rep] = ['Y', 'Z'];
}

// ---------- settings ----------
const sSet = addWorksheetSpec(b, SH.set, { showGridlines: false, tabColor: '8A9A91', columnWidths: { A: 2, B: 40, C: 16, D: 18, E: 20, F: 3, H: 10 }, rowHeights: { 1: 30 } });
{
  const s = sSet;
  applyRangeStyle(s, 'A1:E81', base);
  title(s, '⚙️ تنظیمات', 'سلول‌های کرم‌رنگ قابل تغییرند؛ بقیه خودکار حساب می‌شوند.');
  sectionHead(s, 'B3:E3', 'امروز');
  writeCellValues(s, 'B4:B6', [['تاریخ امروز (اختیاری، شمسی)'], ['تاریخ امروز (محاسبه‌شده)'], ['چند روز دوری = «بازگشت آرام»']]);
  writeCellFormulas(s, 'H4', [[normF('C4')]]);
  writeCellFormulas(s, 'C5', [[`IF(C4="",TODAY(),IFERROR(${j2gF('C4', 'H4')}+0,TODAY()))`]]);
  writeCellFormulas(s, 'D5', [[jLongF('C5')]]);
  writeCellValues(s, 'C6', [[3]]);
  writeCellValues(s, 'D4', [['خالی = تاریخ سیستم']]);
  sectionHead(s, 'B8:E8', 'الگوی پومودورو (دقیقه)');
  writeCellValues(s, 'B9:C12', [['تمرکز', 25], ['استراحت کوتاه', 5], ['استراحت بلند', 15], ['تعداد جلسه تا استراحت بلند', 4]]);
  sectionHead(s, 'B14:E14', 'معیارهای «از کجا شروع کنم؟» (اولویت، زمان، انرژی و وضعیت همیشه حساب می‌شوند)');
  writeCellValues(s, 'B15:C17', [['نزدیکی مهلت‌ها', 'بله'], ['شروع آسان (کارهای کوتاه)', 'بله'], ['ارتباط با اهداف بلندمدت', 'بله']]);
  sectionHead(s, 'B19:E19', 'نوع روز');
  writeCellValues(s, 'B20:E24', [['نوع روز', 'انرژی', 'بودجهٔ زمانی (دقیقه)', 'حداکثر کار پیشنهادی'], ['شلوغ', 'متوسط', 60, 2], ['کم‌انرژی', 'کم', 90, 2], ['معمولی', 'متوسط', 180, 3], ['پرانرژی', 'زیاد', 300, 4]]);
  sectionHead(s, 'B26:E26', 'بخش‌های صفحهٔ امروز (تعداد، نام و ظرفیت دست شماست؛ حداکثر ۶)');
  writeCellValues(s, 'B27:C33', [['نام بخش', 'ظرفیت'], ['سه کار مهم امروز', 3], ['یک قدم برای آینده شغلی', 1], ['یک قدم برای دانشگاه', 1], ['زمان‌های استراحت و آزاد', 3], ['کارهای اختیاری یا کم‌اولویت', 5], ['', '']]);
  sectionHead(s, 'B35:E35', 'جدول نوروز برای تبدیل تاریخ شمسی (دست نزنید)');
  writeCellValues(s, 'B36:C36', [['سال شمسی', '۱ فروردین (میلادی)']]);
  const years = Array.from({ length: 36 }, (_, i) => 1395 + i);
  writeCellValues(s, 'B37:B72', years.map((y) => [y]));
  writeCellFormulas(s, 'C37:C72', years.map((y) => { const g = toGregorian(y, 1, 1); return [`DATE(${g.gy},${g.gm},${g.gd})`]; }));
  sectionHead(s, 'B75:E75', 'محاسبات امروز (خودکار)');
  writeCellValues(s, 'B76:B81', [['انرژی امروز'], ['آخرین روز فعال'], ['روزهای دوری'], ['برنامهٔ سبک (بازگشت آرام)؟'], ['بودجهٔ زمانی امروز (دقیقه)'], ['حداکثر کار پیشنهادی امروز']]);
  const dt = (r) => `IFERROR(INDEX(${r},MATCH(DayType,DayTypes,0)),INDEX(${r},3))`;
  const before = (rg) => `_xlfn.MAXIFS(${rg},${rg},"<"&TodayDate)`;
  writeCellFormulas(s, 'C76:C81', [[dt('DT_Energy')], [`MAX(${before(S_('N'))},${before(T_('R'))},${before(J_('G'))})`], ['IF(C77=0,0,TodayDate-C77)'], ['IF(AND(C77>0,C78>=ComebackDays),"بله","خیر")'],
    [`IF(C79="بله",MAX(30,ROUND(IF(AvailMin>0,AvailMin,${dt('DT_Budget')})*0.6,0)),IF(AvailMin>0,AvailMin,${dt('DT_Budget')}))`], [`IF(C79="بله",MAX(1,${dt('DT_Max')}-1),${dt('DT_Max')})`]]);
  writeCellFormulas(s, 'D77', [['IF(C77=0,"—",' + g2jF('C77') + ')']]);
  // styles
  applyRangeStyle(s, 'B4:B6', { bold: true }); applyRangeStyle(s, 'B9:B12', { bold: true }); applyRangeStyle(s, 'B15:B17', { bold: true }); applyRangeStyle(s, 'B76:B81', { bold: true });
  for (const r of ['C4', 'C6', 'C9:C12', 'C15:C17', 'B21:E24', 'B28:C33']) applyRangeStyle(s, r, { fill: COL.input, border: { color: COL.line } });
  for (const r of ['C5:D5', 'C37:C72', 'C76:D81']) applyRangeStyle(s, r, { fill: COL.calc, fontColor: COL.sub, border: { color: COL.line } });
  applyRangeStyle(s, 'B20:E20', { bold: true, fill: COL.head, fontColor: COL.headInk, align: 'center' });
  applyRangeStyle(s, 'B27:C27', { bold: true, fill: COL.head, fontColor: COL.headInk, align: 'center' });
  applyRangeStyle(s, 'B36:C36', { bold: true, fill: COL.head, fontColor: COL.headInk, align: 'center' });
  applyRangeStyle(s, 'C4:C81', { align: 'center' }); applyRangeStyle(s, 'D21:E24', { align: 'center' }); applyRangeStyle(s, 'B37:B72', { align: 'center', numberFormat: '0' });
  applyRangeStyle(s, 'C5', { numberFormat: 'yyyy-mm-dd' }); applyRangeStyle(s, 'C37:C72', { numberFormat: 'yyyy-mm-dd' }); applyRangeStyle(s, 'C77', { numberFormat: 'yyyy-mm-dd' });
  applyRangeStyle(s, 'C4', { numberFormat: '@' }); applyRangeStyle(s, 'C6', { numberFormat: '0' }); applyRangeStyle(s, 'C9:C12', { numberFormat: '0' });
  applyRangeStyle(s, 'D21:E24', { numberFormat: '0' }); applyRangeStyle(s, 'C28:C33', { numberFormat: '0', align: 'center' }); applyRangeStyle(s, 'C78', { numberFormat: '0' }); applyRangeStyle(s, 'C80:C81', { numberFormat: '0' });
  applyRangeStyle(s, 'D4:D5', { fontColor: COL.sub }); applyRangeStyle(s, 'H4', { fontColor: '999999' });
  addValidationRule(s, 'C15:C17', { type: 'list', values: LISTS.yesno });
  addValidationRule(s, 'C21:C24', { type: 'list', values: LISTS.energy });
  addValidationRule(s, 'C6', { type: 'whole', operator: 'between', formula1: '1', formula2: '30', error: 'عددی بین ۱ تا ۳۰.' });
  addValidationRule(s, 'C9:C11', { type: 'whole', operator: 'between', formula1: '1', formula2: '300', error: 'عددی بین ۱ تا ۳۰۰.' });
  addValidationRule(s, 'C12', { type: 'whole', operator: 'between', formula1: '1', formula2: '12', error: 'عددی بین ۱ تا ۱۲.' });
  addValidationRule(s, 'C28:C33', { type: 'whole', operator: 'between', formula1: '1', formula2: '20', allowBlank: true, error: 'ظرفیت بین ۱ تا ۲۰.' });
  addValidationRule(s, 'C4', { type: 'textLength', operator: 'lessThanOrEqual', formula1: '12', allowBlank: true, error: 'تاریخ شمسی مثل 1405/07/19' });
  helpers[SH.set] = ['H'];
}
for (const [n, ref] of Object.entries(NAMES)) defineWorkbookName(b, n, ref);

// ---------- dashboard: today ----------
{
  const s = sToday;
  applyRangeStyle(s, 'A1:I48', base);
  writeCellValues(s, 'B1', [['🌿 رویش · امروز']]);
  applyRangeStyle(s, 'B1', { fontFamily: FONT, fontSize: 20, bold: true, fontColor: COL.ink });
  writeCellFormulas(s, 'B2', [[jLongF('TodayDate')]]);
  applyRangeStyle(s, 'B2', { fontSize: 12, fontColor: COL.sub });
  writeCellFormulas(s, 'F2', [[`IF(LightMode="بله","🌱 خوش برگشتی! "&GapDays&" روز از آخرین فعالیتت گذشته. لازم نیست چیزی را جبران کنی؛ امروز یک برنامهٔ سبک کافی است.","")`]]);
  applyRangeStyle(s, 'F2', { fontColor: COL.accent, italic: true });
  // inputs
  writeCellValues(s, 'B4:B6', [['نوع روز'], ['زمان در دسترس امروز (دقیقه)'], ['انرژی و بودجهٔ امروز']]);
  writeCellValues(s, 'C4', [['معمولی']]);
  writeCellFormulas(s, 'C6:D6', [['DayEnergy', `DayBudget&" دقیقه · تا "&DayMax&" کار"`]]);
  applyRangeStyle(s, 'B4:B6', { bold: true });
  applyRangeStyle(s, 'C4:C5', { fill: COL.input, border: { color: COL.line }, align: 'center' });
  applyRangeStyle(s, 'C5', { numberFormat: '0' });
  applyRangeStyle(s, 'C6:D6', { fill: COL.calc, fontColor: COL.sub, align: 'center', border: { color: COL.line } });
  addValidationRule(s, 'C4', { type: 'list', formula1: 'DayTypes', error: 'یکی از نوع‌های روز را انتخاب کنید.' });
  addValidationRule(s, 'C5', { type: 'whole', operator: 'between', formula1: '0', formula2: '1000', allowBlank: true, error: 'عدد دقیقه.' });
  addCellNote(s, 'C5', 'اختیاری. خالی = بودجهٔ پیش‌فرضِ نوع روز (برگهٔ تنظیمات).', { author: 'رویش' });
  writeCellFormulas(s, 'F4:F6', [[`"حال امروز در دفتر: "&IFERROR(CHOOSE(INDEX(${J_('B')},MATCH(TodayDate,${J_('G')},0)),"😞","😕","😐","🙂","😄"),"— (هنوز ننوشته‌ای)")`], ['"کارهای باز در کل: "&COUNTIF(' + T_('W') + ',1)&" · امروز: "&COUNTIFS(' + T_('AB') + ',"?*",' + T_('E') + ',"<>انجام‌شده")'], [`"برای تغییر بخش‌ها، پومودورو و معیارها ← برگهٔ تنظیمات"`]]);
  applyRangeStyle(s, 'F4:F6', { fontColor: COL.sub });
  // where am I
  sectionHead(s, 'B8:D8', 'کجا هستم؟');
  writeCellValues(s, 'B9:B12', [['تمرکز امروز (دقیقه)'], ['جلسه‌های امروز'], ['کارهای انجام‌شدهٔ امروز'], ['استراحت بعدی']]);
  writeCellFormulas(s, 'C9:C12', [[`SUMIFS(${S_('E')},${S_('N')},TodayDate)`], [`COUNTIFS(${S_('N')},TodayDate,${S_('E')},">0")`], [`COUNTIFS(${T_('R')},TodayDate)`],
    ['IF(C10=0,PomShort&" دقیقه بعد از اولین جلسه",IF(MOD(C10,PomEvery)=0,"بلند: "&PomLong&" دقیقه","کوتاه: "&PomShort&" دقیقه"))']]);
  applyRangeStyle(s, 'C9:C11', { fontSize: 14, bold: true, fontColor: COL.accent, align: 'center', numberFormat: '#,##0' });
  applyRangeStyle(s, 'C12', { align: 'center', fontColor: COL.accent });
  writeCellFormulas(s, 'D9', [[`"این هفته: "&SUMIFS(${S_('E')},${S_('N')},">="&(TodayDate-MOD(WEEKDAY(TodayDate),7)),${S_('N')},"<="&TodayDate)&" د"`]]);
  applyRangeStyle(s, 'D9:D12', { fontColor: COL.sub, align: 'center' });
  applyRangeStyle(s, 'B9:D12', { fill: COL.soft, border: { color: COL.line } });
  // suggestion
  sectionHead(s, 'F8:H8', '🧭 الان از کجا شروع کنم؟');
  const best = `MATCH(MAX(${T_('O')}),${T_('O')},0)`;
  writeCellFormulas(s, 'F9:F12', [
    [`IF(COUNT(${T_('O')})=0,"هنوز کار بازی نیست؛ در برگهٔ «کارها» یک کار کوچک بنویس.",INDEX(${T_('B')},${best}))`],
    [`IF(COUNT(${T_('O')})=0,"","چرا؟ "&INDEX(${T_('P')},${best}))`],
    [`IF(COUNT(${T_('O')})=0,"","▶ یک جلسهٔ "&IF(INDEX(${T_('H')},${best})>0,MIN(INDEX(${T_('H')},${best}),IF(AvailMin>0,MIN(50,AvailMin),50)),MIN(IF(DayEnergy="کم",15,25),IF(AvailMin>0,MIN(50,AvailMin),50)))&" دقیقه‌ای شروع کن و در برگهٔ «جلسات تمرکز» ثبتش کن.")`],
    [`IF(COUNT(${T_('O')})<2,"","گزینه‌های دیگر: "&INDEX(${T_('B')},MATCH(LARGE(${T_('O')},2),${T_('O')},0))&IF(COUNT(${T_('O')})>=3," · "&INDEX(${T_('B')},MATCH(LARGE(${T_('O')},3),${T_('O')},0)),""))`],
  ]);
  applyRangeStyle(s, 'F9', { fontSize: 14, bold: true, fontColor: COL.ink });
  applyRangeStyle(s, 'F10:F12', { fontColor: COL.sub, wrapText: true, verticalAlign: 'top' });
  applyRangeStyle(s, 'F9:H12', { fill: 'EEF5F0' });
  // proposed plan
  sectionHead(s, 'B14:D14', '🗓 برنامهٔ پیشنهادی امروز');
  writeCellValues(s, 'B15:D15', [['کار (بر اساس امتیاز)', 'زمان (دقیقه)', 'جمع / بودجه']]);
  writeCellFormulas(s, 'B16:D19', Array.from({ length: 4 }, (_, i) => {
    const k = i + 1, r = 16 + i, m = `MATCH(LARGE(${T_('O')},${k}),${T_('O')},0)`;
    return [`IF(OR(${k}>DayMax,COUNT(${T_('O')})<${k}),"",INDEX(${T_('B')},${m}))`, `IF(B${r}="","",IF(INDEX(${T_('H')},${m})>0,INDEX(${T_('H')},${m}),25))`, `IF(B${r}="","",IF(SUM($C$16:C${r})<=DayBudget,"✓ "&SUM($C$16:C${r})&" از "&DayBudget,"⚠ "&SUM($C$16:C${r})&" از "&DayBudget))`];
  }));
  writeCellValues(s, 'B20', [['کارهای پیشنهادی را با «امروز؟ = بله» در برگهٔ کارها به برنامه اضافه کن. بقیه سر جایشان می‌مانند.']]);
  applyRangeStyle(s, 'B15:D15', { bold: true, fill: COL.head, fontColor: COL.headInk, align: 'center' });
  applyRangeStyle(s, 'B16:D19', { border: { color: COL.line } });
  applyRangeStyle(s, 'C16:D19', { align: 'center' }); applyRangeStyle(s, 'C16:C19', { numberFormat: '0' });
  applyRangeStyle(s, 'B20', { fontColor: COL.sub, italic: true, fontSize: 9 });
  addConditionalStyle(s, 'D16:D19', { type: 'expression', formula: 'LEFT($D16,1)="⚠"', format: { font: { color: COL.warn } } });
  // goals
  sectionHead(s, 'F14:H14', '🎯 اهداف');
  writeCellValues(s, 'F15:H15', [['هدف', 'پیشرفت', 'قدم بعدی']]);
  writeCellFormulas(s, 'F16:H21', Array.from({ length: 6 }, (_, i) => { const r = FIRST + i; const g = q(SH.goals); return [`IF(${g}!B${r}="","",${g}!B${r})`, `IF(F${16 + i}="","",${g}!H${r})`, `IF(F${16 + i}="","",${g}!I${r})`]; }));
  applyRangeStyle(s, 'F15:H15', { bold: true, fill: COL.head, fontColor: COL.headInk, align: 'center' });
  applyRangeStyle(s, 'F16:H21', { border: { color: COL.line } });
  applyRangeStyle(s, 'G16:G21', { numberFormat: '0%', align: 'center' });
  addConditionalStyle(s, 'G16:G21', { type: 'dataBar', thresholds: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }], color: '8DB7A0' });
  // sections
  sectionHead(s, 'B23:H23', 'چه چیزی امروز مهم است؟');
  const blockAt = [['B', 'C', 24], ['B', 'C', 31], ['B', 'C', 38], ['F', 'G', 24], ['F', 'G', 31], ['F', 'G', 38]];
  blockAt.forEach(([t, m, r], i) => {
    const sec = `INDEX(SecNames,${i + 1})`;
    writeCellFormulas(s, `${t}${r}:${m}${r}`, [[`IF(${sec}="","(بخش ${i + 1} — در تنظیمات نام بگذار)",${sec})`, `IF(${sec}="","",COUNTIF(${T_('AB')},${sec})&" از "&INDEX(SecCaps,${i + 1}))`]]);
    applyRangeStyle(s, `${t}${r}:${m}${r}`, { bold: true, fill: COL.band, fontColor: COL.ink });
    applyRangeStyle(s, `${m}${r}`, { align: 'center' });
    writeCellFormulas(s, `${t}${r + 1}:${m}${r + 5}`, Array.from({ length: 5 }, (_, n) => {
      const mt = `MATCH(${sec}&"#"&${n + 1},${T_('T')},0)`;
      return [`IFERROR(INDEX(${T_('B')},${mt}),"")`, `IFERROR(IF(INDEX(${T_('E')},${mt})="انجام‌شده","✓ انجام شد","○"),"")`];
    }));
    applyRangeStyle(s, `${t}${r + 1}:${m}${r + 5}`, { border: { color: COL.line } });
    applyRangeStyle(s, `${m}${r + 1}:${m}${r + 5}`, { align: 'center', fontColor: COL.sub });
    addConditionalStyle(s, `${t}${r + 1}:${m}${r + 5}`, { type: 'expression', formula: `$${m}${r + 1}="✓ انجام شد"`, format: { font: { color: 'A3ADA7' } } });
    addConditionalStyle(s, `${m}${r}`, { type: 'expression', formula: `AND(${sec}<>"",COUNTIF(${T_('AB')},${sec})>INDEX(SecCaps,${i + 1}))`, format: { font: { color: COL.warn } } });
  });
  writeCellFormulas(s, 'B45', [[`"بقیهٔ کارهای باز (خارج از امروز): "&COUNTIFS(${T_('W')},1,${T_('J')},"<>بله")&" — سر جایشان می‌مانند؛ فقط چیزی را به امروز بیاور که واقعاً جا دارد."`]]);
  applyRangeStyle(s, 'B45', { fontColor: COL.sub, italic: true });
  s.options.rowHeights = { 1: 34, 9: 26, 10: 48, 11: 36, 12: 48 };
  s.options.freezePanes = 'A3';
}

// ---------- guide ----------
{
  const s = sGuide;
  applyRangeStyle(s, 'A1:C40', base);
  title(s, '🌿 رویش — راهنمای استفاده', 'نسخهٔ اکسل رویش: برنامه‌ریزی آرام، تمرکز و رشد شخصی — همه‌چیز داخل همین فایل و روی کامپیوتر خودت.');
  const rows = [
    ['شروع سریع', '۱) ردیف‌های نمونه را پاک کن (فقط سلول‌های ورودی؛ ستون‌های خاکستری خودکارند). ۲) در «اهداف»، «پروژه‌ها» و «کارها» موارد خودت را بنویس. ۳) هر روز به برگهٔ «امروز» سر بزن.'],
    ['رنگ‌ها', 'کرم/سفید = ورودی تو · خاکستری‌سبز = محاسبهٔ خودکار (دست نزن) · ستون‌های کمکی پنهان‌اند.'],
    ['تاریخ‌ها', 'همهٔ تاریخ‌ها شمسی‌اند، مثل 1405/07/19 (رقم فارسی هم قبول است). Ctrl+; تاریخ امروز را می‌گذارد و آن هم پذیرفته می‌شود. تاریخ اشتباه قرمز می‌شود.'],
    ['امروز', 'نوع روز (شلوغ / کم‌انرژی / معمولی / پرانرژی) و زمان در دسترس را انتخاب کن؛ پیشنهاد «از کجا شروع کنم؟»، برنامهٔ پیشنهادی و بخش‌های امروز خودکار به‌روز می‌شوند.'],
    ['از کجا شروع کنم؟', 'بر اساس اولویت، برنامهٔ امروز، کار نیمه‌کاره، نزدیکی مهلت، قدم بعدی پروژه، ارتباط با هدف، زمان در دسترس، شروع آسان و انرژی امروز امتیاز می‌دهد و دلیلش را می‌گوید. معیارها در «تنظیمات» قابل خاموش/روشن‌اند.'],
    ['بازگشت آرام', 'اگر چند روز (پیش‌فرض ۳) فعالیتی ثبت نشده باشد، رویش بدون سرزنش یک برنامهٔ سبک‌تر پیشنهاد می‌دهد. کارهای ناتمام سر جایشان می‌مانند و خودکار به امروز ریخته نمی‌شوند.'],
    ['اهداف ← پروژه‌ها ← کارها', 'هر کار با شناسهٔ پروژه به پروژه وصل می‌شود و هر پروژه با شناسهٔ هدف به هدف. پیشرفت، قدم بعدی و زمان صرف‌شده خودکارند.'],
    ['جلسات تمرکز', 'اکسل تایمر زنده ندارد؛ هر جلسه را با ساعت شروع و پایان (Ctrl+Shift+; ساعت فعلی را می‌گذارد) یا مدت دستی ثبت کن، به کار یا منبع یادگیری وصلش کن و نتیجه‌اش را بنویس. برای تایمر زنده از نسخهٔ وب یا ربات تلگرام استفاده کن.'],
    ['پومودورو', 'الگوی تمرکز/استراحت در «تنظیمات»؛ برگهٔ «امروز» استراحت بعدی را بر اساس تعداد جلسه‌های امروز نشان می‌دهد.'],
    ['یادگیری و خروجی‌ها', 'برای هر منبع آخرین مبحث، قدم بعدی، سؤال‌های حل‌نشده و یادداشت. خروجی‌ها (کد، فایل، تصویر، لینک) با مسیر فایل یا لینک ثبت می‌شوند و با یک کلیک باز می‌شوند.'],
    ['دفتر شخصی', 'حال و انرژی (۱ تا ۵)، افکار، اتفاقات و آموخته‌ها. میانگین حال در مرور هفتگی می‌آید.'],
    ['مرور هفتگی و گزارش', '«مرور هفتگی» آمار و نمودار هر روز هفته و یادداشت‌های مرور را دارد؛ «گزارش» زمان هر هدف، پروژه و منبع را در هر بازهٔ دلخواه نشان می‌دهد.'],
    ['حریم خصوصی', 'هیچ داده‌ای از این فایل بیرون نمی‌رود. از فایل نسخهٔ پشتیبان نگه دار.'],
    ['نیازمندی', 'Excel 2019 یا 365، یا LibreOffice 7 به بالا (توابع MINIFS/MAXIFS).'],
  ];
  writeCellValues(s, `B4:C${3 + rows.length}`, rows);
  applyRangeStyle(s, `B4:B${3 + rows.length}`, { bold: true, fontColor: COL.accent, verticalAlign: 'top' });
  applyRangeStyle(s, `C4:C${3 + rows.length}`, { wrapText: true, verticalAlign: 'top' });
  applyRangeStyle(s, `B4:C${3 + rows.length}`, { border: { color: COL.line } });
  sectionHead(s, `B${5 + rows.length}:C${5 + rows.length}`, 'برگه‌ها (روی هر نام بزن)');
  const links = [SH.today, SH.goals, SH.proj, SH.tasks, SH.sess, SH.learn, SH.outs, SH.ideas, SH.jour, SH.week, SH.rep, SH.set];
  const desc = ['داشبورد روزانه', 'هدف‌های بلندمدت', 'مراحل و پروژه‌های هر هدف', 'همهٔ کارها و قدم‌ها', 'ثبت زمان و نتیجهٔ هر جلسه', 'منابع یادگیری', 'کدها، فایل‌ها و تمرین‌ها', 'ایده‌ها و مقالات', 'نوشته‌های خصوصی', 'آمار و مرور هفته', 'گزارش زمان در بازهٔ دلخواه', 'بخش‌ها، پومودورو، معیارها'];
  const r0 = 6 + rows.length;
  writeCellValues(s, `B${r0}:C${r0 + links.length - 1}`, links.map((l, i) => [l, desc[i]]));
  applyRangeStyle(s, `B${r0}:B${r0 + links.length - 1}`, { fontColor: '2F6F9F', bold: true });
  applyRangeStyle(s, `C${r0}:C${r0 + links.length - 1}`, { fontColor: COL.sub });
  s.options.rowHeights = Object.fromEntries([[1, 30], ...rows.map((_, i) => [4 + i, 46])]);
  notes.push({ sheet: SH.guide, linkRows: [r0, r0 + links.length - 1], links });
}

// =====================================================================
// build → post-process (RTL, hidden helpers, links) → recalculate → audit → render
function run(label, cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${label} failed\n${String(r.stdout).slice(-4000)}\n${String(r.stderr).slice(-1500)}`);
  return r.stdout;
}
const MAT = path.join(BUILD, 'Rooyesh.materialized.xlsx'), POST = path.join(BUILD, 'Rooyesh.post.xlsx');
try {
  await buildXlsx(b, { specPath: path.join(BUILD, 'workbook-spec.json'), outputPath: MAT, auditPath: path.join(BUILD, 'audit-materialized.txt'), previewDir: path.join(BUILD, 'preview'), recalculate: false });
} catch (e) {
  // The strict audit of the not-yet-recalculated file only reports missing cached values; the real audit runs after recalculation below.
  if (!fs.existsSync(MAT) || !/audit workbook failed/.test(e.message)) throw e;
}
fs.writeFileSync(path.join(BUILD, 'meta.json'), JSON.stringify({ helpers, notes, active: SH.today }));
const RECALC = path.join(BUILD, 'Rooyesh.recalculated.xlsx');
console.log(run('prepare', 'python3', [path.join(HERE, 'postprocess.py'), 'prepare', MAT, POST, path.join(BUILD, 'meta.json')]).trim());
const rec = run('recalculate', 'python3', [path.join(SK, 'recalculate.py'), POST, RECALC]);
fs.writeFileSync(path.join(BUILD, 'recalc.json'), rec);
console.log(rec.split('\n').filter((l) => /status|Errors|Differences|FormulaCount/.test(l)).join('\n'));
console.log(run('rtl', 'python3', [path.join(HERE, 'postprocess.py'), 'rtl', RECALC, OUT]).trim());
const audit = run('audit', 'python3', [path.join(SK, 'audit_workbook.py'), OUT, '--strict-generated']);
fs.writeFileSync(path.join(BUILD, 'audit.txt'), audit);
console.log(audit.split('\n').slice(0, 40).join('\n'));
console.log(run('fonts', 'python3', [path.join(SK, 'audit_office_fonts.py'), OUT]).split('\n').slice(0, 15).join('\n'));
if (!process.argv.includes('--no-render')) {
  const views = [`${SH.today}!A1:I46`, `${SH.tasks}!A1:P20`, `${SH.goals}!A1:K10`, `${SH.proj}!A1:M18`, `${SH.sess}!A1:M15`, `${SH.learn}!A1:M9`, `${SH.week}!A1:H45`, `${SH.rep}!A1:I28`, `${SH.set}!A1:E34`, `${SH.guide}!A1:C34`, `${SH.outs}!A1:I9`, `${SH.jour}!A1:F9`];
  console.log(run('render', 'python3', [path.join(SK, 'render_workbook.py'), OUT, '--out-dir', path.join(BUILD, 'preview'), ...views.flatMap((v) => ['--view', v])]).split('\n').slice(0, 30).join('\n'));
}
