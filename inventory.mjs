// Baut aus der Bungie-Profilantwort ein flaches Inventar (Waffen, Rüstung, Postmaster) mit Perks und Godroll-Abgleich.
import { I } from './data.mjs';

export const VAULT = 'vault';
const POSTMASTER = 215593132, VAULT_BUCKET = 138197802;
export const ARTIFACT_BUCKET = 1506418338;
// Waffen (3), Rüstung (2) sowie Embleme (14), Subklassen (16), Schiffe (21), Sparrows (22), Ghosts (24)
export const GEAR = [2, 3, 14, 16, 21, 22, 24];
// Werte wie im Spiel, ohne Power/Angriff/Verteidigung; Name, Icon und Reihenfolge aus DestinyStatDefinition
const NO_STAT = new Set([1935656794, 1480404414, 3897883278]);
const statList = (data, entries) => entries.filter(([h]) => !NO_STAT.has(+h) && data.raw?.stats?.[h]?.[0])
  .map(([h, value]) => { const [name, icon, index] = data.raw.stats[h]; return { hash: +h, name, icon, value, index }; }).sort((a, b) => a.index - b.index);
export const CLASSES = ['Titan', 'Jäger', 'Warlock'];

export function buildInventory(profile, data) {
  const C = profile.itemComponents ?? {};
  const instances = C.instances?.data ?? {}, sockets = C.sockets?.data ?? {}, reusable = C.reusablePlugs?.data ?? {};
  const perkTypes = new Set(data.raw?.perkTypes ?? []);
  const items = [];

  function add(raw, owner, equipped) {
    const def = data.item(raw.itemHash);
    if (!def) return;
    const inPost = raw.bucketHash === POSTMASTER;
    const itemType = def[I.itemType];
    if (!inPost && !GEAR.includes(itemType)) return;
    const id = raw.itemInstanceId;
    const it = {
      id, hash: raw.itemHash, owner, equipped, postmaster: inPost, amount: raw.quantity ?? 1,
      name: def[I.name], icon: def[I.icon], type: def[I.type], tier: def[I.tier], bucket: def[I.bucket], itemType, cls: def[I.cls],
      power: instances[id]?.primaryStat?.value ?? 0,
      locked: !!(raw.state & 1), crafted: !!(raw.state & 8), lockable: !!raw.lockable,
      plugs: sockets[id]?.sockets.map((s) => s.plugHash ?? 0) ?? [], // eingesetzte Plugs je Sockel (Mods, Subklassen-Setup)
      stats: statList(data, Object.values(C.stats?.data?.[id]?.stats ?? {}).map((s) => [s.statHash, s.value])),
      perks: [], god: [], trash: false, pve: false, pvp: false,
    };
    if (itemType === 3 && sockets[id]) {
      const names = new Set();
      sockets[id].sockets.forEach((s, idx) => {
        const opts = (reusable[id]?.plugs?.[idx] ?? []).map((p) => p.plugItemHash);
        if (s.plugHash && !opts.includes(s.plugHash)) opts.unshift(s.plugHash);
        const col = opts.map((h) => data.item(h)).filter(Boolean);
        if (!col.some((d) => perkTypes.has(d[I.type]))) return;
        it.perks.push(opts.filter((h) => data.item(h)).map((h) => {
          const d = data.item(h); names.add(d[I.name]);
          return { hash: h, name: d[I.name], icon: d[I.icon], active: h === s.plugHash };
        }));
      });
      Object.assign(it, data.match(String(raw.itemHash), names));
    }
    // Subklasse: eingesetzte Super, Fähigkeiten, Aspekte, Fragmente mit Namen (Typname gruppiert sie in der Anzeige)
    const named = () => it.plugs.filter((h) => data.item(h)).map((h) => { const d = data.item(h); return { hash: h, name: d[I.name], icon: d[I.icon], type: d[I.type] }; });
    if (itemType === 16) it.setup = named();
    // Rüstung: eingesetzte Mods, dann Ornament und Shader; leere Sockel und Plugs ohne Typ (Statistik-Platzhalter) weg
    if (itemType === 2) {
      const look = (p) => /Shader|Ornament/.test(p.type);
      const ps = named().filter((p) => p.type && !/^(leer|empty)/i.test(p.name));
      it.mods = [...ps.filter((p) => !look(p)), ...ps.filter(look)];
    }
    items.push(it);
  }

  const charIds = profile.profile?.data?.characterIds ?? [];
  for (const cid of charIds) {
    for (const raw of profile.characterEquipment?.data?.[cid]?.items ?? []) add(raw, cid, true);
    for (const raw of profile.characterInventories?.data?.[cid]?.items ?? []) add(raw, cid, false);
  }
  const vaultRaw = (profile.profileInventory?.data?.items ?? []).filter((r) => r.bucketHash === VAULT_BUCKET);
  for (const raw of vaultRaw) add(raw, VAULT, false);

  const byName = new Map();
  for (const it of items) if (it.id && !it.postmaster) byName.set(it.name, (byName.get(it.name) ?? 0) + 1);
  for (const it of items) it.dupe = (byName.get(it.name) ?? 0) > 1;

  // Saison-Artefakt: Power-Bonus/Punkte gelten fürs Konto, die Perk-Auswahl je Charakter
  const art = profile.profileProgression?.data?.seasonalArtifact;
  const artifact = (cid) => {
    const a = profile.characterProgressions?.data?.[cid]?.seasonalArtifact ?? {};
    // Seit Edge of Fate stecken die gewählten Perks als Sockel im angelegten Artefakt-Item (pointsUsed/isActive bleiben 0)
    const eqArt = (profile.characterEquipment?.data?.[cid]?.items ?? []).find((r) => r.bucketHash === ARTIFACT_BUCKET);
    if (!eqArt && !a.tiers) return null;
    const plugged = (eqArt && sockets[eqArt.itemInstanceId]?.sockets) ?? [];
    const on = new Set(plugged.map((s) => s.plugHash));
    const d = (eqArt && data.item(eqArt.itemHash)) ?? data.item(a.artifactHash);
    return {
      slots: plugged.map((s) => data.item(s.plugHash)).filter(Boolean)
        .map((pd) => ({ name: pd[I.name], icon: pd[I.icon], empty: !pd[I.type] })), // leerer Platz hat keinen Typnamen
      name: d?.[I.name] ?? 'Artefakt', icon: d?.[I.icon], power: art?.powerBonus ?? 0, used: a.pointsUsed ?? 0,
      points: art?.pointsAcquired ?? art?.pointProgression?.level ?? 0,
      tiers: (a.tiers ?? []).map((t) => ({ unlocked: !!t.isUnlocked, perks: (t.items ?? []).filter((p) => p.isVisible !== false).map((p) => {
        const pd = data.item(p.itemHash);
        return { name: pd?.[I.name] ?? '?', icon: pd?.[I.icon], active: !!p.isActive || on.has(p.itemHash) };
      }) })),
    };
  };
  const chars = charIds.map((id) => {
    const c = profile.characters.data[id];
    return {
      artifact: artifact(id), stats: statList(data, Object.entries(c.stats ?? {})),
      id, cls: CLASSES[c.classType] ?? '?', classType: c.classType, light: c.light, emblem: c.emblemPath, bg: c.emblemBackgroundPath, last: c.dateLastPlayed,
      postmaster: (profile.characterInventories?.data?.[id]?.items ?? []).filter((r) => r.bucketHash === POSTMASTER).length,
    };
  }).sort((a, b) => b.last.localeCompare(a.last)); // zuletzt gespielter Charakter zuerst

  const cur = profile.profileCurrencies?.data?.items ?? [];
  // Alle Währungen, die Bungie fürs Konto liefert, mit Name und Obergrenze aus dem Manifest
  const currencies = cur.filter((x) => data.item(x.itemHash)).map((x) => ({
    hash: x.itemHash, name: data.item(x.itemHash)[I.name], icon: data.item(x.itemHash)[I.icon], amount: x.quantity, max: data.raw?.stacks?.[x.itemHash] ?? null,
  }));

  const raw = data.raw ?? {};
  const byId = new Map(items.map((i) => [i.id, i]));
  const loadouts = Object.fromEntries(charIds.map((cid) => [cid,
    (profile.characterLoadouts?.data?.[cid]?.loadouts ?? []).map((l, index) => ({
      index, name: raw.loadoutNames?.[l.nameHash] ?? `Loadout ${index + 1}`,
      icon: raw.loadoutIcons?.[l.iconHash], color: raw.loadoutColors?.[l.colorHash],
      empty: l.items.every((x) => x.itemInstanceId === '0'),
      nameHash: l.nameHash, iconHash: l.iconHash, colorHash: l.colorHash,
      items: l.items.map((x) => byId.get(x.itemInstanceId)).filter(Boolean).map((i) => ({ id: i.id, name: i.name, icon: i.icon, tier: i.tier, type: i.type })),
    }))]));

  const limits = { vault: 0, postmaster: 21, ...data.raw?.limits }; // ponytail: 21 nur bis die Spieldaten neu geladen sind
  return { chars, items, currencies, limits, vaultCount: vaultRaw.length, loadouts };
}

