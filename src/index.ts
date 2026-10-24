import { ApiClient } from './api.js';
import { DbClient } from './db.js';
import { PdfParser } from './parser.js';
import { TdnetDocument, SearchOptions, SyncResult, SyncStatus, RecoveryResult } from './types.js';
import { delay } from './utils.js';
import { disclosureFromApi, validateSyncOptions } from './sync-input.js';
import fs from 'node:fs';
import path from 'node:path';

export * from './types.js';
export { ApiClient, DbClient, PdfParser };

export interface SyncOptions {
    limit?: number;           // デフォルト100
    date?: string;            // YYYY-MM-DD (指定がなければ直近)
    downloadDelayMs?: number; // PDFダウンロード間の待機時間(デフォルト1000ms)
    savePdfDir?: string;      // PDFを保存するディレクトリ。指定された場合のみ保存。
    concurrency?: number;     // 並列処理数 (デフォルト2)
}

/**
 * TDnetの統合管理クラス
 */
export class TdnetManager {
    private api: ApiClient;
    private db: DbClient;
    private parser: PdfParser;

    constructor(dbPath?: string) {
        this.api = new ApiClient();
        this.db = new DbClient(dbPath);
        this.parser = new PdfParser();
    }

    /**
     * APIからデータを取得し、PDFをダウンロード・変換してSQLiteに保存する
     * @param options 同期オプション
     */
    public async sync(options: SyncOptions = {}): Promise<SyncResult> {
        const { limit, concurrency, downloadDelayMs } = validateSyncOptions(options);
        const apiData = options.date ? await this.api.fetchByDate(options.date, limit) : await this.api.fetchRecent(limit);
        if (!Array.isArray(apiData.items)) throw new Error('Invalid API response: items must be an array.');
        const result: SyncResult = { received: apiData.items.length, duplicates: 0, invalid: 0, synced: 0, existing: 0,
            failed: 0, exhausted: 0, unsupported: 0, pdfSaveFailed: 0, limitReached: apiData.items.length >= limit, documents: [] };
        const seen = new Set<string>();
        const queue: { doc: TdnetDocument; status?: SyncStatus; attempts: number; pdfSaveFailed: boolean }[] = [];
        for (const item of apiData.items) {
            let doc: TdnetDocument;
            try { doc = disclosureFromApi(item); } catch { result.invalid++; continue; }
            if (seen.has(doc.id)) { result.duplicates++; continue; }
            seen.add(doc.id);
            const existing = this.db.getDocument(doc.id);
            if (existing) { doc.createdAt = existing.createdAt; doc.retryCount = existing.retryCount ?? 0; }
            const status: SyncStatus | undefined = existing && existing.content !== null ? 'existing'
                : !/\.pdf$/i.test(new URL(doc.documentUrl).pathname) ? 'unsupported'
                : doc.retryCount >= 3 ? 'exhausted' : undefined;
            if (status === 'existing') doc = existing!; // Keep body and its source URL together.
            if (status === 'unsupported') this.db.insertDocument(doc);
            queue.push({ doc, status, attempts: 0, pdfSaveFailed: false });
        }
        const rounds = [3, 10, 30].map(minutes => minutes * 60 * 1000);
        for (let round = 0; round < rounds.length; round++) {
            const pending = queue.filter(item => !item.status && item.doc.retryCount <= round);
            for (let i = 0; i < pending.length; i += concurrency) {
                const completed = await Promise.allSettled(pending.slice(i, i + concurrency).map(async item => {
                    item.attempts++;
                    try {
                        const parsed = options.savePdfDir ? await (async () => {
                            const original = await this.loadOriginal(item.doc, options.savePdfDir!, rounds[round]);
                            item.pdfSaveFailed = original.saveFailed;
                            return { markdown: await this.parser.parsePdfToMarkdown(original.buffer, rounds[round]) };
                        })() : await this.parser.downloadAndParse(item.doc.documentUrl, rounds[round]);
                        if (!parsed.markdown.trim()) throw new Error('PDF body is empty.');
                        item.doc.content = parsed.markdown;
                        item.status = 'synced';
                    } catch {
                        item.doc.retryCount++;
                        if (round === rounds.length - 1) item.status = 'failed';
                    }
                    // A database write failure is fatal, not a successful or retryable PDF result.
                    this.db.insertDocument(item.doc);
                }));
                const rejected = completed.find(outcome => outcome.status === 'rejected');
                if (rejected?.status === 'rejected') throw rejected.reason;
                if (i + concurrency < pending.length) await delay(downloadDelayMs);
            }
        }
        // Existing bodies are not re-parsed just to add a missing original.
        if (options.savePdfDir) {
            const existing = queue.filter(item => item.status === 'existing');
            for (let i = 0; i < existing.length; i++) {
                try { existing[i].pdfSaveFailed = (await this.loadOriginal(existing[i].doc, options.savePdfDir, rounds[0])).saveFailed; }
                catch { existing[i].pdfSaveFailed = true; }
                if (i + 1 < existing.length) await delay(downloadDelayMs);
            }
        }
        for (const item of queue) {
            const status = item.status ?? 'failed';
            result[status]++;
            if (item.pdfSaveFailed) result.pdfSaveFailed++;
            result.documents.push({ id: item.doc.id, status, attempts: item.attempts, pdfSaveFailed: item.pdfSaveFailed });
        }
        return result;
    }

