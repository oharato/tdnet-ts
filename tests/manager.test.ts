import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TdnetManager } from '../src/index.js';

// 各種依存クラスをモック化
const mockFetchRecent = vi.fn();
const mockFetchByDate = vi.fn();
vi.mock('../src/api', () => ({
    ApiClient: class {
        fetchRecent = mockFetchRecent;
        fetchByDate = mockFetchByDate;
    }
}));

const mockInsertDocument = vi.fn();
const mockGetDocument = vi.fn();
const mockSearchDocuments = vi.fn();
const mockGetRecentDocuments = vi.fn();
const mockClose = vi.fn();
vi.mock('../src/db', () => ({
    DbClient: class {
        insertDocument = mockInsertDocument;
        getDocument = mockGetDocument;
        searchDocuments = mockSearchDocuments;
        getRecentDocuments = mockGetRecentDocuments;
        close = mockClose;
    }
}));

const mockDownloadAndParse = vi.fn();
vi.mock('../src/parser', () => ({
    PdfParser: class {
        downloadAndParse = mockDownloadAndParse;
    }
}));

describe('TdnetManager', () => {
    let manager: any;

    beforeEach(() => {
        // 依存関係をモック化した状態でインスタンスを作成
        manager = new TdnetManager(':memory:');

        // コンソール出力を抑制 (テストログが汚れるのを防ぐ)
        vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        mockFetchRecent.mockReset();
        mockFetchByDate.mockReset();
        mockInsertDocument.mockReset();
        mockGetDocument.mockReset();
        mockSearchDocuments.mockReset();
        mockGetRecentDocuments.mockReset();
        mockClose.mockReset();
        mockDownloadAndParse.mockReset();
    });

    it('syncメソッドが正しくプロパティを整形してDBに保存すること', async () => {
        // モックデータの設定
        const mockApiItems = {
            items: [
                {
                    Tdnet: {
                        pubdate: '2026-02-23 15:00:00',
                        company_code: '12340', // 5文字で末尾が0
                        company_name: '株式会社テスト',
                        title: '決算説明会資料',
                        document_url: 'https://webapi.yanoshin.jp/rd.php?https://example.com/test.pdf' // リダイレクトプレフィックス付き
                    }
                }
            ]
        };

        // ApiClientのモック戻り値を設定
        mockFetchRecent.mockResolvedValue(mockApiItems);

        // DBへの既存問い合わせはnull(新規)とする
        mockGetDocument.mockReturnValue(undefined);

        // PdfParserのモック戻り値を設定
        mockDownloadAndParse.mockResolvedValue('Markdown content mock');

        // 実行
        await manager.sync({ limit: 1, downloadDelayMs: 0 }); // delayを0にしてすぐに終わらせる

        // fetchRecentが呼ばれたことを確認
        expect(mockFetchRecent).toHaveBeenCalledWith(1);

        // downloadAndParseがリダイレクト除去後のURLで呼ばれたことを確認
        expect(mockDownloadAndParse).toHaveBeenCalledWith('https://example.com/test.pdf');

        // DBへの保存(insertDocument)が意図したフォーマットで行われているか確認
        expect(mockInsertDocument).toHaveBeenCalledTimes(1);
        const insertedDoc = mockInsertDocument.mock.calls[0][0];

        // 整形（JSTのUTC ISO化、ticker末尾0の除去、URLプレフィックス除去）の検証
        expect(insertedDoc.ticker).toBe('1234'); // 12340 -> 1234 に整形されている
        expect(insertedDoc.publishedAt).toBe('2026-02-23T06:00:00.000Z'); // 15:00 JST -> 06:00 UTC
        expect(insertedDoc.documentUrl).toBe('https://example.com/test.pdf');
        expect(insertedDoc.content).toBe('Markdown content mock');
        expect(insertedDoc.companyName).toBe('株式会社テスト');
    });

    it('既存のドキュメントはスキップされること', async () => {
        const mockApiItems = {
            items: [
                {
                    Tdnet: {
                        pubdate: '2026-02-23 15:00:00',
                        company_code: '12340',
                        company_name: '株式会社テスト',
                        title: '決算説明会資料',
                        document_url: 'https://example.com/test.pdf'
                    }
                }
            ]
        };

        mockFetchRecent.mockResolvedValue(mockApiItems);

        // DBへの既存問い合わせで、値が返る（既に存在することをシミュレート）
        mockGetDocument.mockReturnValue({ documentUrl: 'https://example.com/test.pdf' });

        // 実行
        await manager.sync({ limit: 1, downloadDelayMs: 0 });

        // downloadAndParse と insertDocument は呼ばれないはず
        expect(mockDownloadAndParse).not.toHaveBeenCalled();
        expect(mockInsertDocument).not.toHaveBeenCalled();
    });
});
