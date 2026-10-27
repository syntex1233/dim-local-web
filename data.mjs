// Spieldaten-Cache: Bungie-Manifest (Item-/Perknamen, Icons) + DIM-Wishlists (Standard: voltron).
// Wishlist-Format: "dimwishlist:item=<hash>&perks=<hash>,<hash>#notes:..." ; negativer Hash = Trash-Roll
// Web-Version: Cache liegt in IndexedDB (cache = {load, save}), Bungie-/Platform-Aufrufe brauchen im Browser den API-Key

export const BUNGIE = 'https://www.bungie.net';

async function get(url, type = 'json', headers = {}) {
  const r = await fetch(url, { signal: AbortSignal.timeout(180_000), headers });
  if (!r.ok) throw new Error(`${r.status} bei ${url}`);
  return type === 'json' ? r.json() : r.text();
}

// rolls/trash: hash -> [[perkCsv, labelIdx]], labels: ["Titel\x1fSpalten\x1fNotiz"]
export function parseWishlist(text, rolls = {}, trash = {}, labels = [], labelIdx = new Map()) {
  let title = '', cols = '', note = '';
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (l.startsWith('//notes:')) note = l.slice(8).trim();
    // ponytail: voltron-Konvention "// Name - Art" gefolgt von "// (Spalte), (Spalte)"; andere Listen haben evtl. nur Notizen
    else if (l.startsWith('//')) {
      const c = l.slice(2).trim();
      if (c.startsWith('(')) cols = c; else { title = c; cols = ''; note = ''; }
    } else if (l.startsWith('dimwishlist:')) {
      const m = /item=(-?\d+)(?:&perks=([\d,]*))?(?:#notes:(.*))?/.exec(l);
      if (!m || m[1] === '-69420') continue; // -69420 = gilt für jedes Item, ignoriert
      const label = [title, cols, (m[3] ?? note).trim()].join('\x1f');
      let i = labelIdx.get(label);
      if (i === undefined) { i = labels.push(label) - 1; labelIdx.set(label, i); }
      const neg = m[1].startsWith('-');
      ((neg ? trash : rolls)[neg ? m[1].slice(1) : m[1]] ??= []).push([m[2] ?? '', i]);
    }
  }
  return { rolls, trash, labels };
}

// items: hash -> [name, icon, typeName, tierType, bucketHash, itemType, classType]
export const I = { name: 0, icon: 1, type: 2, tier: 3, bucket: 4, itemType: 5, cls: 6 };

