import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { TdnetDocument, SearchOptions } from './types.js';
import { searchDateBound } from './search-date.js';
import { normalizeSearchText } from './search-normalize.js';
import { literalPattern, searchColumns, searchTerms } from './search-query.js';
import type { ExtractedFinancialSummary } from './financial/extractor.js';
import type { ResolvedFact } from './xbrl/context.js';
import type { XbrlDimension } from './xbrl/parser.js';

export interface XbrlDocumentRecord {
  documentId: string;
  xbrlUrl: string | null;
  status: 'parsed' | 'failed' | 'skipped';
  periodType: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  accountingStandard: string | null;
  isConsolidated: boolean | null;
  isRevision: boolean;
  factCount: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredFinancialFact extends Omit<ResolvedFact, 'dimensions' | 'unresolvedReasons'> {
  dimensions: XbrlDimension[];
  unresolvedReasons: string[];
}

function nullableNumber(value: number | undefined): number | null {
  return value === undefined || Number.isNaN(value) ? null : value;
}

function nullableInteger(value: number | undefined): number | null {
  return value === undefined || Number.isNaN(value) ? null : Math.round(value);
}

function booleanToInteger(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

function numberOrUndefined(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}

export interface FinancialScreenOptions {
  /** tdnet_financial_summary に対する SQL の WHERE 条件式。 */
  where?: string;
  limit?: number;
  offset?: number;
}

/** screen の結果行。DB の tdnet_financial_summary をフラットな camelCase で返す。 */
export interface FinancialSummaryRow {
  documentId: string;
  ticker: string | null;
  companyName: string | null;
  title: string | null;
  publishedAt: string | null;
  xbrlUrl: string | null;
  periodType: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  priorPeriodStart: string | null;
  priorPeriodEnd: string | null;
  accountingStandard: string | null;
  isConsolidated: boolean | null;
  isRevision: boolean;
  currentNetSales?: number;
  currentOperatingIncome?: number;
  currentOrdinaryIncome?: number;
  currentNetIncome?: number;
  currentNetAssets?: number;
  currentTotalAssets?: number;
  currentOperatingCf?: number;
  currentInvestingCf?: number;
  currentCashAndEquivalents?: number;
  currentEps?: number;
  currentBps?: number;
  currentDividendPerShare?: number;
  currentNumberOfEmployees?: number;
  priorNetSales?: number;
  priorOperatingIncome?: number;
  priorOrdinaryIncome?: number;
  priorNetIncome?: number;
  priorNetAssets?: number;
  priorTotalAssets?: number;
  priorOperatingCf?: number;
  priorInvestingCf?: number;
  priorCashAndEquivalents?: number;
  priorEps?: number;
  priorBps?: number;
  priorDividendPerShare?: number;
  priorNumberOfEmployees?: number;
  operatingMarginCurrent?: number;
  operatingMarginPrior?: number;
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
  createdAt: string;
  updatedAt: string;
}

function mapFinancialSummaryRowFlat(row: Record<string, any>): FinancialSummaryRow {
  return {
    documentId: String(row.document_id),
    ticker: row.ticker ?? null,
    companyName: row.company_name ?? null,
    title: row.title ?? null,
    publishedAt: row.published_at ?? null,
    xbrlUrl: row.xbrl_url ?? null,
    periodType: row.period_type ?? null,
    periodStart: row.period_start ?? null,
    periodEnd: row.period_end ?? null,
    priorPeriodStart: row.prior_period_start ?? null,
    priorPeriodEnd: row.prior_period_end ?? null,
    accountingStandard: row.accounting_standard ?? null,
    isConsolidated: row.is_consolidated === null || row.is_consolidated === undefined ? null : Boolean(row.is_consolidated),
    isRevision: Boolean(row.is_revision),
    currentNetSales: numberOrUndefined(row.current_net_sales),
    currentOperatingIncome: numberOrUndefined(row.current_operating_income),
    currentOrdinaryIncome: numberOrUndefined(row.current_ordinary_income),
    currentNetIncome: numberOrUndefined(row.current_net_income),
    currentNetAssets: numberOrUndefined(row.current_net_assets),
    currentTotalAssets: numberOrUndefined(row.current_total_assets),
    currentOperatingCf: numberOrUndefined(row.current_operating_cf),
    currentInvestingCf: numberOrUndefined(row.current_investing_cf),
    currentCashAndEquivalents: numberOrUndefined(row.current_cash_and_equivalents),
    currentEps: numberOrUndefined(row.current_eps),
    currentBps: numberOrUndefined(row.current_bps),
    currentDividendPerShare: numberOrUndefined(row.current_dividend_per_share),
    currentNumberOfEmployees: numberOrUndefined(row.current_number_of_employees),
    priorNetSales: numberOrUndefined(row.prior_net_sales),
    priorOperatingIncome: numberOrUndefined(row.prior_operating_income),
    priorOrdinaryIncome: numberOrUndefined(row.prior_ordinary_income),
    priorNetIncome: numberOrUndefined(row.prior_net_income),
    priorNetAssets: numberOrUndefined(row.prior_net_assets),
    priorTotalAssets: numberOrUndefined(row.prior_total_assets),
    priorOperatingCf: numberOrUndefined(row.prior_operating_cf),
    priorInvestingCf: numberOrUndefined(row.prior_investing_cf),
    priorCashAndEquivalents: numberOrUndefined(row.prior_cash_and_equivalents),
    priorEps: numberOrUndefined(row.prior_eps),
    priorBps: numberOrUndefined(row.prior_bps),
    priorDividendPerShare: numberOrUndefined(row.prior_dividend_per_share),
    priorNumberOfEmployees: numberOrUndefined(row.prior_number_of_employees),
    operatingMarginCurrent: numberOrUndefined(row.operating_margin_current),
    operatingMarginPrior: numberOrUndefined(row.operating_margin_prior),
    operatingMarginDelta: numberOrUndefined(row.operating_margin_delta),
    netSalesGrowthRate: numberOrUndefined(row.net_sales_growth_rate),
    operatingIncomeGrowthRate: numberOrUndefined(row.operating_income_growth_rate),
    freeCashFlowCurrent: numberOrUndefined(row.free_cash_flow_current),
    freeCashFlowPrior: numberOrUndefined(row.free_cash_flow_prior),
    equityRatioCurrent: numberOrUndefined(row.equity_ratio_current),
    equityRatioPrior: numberOrUndefined(row.equity_ratio_prior),
    roeCurrent: numberOrUndefined(row.roe_current),
    roePrior: numberOrUndefined(row.roe_prior),
    roaCurrent: numberOrUndefined(row.roa_current),
    roaPrior: numberOrUndefined(row.roa_prior),
    operatingIncomePerEmployee: numberOrUndefined(row.operating_income_per_employee),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapFinancialSummaryRow(row: Record<string, any>): ExtractedFinancialSummary {
  return {
    documentId: String(row.document_id),
    ticker: row.ticker ?? null,
    companyName: row.company_name ?? null,
    title: row.title ?? null,
    publishedAt: row.published_at ?? null,
    xbrlUrl: row.xbrl_url ?? null,
    periodType: row.period_type ?? 'unknown',
    periodStart: row.period_start ?? null,
    periodEnd: row.period_end ?? null,
    priorPeriodStart: row.prior_period_start ?? null,
    priorPeriodEnd: row.prior_period_end ?? null,
    accountingStandard: row.accounting_standard ?? 'unknown',
    isConsolidated: row.is_consolidated === null || row.is_consolidated === undefined ? null : Boolean(row.is_consolidated),
    isRevision: Boolean(row.is_revision),
    current: {
      netSales: numberOrUndefined(row.current_net_sales),
      operatingIncome: numberOrUndefined(row.current_operating_income),
      ordinaryIncome: numberOrUndefined(row.current_ordinary_income),
      netIncome: numberOrUndefined(row.current_net_income),
      netAssets: numberOrUndefined(row.current_net_assets),
      totalAssets: numberOrUndefined(row.current_total_assets),
      operatingCashFlow: numberOrUndefined(row.current_operating_cf),
      investingCashFlow: numberOrUndefined(row.current_investing_cf),
      cashAndEquivalents: numberOrUndefined(row.current_cash_and_equivalents),
      eps: numberOrUndefined(row.current_eps),
      bps: numberOrUndefined(row.current_bps),
      dividendPerShare: numberOrUndefined(row.current_dividend_per_share),
      numberOfEmployees: numberOrUndefined(row.current_number_of_employees),
    },
    prior: {
      netSales: numberOrUndefined(row.prior_net_sales),
      operatingIncome: numberOrUndefined(row.prior_operating_income),
      ordinaryIncome: numberOrUndefined(row.prior_ordinary_income),
      netIncome: numberOrUndefined(row.prior_net_income),
      netAssets: numberOrUndefined(row.prior_net_assets),
      totalAssets: numberOrUndefined(row.prior_total_assets),
      operatingCashFlow: numberOrUndefined(row.prior_operating_cf),
      investingCashFlow: numberOrUndefined(row.prior_investing_cf),
      cashAndEquivalents: numberOrUndefined(row.prior_cash_and_equivalents),
      eps: numberOrUndefined(row.prior_eps),
      bps: numberOrUndefined(row.prior_bps),
      dividendPerShare: numberOrUndefined(row.prior_dividend_per_share),
      numberOfEmployees: numberOrUndefined(row.prior_number_of_employees),
    },
    indicators: {
      operatingMarginCurrent: numberOrUndefined(row.operating_margin_current),
      operatingMarginPrior: numberOrUndefined(row.operating_margin_prior),
      operatingMarginDelta: numberOrUndefined(row.operating_margin_delta),
      netSalesGrowthRate: numberOrUndefined(row.net_sales_growth_rate),
      operatingIncomeGrowthRate: numberOrUndefined(row.operating_income_growth_rate),
      freeCashFlowCurrent: numberOrUndefined(row.free_cash_flow_current),
      freeCashFlowPrior: numberOrUndefined(row.free_cash_flow_prior),
      equityRatioCurrent: numberOrUndefined(row.equity_ratio_current),
      equityRatioPrior: numberOrUndefined(row.equity_ratio_prior),
      roeCurrent: numberOrUndefined(row.roe_current),
      roePrior: numberOrUndefined(row.roe_prior),
      roaCurrent: numberOrUndefined(row.roa_current),
      roaPrior: numberOrUndefined(row.roa_prior),
      operatingIncomePerEmployee: numberOrUndefined(row.operating_income_per_employee),
    },
    usedContextIds: {
      currentDuration: [],
      priorDuration: [],
      currentInstant: [],
      priorFiscalYearInstant: [],
      priorPeriodInstant: [],
    },
  };
}

export class DbClient {
  private db: DatabaseSync;
  private normalizationRegistered = false;

  constructor(dbPath: string = path.join(process.cwd(), 'tdnet.sqlite')) {
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tdnet_documents (
        id TEXT PRIMARY KEY,
        document_url TEXT NOT NULL,
        published_at TEXT NOT NULL,
        ticker TEXT NOT NULL,
        company_name TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `);
    // 後からカラムを追加する場合の対応（既存DB用）
    try {
      this.db.exec(`ALTER TABLE tdnet_documents ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`);
    } catch {
      /* ignore if already exists */
    }

    // XBRL 解析結果。既存の tdnet_documents は変更しない。
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tdnet_xbrl_documents (
        document_id TEXT PRIMARY KEY,
        xbrl_url TEXT,
        status TEXT NOT NULL,
        period_type TEXT,
        period_start TEXT,
        period_end TEXT,
        accounting_standard TEXT,
        is_consolidated INTEGER,
        is_revision INTEGER NOT NULL DEFAULT 0,
        fact_count INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tdnet_financial_facts (
        document_id TEXT NOT NULL,
        concept TEXT NOT NULL,
        name TEXT NOT NULL,
        namespace TEXT,
        context_id TEXT NOT NULL,
        unit_ref TEXT,
        decimals TEXT,
        scale INTEGER NOT NULL,
        sign INTEGER NOT NULL,
        format TEXT,
        raw_text TEXT NOT NULL,
        value REAL NOT NULL,
        scaled_value REAL NOT NULL,
        period_relation TEXT NOT NULL,
        period_kind TEXT NOT NULL,
        period_start TEXT,
        period_end TEXT,
        period_scope TEXT NOT NULL,
        quarter INTEGER,
        consolidation TEXT NOT NULL,
        actual_forecast TEXT NOT NULL,
        context_status TEXT NOT NULL,
        unresolved_reasons TEXT NOT NULL,
        dimensions TEXT NOT NULL,
        source_file TEXT NOT NULL
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_tdnet_financial_facts_document ON tdnet_financial_facts(document_id)`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tdnet_financial_summary (
        document_id TEXT PRIMARY KEY,
        ticker TEXT,
        company_name TEXT,
        title TEXT,
        published_at TEXT,
        xbrl_url TEXT,
        period_type TEXT,
        period_start TEXT,
        period_end TEXT,
        prior_period_start TEXT,
        prior_period_end TEXT,
        accounting_standard TEXT,
        is_consolidated INTEGER,
        is_revision INTEGER NOT NULL DEFAULT 0,
        current_net_sales REAL,
        current_operating_income REAL,
        current_ordinary_income REAL,
        current_net_income REAL,
        current_net_assets REAL,
        current_total_assets REAL,
        current_operating_cf REAL,
        current_investing_cf REAL,
        current_cash_and_equivalents REAL,
        current_eps REAL,
        current_bps REAL,
        current_dividend_per_share REAL,
        current_number_of_employees REAL,
        prior_net_sales REAL,
        prior_operating_income REAL,
        prior_ordinary_income REAL,
        prior_net_income REAL,
        prior_net_assets REAL,
        prior_total_assets REAL,
        prior_operating_cf REAL,
        prior_investing_cf REAL,
        prior_cash_and_equivalents REAL,
        prior_eps REAL,
        prior_bps REAL,
        prior_dividend_per_share REAL,
        prior_number_of_employees REAL,
        operating_margin_current REAL,
        operating_margin_prior REAL,
        operating_margin_delta REAL,
        net_sales_growth_rate REAL,
        operating_income_growth_rate REAL,
        free_cash_flow_current REAL,
        free_cash_flow_prior REAL,
        equity_ratio_current REAL,
        equity_ratio_prior REAL,
        roe_current REAL,
        roe_prior REAL,
        roa_current REAL,
        roa_prior REAL,
        operating_income_per_employee REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  public insertDocument(doc: TdnetDocument) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tdnet_documents (
        id, document_url, published_at, ticker, company_name, title, content, retry_count, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    stmt.run(
      doc.id,
      doc.documentUrl,
      doc.publishedAt,
      doc.ticker,
      doc.companyName,
      doc.title,
      doc.content || null,
      doc.retryCount,
      doc.createdAt
    );
  }

  public getDocument(id: string): TdnetDocument | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM tdnet_documents WHERE id = ?
    `);
    const row = stmt.get(id) as Record<string, any> | undefined;
    if (!row) return undefined;

    return {
      id: String(row.id),
      publishedAt: row.published_at,
      ticker: row.ticker,
      companyName: row.company_name,
      title: row.title,
      documentUrl: row.document_url,
      content: row.content,
      retryCount: Number(row.retry_count || 0),
      createdAt: row.created_at,
    };
  }

  public searchDocuments(keyword: string | undefined, options?: SearchOptions): TdnetDocument[] {
    let sql = `SELECT * FROM tdnet_documents WHERE 1=1`;
    const params: (string | number)[] = [];

    const match = options?.match ?? 'legacy';
    if (options?.normalize !== undefined && options.normalize !== 'width-case') {
      throw new Error('Search normalize must be width-case or omitted.');
    }
    if (options?.normalize && match === 'legacy') {
      throw new Error('Search normalization requires match literal, all or any.');
    }
    const fold = options?.normalize === 'width-case';
    if (fold && !this.normalizationRegistered) {
      if (typeof this.db.function !== 'function') {
        throw new Error('Search normalization requires Node.js 22.13 or later (SQLite function support).');
      }
      this.db.function('tdnet_width_case', { deterministic: true }, value =>
        value === null ? null : normalizeSearchText(String(value)));
      this.normalizationRegistered = true;
    }
    const columns = searchColumns(options?.fields).map(column => fold ? `tdnet_width_case(${column})` : column);
    // Parse syntax first so folding fullwidth quotes cannot create query operators.
    const terms = searchTerms(keyword, match).map(term => fold ? normalizeSearchText(term) : term);
    if (terms.length) {
      const conditions = terms.map(term => {
        const pattern = match === 'legacy' ? `%${term}%` : literalPattern(term);
        params.push(...columns.map(() => pattern));
        return `(${columns.map(column => `${column} LIKE ?${match === 'legacy' ? '' : " ESCAPE '\\'"}`).join(' OR ')})`;
      });
      sql += ` AND (${conditions.join(match === 'any' ? ' OR ' : ' AND ')})`;
    }

    if (options?.ticker) {
      sql += ` AND ticker = ?`;
      params.push(options.ticker);
    }
    if (options?.title) {
      const column = fold ? 'tdnet_width_case(title)' : 'title';
      sql += match === 'legacy' ? ` AND title LIKE ?` : ` AND ${column} LIKE ? ESCAPE '\\'`;
      const title = fold ? normalizeSearchText(options.title) : options.title;
      params.push(match === 'legacy' ? `%${title}%` : literalPattern(title));
    }
    const start = options?.startDate !== undefined ? searchDateBound(options.startDate, false) : undefined;
    const end = options?.endDate !== undefined ? searchDateBound(options.endDate, true) : undefined;
    if (start && end && (start.iso > end.iso || (end.exclusive && start.iso === end.iso))) {
      throw new Error('Search startDate must not be after endDate.');
    }
    // Compare instants, including existing ISO values without fractional seconds.
    if (start) {
      sql += ` AND julianday(published_at) >= julianday(?)`;
      params.push(start.iso);
    }
    if (end) {
      sql += end.exclusive ? ` AND julianday(published_at) < julianday(?)` : ` AND julianday(published_at) <= julianday(?)`;
      params.push(end.iso);
    }

    sql += ` ORDER BY published_at DESC, id ASC`;

    if (options?.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < -1)) {
      throw new Error('Search limit must be an integer >= -1.');
    }
    if (options?.offset !== undefined && (!Number.isSafeInteger(options.offset) || options.offset < 0)) {
      throw new Error('Search offset must be a nonnegative integer.');
    }
    if (options?.limit !== undefined || options?.offset !== undefined) {
      sql += ` LIMIT ? OFFSET ?`;
      params.push(options?.limit ?? -1, options?.offset ?? 0);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Record<string, any>[];

    return rows.map(row => ({
      id: String(row.id),
      publishedAt: row.published_at,
      ticker: row.ticker,
      companyName: row.company_name,
      title: row.title,
      documentUrl: row.document_url,
      content: row.content,
      retryCount: Number(row.retry_count || 0),
      createdAt: row.created_at,
    }));
  }

  public insertXbrlDocument(record: XbrlDocumentRecord) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tdnet_xbrl_documents (
        document_id, xbrl_url, status, period_type, period_start, period_end,
        accounting_standard, is_consolidated, is_revision, fact_count, error,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.documentId,
      record.xbrlUrl,
      record.status,
      record.periodType,
      record.periodStart,
      record.periodEnd,
      record.accountingStandard,
      booleanToInteger(record.isConsolidated),
      record.isRevision ? 1 : 0,
      record.factCount,
      record.error,
      record.createdAt,
      record.updatedAt,
    );
  }

  public getXbrlDocument(documentId: string): XbrlDocumentRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM tdnet_xbrl_documents WHERE document_id = ?`).get(documentId) as Record<string, any> | undefined;
    if (!row) return undefined;
    return {
      documentId: String(row.document_id),
      xbrlUrl: row.xbrl_url ?? null,
      status: row.status,
      periodType: row.period_type ?? null,
      periodStart: row.period_start ?? null,
      periodEnd: row.period_end ?? null,
      accountingStandard: row.accounting_standard ?? null,
      isConsolidated: row.is_consolidated === null || row.is_consolidated === undefined ? null : Boolean(row.is_consolidated),
      isRevision: Boolean(row.is_revision),
      factCount: Number(row.fact_count ?? 0),
      error: row.error ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** 指定文書の Fact を全件入れ替える。数値 Fact は未解決 Context も含めて保存する。 */
  public replaceFinancialFacts(documentId: string, facts: ResolvedFact[]) {
    this.db.prepare(`DELETE FROM tdnet_financial_facts WHERE document_id = ?`).run(documentId);
    const columns = [
      'document_id', 'concept', 'name', 'namespace', 'context_id', 'unit_ref', 'decimals',
      'scale', 'sign', 'format', 'raw_text', 'value', 'scaled_value', 'period_relation',
      'period_kind', 'period_start', 'period_end', 'period_scope', 'quarter', 'consolidation',
      'actual_forecast', 'context_status', 'unresolved_reasons', 'dimensions', 'source_file',
    ];
    const stmt = this.db.prepare(`
      INSERT INTO tdnet_financial_facts (${columns.join(', ')})
      VALUES (${columns.map(() => '?').join(', ')})
    `);
    for (const fact of facts) {
      stmt.run(
        documentId,
        fact.concept,
        fact.name,
        fact.namespace,
        fact.contextRef,
        fact.unitRef,
        fact.decimals,
        fact.scale,
        fact.sign,
        fact.format,
        fact.rawText,
        fact.value,
        fact.scaledValue,
        fact.periodRelation,
        fact.periodKind,
        fact.periodStart,
        fact.periodEnd,
        fact.periodScope,
        fact.quarter,
        fact.consolidation,
        fact.actualForecast,
        fact.contextStatus,
        JSON.stringify(fact.unresolvedReasons),
        JSON.stringify(fact.dimensions),
        fact.sourceFile,
      );
    }
  }

  public getFinancialFacts(documentId: string): StoredFinancialFact[] {
    const rows = this.db.prepare(`SELECT * FROM tdnet_financial_facts WHERE document_id = ?`).all(documentId) as Record<string, any>[];
    return rows.map(row => ({
      concept: String(row.concept),
      name: String(row.name),
      namespace: row.namespace ?? null,
      contextRef: String(row.context_id),
      unitRef: row.unit_ref ?? null,
      decimals: row.decimals ?? null,
      scale: Number(row.scale),
      sign: Number(row.sign) === -1 ? -1 : 1,
      format: row.format ?? null,
      rawText: String(row.raw_text),
      value: Number(row.value),
      scaledValue: Number(row.scaled_value),
      sourceFile: String(row.source_file),
      periodRelation: row.period_relation,
      periodKind: row.period_kind,
      periodStart: row.period_start ?? null,
      periodEnd: row.period_end ?? null,
      periodScope: row.period_scope,
      quarter: row.quarter === null || row.quarter === undefined ? null : Number(row.quarter),
      consolidation: row.consolidation,
      actualForecast: row.actual_forecast,
      contextStatus: row.context_status,
      unresolvedReasons: JSON.parse(String(row.unresolved_reasons)) as string[],
      dimensions: JSON.parse(String(row.dimensions)) as XbrlDimension[],
    }));
  }

  public insertFinancialSummary(summary: ExtractedFinancialSummary, now: string = new Date().toISOString()) {
    const values: Record<string, string | number | null> = {
      document_id: summary.documentId,
      ticker: summary.ticker,
      company_name: summary.companyName,
      title: summary.title,
      published_at: summary.publishedAt,
      xbrl_url: summary.xbrlUrl,
      period_type: summary.periodType,
      period_start: summary.periodStart,
      period_end: summary.periodEnd,
      prior_period_start: summary.priorPeriodStart,
      prior_period_end: summary.priorPeriodEnd,
      accounting_standard: summary.accountingStandard,
      is_consolidated: booleanToInteger(summary.isConsolidated),
      is_revision: summary.isRevision ? 1 : 0,
      current_net_sales: nullableNumber(summary.current.netSales),
      current_operating_income: nullableNumber(summary.current.operatingIncome),
      current_ordinary_income: nullableNumber(summary.current.ordinaryIncome),
      current_net_income: nullableNumber(summary.current.netIncome),
      current_net_assets: nullableNumber(summary.current.netAssets),
      current_total_assets: nullableNumber(summary.current.totalAssets),
      current_operating_cf: nullableNumber(summary.current.operatingCashFlow),
      current_investing_cf: nullableNumber(summary.current.investingCashFlow),
      current_cash_and_equivalents: nullableNumber(summary.current.cashAndEquivalents),
      current_eps: nullableNumber(summary.current.eps),
      current_bps: nullableNumber(summary.current.bps),
      current_dividend_per_share: nullableNumber(summary.current.dividendPerShare),
      current_number_of_employees: nullableInteger(summary.current.numberOfEmployees),
      prior_net_sales: nullableNumber(summary.prior.netSales),
      prior_operating_income: nullableNumber(summary.prior.operatingIncome),
      prior_ordinary_income: nullableNumber(summary.prior.ordinaryIncome),
      prior_net_income: nullableNumber(summary.prior.netIncome),
      prior_net_assets: nullableNumber(summary.prior.netAssets),
      prior_total_assets: nullableNumber(summary.prior.totalAssets),
      prior_operating_cf: nullableNumber(summary.prior.operatingCashFlow),
      prior_investing_cf: nullableNumber(summary.prior.investingCashFlow),
      prior_cash_and_equivalents: nullableNumber(summary.prior.cashAndEquivalents),
      prior_eps: nullableNumber(summary.prior.eps),
      prior_bps: nullableNumber(summary.prior.bps),
      prior_dividend_per_share: nullableNumber(summary.prior.dividendPerShare),
      prior_number_of_employees: nullableInteger(summary.prior.numberOfEmployees),
      operating_margin_current: nullableNumber(summary.indicators.operatingMarginCurrent),
      operating_margin_prior: nullableNumber(summary.indicators.operatingMarginPrior),
      operating_margin_delta: nullableNumber(summary.indicators.operatingMarginDelta),
      net_sales_growth_rate: nullableNumber(summary.indicators.netSalesGrowthRate),
      operating_income_growth_rate: nullableNumber(summary.indicators.operatingIncomeGrowthRate),
      free_cash_flow_current: nullableNumber(summary.indicators.freeCashFlowCurrent),
      free_cash_flow_prior: nullableNumber(summary.indicators.freeCashFlowPrior),
      equity_ratio_current: nullableNumber(summary.indicators.equityRatioCurrent),
      equity_ratio_prior: nullableNumber(summary.indicators.equityRatioPrior),
      roe_current: nullableNumber(summary.indicators.roeCurrent),
      roe_prior: nullableNumber(summary.indicators.roePrior),
      roa_current: nullableNumber(summary.indicators.roaCurrent),
      roa_prior: nullableNumber(summary.indicators.roaPrior),
      operating_income_per_employee: nullableNumber(summary.indicators.operatingIncomePerEmployee),
      created_at: now,
      updated_at: now,
    };
    const columns = Object.keys(values);
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tdnet_financial_summary (${columns.join(', ')})
      VALUES (${columns.map(() => '?').join(', ')})
    `);
    stmt.run(...Object.values(values));
  }

  public getFinancialSummary(documentId: string): ExtractedFinancialSummary | undefined {
    const row = this.db.prepare(`SELECT * FROM tdnet_financial_summary WHERE document_id = ?`).get(documentId) as Record<string, any> | undefined;
    return row ? mapFinancialSummaryRow(row) : undefined;
  }

  /** tdnet_financial_summary を --where の SQL 条件式で検索する。 */
  public screenFinancials(options: FinancialScreenOptions = {}): FinancialSummaryRow[] {
    let sql = `SELECT * FROM tdnet_financial_summary`;
    const params: (string | number)[] = [];
    if (options.where !== undefined && options.where.trim() !== '') {
      sql += ` WHERE (${options.where})`;
    }
    sql += ` ORDER BY period_end DESC, document_id ASC`;
    if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < -1)) {
      throw new Error('Screen limit must be an integer >= -1.');
    }
    if (options.offset !== undefined && (!Number.isSafeInteger(options.offset) || options.offset < 0)) {
      throw new Error('Screen offset must be a nonnegative integer.');
    }
    if (options.limit !== undefined || options.offset !== undefined) {
      sql += ` LIMIT ? OFFSET ?`;
      params.push(options.limit ?? -1, options.offset ?? 0);
    }
    const rows = this.db.prepare(sql).all(...params) as Record<string, any>[];
    return rows.map(mapFinancialSummaryRowFlat);
  }

  /** XBRL 文書・Fact 全件・サマリーを 1 トランザクションで保存する。 */
  public saveXbrlExtraction(input: {
    document: XbrlDocumentRecord;
    facts: ResolvedFact[];
    summary: ExtractedFinancialSummary;
  }) {
    this.db.exec('BEGIN');
    try {
      this.insertXbrlDocument(input.document);
      this.replaceFinancialFacts(input.document.documentId, input.facts);
      this.insertFinancialSummary(input.summary);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  public getRecentDocuments(limit: number = 50): TdnetDocument[] {
    const stmt = this.db.prepare(`
      SELECT * FROM tdnet_documents ORDER BY published_at DESC LIMIT ?
    `);
    const rows = stmt.all(limit) as Record<string, any>[];
    return rows.map(row => ({
      id: String(row.id),
      publishedAt: row.published_at,
      ticker: row.ticker,
      companyName: row.company_name,
      title: row.title,
      documentUrl: row.document_url,
      content: row.content,
      retryCount: Number(row.retry_count || 0),
      createdAt: row.created_at,
    }));
  }

  public close() {
    this.db.close();
  }
}
