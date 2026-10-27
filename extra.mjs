// Zusatzfunktionen – in Desktop- und Web-App identisch (dim-app/extra.mjs = dim-web/extra.mjs):
// Tags & Notizen, Aufräumen, Rüstungs-Optimierer, Loadout-Werte, Farmen, Godroll-Hinweise, Wochenübersicht, Fortschritt
import { I } from './data.mjs';
import { filterItems, SLOT, VAULT } from './inventory.mjs';

const ARMOR = [SLOT.helm, SLOT.arme, SLOT.brust, SLOT.beine, SLOT.klasse];
const FARM_BUCKETS = [SLOT.kinetik, SLOT.energie, SLOT.power, ...ARMOR, SLOT.ghost];
const XUR = 2190858386; // Xûr-Händler
export const TAGS = ['favorit', 'behalten', 'zerlegen', 'pve', 'pvp', 'raid'];

const val = (i, h) => i.stats?.find((s) => s.hash === h)?.value ?? 0;

// Rüstungs-Optimierer: je Slot ein Teil der Klasse, höchstens ein Exotic (oder genau das gewünschte).
// Bewertet wird zuerst, wie viel zu den Mindestwerten fehlt, dann die Summe aller Werte.
export function optimize(items, classType, targets = {}, exotic = 0, keep = 5) {
  const want = Object.entries(targets).map(([h, v]) => [+h, +v]).filter(([, v]) => v > 0);
  const score = (i) => (want.length ? want.reduce((a, [h]) => a + val(i, h), 0) : i.stats.reduce((a, s) => a + s.value, 0));
  // ponytail: je Slot nur die 10 besten Legendären + 3 besten Exotics (13^5 Kombinationen); Pareto-Filter, falls das zu grob wird
  const slots = ARMOR.map((b) => {
    const l = items.filter((i) => i.itemType === 2 && i.bucket === b && i.cls === classType && i.stats?.length && !i.postmaster)
      .sort((a, c) => score(c) - score(a));
    return [...l.filter((i) => i.tier !== 6).slice(0, 10), ...l.filter((i) => i.tier === 6 && (!exotic || i.hash === +exotic)).slice(0, 3)];
  }).filter((l) => l.length);
  const hashes = [...new Set(slots.flat().flatMap((i) => i.stats.map((s) => s.hash)))];
  const best = [], pick = [];
  (function walk(n, exo) {
    if (n === slots.length) {
      if (exotic && !exo) return;
      const tot = Object.fromEntries(hashes.map((h) => [h, 0]));
      for (const i of pick) for (const s of i.stats) tot[s.hash] += s.value;
      const miss = want.reduce((a, [h, v]) => a + Math.max(0, v - (tot[h] ?? 0)), 0);
      const sum = hashes.reduce((a, h) => a + tot[h], 0);
      const last = best.at(-1);
      if (best.length < keep || miss < last.miss || (miss === last.miss && sum > last.sum)) {
        best.push({ miss, sum, tot, items: [...pick] });
        best.sort((a, b) => a.miss - b.miss || b.sum - a.sum);
        best.length = Math.min(best.length, keep);
      }
      return;
    }
    for (const i of slots[n]) {
      if (i.tier === 6 && exo) continue;
      pick.push(i); walk(n + 1, exo || i.tier === 6); pick.pop();
    }
  })(0, false);
  return best;
}

export function createExtra({ db, live, data, bungie, move, save, addLoadout, current }) {
  db.tags ??= {}; // itemId -> {tag, note}
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

  // Routen: Rückgabe undefined = nicht zuständig
  async function route(method, path, q, b = {}) {
    if (method === 'GET') {
      if (path === '/api/extra/state') return { alerts: live.alerts, farm: live.farm, farmLog: live.farmLog, cleanup: cleanup(), tags: TAGS };
      if (path === '/api/weekly') return weekly();
      if (path === '/api/progress') return progress(q.get('charId') || undefined);
      if (path === '/api/optimize') {
        const t = JSON.parse(q.get('targets') || '{}');
        return optimize(live.inv?.items ?? [], +q.get('classType'), t, +q.get('exotic') || 0)
          .map((r) => ({ miss: r.miss, items: r.items.map(short), stats: statList(r.tot) }));
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
    if (path === '/api/farm') { live.farm = b.charId || null; live.farmLog = ''; if (live.farm && live.inv) await farm(); return {}; }
    if (path === '/api/optimize/save') {
      const ids = new Set(b.ids ?? []);
      const items = (live.inv?.items ?? []).filter((i) => ids.has(i.id));
      return addLoadout({ name: b.name || 'Optimierer', classType: +b.classType, equipped: items.map((i) => ({ id: i.id, hash: i.hash })) });
    }
    return undefined;
  }

  return { afterSync, loadoutStats, route };
}
