import { ApiClient } from './api.js';
import { DbClient } from './db.js';
import { PdfParser } from './parser.js';
import { TdnetDocument } from './types.js';
import { delay } from './utils.js';
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
    public async sync(options: SyncOptions = {}): Promise<void> {
        const limit = options.limit || 100;
        const downloadDelayMs = options.downloadDelayMs ?? 1000;
        const concurrency = options.concurrency ?? 2;

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

        // ラウンドごとのタイムアウト設定(ミリ秒)
        const rounds = [
            { timeoutMs: 3 * 60 * 1000, desc: '3分' },
            { timeoutMs: 10 * 60 * 1000, desc: '10分' },
            { timeoutMs: 30 * 60 * 1000, desc: '30分' }
        ];

        // 1. 各アイテムの初期状態（DBから既存情報を取得）を確認
        const queue = items
            .filter((d: any) => d.Tdnet != null)
            .map((dataItem: any) => {
                const item = dataItem.Tdnet;
                const rawUrl = item.document_url || '';
                const cleanUrl = rawUrl.startsWith('https://webapi.yanoshin.jp/rd.php?')
                    ? rawUrl.replace('https://webapi.yanoshin.jp/rd.php?', '')
                    : rawUrl;
                item.document_url = cleanUrl;
                const docId = path.basename(item.document_url).replace(/\.pdf$/i, '') || item.id;

                const existing = this.db.getDocument(String(docId));
                return {
                    dataItem,
                    docId,
                    existing,
                    processed: existing ? (existing.content !== null) : false,
                    retryCount: existing ? existing.retryCount : 0
                };
            });

        for (let roundIdx = 0; roundIdx < rounds.length; roundIdx++) {
            const roundItems = queue.filter(q => !q.processed && q.retryCount <= roundIdx);
            if (roundItems.length === 0) continue;

            const round = rounds[roundIdx];
            console.log(`\n=== Round ${roundIdx + 1}: Timeout ${round.desc} (Target: ${roundItems.length} items, Concurrency: ${concurrency}) ===`);

            // 並列処理のためのワーカー関数
            const processItem = async (q: typeof queue[0], index: number) => {
                const item = q.dataItem.Tdnet;
                console.log(`\n[Round ${roundIdx + 1}] Processing (${index}/${roundItems.length}): ${item.company_name} - ${item.title}`);

                try {
                    let content = null;
                    if (item.document_url && item.document_url.endsWith('.pdf')) {
                        const parsed = await this.parser.downloadAndParse(item.document_url, round.timeoutMs);
                        content = parsed.markdown;

                        if (options.savePdfDir && parsed.buffer) {
                            try {
                                if (!fs.existsSync(options.savePdfDir)) {
                                    fs.mkdirSync(options.savePdfDir, { recursive: true });
                                }
                                const fileName = `${q.docId}.pdf`;
                                const filePath = path.join(options.savePdfDir, fileName);
                                if (!fs.existsSync(filePath)) {
                                    fs.writeFileSync(filePath, Buffer.from(parsed.buffer));
                                }
                            } catch (writeErr: any) {
                                console.error(`  -> Failed to save local PDF for ${q.docId}: ${writeErr.message}`);
                            }
                        }
                    }

                    const ticker = item.company_code.endsWith('0') ? item.company_code.slice(0, -1) : item.company_code;
                    const jstDateStr = item.pubdate.replace(' ', 'T') + '+09:00';
                    const publishedAt = new Date(jstDateStr).toISOString();

                    const doc: TdnetDocument = {
                        id: q.docId,
                        publishedAt,
                        ticker,
                        companyName: item.company_name,
                        title: item.title,
                        documentUrl: item.document_url,
                        content,
                        retryCount: q.retryCount,
                        createdAt: q.existing?.createdAt || new Date().toISOString()
                    };

                    this.db.insertDocument(doc);
                    q.processed = true;
                    console.log(`  -> [${q.docId}] Successfully synced.`);

                } catch (e: any) {
                    console.log(`  -> [${q.docId}] Error: ${e.message}`);
                    q.retryCount++;

                    const ticker = item.company_code.endsWith('0') ? item.company_code.slice(0, -1) : item.company_code;
                    const jstDateStr = item.pubdate.replace(' ', 'T') + '+09:00';
                    const publishedAt = new Date(jstDateStr).toISOString();

                    const doc: TdnetDocument = {
                        id: q.docId,
                        publishedAt,
                        ticker,
                        companyName: item.company_name,
                        title: item.title,
                        documentUrl: item.document_url,
                        content: null,
                        retryCount: q.retryCount,
                        createdAt: q.existing?.createdAt || new Date().toISOString()
                    };
                    this.db.insertDocument(doc);
                }
            };

            // 並列実行（リミッター付き）
            for (let i = 0; i < roundItems.length; i += concurrency) {
                const chunk = roundItems.slice(i, i + concurrency);
                await Promise.all(chunk.map((item, j) => processItem(item, i + j + 1)));

                // チャンク間に少しディレイを入れる（レートリミット対策）
                if (i + concurrency < roundItems.length) {
                    await delay(downloadDelayMs);
                }
            }
        }

        console.log('\nSync complete.');
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
