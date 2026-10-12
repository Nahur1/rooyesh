// Per-user JSON storage on local disk with atomic, serialized writes.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('./core.cjs');

export function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const cache = new Map();
  const chains = new Map();
  const file = (id) => path.join(dir, 'user-' + String(id).replace(/[^0-9-]/g, '') + '.json');

  function blank() { return { state: C.defaultState(), bot: { flow: null, chatId: null, name: '' } }; }
  function get(id) {
    if (cache.has(id)) return cache.get(id);
    let rec = blank();
    try {
      const raw = JSON.parse(fs.readFileSync(file(id), 'utf8'));
      rec = { state: C.normalizeState(raw.state), bot: Object.assign(blank().bot, raw.bot || {}) };
    } catch (e) {
      if (e.code !== 'ENOENT') { try { fs.copyFileSync(file(id), file(id) + '.corrupt-' + Date.now()); } catch { /* ignore */ } }
    }
    cache.set(id, rec);
    return rec;
  }
  function save(id) {
    const rec = cache.get(id); if (!rec) return Promise.resolve();
    const data = JSON.stringify(rec);
    const prev = chains.get(id) || Promise.resolve();
    const next = prev.then(() => new Promise((res, rej) => {
      const tmp = file(id) + '.tmp';
      fs.writeFile(tmp, data, (err) => { if (err) return rej(err); fs.rename(tmp, file(id), (e2) => (e2 ? rej(e2) : res())); });
    })).catch((e) => { console.error('save failed', e.message); });
    chains.set(id, next);
    return next;
  }
  function reset(id) { cache.set(id, blank()); return save(id); }
  function allIds() {
    return fs.readdirSync(dir).map((f) => (f.match(/^user-(-?\d+)\.json$/) || [])[1]).filter(Boolean).map(Number);
  }
  async function flush() { await Promise.all([...chains.values()]); }
  return { get, save, reset, allIds, flush, file, dir };
}
