import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbClient } from '../src/db.js';
import type { ExtractedFinancialSummary } from '../src/financial/extractor.js';

let db: DbClient;

beforeEach(() => {
    db = new DbClient(':memory:');
});
afterEach(() => db.close());

interface SummaryInput {
    documentId: string;
    publishedAt: string;
    ticker?: string;
    periodEnd?: string | null;
    isRevision?: boolean;
    netSales?: number;
    netIncome?: number;
    operatingCashFlow?: number;
}

/** サマリー表の最新版選択だけを検証するための最小データ。未指定の科目は null になる。 */
function summary(input: SummaryInput): ExtractedFinancialSummary {
    return {
        documentId: input.documentId,
        ticker: input.ticker ?? '1301',
        companyName: 'テスト商事株式会社',
        title: input.isRevision ? '（訂正・数値データ訂正）決算短信の一部訂正について' : '2026年3月期 決算短信〔日本基準〕（連結）',
        publishedAt: input.publishedAt,
        xbrlUrl: null,
        periodType: 'FY',
        periodStart: '2025-04-01',
        periodEnd: input.periodEnd === undefined ? '2026-03-31' : input.periodEnd,
        priorPeriodStart: '2024-04-01',
        priorPeriodEnd: '2025-03-31',
        accountingStandard: 'J-GAAP',
        isConsolidated: true,
        isRevision: input.isRevision ?? false,
        current: {
            netSales: input.netSales,
            netIncome: input.netIncome,
            operatingCashFlow: input.operatingCashFlow,
        },
        prior: {},
        indicators: {},
        usedContextIds: {
            currentDuration: [],
            priorDuration: [],
            currentInstant: [],
            priorFiscalYearInstant: [],
            priorPeriodInstant: [],
        },
    };
}

