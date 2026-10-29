// Cloud-Sync zwischen Desktop- und Web-App (identisch in dim-app und dim-web): eigene Loadouts, Transmog-Sets,
// Such-Shortcuts, Markierungen und beobachtete PvP-Spieler liegen zusätzlich im Worker (Cloudflare KV), Schlüssel = Bungie-Konto.
// Pro Eintrag gewinnt die neuere Änderung; beim allerersten Abgleich werden Listen zusammengeführt statt überschrieben.
export const SYNC_KEYS = ['loadouts', 'fashion', 'shortcuts', 'tags', 'pvp'];

export function createCloud({ url, db, save, session }) {
  db.syncAt ??= {}; // Eintrag -> Zeitpunkt der letzten lokalen Änderung
  const json = (k) => JSON.stringify(db[k] ?? null);
  const snap = Object.fromEntries(SYNC_KEYS.map((k) => [k, json(k)]));
  const status = { at: null, error: null };
  let pushT, busy = false;

  const merge = (local, remote) => Array.isArray(remote)
    ? [...remote, ...(local ?? []).filter((x) => !remote.some((r) => r.id === x.id))]
    : { ...local, ...remote };
  const empty = (v) => v == null || (Array.isArray(v) ? !v.length : !Object.keys(v).length);

  async function call(method, body) {
    const s = await session();
    if (!s) return null;
    const r = await fetch(url + '/sync', { method, body: body && JSON.stringify(body),
      headers: { authorization: 'Bearer ' + s.token, 'x-api-key': s.apiKey, 'content-type': 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `Sync: HTTP ${r.status}`);
    return j;
  }

  // Remote-Stand übernehmen, wo er neuer ist; true = lokal ist etwas Neueres hochzuladen
  function apply(remote) {
    let dirty = false, push = false;
    for (const k of SYNC_KEYS) {
      const r = remote[k], local = db.syncAt[k] ?? 0;
      if (r && r.at > local) {
        const first = !local && !empty(db[k]);
        db[k] = first ? merge(db[k], r.v) : r.v;
        db.syncAt[k] = first ? Date.now() : r.at;
        if (first) push = true;
        snap[k] = json(k); dirty = true;
      } else if (!r && !local && !empty(db[k])) { db.syncAt[k] = Date.now(); push = true; dirty = true; } // erster Upload
      else if (r && local > r.at) push = true;
    }
    if (dirty) save();
    return push;
  }

  async function run(fn) {
    if (busy) return;
    busy = true;
    try { await fn(); status.at = new Date().toISOString(); status.error = null; } catch (e) { status.error = e.message; } finally { busy = false; }
  }
  const body = () => Object.fromEntries(SYNC_KEYS.filter((k) => db.syncAt[k]).map((k) => [k, { v: db[k], at: db.syncAt[k] }]));
  const push = () => run(async () => { const r = await call('PUT', body()); if (r) apply(r); });
  const pull = () => run(async () => { const r = await call('GET'); if (r && apply(r)) { const m = await call('PUT', body()); if (m) apply(m); } });

  // Vor jedem Speichern aufrufen: geänderte Einträge stempeln und gebündelt hochladen
  function changed() {
    const keys = SYNC_KEYS.filter((k) => json(k) !== snap[k]);
    if (!keys.length) return;
    for (const k of keys) { snap[k] = json(k); db.syncAt[k] = Date.now(); }
    clearTimeout(pushT); pushT = setTimeout(push, 1500);
  }

  return { changed, pull, status };
}
