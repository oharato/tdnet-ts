import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbClient } from '../src/db.js';
import { normalizeSearchText } from '../src/search-normalize.js';
import type { SearchOptions } from '../src/types.js';

describe('opt-in width/case search', () => {
    let db: DbClient;
    const add = (id: string, title: string, content: string | null, companyName = 'ＡＢＣ架空社', ticker = '130A', publishedAt = '2026-10-01T06:00:00.000Z') => db.insertDocument({
        id, title, content, companyName, ticker, publishedAt,
        documentUrl: `https://example.invalid/${id}`, retryCount: 0, createdAt: publishedAt,
    });
    const ids = (query?: string, options?: SearchOptions) => db.searchDocuments(query, options).map(doc => doc.id);
    const folded: SearchOptions = { match: 'literal', normalize: 'width-case' };
    beforeEach(() => {
        db = new DbClient(':memory:');
        add('a', 'Ｍ＆Ａ　決定', '配当１０％増額（確認）');
        add('b', 'M&A 決定', null, 'abc架空社');
        add('c', '別資料', '配当を維持', '別会社', '9999');
        add('old', 'Ｍ＆Ａ　決定', '配当１０％増額', 'ＡＢＣ架空社', '130A', '2026-09-30T14:59:59.999Z');
    });
    afterEach(() => db.close());

    it('keeps default literal and legacy behavior unchanged', () => {
        expect(ids('M&A', { match: 'literal' })).toEqual(['b']);
        expect(ids('Ｍ＆Ａ', { match: 'literal' })).toEqual(['a', 'old']);
        expect(ids('M&A')).toEqual(['b']);
        expect(ids('10%', { match: 'literal' })).toEqual([]);
    });
    it('matches width and ASCII case in either query direction', () => {
        expect(ids('m&a', folded)).toEqual(['a', 'b', 'old']);
        expect(ids('ｍ＆ａ', folded)).toEqual(['a', 'b', 'old']);
        expect(ids('abc', { ...folded, fields: ['company'] })).toEqual(['a', 'b', 'old']);
    });
    it('keeps raw records unchanged, including JSON-visible fields', () => {
        const before = db.getDocument('a');
        expect(db.searchDocuments('10%', folded)[0]).toEqual(before);
        expect(db.getDocument('a')).toEqual(before);
        expect(db.getDocument('a')?.content).toBe('配当１０％増額（確認）');
    });
    it('combines phrases, AND across fields, short Japanese words and NULL bodies', () => {
        expect(ids('"m&a 決定" 配当', { ...folded, match: 'all' })).toEqual(['a', 'old']);
        expect(ids('m&a abc', { ...folded, match: 'all' })).toEqual(['a', 'b', 'old']);
        expect(ids('配当', { ...folded, fields: ['body'] })).toEqual(['a', 'c', 'old']);
        expect(ids('m&a', { ...folded, fields: ['body'] })).toEqual([]);
    });
    it('applies OR, normalized title, exact ticker, JST day and pagination together', () => {
        const options: SearchOptions = { ...folded, match: 'any', ticker: '130A', title: 'm&a', startDate: '2026-10-01', endDate: '2026-10-01', limit: 1 };
        expect(ids('決定 配当', options)).toEqual(['a']);
        expect(ids('決定 配当', { ...options, offset: 1 })).toEqual(['b']);
        expect(ids('決定', { ...options, ticker: '１３０Ａ' })).toEqual([]);
    });
    it.each(['％', '＿', '＼', '＇ ＯＲ １＝１ －－'])('escapes metacharacters after folding %j', term => {
        add('symbol', `記号${term}終`, null);
        expect(ids(term, { ...folded, fields: ['title'] })).toEqual(['symbol']);
        expect(ids(undefined, { ...folded, title: term })).toEqual(['symbol']);
    });
    it('parses ASCII quotes before folding and preserves fullwidth quotes as text', () => {
        add('quoted', '＂ＡＢＣ＂', null);
        expect(ids('＂ＡＢＣ＂', { ...folded, match: 'all', fields: ['title'] })).toEqual(['quoted']);
        expect(() => ids('"abc', { ...folded, match: 'all' })).toThrow(/phrase/);
    });
    it('handles an empty normalized query without matching NULL by accident', () => {
        expect(ids('　 ', { ...folded, fields: ['body'], limit: 2 })).toEqual(['a', 'b']);
    });
    it('keeps ordinary searches available when SQLite custom functions are unsupported', () => {
        // Simulate the capability missing in Node 22.12 without changing any saved data.
        const connection = (db as unknown as { db: object }).db;
        Object.defineProperty(connection, 'function', { value: undefined });
        expect(ids('M&A', { match: 'literal' })).toEqual(['b']);
        expect(() => ids('m&a', folded)).toThrow('Node.js 22.13');
        expect(ids('Ｍ＆Ａ')).toEqual(['a', 'old']);
    });
    it('rejects unknown policies and legacy combinations even for empty queries', () => {
        expect(() => ids('', { normalize: 'width-case' })).toThrow(/requires match/);
        expect(() => ids('', { ...folded, normalize: 'nfkc' } as unknown as SearchOptions)).toThrow(/normalize/);
    });
});

describe('limited search folding', () => {
    it('changes only fullwidth ASCII, ideographic space and ASCII uppercase', () => {
        expect(normalizeSearchText('ＡＢＣ１２３％＿＼　abc')).toBe('abc123%_\\ abc');
        const untouched = '① Ⅳ ㌔ ㈱ ｶﾅ カナ が か\u3099 É é İ 😀';
        expect(normalizeSearchText(untouched)).toBe(untouched);
        const raw = '😀ＡＢＣ　（１０％）';
        expect(normalizeSearchText(raw).length).toBe(raw.length);
        expect(normalizeSearchText(normalizeSearchText(raw))).toBe(normalizeSearchText(raw));
    });
});
