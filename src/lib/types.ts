import type { TransactionRow } from './services/sheets.js';

/** A business entity tracked in BizTrack, as stored in memory and profile-v2.json. */
export interface Business {
  id: string;
  name: string;
  folderId: string;
  configFileId: string | null;
  yearFolders: Record<number, string>;
  sheetIds: Record<number, string>;
  receiptFolderIds: Record<number, string>;
}

/** Per-business configuration stored in Drive as config-v2.json. */
export interface BusinessConfig {
  id?: string;
  name: string;
  dataVersion: number;
  categories: string[];
}

/** A saved mileage route favorite, stored in profile-v2.json keyed by business folderId. */
export interface MileageFavorite {
  name: string;
  description: string;
  miles: number;
  driver: string;
}

/** Minimal business reference stored in profile-v2.json (name + folderId only). */
export interface ProfileBusiness {
  name: string;
  folderId: string;
}

/** The full profile-v2.json payload synced to Drive. */
export interface ProfileData {
  dataVersion: number;
  businesses: ProfileBusiness[];
  mileage_favorites: Record<string, MileageFavorite[]>;
  default_drivers?: Record<string, string>;
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

/** Sync cache structure stored in localStorage. */
export interface SyncCache {
  dataVersion: number;
  businesses: Business[];
  mileageFavorites: Record<string, MileageFavorite[]>;
  defaultDrivers: Record<string, string>;
  businessConfigs: Record<string, BusinessConfig>;
  transactions: Record<string, TransactionRow[]>;
}

/** Toast notification type. */
export type ToastType = 'success' | 'error';

/** Sync status indicator. */
export type SyncStatus = 'green' | 'yellow' | 'red';