// Mini-Suchsprache: Wörter UND-verknüpft, "-" negiert.
//   is:weapon|armor|godroll|pve|pvp|trash|locked|exotic|legendary|dupe|vault|equipped|postmaster|crafted
//   perk:<text>  class:titan|jäger|warlock  slot:kinetik|energie|power|helm|arme|brust|beine|klasse|subklasse|ghost|…
//   type:<Typ, Leerzeichen als _>  sonst Name/Typ enthält Text
export const SLOT = {
  kinetik: 1498876634, energie: 2465295065, power: 953998645, helm: 3448274439, arme: 3551918588, brust: 14239492,
  beine: 20886954, klasse: 1585787867, subklasse: 3284755031, ghost: 4023194814, sparrow: 2025709351, schiff: 284967655, emblem: 4274335291,
};
const IS = {
  weapon: (i) => i.itemType === 3, armor: (i) => i.itemType === 2, godroll: (i) => i.god.length > 0, pve: (i) => i.pve, pvp: (i) => i.pvp, trash: (i) => i.trash,
  locked: (i) => i.locked, exotic: (i) => i.tier === 6, legendary: (i) => i.tier === 5, rare: (i) => i.tier === 4, dupe: (i) => i.dupe,
  vault: (i) => i.owner === VAULT, equipped: (i) => i.equipped, postmaster: (i) => i.postmaster, crafted: (i) => i.crafted,
};

export function filterItems(items, query) {
  const tests = query.toLowerCase().split(/\s+/).filter(Boolean).map((tok) => {
    const neg = tok.startsWith('-'), t = neg ? tok.slice(1) : tok;
    let f;
    if (t.startsWith('is:')) f = IS[t.slice(3)] ?? (() => false);
    else if (t.startsWith('perk:')) f = (i) => i.perks.flat().some((p) => p.name.toLowerCase().includes(t.slice(5)));
    else if (t.startsWith('class:')) f = (i) => (CLASSES[i.cls] ?? '').toLowerCase().startsWith(t.slice(6));
    else if (t.startsWith('owner:')) f = (i) => i.owner === t.slice(6);
    else if (t.startsWith('slot:')) f = (i) => i.bucket === SLOT[t.slice(5)];
    else if (t.startsWith('type:')) f = (i) => i.type.toLowerCase() === t.slice(5).replace(/_/g, ' ');
    else f = (i) => i.name.toLowerCase().includes(t) || i.type.toLowerCase().includes(t);
    return neg ? (i) => !f(i) : f;
  });
  return items.filter((i) => tests.every((f) => f(i)));
}
