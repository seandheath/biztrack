import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
export const base = process.env.BIZTRACK_BASE_PATH || '';
if (base && !/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(base)) {
  throw new Error('BIZTRACK_BASE_PATH must be an absolute path without a trailing slash.');
}
if (base.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid base path.');
export const appName = base === '/beta' ? 'BizTrack Beta' : `BizTrack ${version}`;
let commit = '';
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
export const buildInfo = { version, commit, base };
