import { ApiDocumentResponse } from './types.js';

export class ApiClient {
    private readonly baseUrl = 'https://webapi.yanoshin.jp/webapi/tdnet/list';

    /**
     * 指定した日付のTDnet開示情報を取得する
     * @param date YYYYMMDD または YYYY-MM-DD
     * @param limit 取得件数 (1-100) デフォルト100
     */
    public async fetchByDate(date: string, limit: number = 100): Promise<ApiDocumentResponse> {
        const formattedDate = date.replace(/-/g, '');
        const url = `${this.baseUrl}/${formattedDate}.json?limit=${limit}`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch from TDnet API: ${response.statusText}`);
        }

        return response.json() as Promise<ApiDocumentResponse>;
    }

    /**
     * 最近のTDnet開示情報を取得する
     * 日付指定なしの場合は最新順（recent）の情報を取得する
     * @param limit 取得件数 (1-100) デフォルト100
     */
    public async fetchRecent(limit: number = 100): Promise<ApiDocumentResponse> {
        const url = `${this.baseUrl}/recent.json?limit=${limit}`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch from TDnet API: ${response.statusText}`);
        }

        return response.json() as Promise<ApiDocumentResponse>;
    }
}
