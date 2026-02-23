export interface TdnetDocument {
    publishedAt: string;    // 開示日時 (UTC ISO形式)
    ticker: string;         // 銘柄コード (末尾0を除去済み)
    companyName: string;    // 会社名
    title: string;          // 件名
    documentUrl: string;    // PDFのURL (主キー)
    content: string | null; // 変換されたMarkdown本文
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
