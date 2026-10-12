// A tiny HTTP mock of the Telegram Bot API (JSON + multipart) for integration tests.
import http from 'node:http';

export function startMockTelegram(token) {
  const calls = [], queue = [], files = new Map();
  let mid = 1, waiters = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const send = (result, ok = true, extra = {}) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(Object.assign({ ok, result }, extra))); };
    const fm = req.url.match(/^\/file\/bot([^/]+)\/(.+)$/);
    if (fm) { if (fm[1] !== token || !files.has(fm[2])) { res.statusCode = 404; return res.end(); } return res.end(files.get(fm[2])); }
    const m = req.url.match(/^\/bot([^/]+)\/(\w+)$/);
    if (!m || m[1] !== token) { res.statusCode = 401; return send(null, false, { error_code: 401, description: 'Unauthorized' }); }
    const method = m[2], type = req.headers['content-type'] || '';
    let params = {};
    if (type.startsWith('application/json')) params = JSON.parse(body.toString() || '{}');
    else if (type.startsWith('multipart/form-data')) {
      const fd = await new Response(body, { headers: { 'content-type': type } }).formData();
      for (const [k, v] of fd.entries()) params[k] = typeof v === 'string' ? v : { name: v.name, type: v.type, data: Buffer.from(await v.arrayBuffer()) };
    }
    calls.push({ method, params, multipart: type.startsWith('multipart/') });
    waiters = waiters.filter((w) => !w());
    switch (method) {
      case 'getMe': return send({ id: 1, is_bot: true, username: 'nava_mock_bot' });
      case 'setMyCommands': return send(true);
      case 'getUpdates': {
        const out = queue.filter((u) => u.update_id >= (params.offset || 0));
        queue.length = 0;
        if (out.length) return send(out);
        return setTimeout(() => send([]), 30);
      }
      case 'sendMessage': if (params.parse_mode === 'HTML' && /<(?!\/?(b|i|s|u|code|pre|a)\b)/.test(params.text)) return send(null, false, { error_code: 400, description: "Bad Request: can't parse entities" });
        return send({ message_id: mid++, chat: { id: params.chat_id }, text: params.text });
      case 'editMessageText': return send({ message_id: Number(params.message_id) });
      case 'answerCallbackQuery': return send(true);
      case 'sendDocument': return send({ message_id: mid++, document: { file_id: 'srv_' + mid, file_name: params.document && params.document.name } });
      case 'getFile': return send({ file_id: params.file_id, file_path: 'docs/' + params.file_id });
      default: return send(null, false, { error_code: 404, description: 'Not Found: method ' + method });
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = 'http://127.0.0.1:' + server.address().port;
    resolve({
      base, calls, files,
      push(update) { queue.push(update); },
      /** resolves when predicate(calls) becomes true */
      waitFor(pred, ms = 4000) {
        return new Promise((res, rej) => {
          if (pred(calls)) return res();
          const timer = setTimeout(() => rej(new Error('timeout waiting; calls: ' + calls.map((c) => c.method).join(','))), ms);
          waiters.push(() => { if (pred(calls)) { clearTimeout(timer); setImmediate(res); return true; } return false; });
        });
      },
      close() { return new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(r); }); },
    });
  }));
}
