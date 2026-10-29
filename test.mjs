// Selbsttest der Web-Version ohne Browser, ohne Netz und ohne Bungie-Konto: node test.mjs
// Gleiche Prüfungen wie in der Desktop-App; statt HTTP ruft fetch hier direkt core.handle auf.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseWishlist } from './data.mjs';
import { optimize } from './extra.mjs';
import { createCloud } from './cloud.mjs';
import { createCore } from './core.mjs';

// ---- Rüstungs-Optimierer: höchstens ein Exotic, Mindestwert erreicht
{
  const mk = (id, b, tier, a, c) => ({ id, itemType: 2, bucket: b, cls: 0, tier, stats: [{ hash: 1, value: a }, { hash: 2, value: c }] });
  const items = [3448274439, 3551918588, 14239492, 20886954, 1585787867].flatMap((b, n) => [mk('l' + n, b, 5, 10, 30), mk('h' + n, b, 5, 30, 5), mk('x' + n, b, 6, 40, 40)]);
  const [best] = optimize(items, 0, { stats: [{ hash: 1, min: 150 }] });
  assert.equal(best.items.filter((i) => i.tier === 6).length, 1);
  assert.equal(best.tot[1], 160); assert.equal(best.miss, 0);
  const [capped] = optimize(items, 0, { stats: [{ hash: 1, min: 0, max: 100 }] }); // bis-Wert wird eingehalten
  assert.ok(capped.tot[1] <= 100 && capped.miss === 0);
  const [modded] = optimize(items, 0, { stats: [{ hash: 1, min: 200 }], mods: true }); // 160 + 4×10 durch Stat-Mods
  assert.ok(modded.miss === 0 && modded.mods.length === 5 && modded.tot[1] === 210);
  const [none] = optimize(items, 0, { exotic: -1, pinned: ['h0'], excluded: ['l1'] }); // kein Exotic, Pin, Ausschluss
  assert.ok(none.items.every((i) => i.tier !== 6) && none.items.some((i) => i.id === 'h0') && !none.items.some((i) => i.id === 'l1'));
}

// ---- Cloud-Sync: erster Abgleich führt zusammen, danach gewinnt die neuere Änderung
{
  const remote = { loadouts: { v: [{ id: 'r' }], at: 5 } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    if (o.method === 'PUT') for (const [k, e] of Object.entries(JSON.parse(o.body))) if (e.at > (remote[k]?.at ?? 0)) remote[k] = e;
    return Response.json(remote);
  };
  const db = { loadouts: [{ id: 'l' }], tags: {} };
  const cloud = createCloud({ url: 'x', db, save: () => cloud.changed(), session: async () => ({ token: 't', apiKey: 'k' }) });
  await cloud.pull();
  assert.deepEqual(db.loadouts.map((x) => x.id), ['r', 'l']);
  assert.deepEqual(remote.loadouts.v.map((x) => x.id), ['r', 'l']);
  remote.loadouts = { v: [{ id: 'neu' }], at: Date.now() + 1000 };
  await cloud.pull();
  assert.deepEqual(db.loadouts, [{ id: 'neu' }]);
  globalThis.fetch = realFetch;
}

// ---- Wishlist-Parser
const wl = parseWishlist(`// Testwaffe - PvE god 1
// (Explosivladung), (Raserei)
//notes:Top PvE
dimwishlist:item=100&perks=1,2
dimwishlist:item=-69420&perks=1
dimwishlist:item=-100&perks=9#notes:mies|mit Strich`);
assert.deepEqual(wl.rolls['100'], [['1,2', 0]]);
assert.deepEqual(wl.trash['100'], [['9', 1]]);
assert.equal(wl.labels[1].split('\x1f')[2], 'mies|mit Strich');