describe('訂正版の最新選択', () => {
    it('訂正が1回のとき、screen は訂正版だけを返す', () => {
        db.insertFinancialSummary(summary({ documentId: 'orig', publishedAt: '2026-05-01T06:00:00.000Z', netSales: 100, netIncome: 10 }));
        db.insertFinancialSummary(summary({
            documentId: 'rev', publishedAt: '2026-06-01T06:00:00.000Z', isRevision: true, netSales: 90, netIncome: 12,
        }));

        const rows = db.screenFinancials();
        expect(rows.map(row => row.documentId)).toEqual(['rev']);
        expect(rows[0]).toMatchObject({ currentNetSales: 90, currentNetIncome: 12, isRevision: true });

        // 保存行は失われず、文書ID指定なら旧版も読める。
        expect(db.getFinancialSummary('orig')?.current.netSales).toBe(100);
    });

    it('再訂正があるとき、screen は最後の訂正版だけを返す', () => {
        db.insertFinancialSummary(summary({ documentId: 'orig', publishedAt: '2026-05-01T06:00:00.000Z', netSales: 100 }));
        db.insertFinancialSummary(summary({
            documentId: 'rev-1', publishedAt: '2026-06-01T06:00:00.000Z', isRevision: true, netSales: 95,
        }));
        db.insertFinancialSummary(summary({
            documentId: 'rev-2', publishedAt: '2026-07-01T06:00:00.000Z', isRevision: true, netSales: 92,
        }));

        const rows = db.screenFinancials();
        expect(rows.map(row => row.documentId)).toEqual(['rev-2']);
        expect(rows[0].currentNetSales).toBe(92);
    });

    it('数値だけを訂正した版は、訂正後の数値を使う', () => {
        db.insertFinancialSummary(summary({
            documentId: 'orig', publishedAt: '2026-05-01T06:00:00.000Z', netSales: 100, netIncome: 10, operatingCashFlow: 30,
        }));
        db.insertFinancialSummary(summary({
            documentId: 'rev', publishedAt: '2026-06-01T06:00:00.000Z', isRevision: true, netSales: 100, netIncome: 12, operatingCashFlow: 30,
        }));

        const rows = db.screenFinancials({ where: "ticker = '1301'" });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            documentId: 'rev',
            currentNetSales: 100,
            currentNetIncome: 12,
            currentOperatingCf: 30,
            isRevision: true,
        });
    });

    it('訂正版が一部の科目だけでも最新版を採り、旧版の値を混ぜない', () => {
        db.insertFinancialSummary(summary({
            documentId: 'orig', publishedAt: '2026-05-01T06:00:00.000Z', netSales: 100, netIncome: 10,
        }));
        db.insertFinancialSummary(summary({
            documentId: 'rev', publishedAt: '2026-06-01T06:00:00.000Z', isRevision: true, netIncome: 12,
        }));

        const rows = db.screenFinancials();
        expect(rows).toHaveLength(1);
        expect(rows[0].documentId).toBe('rev');
        expect(rows[0].currentNetSales).toBeUndefined();
        expect(rows[0].currentNetIncome).toBe(12);
    });

    it('同じ企業でも期末日が違う行、別企業の同じ期末日の行は残す', () => {
        db.insertFinancialSummary(summary({ documentId: 'fy-2025', publishedAt: '2025-05-01T06:00:00.000Z', periodEnd: '2025-03-31', netSales: 80 }));
        db.insertFinancialSummary(summary({ documentId: 'fy-2026', publishedAt: '2026-05-01T06:00:00.000Z', periodEnd: '2026-03-31', netSales: 100 }));
        db.insertFinancialSummary(summary({
            documentId: 'other-fy-2026', publishedAt: '2026-05-01T06:00:00.000Z', ticker: '1302', periodEnd: '2026-03-31', netSales: 200,
        }));

        expect(db.screenFinancials().map(row => row.documentId).sort()).toEqual(['fy-2025', 'fy-2026', 'other-fy-2026']);
    });

    it('数値が全nullの訂正版は最新版の候補にせず、有効な元行を隠さない', () => {
        db.insertFinancialSummary(summary({ documentId: 'orig', publishedAt: '2026-05-01T06:00:00.000Z', netSales: 100 }));
        db.insertFinancialSummary(summary({ documentId: 'empty-rev', publishedAt: '2026-06-01T06:00:00.000Z', isRevision: true }));

        const rows = db.screenFinancials();
        expect(rows.map(row => row.documentId)).toEqual(['orig']);
        expect(db.getLatestFinancialSummary('orig')?.documentId).toBe('orig');
        expect(db.getLatestFinancialSummary('empty-rev')?.documentId).toBe('orig');
    });

    it('期末日が不明な訂正告知（数値なし）は単独行として扱い、元行を隠さない', () => {
        db.insertFinancialSummary(summary({ documentId: 'orig', publishedAt: '2026-05-01T06:00:00.000Z', netSales: 100 }));
        db.insertFinancialSummary(summary({
            documentId: 'notice', publishedAt: '2026-06-01T06:00:00.000Z', periodEnd: null, isRevision: true,
        }));

        expect(db.screenFinancials().map(row => row.documentId)).toEqual(['orig']);
    });

    it('指定文書から同一企業・同一期末日の最新版を引ける', () => {
        db.insertFinancialSummary(summary({ documentId: 'orig', publishedAt: '2026-05-01T06:00:00.000Z', netSales: 100 }));
        db.insertFinancialSummary(summary({
            documentId: 'rev', publishedAt: '2026-06-01T06:00:00.000Z', isRevision: true, netSales: 90,
        }));

        expect(db.getLatestFinancialSummary('orig')?.documentId).toBe('rev');
        expect(db.getLatestFinancialSummary('rev')?.documentId).toBe('rev');
        expect(db.getLatestFinancialSummary('missing')).toBeUndefined();
    });

    it('published_at が同じなら document_id の降順で最新を決める', () => {
        const at = '2026-06-01T06:00:00.000Z';
        db.insertFinancialSummary(summary({ documentId: 'rev-a', publishedAt: at, isRevision: true, netSales: 95 }));
        db.insertFinancialSummary(summary({ documentId: 'rev-b', publishedAt: at, isRevision: true, netSales: 90 }));

        expect(db.screenFinancials().map(row => row.documentId)).toEqual(['rev-b']);
    });
});
