// Zusatzfunktionen – in Desktop- und Web-App identisch (dim-app/extra.mjs = dim-web/extra.mjs):
// Tags & Notizen, Aufräumen, Rüstungs-Optimierer, Loadout-Werte, Farmen, Godroll-Hinweise, Wochenübersicht, Fortschritt, PvP-Statistiken
import { I } from './data.mjs';
import { CLASSES, filterItems, SLOT, VAULT } from './inventory.mjs';

const ARMOR = [SLOT.helm, SLOT.arme, SLOT.brust, SLOT.beine, SLOT.klasse];
const FARM_BUCKETS = [SLOT.kinetik, SLOT.energie, SLOT.power, ...ARMOR, SLOT.ghost];
const XUR = 2190858386; // Xûr-Händler
export const TAGS = ['favorit', 'behalten', 'zerlegen', 'pve', 'pvp', 'raid'];
// PvP-Modi der Bungie-Statistik (Schlüssel kleingeschrieben) in Anzeige-Reihenfolge
const PVP_MODES = { allpvp: 'Alle PvP', pvpquickplay: 'Schnelles Spiel', pvpcompetitive: 'Kompetitiv', trialsofosiris: 'Trials of Osiris', ironbanner: 'Eisenbanner' };
const PVP_STATS = ['activitiesEntered', 'activitiesWon', 'kills', 'deaths', 'assists', 'killsDeathsRatio', 'killsDeathsAssists', 'efficiency',
  'precisionKills', 'longestKillSpree', 'bestSingleGameKills', 'secondsPlayed'];
const CLASS_HASH = { 3655393761: 'Titan', 671679327: 'Jäger', 2271682572: 'Warlock' };
const bv = (o, k) => o?.[k]?.basic?.value ?? 0;
const bName = (u) => u?.bungieGlobalDisplayName ? `${u.bungieGlobalDisplayName}#${String(u.bungieGlobalDisplayNameCode ?? '').padStart(4, '0')}` : u?.displayName ?? '?';

const val = (i, h) => i.stats?.find((s) => s.hash === h)?.value ?? 0;
// Stat-Mods für den allgemeinen Sockel: Wert -> [Mod +10 (3 Energie), kleiner Mod +5 (1 Energie)]
export const STAT_MODS = { 2996146975: [4183296050, 1703647492], 392767087: [1180408010, 2532323436], 1943323491: [4204488676, 1237786518],
  1735777505: [1435557120, 4021790309], 144602215: [2724608735, 350061697], 4244567218: [4287799666, 2639422088] };

// Ein Stat-Mod je Rüstungsteil: zuerst Lücken zu den Mindestwerten füllen (größte Lücke zuerst),
// dann die Werte nach Priorität bis zum Höchstwert; +5, wenn +10 über den Höchstwert ginge.
function addMods(tot, st, on, n) {
  const mods = [];
  for (let k = 0; k < n; k++) {
    const gap = st.filter((x) => tot[x.hash] < x.min).sort((a, b) => (b.min - tot[b.hash]) - (a.min - tot[a.hash]))[0];
    const x = gap ?? on.find((y) => tot[y.hash] + 10 <= y.max) ?? on.find((y) => tot[y.hash] + 5 <= y.max);
    if (!x) break;
    const v = tot[x.hash] + 10 <= x.max ? 10 : 5;
    tot[x.hash] += v; mods.push({ hash: x.hash, value: v });
  }
  return mods;
}

