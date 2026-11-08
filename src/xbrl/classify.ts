import type { ParsedXbrl } from './parser.js';

export interface XbrlClassification {
    isFinancialSummary: boolean;
    documentName: string | null;
    quarterlyPeriod: number | null;
    typeOfCurrentPeriod: string | null;
    accountingStandard: string | null;
    isRevision: boolean;
    hasFinancialStatements: boolean;
    reasons: string[];
}

/** 決算短信の主要財務諸表に現れる数値 Fact。 */
const FINANCIAL_STATEMENT_CONCEPTS = new Set([
    'NetSales',
    'RevenueIFRS',
    'Revenue2IFRS',
    'OperatingIncome',
    'OperatingIncomeIFRS',
    'OrdinaryIncome',
    'ProfitBeforeTaxIFRS',
    'ProfitLoss',
    'ProfitAttributableToOwnersOfParent',
    'ProfitIFRS',
    'ProfitAttributableToOwnersOfParentIFRS',
    'TotalAssets',
    'TotalAssetsIFRS',
    'Assets',
    'AssetsIFRS',
    'NetAssets',
    'TotalEquityIFRS',
    'EquityAttributableToOwnersOfParentIFRS',
    'NetCashProvidedByUsedInOperatingActivities',
    'NetCashProvidedByUsedInOperatingActivitiesIFRS',
]);

const FINANCIAL_STATEMENT_TEXT_BLOCK = /(?:BalanceSheet|StatementOfIncome|StatementOfFinancialPosition|StatementOfProfitOrLoss|StatementOfCashFlows|CashFlows)/;

function firstText(parsed: ParsedXbrl, name: string): string | null {
    return parsed.textFacts.find(fact => fact.name === name)?.rawText ?? null;
}

function firstNumeric(parsed: ParsedXbrl, name: string): number | null {
    const fact = parsed.facts.find(item => item.name === name);
    return fact ? fact.scaledValue : null;
}

function parseBoolean(value: string | null): boolean {
    return value !== null && /^(?:true|1|有|はい)$/i.test(value.trim());
}

/**
 * 決算短信かどうかを、API のタイトルではなく XBRL の DocumentName・
 * 四半期情報 (QuarterlyPeriod / TypeOfCurrentPeriodDEI)・財務諸表の有無で判定する。
 */
export function classifyXbrlDocument(parsed: ParsedXbrl): XbrlClassification {
    const documentName = firstText(parsed, 'DocumentName');
    const quarterlyPeriod = firstNumeric(parsed, 'QuarterlyPeriod');
    const typeOfCurrentPeriod = firstText(parsed, 'TypeOfCurrentPeriodDEI');
    const accountingStandard = firstText(parsed, 'AccountingStandardsDEI');
    const amendmentFlag = firstText(parsed, 'XBRLAmendmentFlagDEI')
        ?? firstText(parsed, 'IdentificationOfDocumentSubjectToAmendment');
    const isRevision = parseBoolean(amendmentFlag) || (documentName?.includes('訂正') ?? false);

    const hasNumericStatements = parsed.facts.some(fact => FINANCIAL_STATEMENT_CONCEPTS.has(fact.name));
    const hasTextStatements = parsed.textFacts.some(fact => FINANCIAL_STATEMENT_TEXT_BLOCK.test(fact.name));
    const hasFinancialStatements = hasNumericStatements || hasTextStatements;

    const nameSaysSummary = documentName?.includes('決算短信') ?? false;
    const periodSaysSummary = quarterlyPeriod !== null
        || /^(?:Q[1-4]|HY|FY|1Q|2Q|3Q|4Q)$/i.test(typeOfCurrentPeriod ?? '');

    const reasons: string[] = [];
    if (!nameSaysSummary) reasons.push('document_name_not_summary');
    if (!periodSaysSummary) reasons.push('missing_quarterly_period');
    if (!hasFinancialStatements) reasons.push('missing_financial_statements');

    // DocumentName が決算短信で、財務諸表があれば四半期情報が欠けていても受理する。
    // DocumentName がない場合は、四半期情報と会計基準と財務諸表の3点で判定する。
    const isFinancialSummary = hasFinancialStatements
        && (nameSaysSummary || (periodSaysSummary && accountingStandard !== null));

    return {
        isFinancialSummary,
        documentName,
        quarterlyPeriod,
        typeOfCurrentPeriod,
        accountingStandard,
        isRevision,
        hasFinancialStatements,
        reasons,
    };
}
