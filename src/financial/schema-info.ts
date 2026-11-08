export interface ColumnDefinition {
    name: string;
    type: string;
    unit: string;
    description: string;
    example: string;
}

export interface TableSchema {
    name: string;
    description: string;
    columns: ColumnDefinition[];
}

export interface QueryExample {
    title: string;
    description: string;
    sql: string;
}

function column(name: string, type: string, unit: string, description: string, example: string): ColumnDefinition {
    return { name, type, unit, description, example };
}

const SUMMARY_COLUMNS: ColumnDefinition[] = [
    column('document_id', 'TEXT', 'TDnet文書ID', '主キー。1文書=1行', "document_id = '140120261105565082'"),
    column('ticker', 'TEXT', '4桁コード', '証券コード', "ticker = '2376'"),
    column('company_name', 'TEXT', '文字列', '会社名', "company_name LIKE '%サイネックス%'"),
    column('title', 'TEXT', '文字列', '決算短信の件名', "title LIKE '%決算短信%'"),
    column('published_at', 'TEXT', 'UTC ISO8601', '開示日時', "published_at >= '2026-11-01'"),
    column('xbrl_url', 'TEXT', 'URL', 'XBRL ZIP の URL', 'xbrl_url IS NOT NULL'),
    column('period_type', 'TEXT', 'Q1 / Q2 / Q3 / FY', '期間種別', "period_type = 'Q2'"),
    column('period_start', 'TEXT', 'YYYY-MM-DD', '当期の期間開始日', "period_start >= '2026-04-01'"),
    column('period_end', 'TEXT', 'YYYY-MM-DD', '当期の期間終了日', "period_end = '2026-09-30'"),
    column('prior_period_start', 'TEXT', 'YYYY-MM-DD', '前期の期間開始日', "prior_period_start >= '2025-04-01'"),
    column('prior_period_end', 'TEXT', 'YYYY-MM-DD', '前期の期間終了日', "prior_period_end = '2025-09-30'"),
    column('accounting_standard', 'TEXT', 'J-GAAP / IFRS', '会計基準', "accounting_standard = 'IFRS'"),
    column('is_consolidated', 'INTEGER', '1=連結 / 0=単体 / NULL=不明', '連結区分', 'is_consolidated = 1'),
    column('is_revision', 'INTEGER', '1=訂正 / 0=通常', '訂正フラグ', 'is_revision = 0'),

    column('current_net_sales', 'REAL', '円', '当期 売上高 / 営業収益', 'current_net_sales >= 10000000000'),
    column('current_operating_income', 'REAL', '円', '当期 営業利益', 'current_operating_income >= 1000000000'),
    column('current_ordinary_income', 'REAL', '円', '当期 経常利益 (IFRSは税引前利益)', 'current_ordinary_income >= 1000000000'),
    column('current_net_income', 'REAL', '円', '当期 親会社株主に帰属する当期純利益', 'current_net_income >= 1000000000'),
    column('current_net_assets', 'REAL', '円', '当期 純資産 (自己資本)', 'current_net_assets >= 5000000000'),
    column('current_total_assets', 'REAL', '円', '当期 総資産', 'current_total_assets >= 10000000000'),
    column('current_operating_cf', 'REAL', '円', '当期 営業活動キャッシュ・フロー', 'current_operating_cf > 0'),
    column('current_investing_cf', 'REAL', '円', '当期 投資活動キャッシュ・フロー', 'current_investing_cf < 0'),
    column('current_cash_and_equivalents', 'REAL', '円', '当期 現金及び現金同等物', 'current_cash_and_equivalents >= 5000000000'),
    column('current_eps', 'REAL', '円/株', '当期 1株当たり当期純利益 (EPS)', 'current_eps >= 100'),
    column('current_bps', 'REAL', '円/株', '当期 1株当たり純資産 (BPS)', 'current_bps >= 1000'),
    column('current_dividend_per_share', 'REAL', '円/株', '当期 1株当たり配当金', 'current_dividend_per_share >= 50'),
    column('current_number_of_employees', 'REAL', '人', '当期 従業員数', 'current_number_of_employees <= 500'),

    column('prior_net_sales', 'REAL', '円', '前期 売上高 / 営業収益', 'prior_net_sales >= 10000000000'),
    column('prior_operating_income', 'REAL', '円', '前期 営業利益', 'prior_operating_income >= 1000000000'),
    column('prior_ordinary_income', 'REAL', '円', '前期 経常利益 (IFRSは税引前利益)', 'prior_ordinary_income >= 1000000000'),
    column('prior_net_income', 'REAL', '円', '前期 親会社株主に帰属する当期純利益', 'prior_net_income >= 1000000000'),
    column('prior_net_assets', 'REAL', '円', '前期 純資産 (自己資本)', 'prior_net_assets >= 5000000000'),
    column('prior_total_assets', 'REAL', '円', '前期 総資産', 'prior_total_assets >= 10000000000'),
    column('prior_operating_cf', 'REAL', '円', '前期 営業活動キャッシュ・フロー', 'prior_operating_cf > 0'),
    column('prior_investing_cf', 'REAL', '円', '前期 投資活動キャッシュ・フロー', 'prior_investing_cf < 0'),
    column('prior_cash_and_equivalents', 'REAL', '円', '前期 現金及び現金同等物', 'prior_cash_and_equivalents >= 5000000000'),
    column('prior_eps', 'REAL', '円/株', '前期 1株当たり当期純利益 (EPS)', 'prior_eps >= 100'),
    column('prior_bps', 'REAL', '円/株', '前期 1株当たり純資産 (BPS)', 'prior_bps >= 1000'),
    column('prior_dividend_per_share', 'REAL', '円/株', '前期 1株当たり配当金', 'prior_dividend_per_share >= 50'),
    column('prior_number_of_employees', 'REAL', '人', '前期 従業員数', 'prior_number_of_employees <= 500'),

    column('operating_margin_current', 'REAL', '小数比率 (0.15 = 15%)', '当期 営業利益率', 'operating_margin_current >= 0.15'),
    column('operating_margin_prior', 'REAL', '小数比率 (0.15 = 15%)', '前期 営業利益率', 'operating_margin_prior >= 0.10'),
    column('operating_margin_delta', 'REAL', '小数比率の差 (0.01 = 1ポイント)', '営業利益率の前年比ポイント差', 'operating_margin_delta > 0'),
    column('net_sales_growth_rate', 'REAL', '小数比率 (0.10 = +10%)', '売上高の前年比成長率', 'net_sales_growth_rate >= 0.10'),
    column('operating_income_growth_rate', 'REAL', '小数比率 (0.20 = +20%)', '営業利益の前年比成長率', 'operating_income_growth_rate >= 0.20'),
    column('free_cash_flow_current', 'REAL', '円', '当期 フリーキャッシュ・フロー (営業CF+投資CF)', 'free_cash_flow_current > 0'),
    column('free_cash_flow_prior', 'REAL', '円', '前期 フリーキャッシュ・フロー', 'free_cash_flow_prior > 0'),
    column('equity_ratio_current', 'REAL', '小数比率 (0.50 = 50%)', '当期 自己資本比率', 'equity_ratio_current >= 0.50'),
    column('equity_ratio_prior', 'REAL', '小数比率 (0.50 = 50%)', '前期 自己資本比率', 'equity_ratio_prior >= 0.50'),
    column('roe_current', 'REAL', '小数比率 (0.10 = 10%)', '当期 ROE', 'roe_current >= 0.10'),
    column('roe_prior', 'REAL', '小数比率 (0.10 = 10%)', '前期 ROE', 'roe_prior >= 0.10'),
    column('roa_current', 'REAL', '小数比率 (0.05 = 5%)', '当期 ROA', 'roa_current >= 0.05'),
    column('roa_prior', 'REAL', '小数比率 (0.05 = 5%)', '前期 ROA', 'roa_prior >= 0.05'),
    column('operating_income_per_employee', 'REAL', '円/人', '従業員1人当たり営業利益', 'operating_income_per_employee >= 10000000'),
    column('created_at', 'TEXT', 'UTC ISO8601', 'レコード作成日時', 'created_at >= \'2026-11-01\''),
    column('updated_at', 'TEXT', 'UTC ISO8601', 'レコード更新日時', 'updated_at >= \'2026-11-01\''),
];

