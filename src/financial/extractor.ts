import type { ParsedXbrl } from '../xbrl/parser.js';
import { resolveFacts } from '../xbrl/context.js';
import type { Consolidation, ResolvedFact } from '../xbrl/context.js';

export type AccountingStandard = 'J-GAAP' | 'IFRS' | 'unknown';
export type FinancialPeriodType = 'Q1' | 'Q2' | 'Q3' | 'FY' | 'unknown';

/** 設計書の固定科目セット。未取得の科目は undefined のままにする。 */
export interface FinancialMetrics {
    netSales?: number;
    operatingIncome?: number;
    /** IFRS では税引前利益を経常利益の代替として使う。 */
    ordinaryIncome?: number;
    netIncome?: number;
    netAssets?: number;
    totalAssets?: number;
    operatingCashFlow?: number;
    investingCashFlow?: number;
    cashAndEquivalents?: number;
    eps?: number;
    bps?: number;
    dividendPerShare?: number;
    numberOfEmployees?: number;
}

export interface FinancialIndicators {
    /** 営業利益率 (営業利益 / 売上高)。 */
    operatingMarginCurrent?: number;
    operatingMarginPrior?: number;
    /** 前年比ポイント差。比率同士の差 (0.01 = 1ポイント)。 */
    operatingMarginDelta?: number;
    netSalesGrowthRate?: number;
    operatingIncomeGrowthRate?: number;
    freeCashFlowCurrent?: number;
    freeCashFlowPrior?: number;
    equityRatioCurrent?: number;
    equityRatioPrior?: number;
    roeCurrent?: number;
    roePrior?: number;
    roaCurrent?: number;
    roaPrior?: number;
    operatingIncomePerEmployee?: number;
}

export interface FinancialExtractionMetadata {
    documentId: string;
    ticker?: string | null;
    companyName?: string | null;
    title?: string | null;
    publishedAt?: string | null;
    xbrlUrl?: string | null;
    isRevision?: boolean;
    /** 指定した場合はタクソノミーからの推定より優先する。 */
    accountingStandard?: AccountingStandard;
}

export interface ExtractedFinancialSummary {
    documentId: string;
    ticker: string | null;
    companyName: string | null;
    title: string | null;
    publishedAt: string | null;
    xbrlUrl: string | null;
    periodType: FinancialPeriodType;
    periodStart: string | null;
    periodEnd: string | null;
    priorPeriodStart: string | null;
    priorPeriodEnd: string | null;
    accountingStandard: AccountingStandard;
    isConsolidated: boolean | null;
    isRevision: boolean;
    current: FinancialMetrics;
    prior: FinancialMetrics;
    indicators: FinancialIndicators;
    /** サマリー抽出に実際に使った Context ID。配当・セグメント次元の除外確認用。 */
    usedContextIds: {
        currentDuration: string[];
        priorDuration: string[];
        currentInstant: string[];
        priorFiscalYearInstant: string[];
        priorPeriodInstant: string[];
    };
}

type MetricKey = keyof FinancialMetrics;

/**
 * TDnet 決算短信のサマリー (tse-ed-t) と添付財務諸表 (jppfs_cor / jpigp_cor) の
 * ローカル名マッピング。上から優先する。
 */
