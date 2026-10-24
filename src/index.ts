import { ApiClient } from './api.js';
import { DbClient } from './db.js';
import { PdfParser } from './parser.js';
import { TdnetDocument, SearchOptions, SyncResult, SyncStatus } from './types.js';
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
                        const parsed = await this.parser.downloadAndParse(item.doc.documentUrl, rounds[round]);
                        if (!parsed.markdown.trim()) throw new Error('PDF body is empty.');
                        if (options.savePdfDir && parsed.buffer) {
                            try {
                                fs.mkdirSync(options.savePdfDir, { recursive: true });
                                try { fs.writeFileSync(path.join(options.savePdfDir, `${item.doc.id}.pdf`), Buffer.from(parsed.buffer), { flag: 'wx' }); }
                                catch (error: any) { if (error.code !== 'EEXIST') throw error; }
                            } catch { item.pdfSaveFailed = true; }
                        }
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
        for (const item of queue) {
            const status = item.status ?? 'failed';
            result[status]++;
            if (item.pdfSaveFailed) result.pdfSaveFailed++;
            result.documents.push({ id: item.doc.id, status, attempts: item.attempts, pdfSaveFailed: item.pdfSaveFailed });
        }
        return result;
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
