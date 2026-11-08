import type { NumericFact, ParsedXbrl, XbrlContext, XbrlDimension } from './parser.js';

export type PeriodRelation = 'current' | 'prior' | 'prior2' | 'filing' | 'unknown';
export type PeriodKind = 'instant' | 'duration' | 'unknown';
export type PeriodScope = 'annual' | 'ytd' | 'quarter' | 'unknown';
export type Consolidation = 'consolidated' | 'non_consolidated' | 'unknown';
export type ActualForecast = 'actual' | 'forecast' | 'unknown';
export type ContextResolutionStatus = 'resolved' | 'unresolved';

export interface ResolvedContext {
    id: string;
    periodRelation: PeriodRelation;
    periodKind: PeriodKind;
    /** instant の場合は null */
    periodStart: string | null;
    /** instant の場合は instant 日 */
    periodEnd: string | null;
    periodScope: PeriodScope;
    /** 識別できた四半期番号 (1〜4)。通期・期間不明時は null */
    quarter: number | null;
    consolidation: Consolidation;
    actualForecast: ActualForecast;
    status: ContextResolutionStatus;
    unresolvedReasons: string[];
    dimensions: XbrlDimension[];
}

export interface ResolvedFact extends NumericFact {
    periodRelation: PeriodRelation;
    periodKind: PeriodKind;
    periodStart: string | null;
    periodEnd: string | null;
    periodScope: PeriodScope;
    quarter: number | null;
    consolidation: Consolidation;
    actualForecast: ActualForecast;
    contextStatus: ContextResolutionStatus;
    unresolvedReasons: string[];
    dimensions: XbrlDimension[];
}

interface IdDimensions {
    periodRelation: PeriodRelation;
    periodKind: PeriodKind;
    periodScope: PeriodScope;
    quarter: number | null;
}

function axisLocalName(dimension: string): string {
    const index = dimension.indexOf(':');
    return index === -1 ? dimension : dimension.slice(index + 1);
}

function memberLocalName(member: string): string {
    const index = member.indexOf(':');
    return index === -1 ? member : member.slice(index + 1);
}

/** 次元軸の値が重複していないか確認する。 */
function dimensionsByAxis(dimensions: XbrlDimension[], axis: string): XbrlDimension[] {
    return dimensions.filter(dimension => axisLocalName(dimension.dimension) === axis);
}

function parseIdDimensions(id: string): IdDimensions {
    const base = id.split('_')[0];

    if (base === 'FilingDateInstant') {
        return { periodRelation: 'filing', periodKind: 'instant', periodScope: 'unknown', quarter: null };
    }
    if (base === 'InterimDuration' || base === 'InterimInstant') {
        return {
            periodRelation: 'current',
            periodKind: base === 'InterimDuration' ? 'duration' : 'instant',
            periodScope: 'ytd',
            quarter: null,
        };
    }

    const interim = /^(Current|Prior1|Prior2|Prior)Interim(Duration|Instant)$/.exec(base);
    if (interim) {
        return {
            periodRelation: relationFromPrefix(interim[1]),
            periodKind: interim[2] === 'Duration' ? 'duration' : 'instant',
            periodScope: 'ytd',
            quarter: null,
        };
    }

    const match = /^(Current|Prior1|Prior2|Prior)(Year|AccumulatedQ([1-4])|Quarter(?:Q?([1-4]))?)(Duration|Instant)$/.exec(base);
    if (!match) {
        return { periodRelation: 'unknown', periodKind: 'unknown', periodScope: 'unknown', quarter: null };
    }

    const token = match[2];
    let periodScope: PeriodScope;
    let quarter: number | null = null;
    if (token === 'Year') {
        periodScope = 'annual';
    } else if (token.startsWith('AccumulatedQ')) {
        periodScope = 'ytd';
        quarter = Number(match[3]);
    } else {
        periodScope = 'quarter';
        quarter = match[4] ? Number(match[4]) : null;
    }

    return {
        periodRelation: relationFromPrefix(match[1]),
        periodKind: match[5] === 'Duration' ? 'duration' : 'instant',
        periodScope,
        quarter,
    };
}

function relationFromPrefix(prefix: string): PeriodRelation {
    if (prefix === 'Current') return 'current';
    if (prefix === 'Prior2') return 'prior2';
    if (prefix === 'Prior' || prefix === 'Prior1') return 'prior';
    return 'unknown';
}

function fallbackMember(id: string, members: string[]): string | null {
    const tokens = id.split('_').map(memberLocalName);
    for (const member of members) {
        if (tokens.includes(member)) return member;
    }
    return null;
}

function resolveConsolidation(context: XbrlContext, reasons: string[]): Consolidation {
    const axes = dimensionsByAxis(context.dimensions, 'ConsolidatedNonconsolidatedAxis');
    if (axes.length === 0) {
        const idMember = fallbackMember(context.id, ['ConsolidatedMember', 'NonConsolidatedMember']);
        if (idMember === 'ConsolidatedMember') return 'consolidated';
        if (idMember === 'NonConsolidatedMember') return 'non_consolidated';
        reasons.push('missing_consolidation_axis');
        return 'unknown';
    }
    if (axes.length > 1) {
        reasons.push('duplicate_consolidation_axis');
        return 'unknown';
    }
    if (axes[0].member === null) {
        reasons.push('typed_dimension:ConsolidatedNonconsolidatedAxis');
        return 'unknown';
    }

    const member = memberLocalName(axes[0].member);
    const result: Consolidation = member === 'ConsolidatedMember' ? 'consolidated'
        : member === 'NonConsolidatedMember' ? 'non_consolidated'
        : 'unknown';
    if (result === 'unknown') {
        reasons.push('unknown_consolidation_member');
        return 'unknown';
    }

    const idMember = fallbackMember(context.id, ['ConsolidatedMember', 'NonConsolidatedMember']);
    const idResult: Consolidation = idMember === 'ConsolidatedMember' ? 'consolidated'
        : idMember === 'NonConsolidatedMember' ? 'non_consolidated'
        : 'unknown';
    if (idResult !== 'unknown' && idResult !== result) reasons.push('dimension_id_conflict:consolidation');
    return result;
}

