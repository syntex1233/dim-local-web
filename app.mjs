// Start der Web-App: Speicher anbinden, App-Kern erzeugen, Rückkehr vom Bungie-Login verarbeiten.
import { createCore } from './core.mjs';
import { AUTH_URL } from './config.mjs';

// Einstellungen, Loadouts, Tokens: localStorage (klein)
const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem('dimweb.' + k)); } catch { return null; } },
  set: (k, v) => (v == null ? localStorage.removeItem('dimweb.' + k) : localStorage.setItem('dimweb.' + k, JSON.stringify(v))),
};

// Spieldaten (~25 MB): IndexedDB, localStorage fasst nur ~5 MB
const open = () => new Promise((res, rej) => {
  const r = indexedDB.open('dimweb', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const tx = async (mode, fn) => {
  const t = (await open()).transaction('kv', mode);
  const q = fn(t.objectStore('kv'));
  return new Promise((res, rej) => { t.oncomplete = () => res(q.result); t.onerror = () => rej(t.error); });
};
const cache = { load: () => tx('readonly', (s) => s.get('gamedata')), save: (d) => tx('readwrite', (s) => s.put(d, 'gamedata')) };

const core = createCore({ store, cache, auth: AUTH_URL, visible: () => !document.hidden });

// Zurück vom Bungie-Login: ?code=…&state=… aus der Adresse holen und einlösen
const p = new URLSearchParams(location.search);
if (p.has('code')) {
  history.replaceState(null, '', location.pathname + location.hash);
  core.finishLogin(p.get('code'), p.get('state')).catch((e) => alert('Anmeldung fehlgeschlagen: ' + e.message));
}
// Beim Zurückkehren in die App sofort aktualisieren
document.addEventListener('visibilitychange', () => { if (!document.hidden) core.sync(); });
if ('serviceWorker' in navigator) {
  // Neue Version übernommen -> einmal neu laden (nicht beim allerersten Start)
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => had && location.reload());
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
}

window.__setCore(core);