// Rüstungs-Optimierer wie in DIM: je Slot ein Teil der Klasse, höchstens ein Exotic.
// o.stats: [{hash, on, min, max}] in Prioritätsreihenfolge; o.exotic: 0 = beliebig, -1 = keins, sonst Item-Hash;
// o.pinned / o.excluded: Item-IDs. Rangfolge: zuerst wie weit außerhalb von min–max, dann Summe der aktiven Werte
// (gedeckelt bei max), dann die Werte in Prioritätsreihenfolge.
export function optimize(items, classType, o = {}, keep = 10) {
  const st = (o.stats ?? []).map((x) => ({ hash: +x.hash, on: x.on !== false, min: +x.min || 0, max: x.max == null || x.max === '' ? Infinity : +x.max }));
  const on = st.filter((x) => x.on);
  const pinned = new Set(o.pinned ?? []), excluded = new Set(o.excluded ?? []), exotic = +o.exotic || 0;
  const score = (i) => (on.length ? on : i.stats).reduce((a, x) => a + val(i, x.hash), 0);
  // ponytail: je Slot nur die 12 besten Legendären + 4 besten Exotics (16^5 ≈ 1 Mio. Kombinationen); Pareto-Filter, falls das zu grob wird
  const slots = ARMOR.map((b) => {
    const l = items.filter((i) => i.itemType === 2 && i.bucket === b && i.cls === classType && i.stats?.length && !i.postmaster && !excluded.has(i.id))
      .sort((a, c) => score(c) - score(a));
    const pin = l.find((i) => pinned.has(i.id));
    if (pin) return [pin];
    return [...l.filter((i) => i.tier !== 6).slice(0, 12), ...(exotic === -1 ? [] : l.filter((i) => i.tier === 6 && (!exotic || i.hash === exotic)).slice(0, 4))];
  }).filter((l) => l.length);
  const hashes = [...new Set([...st.map((x) => x.hash), ...slots.flat().flatMap((i) => i.stats.map((s) => s.hash))])];
  const best = [], pick = [];
  let combos = 0;
  const better = (a, b) => a.miss - b.miss || b.sum - a.sum || on.reduce((r, x) => r || b.tot[x.hash] - a.tot[x.hash], 0);
  (function walk(n, exo) {
    if (n === slots.length) {
      if (exotic > 0 && !exo) return;
      combos++;
      const tot = Object.fromEntries(hashes.map((h) => [h, 0]));
      for (const i of pick) for (const s of i.stats) tot[s.hash] += s.value;
      const mods = o.mods ? addMods(tot, st, on, pick.length) : [];
      const r = { tot, mods, miss: st.reduce((a, x) => a + Math.max(0, x.min - tot[x.hash]) + Math.max(0, tot[x.hash] - x.max), 0),
        sum: on.reduce((a, x) => a + Math.min(tot[x.hash], x.max), 0) };
      if (best.length < keep || better(r, best.at(-1)) < 0) {
        best.push({ ...r, items: [...pick] }); best.sort(better); best.length = Math.min(best.length, keep);
      }
      return;
    }
    for (const i of slots[n]) {
      if (i.tier === 6 && exo) continue;
      pick.push(i); walk(n + 1, exo || i.tier === 6); pick.pop();
    }
  })(0, false);
  best.combos = combos;
  return best;
}

