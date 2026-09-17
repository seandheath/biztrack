/** Old formats belong here. Application services read/write only data version 2. */
import { apiFetch, AuthError, getEmail, getSessionVersion } from './auth.js';
import { findFile, listFiles, listFolders, downloadJson, uploadJson, updateJson, copyForUpgrade } from './drive.js';
import { DATA_VERSION, CONFIG_FILE, PROFILE_FILE, QUEUE_KEY, CACHE_KEY, MILEAGE_HEADERS, requireCurrentData, spreadsheetName } from './data-model.js';
import { storageKey } from './version.js';
import { DEFAULT_CATEGORIES } from './constants.js';
import type { BusinessConfig, ProfileBusiness, ProfileData, MileageFavorite } from './types.js';
import type { QueuedWrite } from './services/offline-queue.js';
import type { TransactionRow } from './services/sheets.js';

const OLD_QUEUE = 'biztrack_offline_queue';
const LOCAL_JOURNAL = 'biztrack_upgrade_1_2';
const JOURNAL_FILE = 'upgrade-v1-v2.json';
const OLD_HEADERS = ['Date', 'From', 'To', 'Purpose/Description', 'Miles', 'Saved By', 'ID', 'Driver'];
const EXPENSE_HEADERS = ['Date', 'Vendor/Payee', 'Description', 'Amount', 'Category', 'Payment Method', 'Receipt', 'Notes', 'Submitted By', 'ID'];
type LegacyTrip = { from?: string; to?: string; purpose?: string };
type LegacyFavorite = LegacyTrip & { name: string; miles: number; driver: string; roundTrip?: boolean };
type LegacyProfile = { dataVersion?: number; businesses: ProfileBusiness[]; mileage_favorites?: Record<string, LegacyFavorite[]>; default_drivers?: Record<string, string> };
type Year = { year: number; folderId: string; sourceId: string };
type UpgradeBusiness = ProfileBusiness & { config: Partial<BusinessConfig>; configId: string; years: Year[]; upgraded: boolean };
export type UpgradePlan = { rootId: string; profileId: string | null; profile: LegacyProfile | ProfileData; legacyProfile: boolean; businesses: UpgradeBusiness[]; localQueue: boolean };
type Journal = { dataVersion: number; sheets: Record<string, { id: string; fingerprint: string; verified: boolean }> };
type Snapshot = { sheets: { properties: { sheetId: number; title: string; gridProperties?: { columnCount: number } }; values: (string | number | boolean)[][] }[] };

export function legacyDescription(row: LegacyTrip): string {
  const route = [row.from, row.to].map(value => String(value ?? '').trim()).filter(Boolean).join(' → ');
  return [route, String(row.purpose ?? '').trim()].filter(Boolean).join(' — ');
}

export function upgradeFavorite(favorite: LegacyFavorite): MileageFavorite {
  if (!favorite || typeof favorite.name !== 'string' || typeof favorite.miles !== 'number' || !Number.isFinite(favorite.miles)
    || (favorite.driver !== undefined && typeof favorite.driver !== 'string')
    || [favorite.from, favorite.to, favorite.purpose].some(value => value !== undefined && typeof value !== 'string')
    || (favorite.roundTrip !== undefined && typeof favorite.roundTrip !== 'boolean')) {
    throw new Error('A saved favorite has invalid data. The original profile is unchanged.');
  }
  return { name: favorite.name, description: legacyDescription(favorite),
    miles: Number(favorite.miles) * (favorite.roundTrip ? 2 : 1), driver: favorite.driver ?? '' };
}

function readLegacyQueue(): string | null {
  const raw = localStorage.getItem(storageKey(OLD_QUEUE));
  if (!raw) return null;
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error('Cannot read pending changes. Keep this device’s data and contact support.');
  return rows.length ? raw : null;
}

export function hasLegacyQueue(): boolean { return readLegacyQueue() !== null; }
export function hasUnfinishedUpgrade(): boolean {
  const raw = localStorage.getItem(storageKey(LOCAL_JOURNAL));
  return !!raw && !JSON.parse(raw).complete;
}

