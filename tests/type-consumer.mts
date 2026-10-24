// Compile against built package entrypoints, not source aliases. No runtime or network calls.
import { TdnetManager, ApiClient } from '../dist/index.js';
import type { SearchOptions, SyncResult, RecoveryResult, TdnetDocument } from '../dist/index.js';
declare const manager: TdnetManager;
const search: SearchOptions = { match:'all', fields:['title','body'], normalize:'width-case', startDate:'2026-10-01' };
const results: TdnetDocument[] = manager.search('配当 増額', search);
const synced: Promise<SyncResult> = manager.sync({limit:1});
const recovered: Promise<RecoveryResult> = manager.recover(['fixture'],{savePdfDir:'./fixture'});
const api: ApiClient = new ApiClient(0,1000);
void [results,synced,recovered,api];
// @ts-expect-error Unsupported match modes must not silently become any.
manager.search('fixture',{match:'vector'});
// @ts-expect-error Recovery takes explicit IDs, not a single untyped string.
manager.recover('fixture');
