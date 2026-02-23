import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { TdnetDocument } from './types.js';

export class DbClient {
  private db: DatabaseSync;

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
        created_at TEXT NOT NULL
      )
    `);
  }

  public insertDocument(doc: TdnetDocument) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tdnet_documents (
        id, document_url, published_at, ticker, company_name, title, content, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?
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
      doc.createdAt
    );
  }

  public getDocument(id: string): TdnetDocument | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM tdnet_documents WHERE id = ?
    `);
    const row = stmt.get(id) as Record<string, string> | undefined;
    if (!row) return undefined;

    return {
      id: String(row.id),
      publishedAt: row.published_at,
      ticker: row.ticker,
      companyName: row.company_name,
      title: row.title,
      documentUrl: row.document_url,
      content: row.content,
      createdAt: row.created_at,
    };
  }

  public searchDocuments(keyword: string | undefined, options?: { ticker?: string; title?: string; startDate?: string; endDate?: string; limit?: number }): TdnetDocument[] {
    let sql = `SELECT * FROM tdnet_documents WHERE 1=1`;
    const params: (string | number)[] = [];

    if (keyword) {
      sql += ` AND (title LIKE ? OR content LIKE ? OR company_name LIKE ?)`;
      const pattern = `%${keyword}%`;
      params.push(pattern, pattern, pattern);
    }

    if (options?.ticker) {
      sql += ` AND ticker = ?`;
      params.push(options.ticker);
    }
    if (options?.title) {
      sql += ` AND title LIKE ?`;
      params.push(`%${options.title}%`);
    }
    if (options?.startDate) {
      sql += ` AND published_at >= ?`;
      // Date string like "2023-01-01" will be compared lexicographically with ISO8601 string like "2023-01-01T..."
      params.push(options.startDate);
    }
    if (options?.endDate) {
      sql += ` AND published_at <= ?`;
      // Append "T23:59:59.999Z" to make it inclusive if user passed "2023-01-31"
      const endDateFull = options.endDate.length <= 10 ? `${options.endDate}T23:59:59.999Z` : options.endDate;
      params.push(endDateFull);
    }

    sql += ` ORDER BY published_at DESC`;

    if (options?.limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Record<string, string>[];

    return rows.map(row => ({
      id: String(row.id),
      publishedAt: row.published_at,
      ticker: row.ticker,
      companyName: row.company_name,
      title: row.title,
      documentUrl: row.document_url,
      content: row.content,
      createdAt: row.created_at,
    }));
  }

  public getRecentDocuments(limit: number = 50): TdnetDocument[] {
    const stmt = this.db.prepare(`
      SELECT * FROM tdnet_documents ORDER BY published_at DESC LIMIT ?
    `);
    const rows = stmt.all(limit) as Record<string, string>[];
    return rows.map(row => ({
      id: String(row.id),
      publishedAt: row.published_at,
      ticker: row.ticker,
      companyName: row.company_name,
      title: row.title,
      documentUrl: row.document_url,
      content: row.content,
      createdAt: row.created_at,
    }));
  }

  public close() {
    this.db.close();
  }
}
