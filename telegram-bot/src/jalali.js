// Jalali (Persian) <-> Gregorian conversion and flexible Persian date parsing.
// Algorithm: jalaali-js (MIT) style arithmetic, compact version.
function div(a, b) { return ~~(a / b); }
function mod(a, b) { return a - ~~(a / b) * b; }
const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
function jalCal(jy) {
  const bl = breaks.length, gy = jy + 621;
  let leapJ = -14, jp = breaks[0], jm, jump, leap, n, i;
  if (jy < jp || jy >= breaks[bl - 1]) throw new Error('Invalid Jalali year ' + jy);
  for (i = 1; i < bl; i += 1) { jm = breaks[i]; jump = jm - jp; if (jy < jm) break; leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4); jp = jm; }
  n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}
function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}
function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1, gm = mod(div(i, 153), 12) + 1, gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}
function j2d(jy, jm, jd) { const r = jalCal(jy); return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1; }
function jalaaliMonthLength(jy, jm) { if (jm <= 6) return 31; if (jm <= 11) return 30; return jalCal(jy).leap === 0 ? 30 : 29; }
export function toGregorian(jy, jm, jd) { return d2g(j2d(jy, jm, jd)); }
export function isValidJalali(jy, jm, jd) { return jy >= -61 && jy <= 3177 && jm >= 1 && jm <= 12 && jd >= 1 && jd <= jalaaliMonthLength(jy, jm); }

export function normalizeDigits(s) {
  return String(s || '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}
const pad = (n) => String(n).padStart(2, '0');
/** Parses «امروز», «فردا», «پس‌فردا», Jalali 1405/8/10 or Gregorian 2026-11-01 → 'YYYY-MM-DD' or null. */
export function parseDate(text, todayKey) {
  const t = normalizeDigits(text).trim().replace(/\u200c/g, '');
  const base = todayKey ? new Date(todayKey + 'T12:00:00') : new Date();
  const shift = (n) => { const d = new Date(base); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  if (/^امروز$/.test(t)) return shift(0);
  if (/^فردا$/.test(t)) return shift(1);
  if (/^پس ?فردا$/.test(t)) return shift(2);
  if (/^دیروز$/.test(t)) return shift(-1);
  let m = t.match(/^(\d+)\s*روز\s*(دیگر|بعد)$/); if (m) return shift(Number(m[1]));
  m = t.match(/^(\d+)\s*روز\s*(پیش|قبل)$/); if (m) return shift(-Number(m[1]));
  m = t.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1700) {
    if (!isValidJalali(y, mo, d)) return null;
    const g = toGregorian(y, mo, d); return g.gy + '-' + pad(g.gm) + '-' + pad(g.gd);
  }
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return y + '-' + pad(mo) + '-' + pad(d);
}