    /** Explicitly recover saved IDs, including records no longer in the latest API listing. */
    public async recover(ids: string[], options: Omit<SyncOptions, 'date' | 'limit'> = {}): Promise<RecoveryResult> {
        const { concurrency, downloadDelayMs } = validateSyncOptions(options);
        if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id.trim())) throw new Error('Recovery requires nonempty document IDs.');
        const unique = [...new Set(ids)];
        const result: RecoveryResult = { requested: unique.length, recovered: 0, existing: 0, missing: 0, failed: 0, pdfSaved: 0, pdfSaveFailed: 0, documents: [] };
        const run = async (id: string): Promise<RecoveryResult['documents'][number]> => {
            const doc = this.db.getDocument(id);
            const entry: RecoveryResult['documents'][number] = { id, status: 'missing', attempts: 0, pdfSaved: false, pdfSaveFailed: false };
            if (!doc) return entry;
            if (doc.content !== null && !options.savePdfDir) return { ...entry, status: 'existing' };
            let original: Awaited<ReturnType<TdnetManager['loadOriginal']>> | undefined;
            for (const timeoutMs of [180000, 600000, 1800000]) {
                entry.attempts++;
                try {
                    original ??= await this.loadOriginal(doc, options.savePdfDir, timeoutMs);
                    entry.pdfSaved = original.saved;
                    entry.pdfSaveFailed = original.saveFailed;
                    if (doc.content !== null) return { ...entry, status: 'existing' };
                    const content = await this.parser.parsePdfToMarkdown(original.buffer, timeoutMs);
                    if (!content.trim()) throw new Error('PDF body is empty.');
                    doc.content = content;
                    entry.status = 'recovered';
                } catch {
                    if (doc.content !== null) return { ...entry, status: 'existing', pdfSaveFailed: true };
                    doc.retryCount++;
                    entry.status = 'failed';
                }
                this.db.insertDocument(doc);
                if (entry.status === 'recovered') break;
            }
            return entry;
        };
        for (let i = 0; i < unique.length; i += concurrency) {
            const completed = await Promise.allSettled(unique.slice(i, i + concurrency).map(run));
            const failed = completed.find(outcome => outcome.status === 'rejected');
            if (failed?.status === 'rejected') throw failed.reason;
            for (const outcome of completed) if (outcome.status === 'fulfilled') {
                const entry = outcome.value; result.documents.push(entry); result[entry.status]++;
                if (entry.pdfSaved) result.pdfSaved++;
                if (entry.pdfSaveFailed) result.pdfSaveFailed++;
            }
            if (i + concurrency < unique.length) await delay(downloadDelayMs);
        }
        return result;
    }

    /** Read an existing regular original or download once and save before parsing. Never overwrite it. */
    private async loadOriginal(doc: TdnetDocument, directory: string | undefined, timeoutMs: number): Promise<{ buffer: Uint8Array; saved: boolean; saveFailed: boolean }> {
        if (!/^[a-zA-Z0-9_.-]+$/.test(doc.id) || doc.id === '.' || doc.id === '..') throw new Error('Unsafe document ID.');
        const url = new URL(doc.documentUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !/\.pdf$/i.test(url.pathname)) throw new Error('Unsupported PDF URL.');
        const target = directory ? path.join(directory, `${doc.id}.pdf`) : undefined;
        if (target) {
            try {
                if (!fs.lstatSync(target).isFile()) throw new Error('Original is not a regular file.');
                return { buffer: fs.readFileSync(target), saved: false, saveFailed: false };
            } catch (error: any) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
        }
        const buffer = new Uint8Array(await this.parser.downloadPdf(doc.documentUrl, timeoutMs));
        if (!target) return { buffer, saved: false, saveFailed: false };
        let temporary: string | undefined;
        try {
            fs.mkdirSync(directory!, { recursive: true });
            temporary = fs.mkdtempSync(path.join(directory!, '.tdnet-original-'));
            const staged = path.join(temporary, 'original.pdf');
            fs.writeFileSync(staged, buffer, { flag: 'wx' });
            try {
                // Same-filesystem hard link publishes a complete file atomically, without replacing target.
                fs.linkSync(staged, target);
                return { buffer, saved: true, saveFailed: false };
            } catch (error: any) {
                if (error.code !== 'EEXIST') throw error;
                if (!fs.lstatSync(target).isFile()) throw new Error('Original is not a regular file.');
                return { buffer: fs.readFileSync(target), saved: false, saveFailed: false };
            }
        } catch {
            return { buffer, saved: false, saveFailed: true };
        } finally {
            if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
        }
    }

    /**
     * データベースの開示情報を検索する
     */
    public search(keyword: string | undefined, options?: SearchOptions): TdnetDocument[] {
        return this.db.searchDocuments(keyword, options);
    }

    /**
     * 最近のドキュメントをDBから取得する
     */
    public getRecent(limit: number = 50): TdnetDocument[] {
        return this.db.getRecentDocuments(limit);
    }

    /**
     * データベース接続を閉じる
     */
    public close() {
        this.db.close();
    }
}
