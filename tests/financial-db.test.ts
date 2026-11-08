import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { DbClient } from '../src/db.js';
import { parseXbrlZip } from '../src/xbrl/parser.js';
import { resolveFacts } from '../src/xbrl/context.js';
import { extractFinancialSummaryFromFacts } from '../src/financial/extractor.js';

function fixture(name: string): URL {
    return new URL(`./fixtures/xbrl/${name}`, import.meta.url);
}

describe('DbClient financial tables', () => {
    let db: DbClient;

    beforeEach(() => {
        db = new DbClient(':memory:');
    });
    afterEach(() => db.close());

    it('XBRL 文書・数値 Fact 全件・サマリーを保存し、既存の tdnet_documents を壊さない', async () => {
        db.insertDocument({
            id: '140120261105565082',
            publishedAt: '2026-11-06T00:00:00.000Z',
            ticker: '2376',
            companyName: '株式会社サイネックス',
            title: '令和9年3月期 第2四半期（中間期）決算短信〔日本基準〕（連結）',
            documentUrl: 'https://www.release.tdnet.info/inbs/140120261105565082.pdf',
            content: 'PDF本文',
            retryCount: 0,
            createdAt: '2026-11-06T00:00:00.000Z',
        });

        const parsed = await parseXbrlZip(await readFile(fixture('jgaap-23760-2026-q2.zip')));
        const facts = resolveFacts(parsed);
        const summary = extractFinancialSummaryFromFacts(facts, {
            documentId: '140120261105565082',
            ticker: '2376',
            companyName: '株式会社サイネックス',
            xbrlUrl: 'https://www.release.tdnet.info/inbs/081220261105565082.zip',
        });
        const now = '2026-11-08T00:00:00.000Z';
        db.saveXbrlExtraction({
            document: {
                documentId: summary.documentId,
                xbrlUrl: summary.xbrlUrl,
                status: 'parsed',
                periodType: summary.periodType,
                periodStart: summary.periodStart,
                periodEnd: summary.periodEnd,
                accountingStandard: summary.accountingStandard,
                isConsolidated: summary.isConsolidated,
                isRevision: summary.isRevision,
                factCount: facts.length,
                error: null,
                createdAt: now,
                updatedAt: now,
            },
            facts,
            summary,
        });

        expect(db.getDocument('140120261105565082')?.content).toBe('PDF本文');
        expect(db.getXbrlDocument(summary.documentId)).toMatchObject({
            status: 'parsed',
            periodType: 'Q2',
            accountingStandard: 'J-GAAP',
            isConsolidated: true,
            factCount: 345,
        });

        const storedFacts = db.getFinancialFacts(summary.documentId);
        expect(storedFacts).toHaveLength(345);
        // 未解決 Context の Fact も捨てず、次元と未解決理由を保持する。
        const dividend = storedFacts.find(fact =>
            fact.name === 'DividendPerShare' && fact.contextRef.includes('AnnualMember'));
        expect(dividend?.contextStatus).toBe('unresolved');
        expect(dividend?.dimensions).toContainEqual({
            dimension: 'tse-ed-t:AnnualDividendPaymentScheduleAxis',
            member: 'tse-ed-t:AnnualMember',
        });
        expect(dividend?.unresolvedReasons).toContain('extra_dimension:AnnualDividendPaymentScheduleAxis');
        // 添付財務諸表の CF Fact も全件保存される。
        expect(storedFacts.find(fact => fact.name === 'NetCashProvidedByUsedInOperatingActivities' && fact.contextRef === 'InterimDuration')?.scaledValue)
            .toBe(163_568_000);

        const stored = db.getFinancialSummary(summary.documentId);
        expect(stored).toMatchObject({
            periodType: 'Q2',
            periodStart: '2026-04-01',
            periodEnd: '2026-09-30',
            priorPeriodStart: '2025-04-01',
            priorPeriodEnd: '2025-09-30',
            accountingStandard: 'J-GAAP',
            isConsolidated: true,
            current: {
                netSales: 7_071_000_000,
                operatingIncome: -325_000_000,
                ordinaryIncome: -363_000_000,
                netIncome: -303_000_000,
                netAssets: 7_712_000_000,
                totalAssets: 13_734_000_000,
                operatingCashFlow: 163_568_000,
                investingCashFlow: -544_345_000,
                cashAndEquivalents: 3_056_973_000,
                eps: -54.03,
            },
            prior: {
                netSales: 8_130_000_000,
                operatingIncome: -125_000_000,
                ordinaryIncome: -111_000_000,
                netIncome: -86_000_000,
                netAssets: 8_057_000_000,
                totalAssets: 14_443_000_000,
                operatingCashFlow: 160_249_000,
                investingCashFlow: -249_996_000,
                cashAndEquivalents: 3_808_553_000,
                eps: -15.39,
            },
        });
        expect(stored?.indicators.freeCashFlowCurrent).toBe(-380_777_000);
        expect(stored?.indicators.equityRatioCurrent).toBeCloseTo(7712 / 13734, 12);
    });

    it('同じ文書を再保存しても Fact を重複させない', async () => {
        const parsed = await parseXbrlZip(await readFile(fixture('ifrs-13750-2026-q2.zip')));
        const facts = resolveFacts(parsed);
        const summary = extractFinancialSummaryFromFacts(facts, { documentId: 'doc-1' });
        const document = {
            documentId: 'doc-1',
            xbrlUrl: null,
            status: 'parsed' as const,
            periodType: summary.periodType,
            periodStart: summary.periodStart,
            periodEnd: summary.periodEnd,
            accountingStandard: summary.accountingStandard,
            isConsolidated: summary.isConsolidated,
            isRevision: false,
            factCount: facts.length,
            error: null,
            createdAt: '2026-11-08T00:00:00.000Z',
            updatedAt: '2026-11-08T00:00:00.000Z',
        };
        db.saveXbrlExtraction({ document, facts, summary });
        db.saveXbrlExtraction({ document, facts, summary });
        expect(db.getFinancialFacts('doc-1')).toHaveLength(380);
        expect(db.getFinancialSummary('doc-1')?.current.netSales).toBe(23_491_000_000);
    });
});
