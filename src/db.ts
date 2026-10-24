import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { TdnetDocument, SearchOptions } from './types.js';
import { searchDateBound } from './search-date.js';
import { literalPattern, searchColumns, searchTerms } from './search-query.js';

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
    const columns = searchColumns(options?.fields);
    const terms = searchTerms(keyword, match);
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
      sql += match === 'legacy' ? ` AND title LIKE ?` : ` AND title LIKE ? ESCAPE '\\'`;
      params.push(match === 'legacy' ? `%${options.title}%` : literalPattern(options.title));
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