export function createExtra({ db, live, data, bungie, move, save, addLoadout, current }) {
  db.tags ??= {}; // itemId -> {tag, note}
  db.pvp ??= [];  // beobachtete Spieler: {id: membershipId, mt, name}
  live.alerts = [];
  live.farm = null;
  live.farmLog = '';
  let seen = null, week = null, triumphs = null;
  const defs = new Map();
  const statInfo = (h) => data.raw?.stats?.[h] ?? ['?', '', 0];
  const statList = (tot) => Object.entries(tot).map(([h, value]) => { const [name, icon, index] = statInfo(h); return { hash: +h, name, icon, value, index }; })
    .filter((s) => s.name).sort((a, b) => a.index - b.index);
  const short = (i) => ({ id: i.id, name: i.name, icon: i.icon, tier: i.tier, owner: i.owner, power: i.power, stats: i.stats });

  // Nach jedem Laden: Tags an die Items hängen, neue Godrolls melden, im Farmen-Modus Platz schaffen
  async function afterSync() {
    for (const i of live.inv.items) { const t = db.tags[i.id]; i.tag = t?.tag ?? ''; i.note = t?.note ?? ''; }
    const ids = new Set(live.inv.items.map((i) => i.id));
    if (seen) for (const i of live.inv.items) if (!seen.has(i.id) && i.god.length)
      live.alerts.unshift({ id: i.id, name: i.name, icon: i.icon, god: i.god, at: Date.now() });
    live.alerts.length = Math.min(live.alerts.length, 20);
    seen = ids;
    if (live.farm) await farm();
  }

  // Farmen wie in DIM: Postmaster-Ausrüstung und überzählige Items in den Tresor, damit nie etwas verloren geht.
  // Bleibt: angelegt, gesperrt, Godroll, Favorit; von den übrigen gehen die schwächsten, bis 6 von 9 Plätzen frei bleiben.
  async function farm() {
    const cid = live.farm, moved = [];
    const keep = (i) => i.locked || i.god.length || i.tag === 'favorit';
    const todo = live.inv.items.filter((i) => i.owner === cid && i.postmaster && (i.itemType === 2 || i.itemType === 3));
    for (const b of FARM_BUCKETS) {
      const l = live.inv.items.filter((i) => i.owner === cid && !i.equipped && !i.postmaster && i.bucket === b);
      if (l.length >= 8) todo.push(...l.filter((i) => !keep(i)).sort((a, c) => a.power - c.power).slice(0, l.length - 6));
    }
    for (const it of todo) {
      try { await move(it, VAULT); moved.push(it.name); } catch (e) { live.farmLog = `${it.name}: ${e.message}`; break; }
    }
    if (moved.length) live.farmLog = `${new Date().toLocaleTimeString('de-DE')}: ${moved.length} in den Tresor (${moved.slice(0, 3).join(', ')}${moved.length > 3 ? ' …' : ''})`;
  }

  // Werte eines eigenen Loadouts (Summe der Rüstung) im Vergleich zur angelegten Rüstung eines passenden Charakters
  function loadoutStats(l) {
    if (!live.inv) return [];
    const armor = (pred) => live.inv.items.filter((i) => i.itemType === 2 && pred(i));
    const lo = l.equipped.map((x) => armor((i) => i.id === x.id)[0] ?? armor((i) => i.hash === x.hash).sort((a, b) => b.power - a.power)[0]).filter(Boolean);
    if (!lo.length) return [];
    const ch = live.inv.chars.find((c) => l.classType === 3 || c.classType === l.classType);
    const sum = (list) => { const t = {}; for (const i of list) for (const s of i.stats ?? []) t[s.hash] = (t[s.hash] ?? 0) + s.value; return t; };
    const now = sum(armor((i) => ch && i.owner === ch.id && i.equipped));
    return statList(sum(lo)).map((s) => ({ ...s, diff: s.value - (now[s.hash] ?? 0) }));
  }

  // Aufräum-Vorschläge, wenn der Tresor voll wird
  const CLEANUP = [['Zum Zerlegen markiert', 'tag:zerlegen'], ['Trash-Rolls', 'is:trash -is:locked'],
    ['Dupes ohne Godroll', 'is:dupe -is:godroll -is:locked -tag:favorit'], ['Blaue Items', 'is:rare -is:locked']];
  const cleanup = () => CLEANUP.map(([label, query]) => ({ label, query, n: live.inv ? filterItems(live.inv.items, query + ' -is:equipped').length : 0 }));

  const defOf = (type, h) => {
    const k = type + h;
    if (!defs.has(k)) defs.set(k, bungie.def(type, h, db.settings.lang).catch(() => null));
    return defs.get(k);
  };
  async function weekly() {
    if (week && Date.now() - week.at < 3600_000) return week.v;
    const ms = Object.values(await bungie.get('/Destiny2/Milestones/'));
    const milestones = (await Promise.all(ms.map(async (m) => {
      const d = await defOf('DestinyMilestoneDefinition', m.milestoneHash);
      if (!d?.displayProperties?.name) return null;
      const acts = await Promise.all((m.activities ?? []).slice(0, 8).map((a) => defOf('DestinyActivityDefinition', a.activityHash)));
      return { name: d.displayProperties.name, desc: d.displayProperties.description, icon: d.displayProperties.icon, end: m.endDate,
        acts: [...new Set(acts.map((a) => a?.displayProperties?.name).filter(Boolean))] };
    }))).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    let xur = null, xurErr = '';
    try { // Xûr ist nur von Freitag bis zum Reset da; sonst meldet Bungie einen Fehler
      const v = await bungie.get(`${bungie.me()}/Character/${current()}/Vendors/${XUR}/?components=400,402`);
      xur = Object.values(v.sales?.data ?? {}).map((s) => data.item(s.itemHash)).filter((d) => d?.[I.icon])
        .map((d) => ({ name: d[I.name], icon: d[I.icon], type: d[I.type], tier: d[I.tier] }));
    } catch (e) { xurErr = e.message; } // ohne Xûr: Fehlermeldung zeigen (oft fehlt der Vendor-Scope der Bungie-App)
    week = { at: Date.now(), v: { milestones, xur, xurErr } };
    return week.v;
  }

  async function progress(cid = current()) {
    const P = live.profile ?? {}, raw = data.raw ?? {};
    const objs = (r) => (P.itemComponents?.objectives?.data?.[r.itemInstanceId] ?? P.characterUninstancedItemComponents?.data?.[cid]?.objectives?.data?.[r.itemHash])?.objectives ?? [];
    const quests = (P.characterInventories?.data?.[cid]?.items ?? []).map((r) => {
      const d = data.item(r.itemHash);
      if (!d || ![12, 26].includes(d[I.itemType])) return null;
      return { name: d[I.name], icon: d[I.icon], type: d[I.type], bounty: d[I.itemType] === 26,
        objectives: objs(r).map((o) => ({ desc: raw.objectives?.[o.objectiveHash] ?? '', progress: o.progress ?? 0, total: o.completionValue ?? 0, done: !!o.complete })) };
    }).filter(Boolean);
    const ranks = Object.values(P.characterProgressions?.data?.[cid]?.progressions ?? {}).map((p) => {
      const r = raw.ranks?.[p.progressionHash];
      return r && { name: r[0], icon: r[1], step: r[2][Math.min(p.stepIndex ?? 0, r[2].length - 1)] ?? '', progress: p.progressToNextLevel ?? 0, next: p.nextLevelAt ?? 0, resets: p.currentResetCount ?? 0 };
    }).filter(Boolean);
    if (!triumphs || Date.now() - triumphs.at > 300_000) {
      const r = (await bungie.get(`${bungie.me()}/?components=900`)).profileRecords?.data ?? {};
      triumphs = { at: Date.now(), active: r.activeScore ?? 0, lifetime: r.lifetimeScore ?? 0, legacy: r.legacyScore ?? 0 };
    }
    return { quests, ranks, triumphs };
  }

  // PvP: Statistiken sind bei Bungie öffentlich, daher auch für andere Spieler (mt/mid leer = eigenes Konto)
  const pvpCache = new Map();
  const actName = async (h) => (await defOf('DestinyActivityDefinition', h))?.displayProperties?.name ?? '';
  async function pvp(mt, mid) {
    if (!mid) [, , mt, , mid] = bungie.me().split('/');
    const key = mt + '/' + mid, c = pvpCache.get(key);
    if (c && Date.now() - c.at < 120_000) return { ...c.v, tracked: db.pvp };
    const base = `/Destiny2/${mt}/Account/${mid}`;
    const [prof, modes] = await Promise.all([bungie.get(`/Destiny2/${mt}/Profile/${mid}/?components=100,200`),
      bungie.get(`${base}/Character/0/Stats/?modes=5,70,69,84,19&groups=1&periodType=2`)]);
    const chars = Object.values(prof.characters?.data ?? {}).sort((a, b) => b.dateLastPlayed.localeCompare(a.dateLastPlayed));
    const acts = (await Promise.all(chars.map((ch) => bungie.get(`${base}/Character/${ch.characterId}/Stats/Activities/?mode=5&count=25`)
      .then((r) => (r.activities ?? []).map((a) => ({ ...a, cls: CLASSES[ch.classType] }))).catch(() => []))))
      .flat().sort((a, b) => b.period.localeCompare(a.period)).slice(0, 25);
    const matches = await Promise.all(acts.map(async (a) => ({ id: a.activityDetails.instanceId, at: a.period, cls: a.cls,
      mode: await actName(a.activityDetails.directorActivityHash), map: await actName(a.activityDetails.referenceId),
      win: bv(a.values, 'standing') === 0, kills: bv(a.values, 'kills'), deaths: bv(a.values, 'deaths'), assists: bv(a.values, 'assists'),
      kd: bv(a.values, 'killsDeathsRatio'), eff: bv(a.values, 'efficiency') })));
    const order = Object.keys(PVP_MODES);
    const v = { name: bName(prof.profile?.data?.userInfo), mt: +mt, mid,
      modes: Object.entries(modes ?? {}).map(([k, m]) => ({ key: k.toLowerCase(), name: PVP_MODES[k.toLowerCase()] ?? k, ...Object.fromEntries(PVP_STATS.map((s) => [s, bv(m.allTime, s)])) }))
        .filter((m) => m.activitiesEntered).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)),
      chars: chars.map((ch) => ({ cls: CLASSES[ch.classType], light: ch.light, emblem: ch.emblemPath })), matches };
    pvpCache.set(key, { at: Date.now(), v });
    return { ...v, tracked: db.pvp };
  }
  // Match-Details (Post Game Carnage Report): beide Teams mit allen Spielern
  async function pgcr(id) {
    const r = await bungie.get(`https://stats.bungie.net/Platform/Destiny2/Stats/PostGameCarnageReport/${id}/`);
    return { at: r.period, mode: await actName(r.activityDetails.directorActivityHash), map: await actName(r.activityDetails.referenceId),
      teams: (r.teams ?? []).map((t) => ({ id: t.teamId, name: t.teamName, score: bv(t, 'score'), win: bv(t, 'standing') === 0 })),
      players: (r.entries ?? []).map((e) => { const u = e.player?.destinyUserInfo ?? {};
        return { name: bName(u), mt: u.membershipType, mid: u.membershipId, cls: CLASS_HASH[e.player?.classHash] ?? e.player?.characterClass ?? '', light: e.player?.lightLevel, emblem: u.iconPath,
          team: bv(e.values, 'team'), kills: bv(e.values, 'kills'), deaths: bv(e.values, 'deaths'), assists: bv(e.values, 'assists'),
          kd: bv(e.values, 'killsDeathsRatio'), eff: bv(e.values, 'efficiency') }; })
        .sort((a, b) => b.kills - a.kills) };
  }
  // Spielersuche über den Bungie-Namen, „Name#1234“ grenzt auf den Code ein
  async function pvpSearch(q) {
    const [name, code = ''] = q.split('#');
    if (!name.trim()) return [];
    const r = await bungie.post('/User/Search/GlobalName/0/', { displayNamePrefix: name.trim() });
    return (r.searchResults ?? []).map((x) => {
      const ms = x.destinyMemberships ?? [], m = ms.find((m) => !m.crossSaveOverride || m.crossSaveOverride === m.membershipType) ?? ms[0];
      return m && { name: bName(x), mt: m.membershipType, mid: m.membershipId };
    }).filter((x) => x && x.name.split('#')[1]?.startsWith(code.trim())).slice(0, 20);
  }

  // Routen: Rückgabe undefined = nicht zuständig
  async function route(method, path, q, b = {}) {
    if (method === 'GET') {
      if (path === '/api/extra/state') return { alerts: live.alerts, farm: live.farm, farmLog: live.farmLog, cleanup: cleanup(), tags: TAGS };
      if (path === '/api/weekly') return weekly();
      if (path === '/api/progress') return progress(q.get('charId') || undefined);
      if (path === '/api/pvp') return pvp(q.get('mt'), q.get('mid')).catch((e) => {
        throw q.get('mid') && /unable to find/i.test(e.message) ? new Error('Für dieses Konto gibt es keine Destiny-2-Daten – wahrscheinlich ein anderer Spieler mit ähnlichem Namen.') : e;
      });
      if (path === '/api/pvp/match') return pgcr(q.get('id'));
      if (path === '/api/pvp/search') return pvpSearch(q.get('q') ?? '');
      if (path === '/api/optimize') {
        const ct = +q.get('classType'), t0 = Date.now();
        const res = optimize(live.inv?.items ?? [], ct, JSON.parse(q.get('opts') || '{}'));
        // Vergleich: angelegte Rüstung des passenden Charakters
        const ch = live.inv?.chars.find((c) => c.classType === ct), cur = {};
        for (const i of live.inv?.items ?? []) if (ch && i.owner === ch.id && i.equipped && i.itemType === 2) for (const s of i.stats ?? []) cur[s.hash] = (cur[s.hash] ?? 0) + s.value;
        return { combos: res.combos, ms: Date.now() - t0, current: cur,
          results: res.map((r) => ({ miss: r.miss, items: r.items.map(short), stats: statList(r.tot),
            mods: r.mods.map((m) => { const plug = STAT_MODS[m.hash]?.[m.value === 10 ? 0 : 1], d = data.item(plug); return { ...m, plug, name: d?.[I.name], icon: d?.[I.icon] }; }) })) };
      }
      if (path === '/api/optimize/exotics') {
        const ct = +q.get('classType'), seenH = new Set();
        return (live.inv?.items ?? []).filter((i) => i.itemType === 2 && i.tier === 6 && i.cls === ct && !seenH.has(i.hash) && seenH.add(i.hash))
          .map((i) => ({ hash: i.hash, name: i.name, icon: i.icon }));
      }
      return undefined;
    }
    if (path === '/api/tag') {
      const it = live.inv?.items.find((i) => i.id === b.id);
      if (b.tag || b.note) db.tags[b.id] = { tag: b.tag ?? '', note: b.note ?? '' }; else delete db.tags[b.id];
      if (it) { it.tag = b.tag ?? ''; it.note = b.note ?? ''; }
      save(); return {};
    }
    if (path === '/api/pvp/track') { // Spieler beobachten/entfernen (wird mitsynchronisiert)
      db.pvp = db.pvp.filter((p) => p.id !== b.mid);
      if (!b.remove) db.pvp.push({ id: b.mid, mt: +b.mt, name: b.name });
      save(); return db.pvp;
    }
    if (path === '/api/farm') { live.farm = b.charId || null; live.farmLog = ''; if (live.farm && live.inv) await farm(); return {}; }
    if (path === '/api/optimize/save') {
      const ids = new Set(b.ids ?? []);
      const items = (live.inv?.items ?? []).filter((i) => ids.has(i.id));
      return addLoadout({ name: b.name || 'Optimierer', classType: +b.classType, equipped: items.map((i) => ({ id: i.id, hash: i.hash })),
        parameters: { mods: (b.mods ?? []).filter(Boolean) } }); // Stat-Mods setzt applyLoadout in die allgemeinen Sockel
    }
    return undefined;
  }

  return { afterSync, loadoutStats, route };
}
