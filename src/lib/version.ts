export const appBase = typeof __APP_BASE__ === 'undefined' ? '' : __APP_BASE__;
export const appName = typeof __APP_NAME__ === 'undefined' ? 'BizTrack' : __APP_NAME__;
export const appCommit = typeof __APP_COMMIT__ === 'undefined' ? '' : __APP_COMMIT__;

// Beta inherits the original installation's data. Never copy an offline queue.
export function storageKey(key: string): string {
  return !appBase || appBase === '/beta' ? key : `biztrack:${appBase}:${key}`;
}

export const shareCache = storageKey('biztrack-share');
export const receiptKey = '/pending-receipt';