async function json(url: string, body?: unknown): Promise<any> {
  const response = await apiFetch(url, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Upgrade request failed (${response.status}). Originals and pending changes are preserved.`);
  return response.json();
}

async function putJson(name: string, data: unknown, folder: string): Promise<void> {
  const id = await findFile(name, folder);
  if (id) await updateJson(id, data);
  else await uploadJson(name, data, folder);
}

/** Read-only discovery; no backfill, year creation, cache loading, or queue replay. */
export async function inspectUpgrade(rootId: string, extra?: ProfileBusiness): Promise<UpgradePlan | null> {
  const currentId = await findFile(PROFILE_FILE, rootId);
  const profileId = currentId ?? await findFile('profile.json', rootId);
  const profile = profileId ? await downloadJson<LegacyProfile | ProfileData>(profileId) : { businesses: [], mileage_favorites: {} };
  if (currentId) requireCurrentData(profile);
  else if (profile.dataVersion !== undefined && profile.dataVersion !== 1) throw new Error('Unsupported data version. Use a newer app.');
  if (!Array.isArray(profile.businesses) || profile.businesses.some(b => !b || typeof b.folderId !== 'string' || !b.folderId || typeof b.name !== 'string' || !b.name)) throw new Error('Invalid business profile. Originals are unchanged.');
  if (currentId && !extra && !hasLegacyQueue() && !hasUnfinishedUpgrade()) return null;
  const references = [...profile.businesses];
  if (extra && !references.some(b => b.folderId === extra.folderId)) references.push(extra);
  const businesses: UpgradeBusiness[] = [];
  for (const ref of references) {
    const currentConfig = await findFile(CONFIG_FILE, ref.folderId);
    const id = currentConfig ?? await findFile('config.json', ref.folderId);
    if (!id) throw new Error(`Cannot find the configuration for ${ref.name}. Check Drive access.`);
    const cfg = await downloadJson<Partial<BusinessConfig>>(id);
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error(`Invalid configuration for ${ref.name}.`);
    if (currentConfig) requireCurrentData(cfg);
    else if (cfg.dataVersion !== undefined && cfg.dataVersion !== 1) throw new Error(`Unsupported data version for ${ref.name}.`);
    if ((cfg.name != null && typeof cfg.name !== 'string')
      || (cfg.categories != null && (!Array.isArray(cfg.categories) || cfg.categories.some(category => typeof category !== 'string')))
      || (currentConfig && (typeof cfg.name !== 'string' || !cfg.name || !Array.isArray(cfg.categories)))) {
      throw new Error(`Invalid configuration for ${ref.name}.`);
    }
    // Legacy defaults were sometimes only applied in memory. Keep cfg raw for the change check.
    const name = cfg.name || ref.name;
    const years: Year[] = [];
    for (const folder of await listFolders(ref.folderId)) {
      if (!/^\d{4}$/.test(folder.name)) continue;
      const sheetName = `${folder.name}_${name.replace(/[/\\:*?"<>|]/g, '')}_expenses`;
      const sourceId = await findFile(sheetName, folder.id);
      if (sourceId) years.push({ year: Number(folder.name), folderId: folder.id, sourceId });
    }
    businesses.push({ ...ref, name, config: cfg, configId: id, years: years.sort((a, b) => a.year - b.year), upgraded: !!currentConfig });
  }
  const localQueue = hasLegacyQueue();
  if ((!profileId || currentId) && businesses.every(b => b.upgraded) && !localQueue && !hasUnfinishedUpgrade()) return null;
  return { rootId, profileId, profile, legacyProfile: !currentId, businesses, localQueue };
}

async function snapshot(id: string): Promise<Snapshot> {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}`;
  const meta = await json(`${base}?fields=sheets.properties`);
  const params = new URLSearchParams({ valueRenderOption: 'FORMULA' });
  for (const sheet of meta.sheets) params.append('ranges', `'${sheet.properties.title.replace(/'/g, "''")}'`);
  const data = await json(`${base}/values:batchGet?${params}`);
  return { sheets: meta.sheets.map((sheet: any, i: number) => ({ properties: sheet.properties, values: data.valueRanges[i].values ?? [] })) };
}

