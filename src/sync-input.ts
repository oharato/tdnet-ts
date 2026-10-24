import { searchDateBound } from './search-date.js';
import type { TdnetDocument } from './types.js';

export function validateSyncOptions(options: { limit?: number; concurrency?: number; downloadDelayMs?: number; date?: string }) {
    const limit = options.limit ?? 100, concurrency = options.concurrency ?? 2, downloadDelayMs = options.downloadDelayMs ?? 1000;
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Sync limit must be a positive integer.');
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Sync concurrency must be a positive integer.');
    if (!Number.isFinite(downloadDelayMs) || downloadDelayMs < 0) throw new Error('Sync downloadDelayMs must be nonnegative and finite.');
    if (options.date !== undefined) {
        const date = options.date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid sync date.');
        searchDateBound(date, false);
    }
    return { limit, concurrency, downloadDelayMs };
}

/** Validate once before processing so an invalid record cannot fail again in the error handler. */
export function disclosureFromApi(data: unknown): TdnetDocument {
    const item = (data as { Tdnet?: Record<string, unknown> } | null)?.Tdnet;
    if (!item || ['pubdate', 'company_code', 'company_name', 'title', 'document_url'].some(key => typeof item[key] !== 'string' || !item[key])) throw new Error('Missing disclosure fields.');
    const code = item.company_code as string;
    if (!/^[0-9A-Z]{4}(?:0)?$/.test(code)) throw new Error('Invalid company code.');
    const pubdate = item.pubdate as string;
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(pubdate)) throw new Error('Invalid disclosure date.');
    const publishedAt = searchDateBound(pubdate.replace(' ', 'T') + '+09:00', false).iso;
    const documentUrl = (item.document_url as string).replace(/^https:\/\/webapi\.yanoshin\.jp\/rd\.php\?/, '');
    const url = new URL(documentUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid document URL.');
    const id = url.pathname.split('/').pop()?.replace(/\.pdf$/i, '') || String(item.id ?? '');
    if (!/^[a-zA-Z0-9_.-]+$/.test(id) || id === '.' || id === '..') throw new Error('Invalid document ID.');
    return { id, publishedAt, ticker: code.length === 5 ? code.slice(0, -1) : code,
        companyName: item.company_name as string, title: item.title as string, documentUrl,
        content: null, retryCount: 0, createdAt: new Date().toISOString() };
}
