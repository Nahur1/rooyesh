// Test helpers: an in-memory fake of the Telegram Bot API that validates what the bot sends
// (HTML well-formedness, message/button limits), plus a small driver for simulated users.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store.js';
import { createBot } from '../src/bot.js';

const ALLOWED_TAGS = new Set(['b', 'i', 's', 'u', 'code', 'pre', 'a']);
export function checkHtml(text) {
  const stack = [];
  const re = /<(\/?)([a-z]+)(\s[^>]*)?>/gi; let m;
  while ((m = re.exec(text))) {
    const tag = m[2].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) throw new Error('unsupported tag <' + tag + '> in: ' + text.slice(0, 120));
    if (m[1]) { if (stack.pop() !== tag) throw new Error('unbalanced </' + tag + '> in: ' + text.slice(0, 200)); }
    else stack.push(tag);
  }
  if (stack.length) throw new Error('unclosed <' + stack.join(',') + '> in: ' + text.slice(0, 200));
  const plain = text.replace(re, '');
  if (/[<>]/.test(plain)) throw new Error('raw < or > in: ' + text.slice(0, 200));
}
function checkMarkup(rm) {
  if (!rm) return;
  if (rm.inline_keyboard) for (const row of rm.inline_keyboard) for (const b of row) {
    if (!b.text) throw new Error('empty button text');
    if (!b.callback_data || Buffer.byteLength(b.callback_data) > 64) throw new Error('bad callback_data: ' + b.callback_data);
  }
}

export function fakeApi() {
  let mid = 100;
  const calls = [], messages = new Map(), files = new Map();
  const api = {
    calls, messages, files,
    async call(method, p = {}) {
      const rec = { method, params: p }; calls.push(rec);
      if (method === 'sendMessage' || method === 'editMessageText') {
        if (!p.text || p.text.length > 4096) throw new Error('bad text length');
        if (p.parse_mode === 'HTML') checkHtml(p.text);
        checkMarkup(p.reply_markup);
        if (method === 'editMessageText') {
          if (!messages.has(p.message_id)) { const e = new Error('Bad Request: message to edit not found'); throw e; }
          messages.set(p.message_id, { text: p.text, markup: p.reply_markup });
          return { message_id: p.message_id };
        }
        const id = ++mid; rec.messageId = id; messages.set(id, { text: p.text, markup: p.reply_markup }); return { message_id: id, text: p.text };
      }
      if (method === 'answerCallbackQuery') return true;
      if (method === 'getFile') { if (!files.has(p.file_id)) throw new Error('Bad Request: invalid file_id'); return { file_id: p.file_id, file_path: 'files/' + p.file_id }; }
      if (method === 'sendDocument' || method === 'sendPhoto') return { message_id: ++mid };
      if (method === 'getMe') return { id: 1, is_bot: true, username: 'nava_test_bot' };
      if (method === 'setMyCommands') return true;
      throw new Error('unexpected method ' + method);
    },
    async upload(method, params, field, filename, buffer, mime) {
      calls.push({ method, params, upload: { field, filename, buffer: Buffer.from(buffer), mime } });
      if (params.caption && params.caption.length > 1024) throw new Error('caption too long');
      return { message_id: ++mid, document: { file_id: 'up_' + filename, file_name: filename } };
    },
    async download(filePath) { const id = filePath.replace(/^files\//, ''); if (!files.has(id)) throw new Error('404'); return files.get(id); },
  };
  return api;
}

export const T0 = Date.parse('2026-03-14T09:00:00+03:30'); // Saturday 1404/12/23
export function setup({ dir, allowed = [], user = 777, api, clock } = {}) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'nava-bot-'));
  api = api || fakeApi();
  clock = clock || { t: T0 };
  const errors = [];
  const log = { error: (...a) => errors.push(a.join(' ')), warn() {}, log() {} };
  const store = createStore(dir);
  const bot = createBot({ api, store, allowed, now: () => clock.t, log });
  let upd = 1, msgNo = 1;
  const from = (id) => ({ id, is_bot: false, first_name: 'نهورام' });
  const h = {
    dir, api, clock, store, bot, errors, user,
    get S() { return store.get(user).state; },
    get B() { return store.get(user).bot; },
    advance(min) { clock.t += min * 60000; },
    async msg(text, extra = {}, uid = user, chatType = 'private') {
      const m = Object.assign({ message_id: msgNo++, from: from(uid), chat: { id: uid, type: chatType }, date: Math.floor(clock.t / 1000) }, text == null ? {} : { text }, extra);
      await bot.handleUpdate({ update_id: upd++, message: m });
    },
    async press(data, messageId, uid = user) {
      await bot.handleUpdate({ update_id: upd++, callback_query: { id: 'cq' + upd, from: from(uid), data, message: { message_id: messageId || h.lastKbMsg() || 1, chat: { id: uid, type: 'private' } } } });
    },
    /** latest message (sent or edited) carrying an inline keyboard */
    lastKbMsg() {
      for (let i = api.calls.length - 1; i >= 0; i--) {
        const c = api.calls[i];
        if ((c.method === 'sendMessage' || c.method === 'editMessageText') && c.params.reply_markup && c.params.reply_markup.inline_keyboard) return c.method === 'sendMessage' ? c.messageId : c.params.message_id;
      }
      return null;
    },
    lastText() {
      for (let i = api.calls.length - 1; i >= 0; i--) { const c = api.calls[i]; if (c.method === 'sendMessage' || c.method === 'editMessageText') return c.params.text; }
      return '';
    },
    texts(since = 0) { return api.calls.slice(since).filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText').map((c) => c.params.text); },
    buttons() { const id = h.lastKbMsg(); const m = id && api.messages.get(id); return m ? m.markup.inline_keyboard.flat() : []; },
    async tap(re) {
      const b = h.buttons().find((x) => (re instanceof RegExp ? re.test(x.text) : x.text.includes(re)));
      if (!b) throw new Error('button not found: ' + re + '\nhave: ' + h.buttons().map((x) => x.text).join(' | '));
      await h.press(b.callback_data);
      return b;
    },
    hasErrorReply() { return h.texts().some((t) => t.includes('مشکلی پیش آمد')); },
  };
  return h;
}
