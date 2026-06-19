import { ApiDocumentResponse } from './types.js';
import { delay } from './utils.js';

export class ApiClient {
    private readonly baseUrl = 'https://webapi.yanoshin.jp/webapi/tdnet/list';
    private readonly maxRetries = 3;
    private readonly retryDelayMs: number;

    constructor(retryDelayMs = 2000) {
        this.retryDelayMs = retryDelayMs;
    }

    /**
     * リトライ付きfetch
     * ネットワークエラー（TypeError）の場合に指数バックオフでリトライする
     */
    private async fetchWithRetry(url: string): Promise<Response> {
        let lastError: unknown;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await fetch(url);
                return response;
            } catch (err) {
                if (!(err instanceof TypeError)) {
                    throw err;
                }
                lastError = err;
                if (attempt < this.maxRetries) {
                    const waitMs = this.retryDelayMs * Math.pow(2, attempt - 1);
                    console.warn(`Fetch attempt ${attempt} failed, retrying in ${waitMs}ms...`);
                    await delay(waitMs);
                }
            }
        }
        throw lastError;
    }

    /**
     * 指定した日付のTDnet開示情報を取得する
     * @param date YYYYMMDD または YYYY-MM-DD
     * @param limit 取得件数 デフォルト100
     */
    public async fetchByDate(date: string, limit: number = 100): Promise<ApiDocumentResponse> {
        const formattedDate = date.replace(/-/g, '');
        const url = `${this.baseUrl}/${formattedDate}.json?limit=${limit}`;

        const response = await this.fetchWithRetry(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch from TDnet API: ${response.statusText}`);
        }

        return response.json() as Promise<ApiDocumentResponse>;
    }

    /**
     * 最近のTDnet開示情報を取得する
     * 日付指定なしの場合は最新順（recent）の情報を取得する
     * @param limit 取得件数 デフォルト100
     */
    public async fetchRecent(limit: number = 100): Promise<ApiDocumentResponse> {
        const url = `${this.baseUrl}/recent.json?limit=${limit}`;

        const response = await this.fetchWithRetry(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch from TDnet API: ${response.statusText}`);
        }

        return response.json() as Promise<ApiDocumentResponse>;
    }
}
