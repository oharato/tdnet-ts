import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbClient } from '../src/db.js';

describe('DbClient search date ranges', () => {
    let db: DbClient;
    const insert = (id: string, publishedAt: string, ticker = '1234') => db.insertDocument({
        id, publishedAt, ticker, companyName: '架空株式会社', title: '配当のお知らせ',
        documentUrl: `https://example.invalid/${id}.pdf`, content: null, retryCount: 0,
        createdAt: '2026-10-01T00:00:00.000Z',
    });
    const ids = (options?: Parameters<DbClient['searchDocuments']>[1]) =>
        db.searchDocuments(undefined, options).map(doc => doc.id);

    beforeEach(() => {
        db = new DbClient(':memory:');
        insert('before', '2026-09-30T14:59:59.999Z');
        insert('start', '2026-09-30T15:00:00.000Z');
        insert('end', '2026-10-01T14:59:59.999Z');
        insert('after', '2026-10-01T15:00:00.000Z');
    });
    afterEach(() => db.close());

    it('includes the entire JST day and excludes both neighboring days', () => {
        expect(ids({ startDate: '2026-10-01', endDate: '2026-10-01' })).toEqual(['end', 'start']);
    });
    it('supports either bound alone', () => {
        expect(ids({ startDate: '2026-10-01' })).toEqual(['after', 'end', 'start']);
        expect(ids({ endDate: '2026-09-30' })).toEqual(['before']);
    });
    it('preserves inclusive timestamp bounds and normalizes explicit offsets', () => {
        expect(ids({ startDate: '2026-10-01T00:00:00+09:00', endDate: '2026-09-30T15:00:00Z' })).toEqual(['start']);
        expect(ids({ startDate: '2026-09-30T15:00:00.000Z', endDate: '2026-10-01T14:59:59.999Z' })).toEqual(['end', 'start']);
    });
    it('includes existing timestamps without milliseconds at an inclusive end', () => {
        insert('no-millis', '2026-10-01T10:00:00Z');
        insert('with-millis', '2026-10-01T10:00:00.000Z');
        expect(ids({ startDate: '2026-10-01T10:00:00Z', endDate: '2026-10-01T10:00:00Z' }).sort()).toEqual(['no-millis', 'with-millis']);
        expect(db.getDocument('no-millis')?.publishedAt).toBe('2026-10-01T10:00:00Z');
    });
    it('normalizes a negative offset and fractional timestamp without changing the instant', () => {
        expect(ids({ startDate: '2026-09-30T10:00:00-05:00', endDate: '2026-09-30T15:00:00.0Z' })).toEqual(['start']);
    });
    it('combines date bounds with existing keyword, ticker, title, limit and ordering', () => {
        insert('other', '2026-10-01T12:00:00.000Z', '9999');
        expect(db.searchDocuments('架空', { startDate: '2026-10-01', endDate: '2026-10-01', ticker: '1234', title: '配当', limit: 1 }).map(doc => doc.id)).toEqual(['end']);
        expect(ids()).toEqual(['after', 'end', 'other', 'start', 'before']);
    });
    it('handles leap days and year rollover', () => {
        insert('leap', '2024-02-29T14:59:59.999Z');
        insert('newyear', '2027-01-01T00:00:00.000Z');
        insert('yearend', '2026-12-31T14:59:59.999Z');
        expect(ids({ startDate: '2024-02-29', endDate: '2024-02-29' })).toEqual(['leap']);
        expect(ids({ startDate: '2026-12-31', endDate: '2026-12-31' })).toEqual(['yearend']);
    });
    it.each(['', '2026-02-29', '2026-04-31', '2026-13-01', '20261001', '2026-1-1', '2026-10-01T00:00:00', '2026-10-01T24:00:00Z', '2026-02-30T00:00:00Z', 'garbage'])('rejects invalid or ambiguous date %j', value => {
        expect(() => ids({ startDate: value })).toThrow('Invalid search date');
        expect(() => ids({ endDate: value })).toThrow('Invalid search date');
        expect(ids()).toHaveLength(4);
    });
    it('rejects reversed ranges including mixed day/timestamp bounds', () => {
        expect(() => ids({ startDate: '2026-10-02', endDate: '2026-10-01' })).toThrow('startDate');
        expect(() => ids({ startDate: '2026-10-02T00:00:00+09:00', endDate: '2026-10-01' })).toThrow('startDate');
    });
});