function resolveActualForecast(context: XbrlContext, reasons: string[]): ActualForecast {
    const axes = dimensionsByAxis(context.dimensions, 'ResultForecastAxis');
    if (axes.length === 0) {
        const idMember = fallbackMember(context.id, ['ResultMember', 'ForecastMember', 'UpperMember', 'LowerMember']);
        if (idMember === 'ResultMember') return 'actual';
        if (idMember !== null) return 'forecast';
        reasons.push('missing_result_forecast_axis');
        return 'unknown';
    }
    if (axes.length > 1) {
        reasons.push('duplicate_result_forecast_axis');
        return 'unknown';
    }
    if (axes[0].member === null) {
        reasons.push('typed_dimension:ResultForecastAxis');
        return 'unknown';
    }

    const member = memberLocalName(axes[0].member);
    const result: ActualForecast = member === 'ResultMember' ? 'actual'
        : ['ForecastMember', 'UpperMember', 'LowerMember'].includes(member) ? 'forecast'
        : 'unknown';
    if (result === 'unknown') {
        reasons.push('unknown_result_forecast_member');
        return 'unknown';
    }

    const idMember = fallbackMember(context.id, ['ResultMember', 'ForecastMember', 'UpperMember', 'LowerMember']);
    const idResult: ActualForecast = idMember === 'ResultMember' ? 'actual'
        : idMember !== null ? 'forecast'
        : 'unknown';
    if (idResult !== 'unknown' && idResult !== result) reasons.push('dimension_id_conflict:actual_forecast');
    return result;
}

export function resolveContext(context: XbrlContext): ResolvedContext {
    const reasons: string[] = [];
    const fromId = parseIdDimensions(context.id);

    let periodKind: PeriodKind;
    if (context.instant) periodKind = 'instant';
    else if (context.startDate && context.endDate) periodKind = 'duration';
    else periodKind = 'unknown';

    if (fromId.periodKind !== 'unknown' && periodKind !== 'unknown' && fromId.periodKind !== periodKind) {
        reasons.push('period_kind_mismatch');
    }
    if (periodKind === 'unknown') reasons.push('invalid_period');
    if (periodKind === 'duration' && context.startDate! > context.endDate!) reasons.push('invalid_period');

    const periodStart = periodKind === 'duration' ? context.startDate : null;
    const periodEnd = periodKind === 'instant' ? context.instant : context.endDate;

    if (fromId.periodRelation === 'unknown') reasons.push('unknown_period_relation');
    if (fromId.periodScope === 'unknown') reasons.push('unknown_period_scope');

    const consolidation = resolveConsolidation(context, reasons);
    const actualForecast = resolveActualForecast(context, reasons);

    for (const dimension of context.dimensions) {
        const axis = axisLocalName(dimension.dimension);
        if (axis !== 'ConsolidatedNonconsolidatedAxis' && axis !== 'ResultForecastAxis') {
            reasons.push(`extra_dimension:${axis}`);
        }
        if (dimension.member === null && axis !== 'ConsolidatedNonconsolidatedAxis' && axis !== 'ResultForecastAxis') {
            reasons.push(`typed_dimension:${axis}`);
        }
    }

    return {
        id: context.id,
        periodRelation: fromId.periodRelation,
        periodKind,
        periodStart,
        periodEnd,
        periodScope: fromId.periodScope,
        quarter: fromId.quarter,
        consolidation,
        actualForecast,
        status: reasons.length === 0 ? 'resolved' : 'unresolved',
        unresolvedReasons: [...new Set(reasons)],
        dimensions: context.dimensions,
    };
}

function missingContext(id: string): ResolvedContext {
    return {
        id,
        periodRelation: 'unknown',
        periodKind: 'unknown',
        periodStart: null,
        periodEnd: null,
        periodScope: 'unknown',
        quarter: null,
        consolidation: 'unknown',
        actualForecast: 'unknown',
        status: 'unresolved',
        unresolvedReasons: ['unknown_context'],
        dimensions: [],
    };
}

export function resolveContexts(parsed: ParsedXbrl): Map<string, ResolvedContext> {
    const resolved = new Map<string, ResolvedContext>();
    for (const [id, context] of parsed.contexts) resolved.set(id, resolveContext(context));
    return resolved;
}

export function resolveFacts(parsed: ParsedXbrl): ResolvedFact[] {
    const contexts = resolveContexts(parsed);
    return parsed.facts.map(fact => {
        const context = contexts.get(fact.contextRef) ?? missingContext(fact.contextRef);
        return {
            ...fact,
            periodRelation: context.periodRelation,
            periodKind: context.periodKind,
            periodStart: context.periodStart,
            periodEnd: context.periodEnd,
            periodScope: context.periodScope,
            quarter: context.quarter,
            consolidation: context.consolidation,
            actualForecast: context.actualForecast,
            contextStatus: context.status,
            unresolvedReasons: context.unresolvedReasons,
            dimensions: context.dimensions,
        };
    });
}
