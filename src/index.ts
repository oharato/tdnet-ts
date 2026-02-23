import { ApiClient } from './api.js';
import { DbClient } from './db.js';
import { PdfParser } from './parser.js';
import { TdnetDocument } from './types.js';
import { delay } from './utils.js';

export * from './types.js';
export { ApiClient, DbClient, PdfParser };

export interface SyncOptions {
    limit?: number;           // デフォルト100
    date?: string;            // YYYY-MM-DD (指定がなければ直近)
    downloadDelayMs?: number; // PDFダウンロード間の待機時間(デフォルト1000ms)
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
    public async sync(options: SyncOptions = {}): Promise<void> {
        const limit = options.limit || 100;
        const downloadDelayMs = options.downloadDelayMs ?? 1000;

        let apiData;
        if (options.date) {
            console.log(`Fetching TDnet info for ${options.date}...`);
            apiData = await this.api.fetchByDate(options.date, limit);
        } else {
            console.log(`Fetching recent ${limit} TDnet info...`);
            apiData = await this.api.fetchRecent(limit);
        }

        const items = apiData.items || [];
        console.log(`Found ${items.length} records.`);

        for (const dataItem of items) {
            const item = dataItem.Tdnet;
            if (!item) continue;

            // URLから余分なリダイレクト部分を除去
            const rawUrl = item.document_url || '';
            const cleanUrl = rawUrl.startsWith('https://webapi.yanoshin.jp/rd.php?')
                ? rawUrl.replace('https://webapi.yanoshin.jp/rd.php?', '')
                : rawUrl;
            item.document_url = cleanUrl;

            // 既にDBにあるかチェックし、あればスキップ
            const existing = this.db.getDocument(item.document_url);
            if (existing) {
                console.log(`[Skip] Already exists: ${item.title}`);
                continue;
            }

            console.log(`[Process] ${item.title}`);
            try {
                let content = null;
                if (item.document_url && item.document_url.endsWith('.pdf')) {
                    console.log(`  -> Downloading and parsing PDF...`);
                    // NOTE: ダウンロード失敗・変換失敗でもDBには記録を残す（mdなしで）ようにした方が堅牢
                    content = await this.parser.downloadAndParse(item.document_url);
                }

                // 末尾の0を除去して4桁のtickerにする (一部の例外がある場合も考慮してendsWith判定)
                const ticker = item.company_code.endsWith('0')
                    ? item.company_code.slice(0, -1)
                    : item.company_code;

                // pubdate（例: "2026-02-20 20:00:00"）をJST(+09:00)として解釈し、UTC ISO形式(Z)に変換
                const jstDateStr = item.pubdate.replace(' ', 'T') + '+09:00';
                const publishedAt = new Date(jstDateStr).toISOString();

                const doc: TdnetDocument = {
                    publishedAt,
                    ticker,
                    companyName: item.company_name,
                    title: item.title,
                    documentUrl: item.document_url,
                    content,
                    createdAt: new Date().toISOString()
                };

                this.db.insertDocument(doc);
                console.log(`  -> Saved to DB.`);

            } catch (e: any) {
                console.error(`  -> Error processing ${item.document_url}: `, e.message);
            }

            // レートリミット対策のためのディレイ
            await delay(downloadDelayMs);
        }

        console.log('Sync complete.');
    }

    /**
     * データベースの開示情報を検索する
     */
    public search(keyword: string | undefined, options?: { ticker?: string; title?: string; startDate?: string; endDate?: string; limit?: number }): TdnetDocument[] {
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
