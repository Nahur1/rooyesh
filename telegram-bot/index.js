// Rooyesh Telegram bot — entry point (long polling, no external dependencies).
// Usage: BOT_TOKEN=123:abc node index.js   (or put values in a .env file next to this file)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Minimal .env loader (KEY=VALUE lines); real environment variables win. */
export function loadEnv(file = path.join(here, '.env')) {
  let txt = ''; try { txt = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (!m) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

export async function run(opts = {}) {
  const { createApi } = await import('./src/telegram.js');
  const { createStore } = await import('./src/store.js');
  const { createBot, COMMANDS } = await import('./src/bot.js');
  const token = opts.token || process.env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN تنظیم نشده است. فایل .env.example را به .env کپی کن و توکن BotFather را در آن بگذار.');
  const api = createApi(token, opts.apiBase || process.env.API_BASE || 'https://api.telegram.org');
  const store = createStore(opts.dataDir || process.env.DATA_DIR || path.join(here, 'data'));
  const allowed = (opts.allowed || process.env.ALLOWED_USERS || '').toString().split(/[\s,]+/).filter(Boolean).map(Number);
  const log = opts.log || console;
  const bot = createBot({ api, store, allowed, log });
  const me = await api.call('getMe');
  await api.call('setMyCommands', { commands: COMMANDS }).catch((e) => log.warn && log.warn('setMyCommands:', e.message));
  log.log && log.log(`رویش روشن شد: @${me.username}` + (allowed.length ? ` (فقط برای ${allowed.join(', ')})` : ' (بدون محدودیت کاربر — ALLOWED_USERS را تنظیم کن)'));

  let stopped = false, offset = 0, ctrl = null;
  const tickTimer = setInterval(() => { bot.tick().catch((e) => log.error('tick', e.message)); }, opts.tickMs || 5000);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const loop = (async () => {
    while (!stopped) {
      try {
        ctrl = new AbortController();
        const updates = await api.call('getUpdates', { offset, timeout: opts.pollTimeout ?? 30, allowed_updates: ['message', 'callback_query'] }, ctrl.signal);
        for (const u of updates) {
          offset = u.update_id + 1;
          try { await bot.handleUpdate(u); } catch (e) { log.error('update failed', e.message); }
        }
      } catch (e) {
        if (stopped) break;
        const wait = e.retryAfter ? e.retryAfter * 1000 : 3000;
        log.error && log.error('polling error:', e.message, '— retry in', wait / 1000, 's');
        await sleep(wait);
      }
    }
  })();
  async function stop() {
    stopped = true; clearInterval(tickTimer);
    try { ctrl && ctrl.abort(); } catch { /* ignore */ }
    await loop.catch(() => {}); await store.flush();
  }
  return { bot, store, api, stop };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnv();
  process.env.TZ = process.env.TZ || 'Asia/Tehran';
  run().then(({ stop }) => {
    const bye = () => { console.log('در حال خاموش شدن…'); stop().then(() => process.exit(0)); };
    process.on('SIGINT', bye); process.on('SIGTERM', bye);
  }).catch((e) => { console.error('❌', e.message); process.exit(1); });
}
