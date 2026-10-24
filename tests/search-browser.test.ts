import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { DbClient } from '../src/db.js';
import { searchExport, validateExport, highlightExport } from '../src/search-browser.js';
import type { SearchOptions, TdnetDocument } from '../src/types.js';

const items: TdnetDocument[] = Array.from({ length: 55 }, (_, i) => ({
    id: String(i).padStart(3, '0'), ticker: i % 2 ? '130A' : '9999',
    title: i % 2 ? 'Ｍ＆Ａ　決定 優待' : '配当10%増額_確認', companyName: i % 2 ? 'ＡＢＣ架空社' : 'abc架空社',
    content: i % 3 ? '配当 決定 <架空> & 確認' : null,
    publishedAt: i < 30 ? '2026-09-30T15:00:00.000Z' : '2026-09-30T14:59:59.999Z',
    createdAt: '2026-10-01T00:00:00.000Z', documentUrl: `https://example.invalid/${i}.pdf`, retryCount: 0,
}));
let db: DbClient | undefined;
afterEach(() => { db?.close(); db = undefined; });

describe('browser and SQLite parity on the same exported fixture', () => {
    const cases: [string, SearchOptions][] = [
        ['', {}], ['　 ', { fields: ['body'] }], ['配当', {}], ['10%', { fields: ['title'] }],
        ['_', {}], ['\\', {}], ['ＡＢＣ', { fields: ['company'] }], ['abc', { fields: ['company'] }],
        ['"m&a 決定" 配当', { match: 'all', normalize: 'width-case' }],
        ['Ｍ＆Ａ 配当', { match: 'any', fields: ['title'], startDate: '2026-10-01', endDate: '2026-10-01', offset: 3, limit: 5 }],
        ['m&a 配当', { match: 'any', normalize: 'width-case', ticker: '130A', limit: 3, offset: 5 }],
        ['配当 決定', { match: 'all', fields: ['body'], title: 'ｍ＆ａ', normalize: 'width-case' }],
        ['é', {}], ['＂ＡＢＣ＂', { match: 'all', normalize: 'width-case' }],
    ];
    it.each(cases)('matches the DB for %j with %j', (query, options) => {
        db = new DbClient(':memory:'); items.forEach(item => db!.insertDocument(item));
        const opts = { match: 'literal' as const, ...options };
        expect(searchExport(items, query, opts)).toEqual(db.searchDocuments(query, opts));
    });
    it.each([
        ['"配当', { match: 'all' }], ['', { fields: [] }], ['', { match: 'legacy' }],
        ['', { startDate: '2026-02-30' }], ['', { startDate: '2026-10-02', endDate: '2026-10-01' }],
    ] as [string, SearchOptions][])('rejects invalid conditions %j %j', (query, options) => {
        expect(() => searchExport(items, query, options)).toThrow();
    });
    it('highlights raw phrases and symbols without modifying HTML entities', () => {
        expect(highlightExport('Ｍ＆Ａ <確認> &', 'm&a 確認 &', { match: 'any', normalize: 'width-case' })).toBe('<mark>Ｍ＆Ａ</mark> &lt;<mark>確認</mark>&gt; <mark>&amp;</mark>');
        expect(highlightExport('abc', 'ab bc', { match: 'any' })).toBe('<mark>abc</mark>');
    });
    it('allows omitted body and rejects malformed exports', () => {
        const { content: _content, ...withoutBody } = items[0];
        expect(validateExport([withoutBody])).toHaveLength(1);
        for (const invalid of [{}, [null], [{ ...items[0], title: null }], [items[0], items[0]]]) expect(() => validateExport(invalid)).toThrow();
    });
});

function appHarness() {
    const location = { search: '' };
    const stack = ['']; let cursor = 0;
    const listeners: Record<string, () => void> = {};
    const context: any = { URLSearchParams, localStorage: { getItem: () => null, setItem: () => {} }, location,
        history: { pushState: (_state: unknown, _title: string, url: string) => { stack.splice(++cursor); stack.push(url); location.search = url; } },
        window: { tdnetSearch: { searchExport, validateExport, highlightExport }, addEventListener: (name: string, fn: () => void) => { listeners[name] = fn; } },
        fetch: async () => ({ ok: true, json: async () => items }), marked: { setOptions() {}, parse: (text: string) => text },
    };
    runInNewContext(readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'), context);
    const app = context.window.tdnetApp();
    return { app, context, stack, back: () => { location.search = stack[--cursor]; listeners.popstate(); } };
}

describe('static Web state and evidence', () => {
    it('submits, repeats, pages, resets on condition change and restores browser Back', async () => {
        const { app, stack, back } = appHarness(); await app.init();
        app.filterYutai = false; app.itemsPerPage = 20; app.applySearch();
        const count = stack.length; app.applySearch(); expect(stack.length).toBe(count);
        app.goPage(2); expect(app.currentPage).toBe(2); expect(app.selected.id).toBe('020');
        app.searchQuery = '配当'; app.applySearch(); expect(app.currentPage).toBe(1);
        back(); expect(app.searchQuery).toBe(''); expect(app.currentPage).toBe(2);
        // A changed condition resets even if it produces exactly the same records.
        app.searchQuery = ' '; app.goPage(3); expect(app.currentPage).toBe(1);
    });
    it('clears stale selection on invalid input and recovers on the next search', async () => {
        const { app } = appHarness(); await app.init(); app.match = 'all'; app.searchQuery = '"未完'; app.applySearch();
        expect(app.searchError).not.toBe(''); expect(app.results).toHaveLength(0); expect(app.selected).toBeNull();
        app.searchQuery = ''; app.applySearch(); expect(app.searchError).toBe(''); expect(app.results.length).toBeGreaterThan(0);
    });
    it('shows load failures, clears stale data, and supports retry', async () => {
        const { app, context } = appHarness(); await app.init();
        context.fetch = async () => ({ ok: false }); await app.fetchData();
        expect(app.loadError).not.toBe(''); expect(app.selected).toBeNull(); expect(app.items).toHaveLength(0);
        context.fetch = async () => ({ ok: true, json: async () => items }); await app.fetchData(); expect(app.loadError).toBe('');
        context.fetch = async () => ({ ok: true, json: async () => ({ invalid: true }) }); await app.fetchData(); expect(app.loadError).not.toBe('');
    });
    it('keeps raw evidence escaped and displays dates in JST', async () => {
        const { app } = appHarness(); await app.init();
        expect(app.highlightText('Ｍ＆Ａ <script> &')).toBe('Ｍ＆Ａ &lt;script&gt; &amp;');
        expect(app.formatDate('2026-09-30T15:00:00.000Z')).toContain('2026/10/01');
        expect(app.formatDate('2026-09-30T15:00:00.000Z')).toContain('00:00');
    });
});