const METRIC_TAGS: Record<MetricKey, string[]> = {
    netSales: [
        'NetSales',
        'RevenueIFRS',
        'Revenue2IFRS',
        'Revenue',
        'OperatingRevenue1',
        'NetSalesSummaryOfBusinessResults',
        'RevenueIFRSSummaryOfBusinessResults',
    ],
    operatingIncome: [
        'OperatingIncome',
        'OperatingIncomeIFRS',
        'OperatingProfit',
        'OperatingProfitIFRS',
        'OperatingProfitLossIFRS',
        'OperatingIncomeSummaryOfBusinessResults',
        'OperatingIncomeIFRSSummaryOfBusinessResults',
        'OperatingProfitIFRSSummaryOfBusinessResults',
    ],
    ordinaryIncome: [
        'OrdinaryIncome',
        'OrdinaryIncomeSummaryOfBusinessResults',
        // IFRS には経常利益がないため、税引前利益を代替にする。
        'ProfitBeforeTaxIFRS',
        'ProfitLossBeforeTaxIFRS',
    ],
    netIncome: [
        'ProfitAttributableToOwnersOfParent',
        'ProfitAttributableToOwnersOfParentIFRS',
        'NetIncome',
        'NetIncomeSummaryOfBusinessResults',
        'ProfitLoss',
        'ProfitIFRS',
        'ProfitLossIFRS',
        'ProfitLossAttributableToOwnersOfParentIFRS',
    ],
    netAssets: [
        'NetAssets',
        'OwnersEquity',
        'ShareholdersEquity',
        'EquityAttributableToOwnersOfParentIFRS',
        'TotalEquityIFRS',
        'EquityIFRS',
        'NetAssetsSummaryOfBusinessResults',
        'EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults',
    ],
    totalAssets: [
        'TotalAssets',
        'TotalAssetsIFRS',
        'Assets',
        'AssetsIFRS',
        'TotalAssetsSummaryOfBusinessResults',
        'TotalAssetsIFRSSummaryOfBusinessResults',
    ],
    operatingCashFlow: [
        'NetCashProvidedByUsedInOperatingActivities',
        'NetCashProvidedByUsedInOperatingActivitiesIFRS',
        'CashFlowsFromUsedInOperatingActivitiesIFRS',
        'OperatingCashFlow',
        'NetCashProvidedByUsedInOperatingActivitiesSummaryOfBusinessResults',
        'CashFlowsFromUsedInOperatingActivitiesIFRSSummaryOfBusinessResults',
    ],
    investingCashFlow: [
        'NetCashProvidedByUsedInInvestingActivities',
        'NetCashProvidedByUsedInInvestmentActivities',
        'NetCashProvidedByUsedInInvestingActivitiesIFRS',
        'CashFlowsFromUsedInInvestingActivitiesIFRS',
        'NetCashProvidedByUsedInInvestingActivitiesSummaryOfBusinessResults',
        'CashFlowsFromUsedInInvestingActivitiesIFRSSummaryOfBusinessResults',
    ],
    cashAndEquivalents: [
        'CashAndCashEquivalents',
        'CashAndCashEquivalentsIFRS',
        'CashAndDeposits',
        'CashAndCashEquivalentsSummaryOfBusinessResults',
        'CashAndCashEquivalentsIFRSSummaryOfBusinessResults',
    ],
    eps: [
        'NetIncomePerShare',
        'BasicEarningsPerShareIFRS',
        'BasicEarningsLossPerShareIFRS',
        'BasicEarningsPerShare',
        'BasicEarningsLossPerShare',
        'EarningsPerShare',
        'BasicEarningsLossPerShareSummaryOfBusinessResults',
        'BasicEarningsLossPerShareIFRSSummaryOfBusinessResults',
    ],
    bps: [
        'NetAssetsPerShare',
        'NetAssetsPerShareIFRS',
        'EquityPerShare',
        'BPS',
        'NetAssetsPerShareSummaryOfBusinessResults',
        'NetAssetsPerShareIFRSSummaryOfBusinessResults',
    ],
    dividendPerShare: [
        'DividendPerShare',
        'DividendPaidPerShare',
        'CashDividendsPaidPerShare',
        'DividendPerShareSummaryOfBusinessResults',
        'DividendPaidPerShareSummaryOfBusinessResults',
        'CashDividendsPaidPerShareSummaryOfBusinessResults',
    ],
    numberOfEmployees: [
        'NumberOfEmployees',
        'NumberOfEmployeesSummaryOfBusinessResults',
        'Employees',
        'NumberOfEmployeesAtEndOfPeriod',
    ],
};

