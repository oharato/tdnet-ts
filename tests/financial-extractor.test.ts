import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseXbrlZip } from '../src/xbrl/parser.js';
import { resolveFacts } from '../src/xbrl/context.js';
import { extractFinancialSummary, extractFinancialSummaryFromFacts } from '../src/financial/extractor.js';
import type { ParsedXbrl } from '../src/xbrl/parser.js';
import type { ResolvedFact } from '../src/xbrl/context.js';

function fixture(name: string): URL {
    return new URL(`./fixtures/xbrl/${name}`, import.meta.url);
}

async function parsedFixture(name: string): Promise<ParsedXbrl> {
    return parseXbrlZip(await readFile(fixture(name)));
}

describe('FinancialExtractor: 実在決算短信との突合', () => {
    it('J-GAAP の主要科目を PDF サマリーの公表値と一致させる', async () => {
        const parsed = await parsedFixture('jgaap-23760-2026-q2.zip');
        const summary = extractFinancialSummary(parsed, {
            documentId: '1290345',
            ticker: '2376',
            companyName: '株式会社サイネックス',
        });

        expect(summary).toMatchObject({
            periodType: 'Q2',
            periodStart: '2026-04-01',
            periodEnd: '2026-09-30',
            priorPeriodStart: '2025-04-01',
            priorPeriodEnd: '2025-09-30',
            accountingStandard: 'J-GAAP',
            isConsolidated: true,
        });

        // 令和9年3月期 第2四半期（中間期）決算短信〔日本基準〕（連結）1ページ。
        expect(summary.current).toMatchObject({
            netSales: 7_071_000_000,
            operatingIncome: -325_000_000,
            ordinaryIncome: -363_000_000,
            netIncome: -303_000_000,
            netAssets: 7_712_000_000,
            totalAssets: 13_734_000_000,
            eps: -54.03,
        });
        expect(summary.prior).toMatchObject({
            netSales: 8_130_000_000,
            operatingIncome: -125_000_000,
            ordinaryIncome: -111_000_000,
            netIncome: -86_000_000,
            netAssets: 8_057_000_000,
            totalAssets: 14_443_000_000,
            eps: -15.39,
        });

        // 同 PDF 8ページ「中間連結キャッシュ・フロー計算書」の当中間期・前中間期。
        expect(summary.current).toMatchObject({
            operatingCashFlow: 163_568_000,
            investingCashFlow: -544_345_000,
            cashAndEquivalents: 3_056_973_000,
        });
        expect(summary.prior).toMatchObject({
            operatingCashFlow: 160_249_000,
            investingCashFlow: -249_996_000,
            cashAndEquivalents: 3_808_553_000,
        });

        expect(summary.indicators.operatingMarginCurrent).toBeCloseTo(-325 / 7071, 12);
        expect(summary.indicators.operatingMarginPrior).toBeCloseTo(-125 / 8130, 12);
        expect(summary.indicators.operatingMarginDelta).toBeCloseTo(-325 / 7071 + 125 / 8130, 12);
        expect(summary.indicators.netSalesGrowthRate).toBeCloseTo((7071 - 8130) / 8130, 12);
        expect(summary.indicators.operatingIncomeGrowthRate).toBeCloseTo(-1.6, 12);
        expect(summary.indicators.freeCashFlowCurrent).toBe(-380_777_000);
        expect(summary.indicators.freeCashFlowPrior).toBe(-89_747_000);
        expect(summary.indicators.equityRatioCurrent).toBeCloseTo(7712 / 13734, 12);
        expect(summary.indicators.equityRatioPrior).toBeCloseTo(8057 / 14443, 12);
        expect(summary.indicators.roeCurrent).toBeCloseTo(-303 / 7712, 12);
        expect(summary.indicators.roaCurrent).toBeCloseTo(-303 / 13734, 12);
        expect(summary.indicators.operatingIncomePerEmployee).toBeUndefined();
    });

    it('IFRS の主要科目を PDF サマリーの公表値と一致させる', async () => {
        const parsed = await parsedFixture('ifrs-13750-2026-q2.zip');
        const summary = extractFinancialSummary(parsed, {
            documentId: '1290367',
            ticker: '1375',
            companyName: 'ユキグニファクトリー株式会社',
        });

        expect(summary).toMatchObject({
            periodType: 'Q2',
            periodStart: '2026-04-01',
            periodEnd: '2026-09-30',
            priorPeriodStart: '2025-04-01',
            priorPeriodEnd: '2025-09-30',
            accountingStandard: 'IFRS',
            isConsolidated: true,
        });

        // 2027年3月期 第2四半期（中間期）決算短信〔IFRS〕（連結）1ページ。
        // IFRS には経常利益がないため、税引前中間利益を ordinaryIncome に採用する。
        expect(summary.current).toMatchObject({
            netSales: 23_491_000_000,
            operatingIncome: 1_749_000_000,
            ordinaryIncome: 1_633_000_000,
            netIncome: 1_022_000_000,
            netAssets: 15_037_000_000,
            totalAssets: 37_638_000_000,
            eps: 25.63,
        });
        expect(summary.prior).toMatchObject({
            netSales: 19_773_000_000,
            operatingIncome: 431_000_000,
            ordinaryIncome: 377_000_000,
            netIncome: 81_000_000,
            netAssets: 14_770_000_000,
            totalAssets: 37_686_000_000,
            eps: 2.05,
        });

        // 同 PDF 10ページ「要約中間連結キャッシュ・フロー計算書」。
        expect(summary.current).toMatchObject({
            operatingCashFlow: -690_000_000,
            investingCashFlow: -1_622_000_000,
            cashAndEquivalents: 1_357_000_000,
        });
        expect(summary.prior).toMatchObject({
            operatingCashFlow: -2_646_000_000,
            investingCashFlow: -694_000_000,
            cashAndEquivalents: 898_000_000,
        });

        expect(summary.indicators.operatingMarginCurrent).toBeCloseTo(1749 / 23491, 12);
        expect(summary.indicators.operatingMarginPrior).toBeCloseTo(431 / 19773, 12);
        expect(summary.indicators.netSalesGrowthRate).toBeCloseTo((23491 - 19773) / 19773, 12);
        expect(summary.indicators.operatingIncomeGrowthRate).toBeCloseTo((1749 - 431) / 431, 12);
        expect(summary.indicators.freeCashFlowCurrent).toBe(-2_312_000_000);
        expect(summary.indicators.freeCashFlowPrior).toBe(-3_340_000_000);
        expect(summary.indicators.equityRatioCurrent).toBeCloseTo(15037 / 37638, 12);
        expect(summary.indicators.equityRatioPrior).toBeCloseTo(14770 / 37686, 12);
        expect(summary.indicators.roeCurrent).toBeCloseTo(1022 / 15037, 12);
        expect(summary.indicators.roaCurrent).toBeCloseTo(1022 / 37638, 12);

        expect(summary.current.dividendPerShareForecast).toBe(20);
        expect(summary.prior.dividendPerShare).toBe(23);
    });

    it('配当は年間行の実績・予想だけをサマリーに使う', async () => {
        const parsed = await parsedFixture('jgaap-23760-2026-q2.zip');
        const facts = resolveFacts(parsed);
        const summary = extractFinancialSummaryFromFacts(facts, { documentId: '1290345' });

        // 配当 Fact は AnnualDividendPaymentScheduleAxis 付きで未解決だが、
        // 年間行 (AnnualMember) の実績・予想だけはサマリーに使う。
        expect(facts.some(fact => fact.name === 'DividendPerShare')).toBe(true);
        // Q2 時点では当期の年間実績はない。四半期行 (0円) を年間実績にしない。
        expect(summary.current.dividendPerShare).toBeUndefined();
        expect(summary.current.dividendPerShareForecast).toBe(15);
        expect(summary.prior.dividendPerShare).toBe(15);

        const used = Object.values(summary.usedContextIds).flat();
        // 配当軸の Context は配当の抽出にだけ使い、他の科目の期間選択には使わない。
        expect(used.some(id => /AnnualMember|QuarterMember|YearEndMember/.test(id))).toBe(false);
        expect(used.some(id => /ReportableSegments|OperatingSegments/.test(id))).toBe(false);
        // 添付財務諸表の無次元 Context は CF・現金同等物のために使う。
        expect(used).toContain('InterimDuration');
        expect(used).toContain('Prior1InterimDuration');
    });

    it('年間配当は連結を優先し、Upper/Lower の予想は使わない', () => {
        const fact = (overrides: Partial<ResolvedFact> & Pick<ResolvedFact, 'name' | 'scaledValue'>): ResolvedFact => ({
            concept: `tse-ed-t:${overrides.name}`,
            name: overrides.name,
            namespace: 'tse-ed-t',
            contextRef: 'CurrentYearDuration_AnnualMember_ConsolidatedMember_ForecastMember',
            unitRef: 'JPYPerShares',
            decimals: '2',
            scale: 0,
            sign: 1,
            format: null,
            rawText: String(overrides.scaledValue),
            value: overrides.scaledValue,
            scaledValue: overrides.scaledValue,
            sourceFile: 'XBRLData/Summary/sample-ixbrl.htm',
            periodRelation: 'current',
            periodKind: 'duration',
            periodStart: '2026-04-01',
            periodEnd: '2027-03-31',
            periodScope: 'annual',
            quarter: null,
            consolidation: 'consolidated',
            actualForecast: 'forecast',
            contextStatus: 'unresolved',
            unresolvedReasons: ['extra_dimension:AnnualDividendPaymentScheduleAxis'],
            dimensions: [
                { dimension: 'tse-ed-t:AnnualDividendPaymentScheduleAxis', member: 'tse-ed-t:AnnualMember' },
                { dimension: 'tse-ed-t:ConsolidatedNonconsolidatedAxis', member: 'tse-ed-t:ConsolidatedMember' },
                { dimension: 'tse-ed-t:ResultForecastAxis', member: 'tse-ed-t:ForecastMember' },
            ],
            ...overrides,
        });
        const facts: ResolvedFact[] = [
            fact({ name: 'DividendPerShare', scaledValue: 30 }),
            fact({
                name: 'DividendPerShare',
                scaledValue: 20,
                consolidation: 'non_consolidated',
                dimensions: [
                    { dimension: 'tse-ed-t:AnnualDividendPaymentScheduleAxis', member: 'tse-ed-t:AnnualMember' },
                    { dimension: 'tse-ed-t:ConsolidatedNonconsolidatedAxis', member: 'tse-ed-t:NonConsolidatedMember' },
                    { dimension: 'tse-ed-t:ResultForecastAxis', member: 'tse-ed-t:ForecastMember' },
                ],
            }),
            fact({
                name: 'DividendPerShare',
                scaledValue: 99,
                dimensions: [
                    { dimension: 'tse-ed-t:AnnualDividendPaymentScheduleAxis', member: 'tse-ed-t:AnnualMember' },
                    { dimension: 'tse-ed-t:ConsolidatedNonconsolidatedAxis', member: 'tse-ed-t:ConsolidatedMember' },
                    { dimension: 'tse-ed-t:ResultForecastAxis', member: 'tse-ed-t:UpperMember' },
                ],
            }),
            fact({
                name: 'DividendPerShare',
                scaledValue: 40,
                actualForecast: 'actual',
                dimensions: [
                    { dimension: 'tse-ed-t:AnnualDividendPaymentScheduleAxis', member: 'tse-ed-t:AnnualMember' },
                    { dimension: 'tse-ed-t:ConsolidatedNonconsolidatedAxis', member: 'tse-ed-t:ConsolidatedMember' },
                    { dimension: 'tse-ed-t:ResultForecastAxis', member: 'tse-ed-t:ResultMember' },
                ],
            }),
            fact({
                name: 'DividendPerShare',
                scaledValue: 35,
                actualForecast: 'actual',
                periodRelation: 'prior',
                dimensions: [
                    { dimension: 'tse-ed-t:AnnualDividendPaymentScheduleAxis', member: 'tse-ed-t:AnnualMember' },
                    { dimension: 'tse-ed-t:ConsolidatedNonconsolidatedAxis', member: 'tse-ed-t:ConsolidatedMember' },
                    { dimension: 'tse-ed-t:ResultForecastAxis', member: 'tse-ed-t:ResultMember' },
                ],
            }),
        ];

        const summary = extractFinancialSummaryFromFacts(facts, { documentId: 'synthetic' });
        expect(summary.current.dividendPerShareForecast).toBe(30);
        expect(summary.current.dividendPerShare).toBe(40);
        expect(summary.prior.dividendPerShare).toBe(35);
    });

    it('BPS・1株当たり配当金・従業員数と従業員1人当たり営業利益を抽出する', () => {
        const fact = (overrides: Partial<ResolvedFact> & Pick<ResolvedFact, 'name' | 'scaledValue' | 'periodKind'>): ResolvedFact => ({
            concept: `tse-ed-t:${overrides.name}`,
            name: overrides.name,
            namespace: 'tse-ed-t',
            contextRef: overrides.contextRef ?? 'CurrentAccumulatedQ2Duration_ConsolidatedMember_ResultMember',
            unitRef: 'JPY',
            decimals: null,
            scale: 0,
            sign: 1,
            format: null,
            rawText: String(overrides.scaledValue),
            value: overrides.scaledValue,
            scaledValue: overrides.scaledValue,
            sourceFile: 'XBRLData/Summary/sample-ixbrl.htm',
            periodRelation: 'current',
            periodKind: overrides.periodKind,
            periodStart: overrides.periodKind === 'duration' ? '2026-04-01' : null,
            periodEnd: '2026-09-30',
            periodScope: 'ytd',
            quarter: 2,
            consolidation: 'consolidated',
            actualForecast: 'actual',
            contextStatus: 'resolved',
            unresolvedReasons: [],
            dimensions: [],
            ...overrides,
        });
        const facts: ResolvedFact[] = [
            fact({ name: 'NetSales', scaledValue: 1_000_000, periodKind: 'duration' }),
            fact({ name: 'OperatingIncome', scaledValue: 100_000, periodKind: 'duration' }),
            fact({ name: 'NumberOfEmployees', scaledValue: 10, periodKind: 'instant' }),
            fact({ name: 'NetAssetsPerShare', scaledValue: 500, periodKind: 'instant' }),
            fact({ name: 'DividendPerShare', scaledValue: 20, periodKind: 'duration' }),
        ];

        const summary = extractFinancialSummaryFromFacts(facts, { documentId: 'synthetic' });
        expect(summary.current).toMatchObject({
            bps: 500,
            dividendPerShare: 20,
            numberOfEmployees: 10,
        });
        expect(summary.indicators.operatingIncomePerEmployee).toBe(10_000);
    });

    it('連結 Fact がなければ単体 Fact にフォールバックする', () => {
        const base: ResolvedFact = {
            concept: 'tse-ed-t:NetSales',
            name: 'NetSales',
            namespace: 'tse-ed-t',
            contextRef: 'CurrentAccumulatedQ2Duration_NonConsolidatedMember_ResultMember',
            unitRef: 'JPY',
            decimals: '-6',
            scale: 6,
            sign: 1,
            format: 'ixt:numdotdecimal',
            rawText: '1,000',
            value: 1000,
            scaledValue: 1_000_000_000,
            sourceFile: 'XBRLData/Summary/sample-ixbrl.htm',
            periodRelation: 'current',
            periodKind: 'duration',
            periodStart: '2026-04-01',
            periodEnd: '2026-09-30',
            periodScope: 'ytd',
            quarter: 2,
            consolidation: 'non_consolidated',
            actualForecast: 'actual',
            contextStatus: 'resolved',
            unresolvedReasons: [],
            dimensions: [
                { dimension: 'tse-ed-t:ConsolidatedNonconsolidatedAxis', member: 'tse-ed-t:NonConsolidatedMember' },
                { dimension: 'tse-ed-t:ResultForecastAxis', member: 'tse-ed-t:ResultMember' },
            ],
        };
        const summary = extractFinancialSummaryFromFacts([base], { documentId: 'synthetic' });
        expect(summary.isConsolidated).toBe(false);
        expect(summary.current.netSales).toBe(1_000_000_000);
    });
});
