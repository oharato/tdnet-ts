export interface TdnetDocument {
    id: string;             // TDnetドキュメントID (主キー、例: 140120260220565990)
    publishedAt: string;    // 開示日時 (UTC ISO形式)
    ticker: string;         // 銘柄コード (末尾0を除去済み)
    companyName: string;    // 会社名
    title: string;          // 件名
    documentUrl: string;    // PDFのURL
    content: string | null; // 変換されたMarkdown本文
    retryCount: number;     // 解析失敗時のリトライ回数
    createdAt: string;      // レコード作成日時
}

export interface ApiDocumentItem {
    Tdnet: {
        id: string;
        pubdate: string;
        company_code: string;
        company_name: string;
        title: string;
        document_url: string;
    };
}

export interface ApiDocumentResponse {
    total_count: number;
    condition_desc?: string;
    items: ApiDocumentItem[];
}

export type SearchField = 'title' | 'body' | 'company';
export type SearchMatch = 'legacy' | 'literal' | 'all' | 'any';
export interface SearchOptions {
    ticker?: string;
    title?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
    fields?: SearchField[];
    match?: SearchMatch;
    normalize?: 'width-case';
}


export type SyncStatus = 'synced' | 'existing' | 'failed' | 'exhausted' | 'unsupported';
export interface SyncResult {
    received: number;
    duplicates: number;
    invalid: number;
    synced: number;
    existing: number;
    failed: number;
    exhausted: number;
    unsupported: number;
    pdfSaveFailed: number;
    /** Requested API limit reached; a possible truncation, not proof of complete coverage. */
    limitReached: boolean;
    documents: { id: string; status: SyncStatus; attempts: number; pdfSaveFailed: boolean }[];
}


export interface RecoveryResult {
    requested: number;
    recovered: number;
    existing: number;
    missing: number;
    failed: number;
    pdfSaved: number;
    pdfSaveFailed: number;
    documents: { id: string; status: 'recovered' | 'existing' | 'missing' | 'failed'; attempts: number; pdfSaved: boolean; pdfSaveFailed: boolean }[];
}