// ---- Spieldaten-Fixture: [name, icon, typeName, tierType, bucketHash, itemType, classType]
const KIN = 1498876634;
const gamedata = ({
  updated: 'x', en: { 2: 'Frenzy' }, items: {
    100: ['Testwaffe', '/i.png', 'Handfeuerwaffe', 5, KIN, 3, 3],
    1: ['Explosivladung', '', 'Eigenschaft', 0, 0, 19, 3],
    3: ['Explosivladung', '', 'Verbessertes Attribut', 0, 0, 19, 3], // verbesserte Variante, anderer Hash
    2: ['Raserei', '', 'Eigenschaft', 0, 0, 19, 3],
    9: ['Mieser Perk', '', 'Eigenschaft', 0, 0, 19, 3],
    4: ['Shader', '', 'Shader', 0, 0, 19, 3],
    200: ['Helm', '/h.png', 'Helm', 5, 3448274439, 2, 0],
    600: ['Sturmruf', '/s.png', 'Titan-Subklasse', 2, 3284755031, 16, 0],
    701: ['Standard-Shader', '/sh.png', 'Shader', 0, 0, 19, 3],
    711: ['Gold', '/gold.png', 'Shader', 0, 0, 19, 3],
    712: ['Gesperrt', '/x.png', 'Shader', 0, 0, 19, 3],
    700: ['Leerer Mod-Sockel', '/m.png', 'Kopfschutz-Mod', 0, 0, 19, 3],
    601: ['Gewittersturm', '/a.png', 'Super-Fähigkeit', 0, 0, 19, 3],
    800: ['Artefakt der Saison', '/art.png', 'Artefakt', 6, 0, 0, 3],
    810: ['Jägertagebuch', '/j.png', 'Artefakt', 5, 1506418338, 0, 3],
    899: ['Artefakt-Mod leer', '/e.png', '', 5, 0, 19, 3],
    801: ['Antibarriere-Automatik', '/p1.png', 'Artefakt-Perk', 0, 0, 19, 3],
    802: ['Überladungs-Bogen', '/p2.png', 'Artefakt-Perk', 0, 0, 19, 3],
    300: ['Engramm', '/e.png', 'Engramm', 3, 375726501, 8, 3],
    3159615086: ['Glimmer', '/g.png', 'Währung', 0, 2689798308, 0, 3],
  },
  limits: { vault: 1300, postmaster: 21 }, stacks: { 3159615086: 500000 },
  perkTypes: ['Eigenschaft', 'Verbessertes Attribut'], rolls: { 100: [['1,2', 0]] }, trash: { 100: [['9', 1]] },
  labels: ['Testwaffe - PvE god 1\x1f\x1f', 'Trash\x1f\x1f'], loadoutNames: { 7: 'Raid' }, loadoutIcons: {}, loadoutColors: {},
});
// Speicher wie im Browser: localStorage-Ersatz + IndexedDB-Ersatz
const mem = { db: { settings: { wishlistUrls: '' } }, secret: { clientSecret: 's', auth: { access: 't' } } };
const store = { get: (k) => mem[k] ?? null, set: (k, v) => { mem[k] = v; } };
const cache = { load: async () => gamedata, save: async () => {} };

