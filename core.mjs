// App-Kern der Web-Version: dieselbe Logik wie der PC-Server der Desktop-App, läuft aber direkt im Browser.
// Die Oberfläche ruft handle(method, pfad, query, body) statt HTTP auf; gespeichert wird in localStorage/IndexedDB.
import { createData, I } from './data.mjs';
import { authorizeUrl, createBungie } from './bungie.mjs';
import { buildInventory, filterItems, GEAR, VAULT } from './inventory.mjs';

const DEFAULT_SETTINGS = {
  wishlistUrls: 'https://raw.githubusercontent.com/48klocs/dim-wish-list-sources/master/voltron.txt',
  lang: 'de',
  postmasterWarn: 18, // Plätze im Postmaster, ab denen gewarnt wird
};
const DB_KEYS = ['shortcuts', 'hotkeys', 'settings', 'loadouts', 'fashion'];
// dim.gg-Kurzlink oder nur die ID (gleiche Regel wie DIM selbst)
const DIM_SHARE = /^(?:(?:https?:\/\/)?dim\.gg\/)?([a-z0-9]{7,})(?:\/.*)?$/;
const SYNC_MS = 60_000;
const DATA_CHECK_MS = 3 * 3600_000; // Spieldaten/Wishlist auf Neuigkeiten prüfen
const CAT = { armorMod: 4104513227, shader: 41, ornament: 56 }; // DestinyItemCategory-Hashes

