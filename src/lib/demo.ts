import { DATA_VERSION } from './data-model.js';
import type { Business, BusinessConfig, SyncCache } from './types.js';
import type { TransactionRow } from './services/sheets.js';

type SheetName = 'Expenses' | 'Mileage';
const companies = new Map<string, Business>();
const configs = new Map<string, BusinessConfig>();
const sheets = new Map<string, Record<SheetName, TransactionRow[]>>();

export function table(sheetId: string, name: SheetName): TransactionRow[] {
  const sheet = sheets.get(sheetId);
  if (!sheet || !Object.hasOwn(sheet, name)) throw new Error('Demo sheet not found.');
  return sheet[name];
}

export function configFor(business: Business): BusinessConfig {
  const config = configs.get(business.id);
  if (!config) throw new Error('Demo business not found.');
  return structuredClone(config);
}

export function ensureYear(business: Business, year: number): Business {
  const company = companies.get(business.id);
  if (!company) throw new Error('Demo business not found.');
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return structuredClone(company);
  if (!company.sheetIds[year]) {
    const id = `${company.id}-${year}`;
    company.sheetIds[year] = id;
    company.yearFolders[year] = `folder-${id}`;
    sheets.set(id, { Expenses: [], Mileage: [] });
  }
  return structuredClone(company);
}

export function readRow(sheetId: string, name: SheetName, rowNum: number): TransactionRow {
  const row = table(sheetId, name)[rowNum - 2];
  if (!row || !Number.isInteger(rowNum)) throw new Error('Demo entry not found.');
  return structuredClone(row);
}

export function append(sheetId: string, name: SheetName, rows: TransactionRow[]): void {
  const target = table(sheetId, name);
  const ids = new Set(target.map(row => row.id));
  for (const row of rows) {
    if (!row.id || ids.has(row.id)) throw new Error('Duplicate or missing demo entry ID.');
    ids.add(row.id);
  }
  target.push(...structuredClone(rows));
}

export function change(sheetId: string, name: SheetName, id: string, row?: TransactionRow): void {
  const target = table(sheetId, name);
  const index = target.findIndex(entry => entry.id === id);
  if (index < 0) throw new Error('Demo entry not found.');
  if (row) target[index] = structuredClone(row);
  else target.splice(index, 1);
}

/** Called once per page load. Nothing in this module reads or writes browser storage. */
export function seedDemo(now = new Date()): SyncCache {
  companies.clear(); configs.clear(); sheets.clear();
  const year = now.getFullYear();
  const cache: SyncCache = { dataVersion: DATA_VERSION, businesses: [], businessConfigs: {}, transactions: {}, mileageFavorites: {}, defaultDrivers: {} };
  for (const [id, name] of [
    ['demo-studio', 'Northstar Studio'],
    ['demo-garden', 'Juniper Gardens'],
  ]) {
    const garden = id === 'demo-garden';
    const driver = garden ? 'Sam Rivera' : 'Alex Morgan';
    const email = garden ? 'sam@example.com' : 'alex@example.com';
    const business: Business = { id, name, folderId: id, configFileId: `config-${id}`, yearFolders: {}, sheetIds: {}, receiptFolderIds: {} };
    const config: BusinessConfig = { id, name, categories: garden
      ? ['Uncategorized', 'Plants & Materials', 'Equipment', 'Fuel', 'Repairs']
      : ['Uncategorized', 'Supplies', 'Office Expenses', 'Meals', 'Travel'], dataVersion: DATA_VERSION };
    companies.set(id, business); configs.set(id, config);
    for (const y of [year, year - 1]) {
      const company = ensureYear(business, y);
      const sheetId = company.sheetIds[y];
      const date = y === year ? `${y}-${String(now.getMonth() + 1).padStart(2, '0')}-01` : `${y}-10-12`;
      if (y < year) {
        append(sheetId, 'Expenses', garden ? [
          { id: `${sheetId}-supplies`, date, vendor: 'Meadow Nursery', description: 'Maple saplings for park restoration', amount: '420.00', category: 'Plants & Materials', paymentMethod: 'Business Mastercard', submittedBy: email },
          { id: `${sheetId}-rental`, date, vendor: 'Oak Tool Rental', description: 'Weekend aerator rental', amount: '96.00', category: 'Equipment', paymentMethod: 'Business Mastercard', submittedBy: email },
          { id: `${sheetId}-review`, date, vendor: 'Mower Works', description: 'Blade sharpening and belt replacement', amount: '154.50', category: 'Uncategorized', paymentMethod: 'Cash', submittedBy: email },
        ] : [
          { id: `${sheetId}-supplies`, date, vendor: 'Pixel Press', description: 'Art fair postcards and posters', amount: '135.00', category: 'Supplies', paymentMethod: 'Business Visa', submittedBy: email },
          { id: `${sheetId}-meal`, date, vendor: 'Harbor Bistro', description: 'Exhibition planning lunch', amount: '42.80', category: 'Meals', paymentMethod: 'Cash', submittedBy: email },
          { id: `${sheetId}-review`, date, vendor: 'Frame Workshop', description: 'Frames for gallery samples', amount: '89.00', category: 'Uncategorized', paymentMethod: 'Business Visa', submittedBy: email },
        ]);
        append(sheetId, 'Mileage', [
          { id: `${sheetId}-trip`, date, driver, savedBy: email, ...(garden
            ? { description: 'Tree farm → Riverside Park — Deliver and plant maple saplings', miles: '46.2' }
            : { description: 'Print shop → Arts center — Set up art fair booth', miles: '22.4' }) },
        ]);
        continue;
      }
      append(sheetId, 'Expenses', garden ? [
        { id: `${sheetId}-supplies`, date, vendor: 'Greenhouse Supply', description: 'Lavender plants and cedar mulch', amount: '286.40', category: 'Plants & Materials', paymentMethod: 'Business Mastercard', submittedBy: email },
        { id: `${sheetId}-fuel`, date, vendor: 'Valley Fuel', description: 'Work truck diesel', amount: '57.20', category: 'Fuel', paymentMethod: 'Fuel card', submittedBy: email },
        { id: `${sheetId}-review`, date, vendor: 'Sprout Irrigation', description: 'Replacement sprinkler valves', amount: '119.00', category: 'Uncategorized', paymentMethod: 'Business Mastercard', submittedBy: email },
      ] : [
        { id: `${sheetId}-supplies`, date, vendor: 'Paper & Pine', description: 'Project supplies', amount: '48.75', category: 'Supplies', paymentMethod: 'Business Visa', submittedBy: email },
        { id: `${sheetId}-coffee`, date, vendor: 'Juniper Coffee', description: 'Client meeting', amount: '18.50', category: 'Meals', paymentMethod: 'Business Visa', submittedBy: 'alex@example.com' },
        { id: `${sheetId}-review`, date, vendor: 'Desk & Co.', description: 'Monitor stand', amount: '64.90', category: 'Uncategorized', paymentMethod: 'Business Visa', submittedBy: 'alex@example.com' },
      ]);
      append(sheetId, 'Mileage', [
        { id: `${sheetId}-trip`, date, driver, savedBy: email, ...(garden
          ? { description: 'Equipment yard → Willow Creek Apartments — Planting and irrigation repair', miles: '32.6' }
          : { description: 'Studio → Client office — Project review', miles: '14.8' }) },
      ]);
    }
    cache.businesses.push(structuredClone(business));
    cache.businessConfigs[id] = structuredClone(config);
    cache.defaultDrivers[id] = driver;
  }
  return cache;
}