const IFRS_CONCEPTS = new Set([
    'RevenueIFRS',
    'OperatingIncomeIFRS',
    'ProfitBeforeTaxIFRS',
    'ProfitIFRS',
    'ProfitAttributableToOwnersOfParentIFRS',
    'TotalAssetsIFRS',
    'EquityAttributableToOwnersOfParentIFRS',
    'TotalEquityIFRS',
    'BasicEarningsPerShareIFRS',
    'BasicEarningsLossPerShareIFRS',
    'NetCashProvidedByUsedInOperatingActivitiesIFRS',
    'NetCashProvidedByUsedInInvestingActivitiesIFRS',
    'CashAndCashEquivalentsIFRS',
]);

/** 4つの対象次元以外の軸 (配当・セグメント等) が付いた Fact はサマリーに使わない。 */
function hasOnlyTargetDimensions(fact: ResolvedFact): boolean {
    return !fact.unresolvedReasons.some(reason =>
        reason.startsWith('extra_dimension:')
        || reason.startsWith('typed_dimension:')
        || reason.startsWith('duplicate_')
        || reason.startsWith('unknown_')
        || reason.startsWith('dimension_id_conflict:')
        || reason === 'period_kind_mismatch'
        || reason === 'invalid_period'
        || reason === 'unknown_period_relation'
        || reason === 'unknown_period_scope');
}

/**
 * 添付財務諸表の Context は連結/実績軸を持たないため stage 2 では unresolved になる。
 * ただし無次元の添付 Context は実際の財務諸表であり、期間軸は解決済みなので、
 * 連結区分の補完対象としてサマリー抽出にだけ使う。
 */
function isAttachmentStatementFact(fact: ResolvedFact): boolean {
    return /(?:^|\/)Attachment\//.test(fact.sourceFile)
        && fact.dimensions.length === 0
        && fact.unresolvedReasons.every(reason =>
            reason === 'missing_consolidation_axis' || reason === 'missing_result_forecast_axis');
}

function isSummaryEligible(fact: ResolvedFact): boolean {
    if (fact.periodRelation !== 'current' && fact.periodRelation !== 'prior') return false;
    if (fact.periodKind !== 'duration' && fact.periodKind !== 'instant') return false;
    if (!hasOnlyTargetDimensions(fact)) return false;
    if (fact.actualForecast !== 'actual' && !isAttachmentStatementFact(fact)) return false;
    if (fact.periodKind === 'duration') {
        if (fact.periodScope !== 'ytd' && fact.periodScope !== 'annual') return false;
        return fact.periodStart !== null && fact.periodEnd !== null;
    }
    return fact.periodEnd !== null;
}

function isKeyMetric(fact: ResolvedFact): boolean {
    return ['netSales', 'operatingIncome', 'ordinaryIncome', 'netIncome', 'eps']
        .some(key => METRIC_TAGS[key as MetricKey].includes(fact.name));
}

function chooseConsolidation(facts: ResolvedFact[]): Consolidation {
    if (facts.some(fact => fact.consolidation === 'consolidated')) return 'consolidated';
    if (facts.some(fact => fact.consolidation === 'non_consolidated')) return 'non_consolidated';
    return 'unknown';
}

function consolidationOrder(basis: Consolidation): Consolidation[] {
    if (basis === 'non_consolidated') return ['non_consolidated', 'consolidated', 'unknown'];
    return ['consolidated', 'non_consolidated', 'unknown'];
}

function chooseCurrentPeriodEnd(facts: ResolvedFact[]): string | null {
    const counts = new Map<string, { key: number; total: number }>();
    for (const fact of facts) {
        if (!fact.periodEnd) continue;
        const entry = counts.get(fact.periodEnd) ?? { key: 0, total: 0 };
        entry.total++;
        if (isKeyMetric(fact)) entry.key++;
        counts.set(fact.periodEnd, entry);
    }
    let best: string | null = null;
    let bestEntry = { key: -1, total: -1 };
    for (const [periodEnd, entry] of counts) {
        if (entry.key > bestEntry.key || (entry.key === bestEntry.key && entry.total > bestEntry.total)) {
            best = periodEnd;
            bestEntry = entry;
        }
    }
    return best;
}

