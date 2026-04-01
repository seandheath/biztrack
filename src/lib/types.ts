import type { TransactionRow } from './services/sheets.js';

/** A business entity tracked in BizTrack, as stored in memory and profile.json. */
export interface Business {
  id: string;
  name: string;
  folderId: string;
  configFileId: string | null;
  yearFolders: Record<number, string>;
  sheetIds: Record<number, string>;
  receiptFolderIds: Record<number, string>;
}

/** Per-business configuration stored in Drive as config.json. */
export interface BusinessConfig {
  id?: string;
  name: string;
  payment_accounts: string[];
  mileage_favorites: MileageFavorite[];
  categories: string[];
}

/** A saved mileage route favorite, stored in profile.json keyed by business folderId. */
export interface MileageFavorite {
  name: string;
  from: string;
  to: string;
  miles: number;
  purpose: string;
  roundTrip?: boolean;
}

/** Minimal business reference stored in profile.json (name + folderId only). */
export interface ProfileBusiness {
  name: string;
  folderId: string;
}

/** The full profile.json payload synced to Drive. */
export interface ProfileData {
  businesses: ProfileBusiness[];
  mileage_favorites: Record<string, MileageFavorite[]>;
}

/** Payload shape for the auth token update callback. */
export interface TokenUpdate {
  token: string | null;
  expiry: Date | null;
  email: string | null;
}

/** Return shape for Drive file operations. */
export interface DriveFile {
  id: string;
  name: string;
}

/** Return shape for Drive file metadata queries. */
export interface DriveFileMeta {
  id: string;
  name: string;
  parents: string[];
}

/** Sync cache structure stored in localStorage. */
export interface SyncCache {
  businesses: Business[];
  mileageFavorites: Record<string, MileageFavorite[]>;
  businessConfigs: Record<string, BusinessConfig>;
  transactions: Record<string, TransactionRow[]>;
  lastSyncTimestamp: number;
  lastSyncError: string | null;
}

/** Toast notification type. */
export type ToastType = 'success' | 'error';

/** Sync status indicator. */
export type SyncStatus = 'green' | 'yellow' | 'red';
