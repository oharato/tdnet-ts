import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../src/api.js';

describe('ApiClient', () => {
    let client: ApiClient;

    beforeEach(() => {
        client = new ApiClient();
        // グローバルの fetch をモック化
        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fetchRecentが正しいURLでリクエストし、データを返すこと', async () => {
        const mockResponse = {
            total_count: 1,
            items: [
                {
                    Tdnet: {
                        id: 'sample-id',
                        pubdate: '2026-02-23 15:00:00',
                        company_code: '12340',
                        company_name: 'テスト株式会社',
                        title: 'テスト開示情報',
                        document_url: 'https://example.com/test.pdf'
                    }
                }
            ]
        };

        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => mockResponse,
        });

        const result = await client.fetchRecent(1);

        // fetchが正しいパラメータで呼ばれたか確認
        expect(global.fetch).toHaveBeenCalledWith('https://webapi.yanoshin.jp/webapi/tdnet/list/recent.json?limit=1');
        expect(result).toEqual(mockResponse);
    });

    it('fetchByDateが正しいURLでリクエストし、データを返すこと', async () => {
        const mockResponse = { total_count: 0, items: [] };

        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => mockResponse,
        });

        const result = await client.fetchByDate('2026-02-23', 5);

        // 日付のハイフンが取り除かれてURLに含まれているか確認
        expect(global.fetch).toHaveBeenCalledWith('https://webapi.yanoshin.jp/webapi/tdnet/list/20260223.json?limit=5');
        expect(result).toEqual(mockResponse);
    });

    it('APIエラー時に例外を適切に投げること', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: false,
            statusText: 'Internal Server Error',
        });

        await expect(client.fetchRecent(10)).rejects.toThrow('Failed to fetch from TDnet API: Internal Server Error');
    });
});