function subtractOneYear(value: string | null): string | null {
    if (value === null) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]) - 1;
    const month = Number(match[2]);
    const day = Number(match[3]);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCMonth() !== month - 1) {
        // 2月29日などは前年同月末に丸める。
        candidate.setUTCDate(0);
    }
    return candidate.toISOString().slice(0, 10);
}

function closestPeriodEnd(facts: ResolvedFact[], target: string | null): string | null {
    if (target === null) return null;
    const ends = [...new Set(facts.map(fact => fact.periodEnd).filter((value): value is string => value !== null))];
    if (ends.length === 0) return null;
    if (ends.includes(target)) return target;
    const targetTime = Date.parse(`${target}T00:00:00Z`);
    let best: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const end of ends) {
        const distance = Math.abs(Date.parse(`${end}T00:00:00Z`) - targetTime);
        if (distance < bestDistance) {
            best = end;
            bestDistance = distance;
        }
    }
    return best;
}

function priorFiscalYearEnd(facts: ResolvedFact[], boundary: string | null): string | null {
    if (boundary === null) return null;
    const ends = [...new Set(facts.map(fact => fact.periodEnd).filter((value): value is string => value !== null))]
        .filter(end => end < boundary)
        .sort();
    return ends.length ? ends[ends.length - 1] : null;
}

function factsAt(facts: ResolvedFact[], periodEnd: string | null): ResolvedFact[] {
    return periodEnd === null ? [] : facts.filter(fact => fact.periodEnd === periodEnd);
}

function findMetric(
    facts: ResolvedFact[],
    key: MetricKey,
    order: Consolidation[],
): number | undefined {
    for (const consolidation of order) {
        for (const tag of METRIC_TAGS[key]) {
            const fact = facts.find(item => item.name === tag && item.consolidation === consolidation);
            if (fact) return fact.scaledValue;
        }
    }
    return undefined;
}

function ratio(numerator: number | undefined, denominator: number | undefined, positiveDenominator = false): number | undefined {
    if (numerator === undefined || denominator === undefined) return undefined;
    if (positiveDenominator ? denominator <= 0 : denominator === 0) return undefined;
    return numerator / denominator;
}

function growth(current: number | undefined, prior: number | undefined): number | undefined {
    if (current === undefined || prior === undefined || prior === 0) return undefined;
    return (current - prior) / Math.abs(prior);
}

function sum(left: number | undefined, right: number | undefined): number | undefined {
    return left === undefined || right === undefined ? undefined : left + right;
}

function extractMetrics(facts: ResolvedFact[], order: Consolidation[]): FinancialMetrics {
    return {
        netSales: findMetric(facts, 'netSales', order),
        operatingIncome: findMetric(facts, 'operatingIncome', order),
        ordinaryIncome: findMetric(facts, 'ordinaryIncome', order),
        netIncome: findMetric(facts, 'netIncome', order),
        netAssets: findMetric(facts, 'netAssets', order),
        totalAssets: findMetric(facts, 'totalAssets', order),
        operatingCashFlow: findMetric(facts, 'operatingCashFlow', order),
        investingCashFlow: findMetric(facts, 'investingCashFlow', order),
        cashAndEquivalents: findMetric(facts, 'cashAndEquivalents', order),
        eps: findMetric(facts, 'eps', order),
        bps: findMetric(facts, 'bps', order),
        dividendPerShare: findMetric(facts, 'dividendPerShare', order),
        numberOfEmployees: findMetric(facts, 'numberOfEmployees', order),
    };
}

function inferAccountingStandard(facts: ResolvedFact[], override?: AccountingStandard): AccountingStandard {
    if (override) return override;
    if (facts.some(fact => fact.namespace === 'jpigp_cor' || IFRS_CONCEPTS.has(fact.name))) return 'IFRS';
    if (facts.length) return 'J-GAAP';
    return 'unknown';
}

