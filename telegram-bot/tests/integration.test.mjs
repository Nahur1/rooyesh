// Integration: real HTTP client + long-polling loop (index.js) against a mock Telegram server.
process.env.TZ = 'Asia/Tehran';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMockTelegram } from './mock-telegram.mjs';
import { run, loadEnv } from '../index.js';

const TOKEN = '123:TEST';
const user = { id: 4242, is_bot: false, first_name: 'Test' };
const chat = { id: 4242, type: 'private' };

test('polling loop, commands, inline buttons, multipart export and file import over HTTP', async () => {
  const mock = await startMockTelegram(TOKEN);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rooyesh-int-'));
  const errors = [];
  const app = await run({ token: TOKEN, apiBase: mock.base, dataDir: dir, pollTimeout: 0, tickMs: 50, log: { log() {}, warn() {}, error: (...a) => errors.push(a.join(' ')) } });
  try {
    assert.ok(mock.calls.some((c) => c.method === 'setMyCommands' && c.params.commands.length >= 10));
    let uid = 1;
    mock.push({ update_id: uid++, message: { message_id: 1, from: user, chat, date: 0, text: '/start' } });
    await mock.waitFor((cs) => cs.filter((c) => c.method === 'sendMessage').length >= 2);
    const sends = mock.calls.filter((c) => c.method === 'sendMessage');
    assert.ok(sends[0].params.reply_markup.keyboard);
    assert.match(sends[1].params.text, /کجا هستم/);
    mock.push({ update_id: uid++, message: { message_id: 2, from: user, chat, date: 0, text: '/add نوشتن گزارش' } });
    mock.push({ update_id: uid++, callback_query: { id: 'c1', from: user, data: 'next', message: { message_id: 5, chat } } });
    await mock.waitFor((cs) => cs.some((c) => c.method === 'answerCallbackQuery'));
    const edit = mock.calls.find((c) => c.method === 'editMessageText');
    assert.match(edit.params.text, /نوشتن گزارش/);
    // timer finishing through the background tick
    mock.push({ update_id: uid++, callback_query: { id: 'c2', from: user, data: 'ff:1', message: { message_id: 5, chat } } });
    await mock.waitFor((cs) => cs.filter((c) => c.method === 'answerCallbackQuery').length >= 2);
    const rec = app.store.get(4242); rec.state.timer.endAt = Date.now() - 1; // fast-forward
    await mock.waitFor((cs) => cs.some((c) => c.method === 'sendMessage' && /جلسه تمام شد/.test(c.params.text)));
    // export → multipart upload
    mock.push({ update_id: uid++, message: { message_id: 3, from: user, chat, date: 0, text: '/export' } });
    await mock.waitFor((cs) => cs.some((c) => c.method === 'sendDocument'));
    const doc = mock.calls.find((c) => c.method === 'sendDocument');
    assert.ok(doc.multipart); assert.equal(doc.params.chat_id, '4242');
    const backup = JSON.parse(doc.params.document.data.toString());
    assert.equal(backup.app, 'rooyesh'); assert.equal(backup.state.tasks[0].title, 'نوشتن گزارش');
    // import via getFile + file download
    backup.state.tasks[0].title = 'بازیابی‌شده';
    mock.files.set('docs/BK', Buffer.from(JSON.stringify(backup)));
    mock.push({ update_id: uid++, message: { message_id: 4, from: user, chat, date: 0, text: '/settings' } });
    mock.push({ update_id: uid++, callback_query: { id: 'c3', from: user, data: 'imp', message: { message_id: 5, chat } } });
    mock.push({ update_id: uid++, message: { message_id: 6, from: user, chat, date: 0, document: { file_id: 'BK', file_name: 'b.json', file_size: 100 } } });
    await mock.waitFor((cs) => cs.some((c) => c.method === 'sendMessage' && /بازیابی انجام شد/.test(c.params.text)));
    assert.equal(app.store.get(4242).state.tasks[0].title, 'بازیابی‌شده');
    assert.deepEqual(errors, []);
  } finally { await app.stop(); await mock.close(); }
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'user-4242.json'), 'utf8'));
  assert.equal(saved.state.tasks[0].title, 'بازیابی‌شده');
});

test('missing token gives a clear Persian error; .env loader', async () => {
  const old = process.env.BOT_TOKEN; delete process.env.BOT_TOKEN;
  await assert.rejects(run({}), /BOT_TOKEN/);
  if (old) process.env.BOT_TOKEN = old;
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'env-')), '.env');
  fs.writeFileSync(f, '# c\nROOYESH_TEST_X="hello"\nROOYESH_TEST_Y = 2\n');
  loadEnv(f); assert.equal(process.env.ROOYESH_TEST_X, 'hello'); assert.equal(process.env.ROOYESH_TEST_Y, '2');
});

test('wrong token → clear startup error instead of a silent hang', async () => {
  const mock = await startMockTelegram('other');
  await assert.rejects(run({ token: TOKEN, apiBase: mock.base, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rooyesh-x-')), log: { log() {}, warn() {}, error() {} } }), /Unauthorized/);
  await mock.close();
});