const raw = (id, hash, bucket = KIN, state = 0) => ({ itemInstanceId: id, itemHash: hash, bucketHash: bucket, quantity: 1, state, lockable: true });
const profile = {
  profile: { data: { characterIds: ['c1', 'c2'] } },
  characters: { data: {
    c1: { classType: 0, light: 2000, dateLastPlayed: '2026-10-26T10:00:00Z' },
    c2: { classType: 2, light: 1990, dateLastPlayed: '2026-10-20T10:00:00Z' },
  } },
  characterEquipment: { data: { c1: { items: [raw('A', 100), raw('S', 600, 3284755031), raw('ART', 810, 1506418338)] }, c2: { items: [] } } },
  characterInventories: { data: { c1: { items: [raw('B', 100, KIN, 1), raw('P', 300, 215593132)] }, c2: { items: [] } } },
  profileInventory: { data: { items: [raw('V', 100, 138197802), raw('H', 200, 138197802), { itemHash: 3159615086, bucketHash: 1 }] } },
  profileProgression: { data: { seasonalArtifact: { powerBonus: 12, pointsAcquired: 20 } } },
  characterProgressions: { data: { c1: { seasonalArtifact: { artifactHash: 800, pointsUsed: 1,
    tiers: [{ isUnlocked: true, items: [{ itemHash: 801, isActive: true, isVisible: true }, { itemHash: 802, isActive: false, isVisible: true }] }] } } } },
  profilePlugSets: { data: { plugs: { 5000: [{ plugItemHash: 711, canInsert: true }, { plugItemHash: 712, canInsert: false }] } } },
  profileCurrencies: { data: { items: [{ itemHash: 3159615086, quantity: 12345 }] } },
  characterLoadouts: { data: { c1: { loadouts: [{ nameHash: 7, items: [{ itemInstanceId: 'A' }] }, { nameHash: 0, items: [{ itemInstanceId: '0' }] }] } } },
  itemComponents: {
    instances: { data: { A: { primaryStat: { value: 2010 } } } },
    sockets: { data: {
      A: { sockets: [{ plugHash: 3 }, { plugHash: 2 }, { plugHash: 4 }] }, // verbesserte Explosivladung + Raserei + Shader
      B: { sockets: [{ plugHash: 9 }, { plugHash: 2 }] },
      V: { sockets: [{ plugHash: 2 }] },
      S: { sockets: [{ plugHash: 601 }, { plugHash: 602 }] }, // Subklasse: Fähigkeit, Aspekt
      ART: { sockets: [{ plugHash: 802 }, { plugHash: 899 }] }, // Artefakt: ein Perk gesetzt, ein Platz leer
      H: { sockets: [{ plugHash: 700 }, { plugHash: 701 }] }, // Helm: leerer Mod-Sockel, Standard-Shader
    } },
    reusablePlugs: { data: { V: { plugs: { 0: [{ plugItemHash: 2 }, { plugItemHash: 1 }] } } } }, // Explosivladung als Alternative
  },
};

const calls = [];
// volle Definitionen für die Mod-Zuordnung (Plug-Kategorie 22 = Helm-Mods, 33 = Shader)
const PLUGS = {
  4: { displayProperties: { name: 'Default Shader' }, plug: { plugCategoryHash: 33 }, itemCategoryHashes: [41, 52] },
  100: { sockets: { socketEntries: [{}, {}, { reusablePlugSetHash: 5000 }] } }, // Testwaffe: Sockel 2 = Shader-Set
  700: { displayProperties: { name: 'Empty Mod Socket' }, plug: { plugCategoryHash: 22 }, itemCategoryHashes: [59, 4104513227] },
  710: { displayProperties: { name: 'Hands-On' }, plug: { plugCategoryHash: 22 }, itemCategoryHashes: [59, 4104513227] },
  701: { displayProperties: { name: 'Default Shader' }, plug: { plugCategoryHash: 33 }, itemCategoryHashes: [41] },
  711: { displayProperties: { name: 'Gold' }, plug: { plugCategoryHash: 33 }, itemCategoryHashes: [41] },
};
const fake = new Proxy({}, { get: (_, fn) => async (...a) => { if (fn !== 'session') calls.push([fn, ...a.map((x) => x?.id ?? x)]); return fn === 'profile' ? profile : fn === 'definition' ? (PLUGS[a[0]] ?? { screenshot: '/s.jpg' }) : 0; } });
const srv = createCore({ store, cache, bungie: fake });
srv.url = 'http://app/';
// fetch auf die App-Pfade -> core.handle (die Oberfläche macht das genauso)
globalThis.fetch = async (u, o = {}) => {
  const url = new URL(u);
  const r = await srv.handle(o.method ?? 'GET', url.pathname, url.searchParams, o.body ? JSON.parse(o.body) : {});
  return { status: r?.error ? 400 : 200, json: async () => r };
};
const post = (u, b, headers = {}) => fetch(srv.url + u.slice(1), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(b) });
const json = async (r) => { const j = await r.json(); if (j?.error) throw new Error(j.error); return j; };
const items = async (q = '') => json(await fetch(srv.url + 'api/items?q=' + encodeURIComponent(q)));