function inferPeriodType(durationFacts: ResolvedFact[]): FinancialPeriodType {
    const scopes = new Set(durationFacts.map(fact => fact.periodScope));
    if (scopes.has('annual')) return 'FY';
    const quarters = durationFacts.map(fact => fact.quarter).filter((value): value is number => value !== null);
    if (quarters.length) {
        const quarter = Math.min(...quarters);
        if (quarter >= 1 && quarter <= 3) return `Q${quarter}` as FinancialPeriodType;
    }
    if (scopes.has('quarter')) return 'Q1';
    return 'unknown';
}

function contextIds(facts: ResolvedFact[]): string[] {
    return [...new Set(facts.map(fact => fact.contextRef))].sort();
}

/** 解決済み Fact 群から、設計書の固定科目セットと指標を抽出する。 */
export function extractFinancialSummaryFromFacts(
    facts: ResolvedFact[],
    metadata: FinancialExtractionMetadata,
): ExtractedFinancialSummary {
    const eligible = facts.filter(isSummaryEligible);
    const basis = chooseConsolidation(eligible);
    const order = consolidationOrder(basis);

    const currentDurationFacts = eligible.filter(fact =>
        fact.periodRelation === 'current' && fact.periodKind === 'duration');
    const currentPeriodEnd = chooseCurrentPeriodEnd(currentDurationFacts);
    const currentDurations = factsAt(currentDurationFacts, currentPeriodEnd);
    const currentPeriodStart = currentDurations.find(fact => fact.periodStart !== null)?.periodStart ?? null;

    const priorDurationFacts = eligible.filter(fact =>
        fact.periodRelation === 'prior' && fact.periodKind === 'duration');
    const priorPeriodEnd = closestPeriodEnd(priorDurationFacts, subtractOneYear(currentPeriodEnd));
    const priorDurations = factsAt(priorDurationFacts, priorPeriodEnd);
    const priorPeriodStart = priorDurations.find(fact => fact.periodStart !== null)?.periodStart ?? null;

    const currentInstantFacts = eligible.filter(fact =>
        fact.periodRelation === 'current' && fact.periodKind === 'instant');
    const currentInstantEnd = closestPeriodEnd(currentInstantFacts, currentPeriodEnd);
    const currentInstants = factsAt(currentInstantFacts, currentInstantEnd);

    const priorInstantFacts = eligible.filter(fact =>
        fact.periodRelation === 'prior' && fact.periodKind === 'instant');
    const priorFiscalInstantEnd = priorFiscalYearEnd(priorInstantFacts, currentPeriodStart ?? currentPeriodEnd);
    const priorFiscalInstants = factsAt(priorInstantFacts, priorFiscalInstantEnd);
    const priorPeriodInstantEnd = closestPeriodEnd(priorInstantFacts, priorPeriodEnd);
    const priorPeriodInstants = factsAt(priorInstantFacts, priorPeriodInstantEnd);

    const currentDuration = extractMetrics(currentDurations, order);
    const priorDuration = extractMetrics(priorDurations, order);
    const currentInstant = extractMetrics(currentInstants, order);
    const priorFiscalInstant = extractMetrics(priorFiscalInstants, order);
    const priorPeriodInstant = extractMetrics(priorPeriodInstants, order);

    const current: FinancialMetrics = {
        netSales: currentDuration.netSales,
        operatingIncome: currentDuration.operatingIncome,
        ordinaryIncome: currentDuration.ordinaryIncome,
        netIncome: currentDuration.netIncome,
        netAssets: currentInstant.netAssets,
        totalAssets: currentInstant.totalAssets,
        operatingCashFlow: currentDuration.operatingCashFlow,
        investingCashFlow: currentDuration.investingCashFlow,
        cashAndEquivalents: currentInstant.cashAndEquivalents,
        eps: currentDuration.eps,
        bps: currentInstant.bps,
        dividendPerShare: currentDuration.dividendPerShare,
        numberOfEmployees: currentInstant.numberOfEmployees,
    };
    const prior: FinancialMetrics = {
        netSales: priorDuration.netSales,
        operatingIncome: priorDuration.operatingIncome,
        ordinaryIncome: priorDuration.ordinaryIncome,
        netIncome: priorDuration.netIncome,
        netAssets: priorFiscalInstant.netAssets ?? priorPeriodInstant.netAssets,
        totalAssets: priorFiscalInstant.totalAssets ?? priorPeriodInstant.totalAssets,
        operatingCashFlow: priorDuration.operatingCashFlow,
        investingCashFlow: priorDuration.investingCashFlow,
        // 現金同等物は CF 計算書の期間末 (前年同期末) を優先する。
        cashAndEquivalents: priorPeriodInstant.cashAndEquivalents ?? priorFiscalInstant.cashAndEquivalents,
        eps: priorDuration.eps,
        bps: priorFiscalInstant.bps ?? priorPeriodInstant.bps,
        dividendPerShare: priorDuration.dividendPerShare,
        numberOfEmployees: priorFiscalInstant.numberOfEmployees ?? priorPeriodInstant.numberOfEmployees,
    };

    const operatingMarginCurrent = ratio(current.operatingIncome, current.netSales);
    const operatingMarginPrior = ratio(prior.operatingIncome, prior.netSales);
    const indicators: FinancialIndicators = {
        operatingMarginCurrent,
        operatingMarginPrior,
        operatingMarginDelta: operatingMarginCurrent !== undefined && operatingMarginPrior !== undefined
            ? operatingMarginCurrent - operatingMarginPrior
            : undefined,
        netSalesGrowthRate: growth(current.netSales, prior.netSales),
        operatingIncomeGrowthRate: growth(current.operatingIncome, prior.operatingIncome),
        freeCashFlowCurrent: sum(current.operatingCashFlow, current.investingCashFlow),
        freeCashFlowPrior: sum(prior.operatingCashFlow, prior.investingCashFlow),
        equityRatioCurrent: ratio(current.netAssets, current.totalAssets, true),
        equityRatioPrior: ratio(prior.netAssets, prior.totalAssets, true),
        roeCurrent: ratio(current.netIncome, current.netAssets, true),
        roePrior: ratio(prior.netIncome, prior.netAssets, true),
        roaCurrent: ratio(current.netIncome, current.totalAssets, true),
        roaPrior: ratio(prior.netIncome, prior.totalAssets, true),
        operatingIncomePerEmployee: current.numberOfEmployees !== undefined && current.numberOfEmployees > 0
            ? ratio(current.operatingIncome, current.numberOfEmployees)
            : undefined,
    };

    const periodType = inferPeriodType(currentDurations);

    return {
        documentId: metadata.documentId,
        ticker: metadata.ticker ?? null,
        companyName: metadata.companyName ?? null,
        title: metadata.title ?? null,
        publishedAt: metadata.publishedAt ?? null,
        xbrlUrl: metadata.xbrlUrl ?? null,
        periodType,
        periodStart: currentPeriodStart,
        periodEnd: currentPeriodEnd,
        priorPeriodStart,
        priorPeriodEnd,
        accountingStandard: inferAccountingStandard(facts, metadata.accountingStandard),
        isConsolidated: basis === 'consolidated' ? true : basis === 'non_consolidated' ? false : null,
        isRevision: metadata.isRevision ?? false,
        current,
        prior,
        indicators,
        usedContextIds: {
            currentDuration: contextIds(currentDurations),
            priorDuration: contextIds(priorDurations),
            currentInstant: contextIds(currentInstants),
            priorFiscalYearInstant: contextIds(priorFiscalInstants),
            priorPeriodInstant: contextIds(priorPeriodInstants),
        },
    };
}

/** iXBRL の解析結果から Context を解決し、サマリーを抽出する。 */
export function extractFinancialSummary(
    parsed: ParsedXbrl,
    metadata: FinancialExtractionMetadata,
): ExtractedFinancialSummary {
    return extractFinancialSummaryFromFacts(resolveFacts(parsed), metadata);
}
