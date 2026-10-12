// Minimal Telegram Bot API client (Node 18+ fetch, no dependencies).
export function createApi(token, base = 'https://api.telegram.org') {
  const url = (m) => `${base}/bot${token}/${m}`;
  async function parse(res) {
    let j; try { j = await res.json(); } catch { throw new Error('Bad response from Telegram (' + res.status + ')'); }
    if (!j.ok) { const e = new Error(j.description || 'Telegram error'); e.code = j.error_code; e.retryAfter = j.parameters && j.parameters.retry_after; throw e; }
    return j.result;
  }
  async function call(method, params = {}, signal) {
    const res = await fetch(url(method), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal });
    return parse(res);
  }
  async function upload(method, params, field, filename, buffer, mime = 'application/octet-stream') {
    const fd = new FormData();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    fd.append(field, new Blob([buffer], { type: mime }), filename);
    const res = await fetch(url(method), { method: 'POST', body: fd });
    return parse(res);
  }
  async function download(filePath) {
    const res = await fetch(`${base}/file/bot${token}/${filePath}`);
    if (!res.ok) throw new Error('download failed ' + res.status);
    return Buffer.from(await res.arrayBuffer());
  }
  return { call, upload, download };
}