export function createData(cache) {
  let data = null;
  const status = { state: 'leer', updated: null, weapons: 0, error: null };
  const loaded = (d) => {
    data = d;
    Object.assign(status, { state: 'bereit', updated: d.updated, weapons: Object.keys(d.rolls).length, error: null });
  };
  const ready = cache.load().then((d) => d && loaded(d)).catch(() => {});

  async function update(urls, lang, apiKey) {
    if (status.state === 'lädt') return;
    status.state = 'lädt'; status.error = null;
    try {
      const rolls = {}, trash = {}, labels = [], idx = new Map();
      for (const u of urls) parseWishlist(await get(u, 'text'), rolls, trash, labels, idx);
      const manifest = (await get(`${BUNGIE}/Platform/Destiny2/Manifest/`, 'json', { 'x-api-key': apiKey })).Response;
      const paths = manifest.jsonWorldComponentContentPaths;
      const p = paths[lang] ?? paths.en;
      const defs = await get(BUNGIE + p.DestinyInventoryItemLiteDefinition);
      const items = {}, stacks = {};
      for (const [h, d] of Object.entries(defs)) {
        if (d.inventory?.maxStackSize >= 1000) stacks[h] = d.inventory.maxStackSize; // Währungs-Obergrenzen (Glimmer usw.)
        const n = d.displayProperties?.name;
        if (n) items[h] = [n, d.displayProperties.icon ?? '', d.itemTypeDisplayName ?? '', d.inventory?.tierType ?? 0,
          d.inventory?.bucketTypeHash ?? 0, d.itemType ?? 0, d.classType ?? 3];
      }
      for (const h of Object.keys(rolls)) if (!items[h]) delete rolls[h];
      // Welche Plug-Typen sind "Perks"? Alle Typen, unter denen Wishlist-Perks (inkl. gleichnamiger verbesserter Varianten) vorkommen.
      const perkNames = new Set();
      for (const list of [rolls, trash]) for (const rs of Object.values(list)) for (const [csv] of rs)
        for (const p of csv.split(',')) if (items[p]) perkNames.add(items[p][I.name]);
      // ponytail: Typ zählt erst ab 3 verschiedenen Perknamen – filtert Ornamente/Gesten, die zufällig wie ein Perk heißen
      const typeNames = new Map();
      for (const x of Object.values(items)) if (x[I.itemType] === 19 && x[I.type] && perkNames.has(x[I.name]))
        typeNames.set(x[I.type], (typeNames.get(x[I.type]) ?? new Set()).add(x[I.name]));
      const perkTypes = [...typeNames].filter(([, s]) => s.size >= 3).map(([t]) => t);
      const named = async (key, f) => Object.fromEntries(Object.entries(await get(BUNGIE + p[key])).map(([h, d]) => [h, f(d)]));
      const buckets = await get(BUNGIE + p.DestinyInventoryBucketDefinition);
      const d = {
        updated: new Date().toISOString(), version: manifest.version, lang, items, perkTypes, rolls, trash, labels, stacks,
        limits: { vault: buckets[138197802]?.itemCount, postmaster: buckets[215593132]?.itemCount }, // Plätze laut aktuellem Manifest
        loadoutNames: await named('DestinyLoadoutNameDefinition', (d) => d.name),
        loadoutIcons: await named('DestinyLoadoutIconDefinition', (d) => d.iconImagePath),
        loadoutColors: await named('DestinyLoadoutColorDefinition', (d) => d.colorImagePath),
      };
      await cache.save(d);
      loaded(d);
    } catch (e) {
      Object.assign(status, { state: data ? 'bereit' : 'leer', error: e.message });
    }
  }

  // Automatisch neu laden: neues Bungie-Manifest (Patch/Saison), Wishlist älter als 24 h, andere Sprache oder alter Cache
  async function check(urls, lang, apiKey) {
    try {
      const fresh = data?.limits && data.lang === lang && Date.now() - Date.parse(data.updated) < 24 * 3600_000;
      if (fresh && (await get(`${BUNGIE}/Platform/Destiny2/Manifest/`, 'json', { 'x-api-key': apiKey })).Response.version === data.version) return false;
      await update(urls, lang, apiKey);
      return status.state === 'bereit' && !status.error;
    } catch { return false; }
  }

  const item = (h) => data?.items[h];
  const perk = (p) => ({ hash: p, name: data.items[p]?.[I.name] ?? p, icon: data.items[p]?.[I.icon] });

  function search(q) {
    if (!data || !q.trim()) return [];
    q = q.toLowerCase();
    const byName = new Map();
    for (const h of Object.keys(data.rolls)) {
      const [name, icon, type, tier] = data.items[h];
      if (!name.toLowerCase().includes(q)) continue;
      const e = byName.get(name) ?? { name, icon, type, tier, rolls: 0 };
      e.rolls += data.rolls[h].length;
      byName.set(name, e);
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60);
  }

  function weapon(name) {
    if (!data) return null;
    const hashes = Object.keys(data.rolls).filter((h) => data.items[h][I.name] === name);
    if (!hashes.length) return null;
    const [, icon, type, tier] = data.items[hashes[0]];
    const counts = new Map(), blocks = new Map();
    let total = 0;
    for (const h of hashes) for (const [csv, li] of data.rolls[h]) {
      total++;
      const ps = csv.split(',').filter(Boolean);
      for (const p of ps) counts.set(p, (counts.get(p) ?? 0) + 1);
      const b = blocks.get(li) ?? { perks: new Set(), combos: 0 };
      b.combos++; ps.forEach((p) => b.perks.add(p));
      blocks.set(li, b);
    }
    return {
      name, icon, type, tier, hashes, total,
      perks: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([p, n]) => ({ ...perk(p), count: n })),
      rolls: [...blocks].map(([li, b]) => {
        const [title, cols, note] = data.labels[li].split('\x1f');
        return { title, cols, note, combos: b.combos, perks: [...b.perks].map(perk) };
      }),
    };
  }

  // Godroll-Abgleich wie DIM: ein Wishlist-Eintrag passt, wenn alle seine Perks am Item verfügbar sind.
  // Vergleich über Perknamen, damit verbesserte Perks (andere Hashes, gleicher Name) mitzählen.
  function match(hash, perkNames) {
    if (!data) return { god: [], trash: false, pve: false, pvp: false };
    const ok = ([csv]) => csv.split(',').filter(Boolean).every((p) => perkNames.has(data.items[p]?.[I.name]));
    const god = new Set();
    let kinds = '';
    for (const r of data.rolls[hash] ?? []) if (ok(r)) {
      const [title, , note = ''] = data.labels[r[1]].split('\x1f');
      god.add(title || 'Wishlist');
      kinds += (title + ' ' + (note.match(/tags:\S+/)?.[0] ?? '')).toLowerCase(); // PvE/PvP steht im Titel oder als tags:
    }
    return { god: [...god], trash: (data.trash[hash] ?? []).some(ok), pve: kinds.includes('pve'), pvp: kinds.includes('pvp') };
  }

  // Godroll-Analyse je Waffe: pro Empfehlung (Wishlist-Block) die beste Kombination – was passt, was fehlt.
  // Gezeigt werden passende und knapp verfehlte (max. 2 Perks fehlen, mind. 1 passt); Perkvergleich über Namen wie bei match()
  function explain(hash, perkNames) {
    if (!data) return [];
    const best = new Map();
    for (const [csv, li] of data.rolls[hash] ?? []) {
      const ps = [...new Set(csv.split(',').filter(Boolean).map((p) => data.items[p]?.[I.name]).filter(Boolean))];
      const have = ps.filter((n) => perkNames.has(n)), missing = ps.filter((n) => !perkNames.has(n));
      const b = best.get(li);
      if (!b || missing.length < b.missing.length || (missing.length === b.missing.length && have.length > b.have.length)) best.set(li, { li, have, missing });
    }
    return [...best.values()].filter((r) => r.missing.length <= 2 && r.have.length > 0).sort((a, b) => a.missing.length - b.missing.length || b.have.length - a.have.length)
      .map(({ li, have, missing }) => { const [title, cols, note] = data.labels[li].split('\x1f'); return { title, cols, note, have, missing }; });
  }

  return { ready, status, update, check, search, weapon, match, explain, item, get raw() { return data; } };
}