function contents(s: Snapshot) { return s.sheets.map(sheet => ({ title: sheet.properties.title, values: sheet.values })); }
async function fingerprint(s: Snapshot): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(contents(s))));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
function mileage(s: Snapshot) {
  const tab = s.sheets.find(sheet => sheet.properties.title === 'Mileage');
  if (!tab) throw new Error('Mileage tab is missing. Originals are unchanged.');
  return tab;
}
function validateSource(s: Snapshot): void {
  for (const [title, header, idColumn] of [['Expenses', EXPENSE_HEADERS, 9], ['Mileage', OLD_HEADERS, 6]] as const) {
    const tab = s.sheets.find(sheet => sheet.properties.title === title);
    if (!tab || JSON.stringify(tab.values[0]) !== JSON.stringify(header)) throw new Error(`Unrecognized ${title} columns. Originals are unchanged.`);
    const ids = new Set();
    for (const row of tab.values.slice(1)) {
      if (row.every(cell => cell === '')) continue;
      if (row.length > header.length || typeof row[idColumn] !== 'string' || !row[idColumn] || ids.has(row[idColumn])) throw new Error(`Invalid or duplicate record in ${title}. Originals are unchanged.`);
      if (title === 'Mileage' && (row.some(cell => typeof cell === 'string' && cell.startsWith('='))
        || row[4] === '' || row[4] === undefined || !Number.isFinite(Number(row[4])))) {
        throw new Error('A mileage record contains a formula or invalid distance. Review the original spreadsheet before upgrading.');
      }
      ids.add(row[idColumn]);
    }
  }
}
function converted(s: Snapshot): Snapshot {
  const result = structuredClone(s);
  mileage(result).values = [MILEAGE_HEADERS, ...mileage(s).values.slice(1).map(row => {
    if (row.every(cell => cell === '')) return [];
    return [row[0] ?? '', legacyDescription({ from: String(row[1] ?? ''), to: String(row[2] ?? ''), purpose: String(row[3] ?? '') }),
      row[4] ?? '', row[5] ?? '', row[6] ?? '', row[7] ?? ''];
  })];
  return result;
}
// Sheets omits trailing empty cells/rows; compare their values rather than response padding.
function comparable(s: Snapshot): string {
  return JSON.stringify(contents(s).map(tab => {
    const rows = tab.values.map(row => { const r = [...row]; while (r.at(-1) === '') r.pop(); return r; });
    while (rows.length && !rows.at(-1)!.length) rows.pop();
    return { title: tab.title, values: rows };
  }));
}
async function transform(id: string, source: Snapshot): Promise<void> {
  const tab = mileage(source);
  const values = mileage(converted(source)).values;
  const rows = values.map(row => ({ values: row.map(value => ({ userEnteredValue: typeof value === 'number'
    ? { numberValue: value } : typeof value === 'boolean' ? { boolValue: value } : { stringValue: value } })) }));
  // One atomic batch: replace cells and shrink the copied tab. Never mutate the original.
  await json(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}:batchUpdate`, { requests: [
    { updateCells: { range: { sheetId: tab.properties.sheetId, startRowIndex: 0, startColumnIndex: 0 }, rows, fields: 'userEnteredValue' } },
    { updateSheetProperties: { properties: { sheetId: tab.properties.sheetId, gridProperties: { columnCount: 6 } }, fields: 'gridProperties.columnCount' } },
  ] });
}

export function convertQueue(raw: string, ids: Record<string, string>): QueuedWrite[] {
  const entries = JSON.parse(raw);
  if (!Array.isArray(entries)) throw new Error('Invalid pending changes.');
  const mapped = (id: string) => { if (!ids[id]) throw new Error('A pending change references an unavailable spreadsheet. Originals and pending changes are preserved.'); return ids[id]; };
  return entries.map((entry: any) => {
    if (!['Expenses', 'Mileage'].includes(entry.sheetName) || !['create', 'update', 'delete', 'replace'].includes(entry.operation)) throw new Error('Unrecognized pending change.');
    const row = (old: any): TransactionRow => {
      if (!old || !old.id) throw new Error('Invalid pending record.');
      if (entry.sheetName === 'Expenses') return old;
      return { id: old.id, date: old.date, description: legacyDescription(old), miles: old.miles, driver: old.driver, savedBy: old.savedBy };
    };
    return { ...entry, spreadsheetId: mapped(entry.spreadsheetId), ...(entry.operation === 'replace'
      ? { sourceSpreadsheetId: mapped(entry.sourceSpreadsheetId), rows: entry.rows.map(row) }
      : { row: row(entry.row) }) };
  });
}

// ponytail: no cross-device lock; users must stop other writers. Add server coordination if concurrent upgrades become necessary.
/** Explicit upgrade only. Reopening a completed copy must never recopy stale original data. */
export async function runUpgrade(plan: UpgradePlan, progress: (message: string) => void = () => {}): Promise<void> {
  const owner = getEmail(), session = getSessionVersion();
  if (!owner || !navigator.onLine) throw new Error('Connect to the internet to upgrade.');
  const checkSession = () => { if (owner !== getEmail() || session !== getSessionVersion()) throw new AuthError('The account changed. Upgrade paused.'); };
  const rawQueue = readLegacyQueue();
  const previous = localStorage.getItem(storageKey(LOCAL_JOURNAL));
  const local = previous ? JSON.parse(previous) : null;
  if (local && local.owner !== owner) throw new Error('The upgrade belongs to a different Google account.');
  // Durable snapshot before any writes. Retained after completion for recovery.
  localStorage.setItem(storageKey(LOCAL_JOURNAL), JSON.stringify({ owner, rawQueue, complete: false }));
  const ids: Record<string, string> = {};
  for (const biz of plan.businesses) {
    checkSession();
    const configId = await findFile(CONFIG_FILE, biz.folderId);
    if (configId) {
      requireCurrentData(await downloadJson<BusinessConfig>(configId));
      const journalId = await findFile(JOURNAL_FILE, biz.folderId);
      if (journalId) {
        const journal = await downloadJson<Journal>(journalId);
        requireCurrentData(journal);
        for (const [source, dest] of Object.entries(journal.sheets)) if (dest.verified) ids[source] = dest.id;
      }
      continue;
    }
    const journalId = await findFile(JOURNAL_FILE, biz.folderId);
    const journal: Journal = journalId ? await downloadJson<Journal>(journalId) : { dataVersion: DATA_VERSION, sheets: {} };
    requireCurrentData(journal);
    const fingerprints: Record<string, string> = {};
    for (const year of biz.years) {
      checkSession();
      progress(`${biz.name} · ${year.year}: copying and verifying`);
      const source = await snapshot(year.sourceId);
      validateSource(source);
      const hash = await fingerprint(source);
      fingerprints[year.sourceId] = hash;
      let entry = journal.sheets[year.sourceId];
      if (entry && entry.fingerprint !== hash) throw new Error('Original data changed during the upgrade. Review the preserved copies before restarting.');
      if (!entry) {
        const copies = await listFiles(`'${year.folderId}' in parents and trashed=false and properties has { key='biztrackSource' and value='${year.sourceId}' } and properties has { key='biztrackUpgrade' and value='1-2' }`, 'find upgrade copy');
        if (copies.length > 1) throw new Error('Multiple upgrade copies found. Review the preserved spreadsheets before continuing.');
        let id = copies[0]?.id;
        if (id) {
          const meta = await json(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=properties&supportsAllDrives=true`);
          if (meta.properties?.biztrackFingerprint !== hash) throw new Error('Original data changed after copying. Review the preserved copy before restarting.');
        } else {
          if (await findFile(spreadsheetName(year.year, biz.name), year.folderId)) throw new Error('An unrecognized version 2 spreadsheet already exists.');
          checkSession();
          id = (await copyForUpgrade(year.sourceId, year.folderId, spreadsheetName(year.year, biz.name), hash)).id;
        }
        entry = journal.sheets[year.sourceId] = { id, fingerprint: hash, verified: false };
        checkSession();
        await putJson(JOURNAL_FILE, journal, biz.folderId);
      }
      const copy = await snapshot(entry.id);
      if (JSON.stringify(mileage(copy).values[0]) === JSON.stringify(OLD_HEADERS)) {
        if (comparable(copy) !== comparable(source)) throw new Error('The backup copy does not match the original. Upgrade paused.');
        checkSession();
        await transform(entry.id, copy);
      }
      const expected = converted(source);
      if (comparable(await snapshot(entry.id)) !== comparable(expected)) throw new Error('Upgraded spreadsheet verification failed. Originals are unchanged.');
      entry.verified = true;
      ids[year.sourceId] = entry.id;
      checkSession();
      await putJson(JOURNAL_FILE, journal, biz.folderId);
    }
    for (const [source, hash] of Object.entries(fingerprints)) {
      if (await fingerprint(await snapshot(source)) !== hash) throw new Error('Original data changed during the upgrade. Close other versions and review the preserved copies.');
    }
    checkSession();
    if (JSON.stringify(await downloadJson(biz.configId)) !== JSON.stringify(biz.config)) throw new Error('The business configuration changed during the upgrade. Close other versions and retry.');
    const config: BusinessConfig = { dataVersion: DATA_VERSION, id: biz.config.id ?? crypto.randomUUID(), name: biz.name,
      categories: biz.config.categories?.length ? biz.config.categories : [...DEFAULT_CATEGORIES] };
    await putJson(CONFIG_FILE, config, biz.folderId);
    requireCurrentData(await downloadJson<BusinessConfig>((await findFile(CONFIG_FILE, biz.folderId))!));
  }
  checkSession();
  if (readLegacyQueue() !== rawQueue) throw new Error('Pending changes changed during the upgrade. Close other tabs and retry.');
  const queue = rawQueue ? convertQueue(rawQueue, ids) : [];
  const currentQueue = localStorage.getItem(storageKey(QUEUE_KEY));
  if (queue.length && currentQueue && JSON.parse(currentQueue).length && currentQueue !== JSON.stringify(queue)) throw new Error('Version 2 has pending changes already. Upgrade paused to preserve both queues.');
  if (queue.length) localStorage.setItem(storageKey(QUEUE_KEY), JSON.stringify(queue));
  let profile: ProfileData;
  if (plan.profileId && JSON.stringify(await downloadJson(plan.profileId)) !== JSON.stringify(plan.profile)) throw new Error('The original profile changed. Close other versions and retry.');
  if (plan.legacyProfile) {
    const favorites: Record<string, MileageFavorite[]> = {};
    for (const [folder, entries] of Object.entries((plan.profile as LegacyProfile).mileage_favorites ?? {})) {
      if (!Array.isArray(entries)) throw new Error('Invalid mileage favorites. The original profile is unchanged.');
      favorites[folder] = entries.map(upgradeFavorite);
    }
    profile = { dataVersion: DATA_VERSION, businesses: plan.businesses.map(({ name, folderId }) => ({ name, folderId })), mileage_favorites: favorites, default_drivers: plan.profile.default_drivers ?? {} };
  } else {
    profile = { ...(plan.profile as ProfileData), businesses: plan.businesses.map(({ name, folderId }) => ({ name, folderId })) };
  }
  checkSession();
  // A prior attempt may have published successfully before its response was lost.
  const existing = await findFile(PROFILE_FILE, plan.rootId);
  if (!existing) await uploadJson(PROFILE_FILE, profile, plan.rootId);
  else if (!plan.legacyProfile) await updateJson(existing, profile);
  const saved = await downloadJson<ProfileData>((await findFile(PROFILE_FILE, plan.rootId))!);
  requireCurrentData(saved);
  if (JSON.stringify(saved) !== JSON.stringify(profile)) throw new Error('Profile verification failed. Pending changes are preserved.');
  checkSession();
  // Commit local cutover last. A failure before removing the old queue remains resumable.
  localStorage.removeItem(storageKey(CACHE_KEY));
  localStorage.setItem(storageKey(LOCAL_JOURNAL), JSON.stringify({ owner, rawQueue, complete: true }));
  localStorage.removeItem(storageKey(OLD_QUEUE));
  progress('Upgrade complete');
}

/** Used only when a user selects a folder for import. */
export async function inspectBusinessFolder(folderId: string): Promise<{ name: string; legacy: boolean } | null> {
  const current = await findFile(CONFIG_FILE, folderId);
  const id = current ?? await findFile('config.json', folderId);
  if (!id) return null;
  const cfg = await downloadJson<BusinessConfig>(id);
  if (current) requireCurrentData(cfg);
  if (typeof cfg.name !== 'string') throw new Error('Invalid business configuration.');
  return { name: cfg.name, legacy: !current };
}