const FACT_COLUMNS: ColumnDefinition[] = [
    column('document_id', 'TEXT', 'TDnet文書ID', 'Fact が属する文書', "document_id = '140120261105565082'"),
    column('concept', 'TEXT', 'QName', '完全修飾名', "concept = 'tse-ed-t:NetSales'"),
    column('name', 'TEXT', 'ローカル名', '名前空間を除いた科目名', "name = 'NetSales'"),
    column('namespace', 'TEXT', '名前空間接頭辞', 'tse-ed-t / jppfs_cor / jpigp_cor など', "namespace = 'tse-ed-t'"),
    column('context_id', 'TEXT', 'Context ID', 'TDnet の Context ID', "context_id LIKE 'CurrentAccumulatedQ2Duration%'"),
    column('unit_ref', 'TEXT', '単位', 'JPY / Shares / Pure など', "unit_ref = 'JPY'"),
    column('decimals', 'TEXT', 'decimals属性', 'iXBRL の decimals 属性', "decimals = '-6'"),
    column('scale', 'INTEGER', '桁', 'iXBRL の scale 属性', 'scale = 6'),
    column('sign', 'INTEGER', '1 / -1', 'iXBRL の sign 属性', 'sign = -1'),
    column('format', 'TEXT', 'ixt形式', '数値フォーマット', "format = 'ixt:numdotdecimal'"),
    column('raw_text', 'TEXT', '原文', 'iXBRL に記載された生の文字列', "raw_text = '7,071'"),
    column('value', 'REAL', '属性適用後', 'sign 適用後、scale 適用前の数値', 'value < 0'),
    column('scaled_value', 'REAL', '円 / 株 / 比率', 'sign と scale を適用した数値', 'scaled_value >= 1000000000'),
    column('period_relation', 'TEXT', 'current / prior / prior2 / filing / unknown', '当期・前期などの関係', "period_relation = 'current'"),
    column('period_kind', 'TEXT', 'instant / duration / unknown', '時点か期間か', "period_kind = 'duration'"),
    column('period_start', 'TEXT', 'YYYY-MM-DD', '期間開始日 (instant は NULL)', "period_start = '2026-04-01'"),
    column('period_end', 'TEXT', 'YYYY-MM-DD', '期間終了日 / instant 日', "period_end = '2026-09-30'"),
    column('period_scope', 'TEXT', 'annual / ytd / quarter / unknown', '通期・累計・四半期単独の区分', "period_scope = 'ytd'"),
    column('quarter', 'INTEGER', '1〜4 / NULL', '識別できた四半期番号', 'quarter = 2'),
    column('consolidation', 'TEXT', 'consolidated / non_consolidated / unknown', '連結・単体', "consolidation = 'consolidated'"),
    column('actual_forecast', 'TEXT', 'actual / forecast / unknown', '実績・予想', "actual_forecast = 'actual'"),
    column('context_status', 'TEXT', 'resolved / unresolved', 'Context 解決の成否', "context_status = 'resolved'"),
    column('unresolved_reasons', 'TEXT', 'JSON配列', '未解決の理由', "unresolved_reasons LIKE '%extra_dimension%'"),
    column('dimensions', 'TEXT', 'JSON配列', '次元軸とメンバー', "dimensions LIKE '%OperatingSegmentsAxis%'"),
    column('source_file', 'TEXT', 'ZIP内パス', 'Fact の抽出元 iXBRL ファイル', "source_file LIKE '%/Summary/%'"),
];