try {
  await srv.ready;
  await json(await post('/api/sync', {}));
  const st = await json(await fetch(srv.url + 'api/state'));
  assert.equal(st.loggedIn, true);
  assert.equal(JSON.stringify(st).includes('"s"') || JSON.stringify(st).includes('clientSecret'), false, 'Geheimnisse dürfen nicht an die UI');
  assert.deepEqual(st.chars.map((c) => [c.id, c.cls, c.postmaster]), [['c1', 'Titan', 1], ['c2', 'Warlock', 0]]);
  assert.deepEqual(st.currencies.map((c) => [c.name, c.amount]), [['Glimmer', 12345]]);
  assert.deepEqual(st.limits, { vault: 1300, postmaster: 21 });
  assert.equal(st.vaultCount, 2);
  const art = st.chars[0].artifact;
  assert.deepEqual([art.name, art.power, art.points, art.tiers[0].perks.map((p) => [p.name, p.active])],
    ['Jägertagebuch', 12, 20, [['Antibarriere-Automatik', true], ['Überladungs-Bogen', true]]], 'aktiv über isActive oder Sockel');
  assert.deepEqual(art.slots.map((s) => [s.name, s.empty]), [['Überladungs-Bogen', false], ['Artefakt-Mod leer', true]]);
  assert.equal(st.chars[1].artifact, null);
  assert.deepEqual(st.loadouts.c1.filter((l) => !l.empty).map((l) => l.name), ['Raid']);

  const all = await items();
  const A = all.find((i) => i.id === 'A'), B = all.find((i) => i.id === 'B'), V = all.find((i) => i.id === 'V');
  assert.deepEqual(A.god, ['Testwaffe - PvE god 1'], 'verbesserter Perk zählt über den Namen');
  assert.equal(A.perks.length, 2, 'Shader-Sockel ist keine Perk-Spalte');
  assert.equal(A.power, 2010);
  assert.equal(B.trash, true); assert.equal(B.god.length, 0); assert.equal(B.locked, true);
  assert.deepEqual(V.god, ['Testwaffe - PvE god 1'], 'Perk-Alternative im selben Sockel zählt');
  assert.equal(all.find((i) => i.id === 'P').postmaster, true);
  assert.equal(all.some((i) => i.hash === 3159615086), false, 'Währungen gehören nicht ins Inventar');

  // Suchsprache
  assert.deepEqual((await items('is:godroll')).map((i) => i.id).sort(), ['A', 'V']);
  assert.deepEqual((await items('is:pve')).map((i) => i.id).sort(), ['A', 'V']);
  assert.deepEqual((await items('is:pvp')).map((i) => i.id), []);
  assert.deepEqual((await items('is:trash -is:locked')).map((i) => i.id), []);
  assert.deepEqual((await items('perk:raserei is:vault')).map((i) => i.id), ['V']);
  assert.deepEqual((await items('owner:c1 is:weapon -is:equipped')).map((i) => i.id), ['B']);
  assert.deepEqual((await items('slot:helm')).map((i) => i.id), ['H']);
  assert.deepEqual((await items('slot:helm'))[0].mods.map((p) => p.name), ['Standard-Shader'], 'Rüstungs-Mods ohne leere Sockel');
  assert.deepEqual((await items('type:handfeuerwaffe -is:vault')).map((i) => i.id).sort(), ['A', 'B']);
  const sub = (await items('slot:subklasse'));
  assert.deepEqual(sub.map((i) => [i.id, i.setup.map((p) => p.name)]), [['S', ['Gewittersturm']]], 'Subklassen-Setup mit Namen');
  assert.equal(sub[0].setup[0].hash, 601);

  // Aktionen -> richtige Bungie-Aufrufe
  calls.length = 0;
  await json(await post('/api/move', { id: 'B', target: 'c2' }));
  assert.deepEqual(calls, [['transfer', 'B', 'c1', true], ['transfer', 'B', 'c2', false]], 'Charakter -> Charakter läuft über den Tresor');
  calls.length = 0;
  await json(await post('/api/move', { id: 'V', target: 'c1', equip: true }));
  assert.deepEqual(calls, [['transfer', 'V', 'c1', false], ['equip', 'V', 'c1']]);
  assert.equal((await items()).find((i) => i.id === 'A').equipped, false, 'altes Item im Slot ist abgelegt');
  calls.length = 0;
  await json(await post('/api/lock', { id: 'H', state: true }));
  assert.deepEqual(calls, [['lock', 'H', 'c1', true]], 'Sperren im Tresor nutzt aktuellen Charakter');
  calls.length = 0;
  const r = await json(await post('/api/bulk', { query: 'is:weapon', action: 'vault' }));
  assert.deepEqual(calls, [['transfer', 'A', 'c1', true], ['transfer', 'B', 'c2', true]], 'angelegte Items (V) werden übersprungen');
  assert.equal(r.ok, 2);
  calls.length = 0;
  await json(await post('/api/run', { type: 'loadout', index: 0 }));
  assert.deepEqual(calls, [['equipLoadout', 'c1', 0]]);
  calls.length = 0;
  await json(await post('/api/postmaster', {}));
  assert.deepEqual(calls[0], ['pull', 'P', 'c1']);
  // Postmaster lädt neu -> Fixture-Zustand: A ist auf c1 angelegt
  assert.match((await post('/api/move', { id: 'A', target: 'vault' }).then((x) => x.json())).error, /angelegt/);

  assert.equal((await json(await fetch(srv.url + 'api/preview?hash=300'))).screenshot, '/s.jpg');
  // Eigene Loadouts: DIM-Link importieren (fremde IDs -> per Hash), Nicht-Ausrüstung überspringen, anlegen
  const dimLo = { name: 'Geteilt', classType: 0, equipped: [{ id: 'B', hash: 100 }, { id: 'fremd', hash: 200 }], unequipped: [{ id: 'x', hash: 300 }] };
  const lo = await json(await post('/api/myloadout/import', { link: 'https://app.destinyitemmanager.com/loadouts?loadout=' + encodeURIComponent(JSON.stringify(dimLo)) }));
  assert.equal(lo.name, 'Geteilt');
  assert.match((await post('/api/myloadout/import', { link: 'https://example.com/x' }).then((x) => x.json())).error, /kein DIM/);
  calls.length = 0;
  const ap = await json(await post('/api/myloadout/apply', { id: lo.id, charId: 'c1' }));
  assert.deepEqual(calls.filter((c) => c[0] !== 'profile'), [['equip', 'B', 'c1'], ['transfer', 'H', 'c1', false], ['equip', 'H', 'c1']], 'Helm über den Hash gefunden, Engramm übersprungen');
  assert.deepEqual(ap, { ok: 2, errors: [] });
  // Subklassen-Setup (socketOverrides) und Mods/Shader aus DIM-Parametern
  const modLo = await json(await post('/api/myloadout/import', { link: 'https://app.destinyitemmanager.com/loadouts?loadout=' + encodeURIComponent(JSON.stringify({
    name: 'Build', classType: 0, unequipped: [],
    equipped: [{ id: 'S', hash: 600, socketOverrides: { 1: 603 } }, { id: 'H', hash: 200 }],
    parameters: { mods: [710], modsByBucket: { 3448274439: [711] } },
  })) }));
  calls.length = 0;
  assert.deepEqual(await json(await post('/api/myloadout/apply', { id: modLo.id, charId: 'c1' })), { ok: 2, errors: [] });
  assert.deepEqual(calls.filter((c) => c[0] !== 'profile' && c[0] !== 'definition'), [
    ['transfer', 'H', 'c1', false], ['equip', 'H', 'c1'],
    ['insertPlug', 'S', 'c1', 1, 603], ['insertPlug', 'H', 'c1', 0, 710], ['insertPlug', 'H', 'c1', 1, 711],
  ], 'Aspekt in Sockel 1, Mod in den leeren Mod-Sockel, Shader in den Shader-Sockel');

  const saved = await json(await post('/api/myloadout/save', { charId: 'c1', name: 'Jetzt' }));
  assert.deepEqual(saved.equipped, [{ id: 'A', hash: 100 }, { id: 'S', hash: 600, socketOverrides: { 0: 601, 1: 602 } }]);
  assert.equal((await json(await fetch(srv.url + 'api/state'))).myLoadouts.length, 3);

  // Transmog: Shader-Sockel mit freigeschalteten Optionen, anwenden
  const tm = await json(await fetch(srv.url + 'api/transmog?charId=c1'));
  const tA = tm.items.find((i) => i.id === 'A');
  assert.deepEqual(tA.sockets, [{ idx: 2, kind: 'shader', current: 4, options: [711] }], 'nur einsetzbare Shader');
  assert.equal(tm.names[711][0], 'Gold');
  calls.length = 0;
  assert.deepEqual(await json(await post('/api/transmog/apply', { hash: 711, targets: [{ id: 'A', idx: 2 }] })), { ok: 1, errors: [] });
  assert.deepEqual(calls, [['insertPlug', 'A', 'c1', 2, 711]]);

  // Transmog-Set: aktuellen Look speichern, später wieder anlegen
  await json(await post('/api/sync', {}));
  const tmH = (await json(await fetch(srv.url + 'api/transmog?charId=c1'))).items;
  assert.ok(tmH.every((i) => i.bucket), 'Slot je Teil für Sets');
  await json(await post('/api/db', { key: 'fashion', value: [
    { id: 'f1', name: 'Gold', classType: 0, byBucket: { [KIN]: { shader: 711 } } },
    { id: 'f2', name: 'Nicht da', classType: 0, byBucket: { [KIN]: { shader: 712 } } },
  ] }));
  calls.length = 0;
  assert.deepEqual(await json(await post('/api/fashion/apply', { id: 'f1', charId: 'c1' })), { ok: 1, errors: [] });
  assert.deepEqual(calls.filter((c) => c[0] === 'insertPlug'), [['insertPlug', 'A', 'c1', 2, 711]]);
  const f2 = await json(await post('/api/fashion/apply', { id: 'f2', charId: 'c1' }));
  assert.equal(f2.ok, 0); assert.match(f2.errors[0], /nicht verfügbar/);
  assert.deepEqual((await json(await fetch(srv.url + 'api/state'))).fashion[0].look.map((x) => x.name), ['Gold']);

  // Tags: zerlegen markieren und per tag: finden
  assert.equal((await post('/api/tag', { id: 'A', tag: 'zerlegen' })).status, 200);
  assert.deepEqual((await json(await fetch(srv.url + 'api/items?q=tag:zerlegen'))).map((i) => i.id), ['A']);
  await post('/api/tag', { id: 'A' });

  // Suche nach Perks, auch mit englischem Namen; Godroll-Finder findet Waffen über empfohlene Perks
  assert.ok((await json(await fetch(srv.url + 'api/items?q=raserei'))).some((i) => i.id === 'A'));
  assert.ok((await json(await fetch(srv.url + 'api/items?q=frenzy'))).some((i) => i.id === 'A'));
  assert.ok((await json(await fetch(srv.url + 'api/godroll/search?q=frenzy'))).length > 0);

  // Godroll-Analyse: B hat Raserei, aber nicht Explosivladung -> knapp verfehlt; A passt (verbesserte Variante zählt)
  const exA = await json(await fetch(srv.url + 'api/godroll/item?id=A'));
  assert.deepEqual(exA.rolls.map((r) => [r.title, r.have, r.missing]), [['Testwaffe - PvE god 1', ['Explosivladung', 'Raserei'], []]]);
  const exB = await json(await fetch(srv.url + 'api/godroll/item?id=B'));
  assert.deepEqual(exB.rolls.map((r) => [r.have, r.missing]), [[['Raserei'], ['Explosivladung']]]);
  assert.equal(exB.hasRolls, true);

  // Spiel-Loadouts: Vorschau-Items, Speichern (Snapshot), Umbenennen, Löschen
  assert.deepEqual((await json(await fetch(srv.url + 'api/state'))).loadouts.c1[0].items.map((i) => i.id), ['A']);
  assert.deepEqual((await json(await fetch(srv.url + 'api/loadoutdefs'))).names, [['7', 'Raid']]);
  calls.length = 0;
  await json(await post('/api/gameloadout/save', { charId: 'c1', index: 1, nameHash: 7, iconHash: 1, colorHash: 2, snapshot: true }));
  await json(await post('/api/gameloadout/save', { charId: 'c1', index: 0, nameHash: 7, iconHash: 3, colorHash: 4 }));
  await json(await post('/api/gameloadout/clear', { charId: 'c1', index: 0 }));
  assert.deepEqual(calls.filter((c) => c[0] !== 'profile'), [
    ['snapshotLoadout', 'c1', 1, { nameHash: 7, iconHash: 1, colorHash: 2 }],
    ['updateLoadout', 'c1', 0, { nameHash: 7, iconHash: 3, colorHash: 4 }],
    ['clearLoadout', 'c1', 0],
  ]);

  // Konfiguration + Schutz
  await json(await post('/api/db', { key: 'hotkeys', value: [{ id: 'h1', accel: 'Ctrl+Alt+1', label: 'x', action: { type: 'sync' } }] }));
  assert.equal(mem.db.hotkeys[0].accel, 'Ctrl+Alt+1');
  assert.equal((await post('/api/db', { key: 'secret', value: {} })).status, 400);
  // Login: Weiterleitung zu Bungie, Rückkehr mit code + state
  const lg = await json(await post('/api/login', {}));
  assert.match(lg.redirect, /OAuth\/Authorize\?client_id=/);
  const state = new URL(lg.redirect).searchParams.get('state');
  await assert.rejects(srv.finishLogin('c', 'falsch'), /state/);
  calls.length = 0;
  await srv.finishLogin('code123', state);
  assert.deepEqual(calls[0], ['login', 'code123']);

  // Token-Tausch über den Worker: kein client_secret im Browser
  const { createBungie } = await import('./bungie.mjs');
  const sentT = [];
  globalThis.fetch = async (u, o = {}) => {
    sentT.push([String(u), o.body, o.headers?.authorization]);
    return new Response(JSON.stringify(String(u).includes('/token')
      ? { access_token: 'a', refresh_token: 'r', expires_in: 3600, refresh_expires_in: 7776000 }
      : { ErrorCode: 1, Response: { primaryMembershipId: 'm', destinyMemberships: [{ membershipId: 'm', membershipType: 3, displayName: 'x' }] } }));
  };
  const authObj = {};
  await createBungie(() => ({ apiKey: 'k', clientId: '1', tokenUrl: 'https://w/token' }), () => authObj, () => {}).login('cc');
  assert.deepEqual(sentT[0], ['https://w/token', JSON.stringify({ grant_type: 'authorization_code', code: 'cc' }), undefined], 'an den Worker, ohne Basic-Auth');
  assert.equal(authObj.access, 'a');
  console.log('OK – alle Checks bestanden');
} finally {
  srv.close();
  setTimeout(() => process.exit(0), 50);
}