// store: {get(key), set(key, value)} (localStorage), cache: {load, save} (IndexedDB für die Spieldaten)
// auth: Adresse des Cloudflare Workers (dim-auth), der API-Key/client_id liefert und das client_secret verwahrt
export function createCore({ store, cache, auth = '', visible = () => true, bungie: bungieOverride /* nur für Tests */ }) {
  const db = store.get('db') ?? {};
  db.shortcuts ??= []; // {id,label,query,action}
  db.hotkeys ??= [];   // {id,accel,label,action}
  db.bungie ??= {};    // {apiKey, clientId}
  db.fashion ??= [];   // Transmog-Sets: {id,name,classType,byBucket:{bucketHash:{ornament,shader}}}
  db.loadouts ??= [];  // eigene Loadouts im DIM-Format: {id,name,classType,notes,equipped:[{id,hash}],unequipped:[{id,hash}]}
  db.settings = { ...DEFAULT_SETTINGS, ...db.settings };
  // ponytail: Secret/Tokens unverschlüsselt in localStorage (nur dieses Gerät, nur diese Seite) – wie DIM selbst
  const secret = store.get('secret') ?? {}; // {clientSecret, auth}
  secret.auth ??= {};
  const save = () => { store.set('db', db); store.set('secret', secret); };

  const data = createData(cache);
  const previews = new Map();
  // Plug-Infos (Kategorie für die Mod-Zuordnung) stehen nur in der vollen Definition: einzeln laden, auf Platte merken
  const plugCache = store.get('plugs') ?? {};
  async function plugInfo(h) {
    if (!plugCache[h]) {
      const d = await bungie.definition(h);
      plugCache[h] = { cat: d.plug?.plugCategoryHash ?? 0, cats: d.itemCategoryHashes ?? [],
        empty: /^(Empty |Default |Restore Defaults)/.test(d.displayProperties?.name ?? '') }; // leere Sockel, Standard-Shader
      store.set('plugs', plugCache);
    }
    return plugCache[h];
  }
  const nameOf = (h) => data.item(h)?.[I.name] ?? h;

  // ---------- Transmog: Shader/Ornamente ----------
  // Welches Plug-Set ein Sockel nutzt, steht nur in der vollen Item-Definition (je Item-Hash einmal laden)
  const socketSets = new Map();
  const setsOf = (hash) => {
    if (!socketSets.has(hash)) socketSets.set(hash, bungie.definition(hash).then((d) =>
      (d.sockets?.socketEntries ?? []).map((e) => e.reusablePlugSetHash || e.randomizedPlugSetHash || 0)).catch((e) => { socketSets.delete(hash); throw e; }));
    return socketSets.get(hash);
  };
  // Angelegte Waffen/Rüstung eines Charakters mit Shader-/Ornament-Sockeln und den freigeschalteten Alternativen
  async function transmog(charId = current()) {
    const P = live.profile ?? {};
    const unlocked = (set) => [...(P.profilePlugSets?.data?.plugs?.[set] ?? []), ...(P.characterPlugSets?.data?.[charId]?.plugs?.[set] ?? [])]
      .filter((p) => p.canInsert !== false && data.item(p.plugItemHash)).map((p) => p.plugItemHash);
    const items = live.inv.items.filter((i) => i.owner === charId && i.equipped && (i.itemType === 2 || i.itemType === 3))
      .sort((a, b) => b.itemType - a.itemType);
    const names = {}, out = [];
    const remember = (h) => { const d = data.item(h); if (d) names[h] = [d[I.name], d[I.icon]]; };
    for (const it of items) {
      const sets = await setsOf(it.hash), sockets = [];
      for (const [idx, h] of it.plugs.entries()) {
        if (!h) continue;
        const c = (await plugInfo(h)).cats; // Standard-Ornament hat auch die Shader-Kategorie, daher Ornament zuerst
        const kind = c.includes(CAT.ornament) ? 'ornament' : c.includes(CAT.shader) ? 'shader' : null;
        if (!kind) continue;
        const options = [...new Set(unlocked(sets[idx]))];
        [h, ...options].forEach(remember);
        sockets.push({ idx, kind, current: h, options });
      }
      out.push({ id: it.id, name: it.name, icon: it.icon, type: it.type, tier: it.tier, itemType: it.itemType, bucket: it.bucket, sockets });
    }
    return { items: out, names };
  }
  // Transmog-Set = Ornament + Shader je Rüstungs-Slot
  async function saveFashion(charId, name) {
    const ch = live.inv.chars.find((c) => c.id === charId) ?? (() => { throw new Error('Charakter nicht gefunden'); })();
    const byBucket = {};
    for (const it of (await transmog(charId)).items.filter((i) => i.itemType === 2))
      byBucket[it.bucket] = Object.fromEntries(it.sockets.map((s) => [s.kind, s.current]));
    const f = { id: crypto.randomUUID(), name: name || 'Transmog-Set', classType: ch.classType, byBucket };
    db.fashion.push(f); save();
    return f;
  }
  async function applyFashion(id, charId = current()) {
    const f = db.fashion.find((x) => x.id === id) ?? (() => { throw new Error('Set nicht gefunden'); })();
    const errors = [];
    let ok = 0;
    for (const it of (await transmog(charId)).items) for (const s of it.sockets) {
      const want = f.byBucket[it.bucket]?.[s.kind];
      if (!want || want === s.current) continue;
      if (!s.options.includes(want)) { errors.push(`${it.name}: ${nameOf(want)} ist für dieses Teil nicht verfügbar`); continue; }
      try { await applyTransmog(it.id, s.idx, want); ok++; } catch (e) { errors.push(`${it.name}: ${e.message}`); }
    }
    return { ok, errors };
  }
  async function applyTransmog(id, idx, hash) {
    const it = find(id);
    if (it.owner === VAULT) throw new Error('Item liegt im Tresor');
    await bungie.insertPlug(it, it.owner, idx, hash);
    it.plugs[idx] = hash;
    return { ok: 1 };
  }
  const bungie = bungieOverride ?? createBungie(() => ({ ...db.bungie, clientSecret: secret.clientSecret, tokenUrl: auth && auth + '/token' }), () => secret.auth, save);
  // Zugang vom Worker holen (und merken, damit die App auch kurz offline startet)
  const authReady = !auth ? Promise.resolve() : fetch(auth + '/config').then((r) => r.json())
    .then((c) => { if (c.apiKey && c.clientId) { db.bungie = { apiKey: c.apiKey, clientId: c.clientId }; save(); } })
    .catch(() => {});
  const live = { inv: null, synced: null, error: null, busy: null, hotkeyErrors: [] };
  const urls = () => db.settings.wishlistUrls.split(/\s+/).filter(Boolean);

  async function sync() {
    if (!secret.auth.access) return;
    try {
      const profile = live.profile = await bungie.profile();
      live.inv = buildInventory(profile, data);
      live.synced = new Date().toISOString(); live.error = null;
    } catch (e) { live.error = e.message; }
  }

  // ---------- Aktionen ----------
  const find = (id) => live.inv?.items.find((i) => i.id === id) ?? (() => { throw new Error('Item nicht gefunden – neu laden'); })();
  const current = () => live.inv?.chars[0]?.id;

  async function move(it, target, equip = false) {
    if (it.postmaster) { await bungie.pull(it, it.owner); it.postmaster = false; }
    if (it.owner !== target && it.equipped) throw new Error(`${it.name} ist angelegt und kann nicht verschoben werden`);
    if (target === VAULT) {
      if (it.owner !== VAULT) await bungie.transfer(it, it.owner, true);
    } else if (it.owner !== target) {
      if (it.owner !== VAULT) await bungie.transfer(it, it.owner, true);
      await bungie.transfer(it, target, false);
    }
    it.owner = target;
    if (equip && target !== VAULT) {
      await bungie.equip(it, target);
      for (const o of live.inv.items) if (o.owner === target && o.bucket === it.bucket) o.equipped = o === it;
    }
  }

  async function lock(it, state) {
    await bungie.lock(it, it.owner === VAULT ? current() : it.owner, state);
    it.locked = state;
  }

  async function bulk(query, action, charId = current()) {
    const hits = filterItems(live.inv.items, query).filter((i) => !i.equipped);
    let ok = 0; const errors = [];
    for (const it of hits) {
      try {
        if (action === 'vault') await move(it, VAULT);
        else if (action === 'char') await move(it, charId);
        else if (action === 'lock' || action === 'unlock') { if (it.lockable && it.locked !== (action === 'lock')) await lock(it, action === 'lock'); }
        ok++;
      } catch (e) { errors.push(`${it.name}: ${e.message}`); }
    }
    return { ok, errors };
  }

  async function postmaster(charId = current()) {
    const pm = live.inv.items.filter((i) => i.postmaster && i.owner === charId);
    const errors = [];
    for (const it of pm) try { await bungie.pull(it, charId); it.postmaster = false; } catch (e) { errors.push(`${it.name}: ${e.message}`); }
    await sync();
    return { ok: pm.length - errors.length, errors };
  }

  // ---------- Eigene Loadouts (wie DIM) ----------
  function addLoadout(l, extra = {}) {
    const items = (xs = []) => xs.map((x) => ({ id: String(x.id ?? ''), hash: Number(x.hash), ...(x.socketOverrides && { socketOverrides: x.socketOverrides }) }))
      .filter((x) => x.hash);
    const p = l.parameters ?? {};
    const lo = { id: crypto.randomUUID(), name: l.name || 'Loadout', classType: l.classType ?? 3, notes: l.notes ?? '',
      equipped: items(l.equipped), unequipped: items(l.unequipped), parameters: { mods: p.mods ?? [], modsByBucket: p.modsByBucket ?? {} }, ...extra };
    db.loadouts.push(lo); save();
    return lo;
  }

  // DIM-Links: dim.gg/<id>/<name> (über DIMs öffentliche API) oder app.destinyitemmanager.com/loadouts?loadout=<json>
  async function importDim(link) {
    link = String(link ?? '').trim();
    let l;
    const m = DIM_SHARE.exec(link);
    if (m) {
      const r = await fetch(`https://api.destinyitemmanager.com/loadout_share?shareId=${m[1]}`, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(r.status === 404 ? 'DIM-Link nicht gefunden' : `DIM-API: HTTP ${r.status}`);
      l = (await r.json()).loadout;
    } else {
      let json;
      try { json = new URL(link).searchParams.get('loadout'); } catch {}
      if (!json) throw new Error('Das ist kein DIM-Loadout-Link');
      l = JSON.parse(json);
    }
    return addLoadout(l, { source: link });
  }

  // Aktuelle Ausrüstung im DIM-Format: Subklassen-Setup als socketOverrides, Rüstungs-Mods als mods, Shader/Ornamente je Slot
  async function saveCurrent(charId, name) {
    const ch = live.inv.chars.find((c) => c.id === charId) ?? (() => { throw new Error('Charakter nicht gefunden'); })();
    const eq = live.inv.items.filter((i) => i.owner === charId && i.equipped);
    const mods = [], modsByBucket = {};
    for (const it of eq.filter((i) => i.itemType === 2 || i.itemType === 3)) for (const h of it.plugs) {
      if (!h) continue;
      const p = await plugInfo(h);
      if (p.empty) continue;
      if (it.itemType === 2 && p.cats.includes(CAT.armorMod)) mods.push(h);
      else if (p.cats.includes(CAT.shader) || p.cats.includes(CAT.ornament)) (modsByBucket[it.bucket] ??= []).push(h);
    }
    const equipped = eq.map((i) => ({ id: i.id, hash: i.hash,
      ...(i.itemType === 16 && { socketOverrides: Object.fromEntries(i.plugs.map((h, idx) => [idx, h]).filter(([, h]) => h)) }) }));
    return addLoadout({ name, classType: ch.classType, equipped, parameters: { mods, modsByBucket } });
  }

  // Subklassen-Setup und Mods auf die angelegten Items des Charakters bringen
  async function applyMods(lo, charId, errors) {
    const eq = () => live.inv.items.filter((i) => i.owner === charId && i.equipped);
    const insert = async (it, idx, h) => { await bungie.insertPlug(it, charId, idx, h); it.plugs[idx] = h; };
    for (const x of lo.equipped) if (x.socketOverrides) {
      const it = eq().find((i) => i.hash === x.hash);
      if (!it) continue;
      // Reihenfolge nach Sockel: Aspekte vor Fragmenten, sonst fehlen die Fragment-Plätze
      for (const [idx, h] of Object.entries(x.socketOverrides).sort((a, b) => a[0] - b[0])) {
        if (it.plugs[idx] === h) continue;
        try { await insert(it, +idx, h); } catch (e) { errors.push(`${it.name} → ${nameOf(h)}: ${e.message}`); }
      }
    }
    // Mods ohne festen Sockel: passender Sockel = gleiche Plug-Kategorie wie der aktuell eingesetzte Plug
    // ponytail: keine Energie-Planung wie in DIM; reicht die Energie beim Tausch nicht, meldet Bungie einen Fehler
    async function fill(items, wanted) {
      const sockets = [];
      for (const it of items) for (const [idx, h] of it.plugs.entries()) if (h) sockets.push({ it, idx, h, cat: (await plugInfo(h)).cat });
      const todo = wanted.filter((m) => { const s = sockets.find((x) => !x.used && x.h === m); return s ? !(s.used = true) : true; });
      for (const m of todo) {
        const cat = (await plugInfo(m)).cat;
        const s = sockets.find((x) => !x.used && x.cat === cat);
        if (!s) { errors.push(`${nameOf(m)}: kein passender Sockel`); continue; }
        s.used = true;
        try { await insert(s.it, s.idx, m); } catch (e) { errors.push(`${s.it.name} → ${nameOf(m)}: ${e.message}`); }
      }
    }
    const p = lo.parameters ?? {};
    if (p.mods?.length) await fill(eq().filter((i) => i.itemType === 2), p.mods);
    for (const [b, ms] of Object.entries(p.modsByBucket ?? {})) await fill(eq().filter((i) => i.bucket === +b), ms);
  }

  // Ein Item aus einem anderen Charakter ablegen, indem dort ein anderes (nicht-exotisches) im selben Slot angelegt wird
  async function unequip(it) {
    const alt = live.inv.items.find((o) => o.owner === it.owner && o.bucket === it.bucket && !o.equipped && !o.postmaster && o.tier !== 6);
    if (!alt) throw new Error('ist angelegt und es gibt keinen Ersatz im Slot');
    await bungie.equip(alt, it.owner);
    alt.equipped = true; it.equipped = false;
  }

  async function applyLoadout(id, charId = current()) {
    const lo = db.loadouts.find((x) => x.id === id) ?? (() => { throw new Error('Loadout nicht gefunden'); })();
    const used = new Set(), errors = [];
    let ok = 0;
    // Eigene Items über die ID, fremde (geteilte) Loadouts über den Item-Hash: bevorzugt schon auf dem Charakter, sonst höchste Power
    const pick = (x) => {
      const c = live.inv.items.filter((i) => !used.has(i) && !i.postmaster && (i.id === x.id || i.hash === x.hash)
        && (i.itemType !== 16 || i.owner === charId)); // Subklassen gehören fest zum Charakter
      const it = c.find((i) => i.id === x.id) ?? c.sort((a, b) => (b.owner === charId) - (a.owner === charId) || b.power - a.power)[0];
      if (it) used.add(it);
      return it;
    };
    const gear = (x) => GEAR.includes(data.item(x.hash)?.[I.itemType]);
    const steps = [...lo.equipped.filter(gear).map((x) => [x, true]), ...lo.unequipped.filter(gear).map((x) => [x, false])]
      .map(([x, eq]) => [x, eq, pick(x)])
      .sort((a, b) => (a[2]?.tier === 6) - (b[2]?.tier === 6)); // Exotics zuletzt, sonst blockiert das alte Exotic
    for (const [x, eq, it] of steps) {
      if (!it) { errors.push(`${data.item(x.hash)?.[I.name] ?? x.hash}: nicht im Inventar`); continue; }
      try {
        if (!(eq && it.equipped && it.owner === charId)) {
          if (it.equipped && it.owner !== charId) await unequip(it);
          await move(it, charId, eq);
        }
        ok++;
      } catch (e) { errors.push(`${it.name}: ${e.message}`); }
    }
    await applyMods(lo, charId, errors);
    await sync();
    return { ok, errors };
  }

  // Für Hotkeys und Knöpfe: {type:'sync'|'postmaster'|'loadout'|'shortcut', index?, shortcutId?}
  async function run(a) {
    if (!live.inv) throw new Error('Nicht angemeldet oder Inventar noch nicht geladen');
    if (a.type === 'sync') return sync();
    if (a.type === 'postmaster') return postmaster();
    if (a.type === 'loadout') return bungie.equipLoadout(current(), a.index);
    if (a.type === 'myloadout') return applyLoadout(a.loadoutId);
    if (a.type === 'shortcut') {
      const s = db.shortcuts.find((x) => x.id === a.shortcutId);
      if (s?.action && s.action !== 'show') return bulk(s.query, s.action);
    }
  }

  async function busy(label, fn) {
    live.busy = label;
    try { return await fn(); } finally { live.busy = null; }
  }

  // ---------- HTTP ----------
  // ---------- Schnittstelle für die Oberfläche (gleiche Pfade wie die Desktop-App) ----------
  async function handle(method, pathname, q, b = {}) {
    const json = (code, obj) => (code >= 400 ? { error: obj?.error ?? `Fehler ${code}` } : obj ?? {});
    try {
      if (method === 'GET') {
        switch (pathname) {
          case '/api/state': {
            const inv = live.inv;
            return json(200, {
              configured: !!(db.bungie.apiKey && db.bungie.clientId && (secret.clientSecret || auth)),
              loggedIn: !!secret.auth.access, user: secret.auth.name,
              bungie: { apiKey: db.bungie.apiKey ?? '', clientId: db.bungie.clientId ?? '', hasSecret: !!secret.clientSecret, managed: !!auth },
              data: data.status, settings: db.settings, shortcuts: db.shortcuts, hotkeys: db.hotkeys,
              fashion: db.fashion.map((f) => ({ ...f, look: Object.values(f.byBucket).flatMap((x) => [x.ornament, x.shader]).filter(Boolean)
                .map((h) => ({ name: data.item(h)?.[I.name] ?? '?', icon: data.item(h)?.[I.icon] })) })),
              myLoadouts: db.loadouts.map((l) => ({ ...l,
                mods: [...(l.parameters?.mods ?? []), ...Object.values(l.parameters?.modsByBucket ?? {}).flat()]
                  .map((h) => ({ hash: h, name: data.item(h)?.[I.name] ?? '?', icon: data.item(h)?.[I.icon] })),
                items: l.equipped.concat(l.unequipped).map((x) => {
                const d = data.item(x.hash);
                return { ...x, name: d?.[I.name] ?? '?', icon: d?.[I.icon], gear: GEAR.includes(d?.[I.itemType]), equip: l.equipped.includes(x),
                  owned: !!live.inv?.items.some((i) => i.id === x.id || i.hash === x.hash) };
              }) })),
              hotkeyErrors: live.hotkeyErrors, synced: live.synced, error: live.error, busy: live.busy,
              chars: inv?.chars ?? [], currencies: inv?.currencies ?? [], limits: inv?.limits, vaultCount: inv?.vaultCount, loadouts: inv?.loadouts ?? {},
              counts: inv && { god: inv.items.filter((i) => i.god.length).length, trash: inv.items.filter((i) => i.trash).length, items: inv.items.length },
            });
          }
          case '/api/items': return json(200, live.inv ? filterItems(live.inv.items, q.get('q') ?? '').slice(0, +(q.get('limit') ?? 400)) : []);
          case '/api/godroll/search': return json(200, data.search(q.get('q') ?? ''));
          case '/api/godroll/weapon': {
            const w = data.weapon(q.get('name') ?? '');
            if (w) w.owned = live.inv?.items.filter((i) => w.hashes.includes(String(i.hash))) ?? [];
            return json(200, w);
          }
          // 2D-Vorschau: steht nur in der vollen Item-Definition, daher einzeln nachladen und merken
          case '/api/transmog': return json(200, live.inv ? await transmog(q.get('charId') || undefined) : { items: [], names: {} });
          case '/api/preview': {
            const h = q.get('hash');
            if (!previews.has(h)) previews.set(h, bungie.definition(h, db.settings.lang).then((d) => ({ screenshot: d.screenshot ?? '', flavor: d.flavorText ?? '', desc: d.displayProperties?.description ?? '' })));
            return json(200, await previews.get(h).catch((e) => { previews.delete(h); throw e; }));
          }
        }
        return json(404);
      }
      switch (pathname) {
        case '/api/db':
          if (!DB_KEYS.includes(b.key)) return json(400, { error: 'key' });
          db[b.key] = b.value; save();
          return json(200);
        case '/api/bungie': // App-Zugangsdaten von bungie.net/de/Application
          db.bungie = { apiKey: b.apiKey?.trim(), clientId: b.clientId?.trim() };
          if (b.clientSecret?.trim()) secret.clientSecret = b.clientSecret.trim();
          save(); return json(200);
        case '/api/login': { // Weiterleitung zu Bungie; zurück kommt die Seite mit ?code=…&state=… (finishLogin)
          const state = crypto.randomUUID();
          store.set('oauthState', state);
          return json(200, { redirect: authorizeUrl(db.bungie.clientId, state, db.settings.lang) });
        }
        case '/api/logout': secret.auth = {}; live.inv = null; save(); return json(200);
        case '/api/sync': return json(200, await busy('Lade Inventar …', sync));
        case '/api/move': return json(200, await busy('Verschiebe …', () => move(find(b.id), b.target, b.equip)));
        case '/api/lock': return json(200, await busy('Sperre …', () => lock(find(b.id), b.state)));
        case '/api/bulk': return json(200, await busy('Massenaktion …', () => bulk(b.query, b.action, b.charId)));
        case '/api/run': return json(200, await busy('Aktion …', () => run(b)));
        case '/api/loadout': return json(200, await busy('Lege Loadout an …', () => bungie.equipLoadout(b.charId, b.index).then(sync)));
        case '/api/myloadout/import': return json(200, await importDim(b.link));
        case '/api/myloadout/save': return json(200, await saveCurrent(b.charId, b.name));
        case '/api/transmog/apply': return json(200, await busy('Transmog …', async () => {
          // Shader auf mehrere Teile: gleiche Reihenfolge wie die Anfrage, Fehler je Teil sammeln
          const errors = [];
          for (const t of b.targets ?? []) try { await applyTransmog(t.id, t.idx, b.hash); } catch (e) { errors.push(`${find(t.id).name}: ${e.message}`); }
          return { ok: (b.targets ?? []).length - errors.length, errors };
        }));
        case '/api/fashion/save': return json(200, await saveFashion(b.charId, b.name));
        case '/api/fashion/apply': return json(200, await busy('Transmog-Set …', () => applyFashion(b.id, b.charId)));
        case '/api/myloadout/apply': return json(200, await busy('Lege Loadout an …', () => applyLoadout(b.id, b.charId)));
        case '/api/postmaster': return json(200, await busy('Hole Postmaster …', () => postmaster(b.charId)));
        case '/api/data/update': data.update(urls(), db.settings.lang, db.bungie.apiKey).then(sync); return json(200);
      }
      return json(404);
    } catch (e) { return json(400, { error: e.message }); }
  }

  async function finishLogin(code, state) {
    if (state !== store.get('oauthState')) throw new Error('Login abgebrochen (state passt nicht)');
    store.set('oauthState', null);
    await busy('Anmeldung …', () => bungie.login(code));
    await sync();
  }

  // Neu laden nur, solange die Seite sichtbar ist (spart Akku auf dem Handy)
  const timer = setInterval(() => { if (!live.busy && visible()) sync(); }, SYNC_MS);
  const checkData = () => urls().length && db.bungie.apiKey && data.check(urls(), db.settings.lang, db.bungie.apiKey).then((changed) => changed && sync());
  const dataTimer = setInterval(checkData, DATA_CHECK_MS);
  const ready = Promise.all([data.ready, authReady]).then(() => { sync(); checkData(); });

  return {
    ready, live, db, handle, finishLogin, sync,
    close: () => { clearInterval(timer); clearInterval(dataTimer); },
  };
}
