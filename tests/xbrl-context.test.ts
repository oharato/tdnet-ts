import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseXbrlZip } from '../src/xbrl/parser.js';
import { resolveContext, resolveContexts, resolveFacts } from '../src/xbrl/context.js';
import type { XbrlContext } from '../src/xbrl/parser.js';

function fixture(name: string): URL {
    return new URL(`./fixtures/xbrl/${name}`, import.meta.url);
}

function context(overrides: Partial<XbrlContext> & Pick<XbrlContext, 'id'>): XbrlContext {
    return {
        entityIdentifier: '12340',
        entityScheme: 'http://www.tse.or.jp/sicc',
        instant: null,
        startDate: null,
        endDate: null,
        dimensions: [],
        sourceFile: 'sample-ixbrl.htm',
        ...overrides,
    };
}

describe('TDnet Context resolution', () => {
    it('J-GAAP の当期・前期・YTD・連結・実績を解決する', async () => {
        const parsed = await parseXbrlZip(await readFile(fixture('jgaap-23760-2026-q2.zip')));
        const contexts = resolveContexts(parsed);

        expect(contexts.get('CurrentAccumulatedQ2Duration_ConsolidatedMember_ResultMember')).toMatchObject({
            periodRelation: 'current',
            periodKind: 'duration',
            periodStart: '2026-04-01',
            periodEnd: '2026-09-30',
            periodScope: 'ytd',
            quarter: 2,
            consolidation: 'consolidated',
            actualForecast: 'actual',
            status: 'resolved',
            unresolvedReasons: [],
        });

        expect(contexts.get('PriorAccumulatedQ2Duration_ConsolidatedMember_ResultMember')).toMatchObject({
            periodRelation: 'prior',
            periodStart: '2025-04-01',
            periodEnd: '2025-09-30',
            periodScope: 'ytd',
            quarter: 2,
            consolidation: 'consolidated',
            actualForecast: 'actual',
            status: 'resolved',
        });

        expect(contexts.get('CurrentAccumulatedQ2Instant_ConsolidatedMember_ResultMember')).toMatchObject({
            periodRelation: 'current',
            periodKind: 'instant',
            periodStart: null,
            periodEnd: '2026-09-30',
            periodScope: 'ytd',
            quarter: 2,
            consolidation: 'consolidated',
            actualForecast: 'actual',
            status: 'resolved',
        });
    });

    it('通期予想を当期・annual・連結・予想として解決する', async () => {
        const parsed = await parseXbrlZip(await readFile(fixture('ifrs-13750-2026-q2.zip')));
        const contexts = resolveContexts(parsed);

        expect(contexts.get('CurrentYearDuration_ConsolidatedMember_ForecastMember')).toMatchObject({
            periodRelation: 'current',
            periodKind: 'duration',
            periodStart: '2026-04-01',
            periodEnd: '2027-03-31',
            periodScope: 'annual',
            quarter: null,
            consolidation: 'consolidated',
            actualForecast: 'forecast',
            status: 'resolved',
        });

        const facts = resolveFacts(parsed);
        const revenue = facts.find(item =>
            item.concept === 'tse-ed-t:RevenueIFRS'
            && item.contextRef === 'CurrentAccumulatedQ2Duration_ConsolidatedMember_ResultMember');
        expect(revenue).toMatchObject({
            periodRelation: 'current',
            periodScope: 'ytd',
            quarter: 2,
            consolidation: 'consolidated',
            actualForecast: 'actual',
            contextStatus: 'resolved',
            scaledValue: 23_491_000_000,
        });
    });

    it('検索次元に使えない Context は推測せず unresolved にする', async () => {
        const parsed = await parseXbrlZip(await readFile(fixture('jgaap-23760-2026-q2.zip')));
        const contexts = resolveContexts(parsed);

        // 配当の AnnualDividendPaymentScheduleAxis は対象4次元の外。潰すと Q1/Q2/期末配当が衝突する。
        expect(contexts.get('CurrentYearDuration_AnnualMember_NonConsolidatedMember_ResultMember')).toMatchObject({
            consolidation: 'non_consolidated',
            actualForecast: 'actual',
            status: 'unresolved',
            unresolvedReasons: ['extra_dimension:AnnualDividendPaymentScheduleAxis'],
        });

        // セグメント軸も対象外。
        expect(contexts.get('InterimDuration_ReportableSegmentsMember')).toMatchObject({
            status: 'unresolved',
            unresolvedReasons: expect.arrayContaining(['extra_dimension:OperatingSegmentsAxis']),
        });

        // 連結/単体・実績/予想の軸を持たない添付資料の Context は、値を推測しない。
        expect(contexts.get('InterimDuration')).toMatchObject({
            periodRelation: 'current',
            periodKind: 'duration',
            periodScope: 'ytd',
            consolidation: 'unknown',
            actualForecast: 'unknown',
            status: 'unresolved',
            unresolvedReasons: expect.arrayContaining(['missing_consolidation_axis', 'missing_result_forecast_axis']),
        });

        expect(contexts.get('FilingDateInstant')).toMatchObject({
            periodRelation: 'filing',
            periodKind: 'instant',
            periodEnd: '2026-11-06',
            status: 'unresolved',
            unresolvedReasons: expect.arrayContaining(['unknown_period_scope', 'missing_consolidation_axis']),
        });
    });

    it('定義のない Context を参照する Fact も unresolved として残す', async () => {
        const parsed = await parseXbrlZip(await readFile(fixture('jgaap-23760-2026-q2.zip')));
        const withMissing = {
            ...parsed,
            facts: [...parsed.facts, {
                ...parsed.facts[0],
                contextRef: 'NoSuchContext',
            }],
        };
        const facts = resolveFacts(withMissing);
        const missing = facts.find(item => item.contextRef === 'NoSuchContext');
        expect(missing).toMatchObject({
            contextStatus: 'unresolved',
            periodRelation: 'unknown',
            periodKind: 'unknown',
            consolidation: 'unknown',
            actualForecast: 'unknown',
            unresolvedReasons: ['unknown_context'],
        });
        // 未解決でも Fact 自体は捨てない。
        expect(facts).toHaveLength(parsed.facts.length + 1);
    });

    it('TDnet の Context ID 命名を四半期単独・Q3・Prior2 まで解決する', () => {
        const current = context({
            id: 'CurrentQuarterDuration_ConsolidatedMember_ResultMember',
            startDate: '2026-07-01',
            endDate: '2026-09-30',
            dimensions: [
                { dimension: 'tse-ed-t:ConsolidatedNonconsolidatedAxis', member: 'tse-ed-t:ConsolidatedMember' },
                { dimension: 'tse-ed-t:ResultForecastAxis', member: 'tse-ed-t:ResultMember' },
            ],
        });
        expect(resolveContext(current)).toMatchObject({
            periodRelation: 'current',
            periodKind: 'duration',
            periodScope: 'quarter',
            quarter: null,
            consolidation: 'consolidated',
            actualForecast: 'actual',
            status: 'resolved',
        });

        const q3 = context({
            id: 'CurrentAccumulatedQ3Duration_ConsolidatedMember_ResultMember',
            startDate: '2026-04-01',
            endDate: '2026-12-31',
            dimensions: current.dimensions,
        });
        expect(resolveContext(q3)).toMatchObject({ periodScope: 'ytd', quarter: 3, status: 'resolved' });

        const prior2 = context({
            id: 'Prior2YearInstant_NonConsolidatedMember_ResultMember',
            instant: '2025-03-31',
            dimensions: [
                { dimension: 'tse-ed-t:ConsolidatedNonconsolidatedAxis', member: 'tse-ed-t:NonConsolidatedMember' },
                { dimension: 'tse-ed-t:ResultForecastAxis', member: 'tse-ed-t:ResultMember' },
            ],
        });
        expect(resolveContext(prior2)).toMatchObject({
            periodRelation: 'prior2',
            periodKind: 'instant',
            periodScope: 'annual',
            consolidation: 'non_consolidated',
            actualForecast: 'actual',
            status: 'resolved',
        });
    });

    it('不正な次元・期間は unresolved の理由を残す', () => {
        const unknownMember = context({
            id: 'CurrentAccumulatedQ2Duration_ConsolidatedMember_ResultMember',
            startDate: '2026-04-01',
            endDate: '2026-09-30',
            dimensions: [
                { dimension: 'tse-ed-t:ConsolidatedNonconsolidatedAxis', member: 'tse-ed-t:MysteryMember' },
                { dimension: 'tse-ed-t:ResultForecastAxis', member: 'tse-ed-t:ResultMember' },
            ],
        });
        expect(resolveContext(unknownMember)).toMatchObject({
            consolidation: 'unknown',
            status: 'unresolved',
            unresolvedReasons: expect.arrayContaining(['unknown_consolidation_member']),
        });

        const mismatch = context({
            id: 'CurrentAccumulatedQ2Duration_ConsolidatedMember_ResultMember',
            instant: '2026-09-30',
            dimensions: unknownMember.dimensions,
        });
        expect(resolveContext(mismatch)).toMatchObject({
            periodKind: 'instant',
            status: 'unresolved',
            unresolvedReasons: expect.arrayContaining(['period_kind_mismatch']),
        });
    });
});