export const FINANCIAL_SCHEMAS: TableSchema[] = [
    {
        name: 'tdnet_financial_summary',
        description: '1文書=1行の当期・前期の主要科目と指標。screen --where の主な対象。',
        columns: SUMMARY_COLUMNS,
    },
    {
        name: 'tdnet_financial_facts',
        description: 'iXBRL から抽出した数値 Fact の全件。未解決 Context やセグメント・配当次元も保持する。',
        columns: FACT_COLUMNS,
    },
];

export const QUERY_EXAMPLES: QueryExample[] = [
    {
        title: '高収益企業',
        description: '当期の営業利益率が15%以上',
        sql: 'operating_margin_current >= 0.15',
    },
    {
        title: '増収増益企業',
        description: '売上高が前年比10%以上、営業利益が前年比20%以上',
        sql: 'net_sales_growth_rate >= 0.10 AND operating_income_growth_rate >= 0.20',
    },
    {
        title: '高ROE企業',
        description: '当期 ROE が15%以上',
        sql: 'roe_current >= 0.15',
    },
    {
        title: 'FCFプラス企業',
        description: '当期のフリーキャッシュ・フローがプラス',
        sql: 'free_cash_flow_current > 0',
    },
    {
        title: '連結決算のみ',
        description: '連結決算の文書に絞る',
        sql: 'is_consolidated = 1',
    },
    {
        title: '直近の四半期',
        description: '2026年4月1日以降に期末を迎えた文書',
        sql: "period_end >= '2026-04-01'",
    },
];
