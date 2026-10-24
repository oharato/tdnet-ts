import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbClient } from '../src/db.js';
import type { SearchOptions } from '../src/types.js';

describe('keyword search', () => {
    let db: DbClient;
    const add = (id: string, title: string, content: string | null, companyName = '架空会社', ticker = '1234', publishedAt = '2026-10-01T06:00:00.000Z') => db.insertDocument({
        id, title, content, companyName, ticker, publishedAt,
        documentUrl: `https://example.invalid/${id}.pdf`, retryCount: 0, createdAt: publishedAt,
    });
    const ids = (query?: string, options?: SearchOptions) => db.searchDocuments(query, options).map(row => row.id);
    beforeEach(() => {
        db = new DbClient(':memory:');
        add('a', '配当のお知らせ', '増額を決定');
        add('b', '配当 増額のお知らせ', null);
        add('c', '別のお知らせ', '配当を維持', '増額産業', '9999');
        add('d', '自己株式取得', '株主への還元');
        add('e', '自己株式の取得', '株主への還元');
        add('f', '過去の配当 増額', null, '架空会社', '1234', '2026-09-30T14:59:59.999Z');
    });
    afterEach(() => db.close());

    it('keeps legacy contiguous-query and wildcard semantics', () => {
        expect(ids('配当 増額')).toEqual(['b', 'f']);
        expect(ids('配当%増額')).toEqual(['b', 'f']);
        expect(ids('配当　増額')).toEqual([]);
        expect(ids(' ', { fields: ['title'] })).toEqual(['b', 'f']);
    });
    it('combines AND across selected fields, including company and NULL body', () => {
        expect(ids('配当 増額', { match: 'all' })).toEqual(['a', 'b', 'c', 'f']);
        expect(ids('配当 増額', { match: 'all', fields: ['title', 'body'] })).toEqual(['a', 'b', 'f']);
        expect(ids('配当 増額', { match: 'all', fields: ['title'] })).toEqual(['b', 'f']);
        expect(ids('配当 増額', { match: 'all', fields: ['body'] })).toEqual([]);
        expect(ids('増額', { match: 'all', fields: ['company'] })).toEqual(['c']);
    });
    it('OR remains grouped with ticker, title and JST date filters', () => {
        expect(ids('増額 還元', { match: 'any', ticker: '1234', title: 'お知らせ', startDate: '2026-10-01', endDate: '2026-10-01' })).toEqual(['a', 'b']);
    });
    it('supports quoted contiguous phrases and Japanese whitespace', () => {
        expect(ids('"配当 増額"', { match: 'all' })).toEqual(['b', 'f']);
        expect(ids('　配当\t増額\n', { match: 'all' })).toEqual(['a', 'b', 'c', 'f']);
        expect(ids('"自己株式取得" 還元', { match: 'all' })).toEqual(['d']);
        expect(ids('取得', { match: 'literal' })).toEqual(['d', 'e']);
        expect(ids('配当', { match: 'all' })).toEqual(['a', 'b', 'c', 'f']);
    });
    it('treats OR/AND as words rather than an implicit query language', () => {
        expect(ids('配当 OR 増額', { match: 'all' })).toEqual([]);
    });
    it.each([undefined, '', '  \t\n　'])('empty explicit query %j means no keyword constraint', query => {
        expect(ids(query, { match: 'all', ticker: '1234', limit: 2 })).toEqual(['a', 'b']);
        expect(ids(query, { match: 'any', fields: ['body'], limit: 2 })).toEqual(['a', 'b']);
    });
    it('literal mode keeps embedded spaces and quotes as characters', () => {
        add('g', '記号 "確認"', null);
        expect(ids('  配当 増額  ', { match: 'literal' })).toEqual(['b', 'f']);
        expect(ids('"確認"', { match: 'literal' })).toEqual(['g']);
    });
    it.each(['%', '_', '\\', '.', '(', "' OR 1=1 --"])('literal metacharacter %j does not broaden SQL matching', term => {
        add('g', `文字${term}文字`, `本文${term}本文`);
        expect(ids(term, { match: 'literal' })).toEqual(['g']);
        expect(ids(undefined, { match: 'all', title: term })).toEqual(['g']);
    });
    it('uses stable id tie-breaking and applies offset after filters', () => {
        expect(ids('配当', { match: 'all', limit: 2 })).toEqual(['a', 'b']);
        expect(ids('配当', { match: 'all', limit: 2, offset: 2 })).toEqual(['c', 'f']);
        expect(ids('配当', { match: 'all', offset: 3 })).toEqual(['f']);
        expect(ids('配当', { limit: 0 })).toEqual([]);
        expect(ids('配当', { limit: -1 })).toEqual(['a', 'b', 'c', 'f']);
    });
    it.each(['"配当', '配"当', '""', '" "', '"配当"増額'])('rejects invalid phrase %j', query => {
        expect(() => ids(query, { match: 'all' })).toThrow(/phrase/);
    });
    it('rejects unsafe field names, invalid modes and paging values even with an empty query', () => {
        for (const options of [
            { fields: [] }, { fields: ['title) OR 1=1 --'] }, { fields: ['toString'] },
            { match: 'invalid' }, { offset: -1 }, { offset: 0.5 }, { offset: NaN },
            { limit: NaN }, { limit: -2 }, { limit: 1.5 },
        ]) expect(() => ids('', options as SearchOptions)).toThrow();
        expect(ids('配当', { fields: ['title', 'title'], match: 'all' })).toEqual(['a', 'b', 'f']);
        expect(ids()).toHaveLength(6);
    });
});
