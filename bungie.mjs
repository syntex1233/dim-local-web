// Bungie.net API: OAuth (vertrauliche App), Profil laden, Items verschieben/anlegen/sperren.
// Doku: https://bungie-net.github.io/multi/index.html
import { BUNGIE } from './data.mjs';

const COMPONENTS = [100, 102, 103, 104, 200, 201, 202, 205, 206, 300, 304, 305, 310].join(',');

export function authorizeUrl(clientId, state, lang = 'de') {
  return `${BUNGIE}/${lang}/OAuth/Authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&state=${state}`;
}

// cfg: {apiKey, clientId, clientSecret, tokenUrl?}; auth: {access, accessExp, refresh, refreshExp, membershipType, membershipId}
// tokenUrl: Worker, der das client_secret verwahrt und den Token-Tausch erledigt (dann bleibt clientSecret leer)
export function createBungie(cfg, auth, saveAuth) {
  async function token(body) {
    const r = cfg().tokenUrl
      ? await fetch(cfg().tokenUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch(`${BUNGIE}/Platform/App/OAuth/Token/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: 'Basic ' + btoa(`${cfg().clientId}:${cfg().clientSecret}`),
        'x-api-key': cfg().apiKey,
      },
      body: new URLSearchParams(body),
    });
    const j = await r.json();
    if (!j.access_token) throw new Error(`Login fehlgeschlagen: ${j.error_description ?? j.error ?? r.status}`);
    const now = Date.now();
    Object.assign(auth(), {
      access: j.access_token, accessExp: now + j.expires_in * 1000,
      refresh: j.refresh_token, refreshExp: now + (j.refresh_expires_in ?? 0) * 1000,
    });
    saveAuth();
  }

  async function accessToken() {
    const a = auth();
    if (!a.access) throw new Error('Nicht angemeldet');
    if (Date.now() > a.accessExp - 60_000) {
      if (!a.refresh || Date.now() > a.refreshExp) throw new Error('Anmeldung abgelaufen – bitte neu anmelden');
      await token({ grant_type: 'refresh_token', refresh_token: a.refresh });
    }
    return auth().access;
  }

  async function api(path, body, tries = 3) {
    const r = await fetch(`${BUNGIE}/Platform${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-api-key': cfg().apiKey, authorization: `Bearer ${await accessToken()}`, ...(body && { 'content-type': 'application/json' }) },
      body: body && JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({ Message: `HTTP ${r.status}` }));
    if (j.ErrorCode === 1) return j.Response;
    // Bungie drosselt Item-Aktionen (ThrottleSeconds) – kurz warten und erneut versuchen
    if (j.ThrottleSeconds > 0 && tries > 1) {
      await new Promise((res) => setTimeout(res, j.ThrottleSeconds * 1000));
      return api(path, body, tries - 1);
    }
    throw new Error(j.Message ?? j.ErrorStatus ?? `HTTP ${r.status}`);
  }

  async function login(code) {
    await token({ grant_type: 'authorization_code', code });
    const m = await api('/User/GetMembershipsForCurrentUser/');
    const dm = m.destinyMemberships.find((x) => x.membershipId === m.primaryMembershipId) ?? m.destinyMemberships[0];
    if (!dm) throw new Error('Kein Destiny-2-Konto gefunden');
    Object.assign(auth(), { membershipType: dm.membershipType, membershipId: dm.membershipId, name: dm.bungieGlobalDisplayName || dm.displayName });
    saveAuth();
  }

  const mt = () => auth().membershipType;
  return {
    login,
    definition: (hash, lc = 'en') => api(`/Destiny2/Manifest/DestinyInventoryItemDefinition/${hash}/?lc=${lc}`),
    insertPlug: (item, characterId, socketIndex, plugItemHash) => api('/Destiny2/Actions/Items/InsertSocketPlugFree/',
      { plug: { socketIndex, socketArrayType: 0, plugItemHash }, itemId: item.id, characterId, membershipType: mt() }),
    profile: () => api(`/Destiny2/${mt()}/Profile/${auth().membershipId}/?components=${COMPONENTS}`),
    transfer: (item, characterId, toVault) => api('/Destiny2/Actions/Items/TransferItem/',
      { itemReferenceHash: item.hash, stackSize: item.amount, transferToVault: toVault, itemId: item.id, characterId, membershipType: mt() }),
    pull: (item, characterId) => api('/Destiny2/Actions/Items/PullFromPostmaster/',
      { itemReferenceHash: item.hash, stackSize: item.amount, itemId: item.id, characterId, membershipType: mt() }),
    equip: (item, characterId) => api('/Destiny2/Actions/Items/EquipItem/', { itemId: item.id, characterId, membershipType: mt() }),
    lock: (item, characterId, state) => api('/Destiny2/Actions/Items/SetLockState/', { state, itemId: item.id, characterId, membershipType: mt() }),
    equipLoadout: (characterId, loadoutIndex) => api('/Destiny2/Actions/Loadouts/EquipLoadout/', { loadoutIndex, characterId, membershipType: mt() }),
    // ids: {nameHash, iconHash, colorHash}; Snapshot speichert die aktuell angelegte Ausrüstung in den Platz
    snapshotLoadout: (characterId, loadoutIndex, ids) => api('/Destiny2/Actions/Loadouts/SnapshotLoadout/', { ...ids, loadoutIndex, characterId, membershipType: mt() }),
    updateLoadout: (characterId, loadoutIndex, ids) => api('/Destiny2/Actions/Loadouts/UpdateLoadoutIdentifiers/', { ...ids, loadoutIndex, characterId, membershipType: mt() }),
    clearLoadout: (characterId, loadoutIndex) => api('/Destiny2/Actions/Loadouts/ClearLoadout/', { loadoutIndex, characterId, membershipType: mt() }),
  };
}
