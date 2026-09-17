export const DATA_VERSION = 2;
export const PROFILE_FILE = 'profile-v2.json';
export const CONFIG_FILE = 'config-v2.json';
export const CACHE_KEY = 'bt_cache_v2';
export const QUEUE_KEY = 'biztrack_offline_queue_v2';
export const MILEAGE_HEADERS = ['Date', 'Description', 'Miles', 'Saved By', 'ID', 'Driver'];
export class DataVersionError extends Error {}

export function requireCurrentData(data: { dataVersion?: number }): void {
  if (data.dataVersion !== DATA_VERSION) {
    throw new DataVersionError('This data needs a different app version. Open the version chooser.');
  }
}

export function spreadsheetName(year: number, name: string): string {
  return `${year}_${name.replace(/[/\\:*?"<>|]/g, '')}_expenses_v2`;
}
