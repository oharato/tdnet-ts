import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, PdfParser, TdnetManager } from '../src/index.js';
import { disclosureFromApi } from '../src/sync-input.js';
import type { ApiDocumentItem } from '../src/types.js';
const row = (id = 'fixture', changes = {}): ApiDocumentItem => ({ Tdnet: { id, company_code: '130A0', company_name: '架空社',
    pubdate: '2026-10-01 00:00:00', title: '架空の配当', document_url: `https://example.invalid/${id}.pdf`, ...changes } });
describe('sync outcomes and input isolation', () => {
    let manager: TdnetManager;
    beforeEach(() => { manager = new TdnetManager(':memory:'); });
    afterEach(() => { manager.close(); vi.restoreAllMocks(); });
    const source = (items: ApiDocumentItem[]) => vi.spyOn(ApiClient.prototype, 'fetchRecent').mockResolvedValue({ items, total_count: items.length, condition_desc: 'fixture' });
    const parser = () => {
        vi.spyOn(PdfParser.prototype, 'downloadPdf').mockResolvedValue(new ArrayBuffer(0));
        vi.spyOn(PdfParser.prototype, 'parsePdfToMarkdown').mockResolvedValue('架空本文');
        return vi.spyOn(PdfParser.prototype, 'downloadAndParse').mockResolvedValue({ markdown: '架空本文', buffer: new ArrayBuffer(0) });
    };
    it('counts distinct IDs, duplicate records and invalid input without mutating source', async () => {
        const input = [row(), row(), row('bad', { pubdate: '2026-02-30 00:00:00' }), row('valid', { company_code: '1230' })];
        source(input); const parse = parser(); const before = JSON.stringify(input);
        const result = await manager.sync({ limit: 4, downloadDelayMs: 0 });
        expect(result).toMatchObject({ received: 4, duplicates: 1, invalid: 1, synced: 2, failed: 0, limitReached: true });
        expect(parse).toHaveBeenCalledTimes(2); expect(JSON.stringify(input)).toBe(before);
        expect(manager.search(undefined).map(d => d.ticker)).toEqual(['130A', '1230']);
    });
    it('reports three failed attempts then exhausted records on the next ordinary sync', async () => {
        source([row()]); const parse = parser().mockRejectedValue(new Error('fixture error'));
        const first = await manager.sync({ downloadDelayMs: 0 });
        expect(first).toMatchObject({ failed: 1, exhausted: 0 }); expect(first.documents[0].attempts).toBe(3);
        expect(manager.search(undefined)[0].retryCount).toBe(3);
        const next = await manager.sync({ downloadDelayMs: 0 });
        expect(next).toMatchObject({ failed: 0, exhausted: 1 }); expect(parse).toHaveBeenCalledTimes(3);
    });
    it('reports recovery within one invocation, then existing content', async () => {
        source([row()]); const parse = parser().mockRejectedValueOnce(new Error('temporary'));
        expect(await manager.sync({ downloadDelayMs: 0 })).toMatchObject({ synced: 1, failed: 0 });
        expect(await manager.sync({ downloadDelayMs: 0 })).toMatchObject({ existing: 1 }); expect(parse).toHaveBeenCalledTimes(2);
    });
    it('does not mark an empty extracted body as synced', async () => {
        source([row()]); parser().mockResolvedValue({ markdown: '   ', buffer: new ArrayBuffer(0) });
        expect(await manager.sync({ downloadDelayMs: 0 })).toMatchObject({ failed: 1 }); expect(manager.search(undefined)[0].content).toBeNull();
    });
    it('stores unsupported metadata but does not try to parse it', async () => {
        source([row('html', { document_url: 'https://example.invalid/fixture.html' })]); const parse = parser();
        expect(await manager.sync()).toMatchObject({ unsupported: 1 }); expect(parse).not.toHaveBeenCalled();
        expect(manager.search(undefined)).toHaveLength(1);
    });
    it('reports a local PDF save failure without losing a successfully extracted body', async () => {
        source([row()]); parser();
        const result = await manager.sync({ savePdfDir: '/dev/null/fixture' });
        expect(result).toMatchObject({ synced: 1, pdfSaveFailed: 1 }); expect(manager.search(undefined)[0].content).toBe('架空本文');
    });
    it.each([{ limit: 0 }, { limit: 1.5 }, { concurrency: 0 }, { concurrency: Infinity }, { downloadDelayMs: -1 }, { date: '20260230' }])('rejects options before acquisition: %j', async options => {
        const fetch = source([]); await expect(manager.sync(options)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
    });
    it('waits for other workers before returning a fatal database failure', async () => {
        source([row('a'), row('b')]); let release!: () => void;
        parser().mockImplementation(async url => { if (url.includes('/b.pdf')) await new Promise<void>(resolve => { release = resolve; }); return { markdown: 'fixture', buffer: new ArrayBuffer(0) }; });
        const db = (manager as any).db; const original = db.insertDocument.bind(db);
        vi.spyOn(db, 'insertDocument').mockImplementation((doc: any) => { if (doc.id === 'a') throw new Error('DB fixture'); original(doc); });
        let finished = false;
        const result = manager.sync({ downloadDelayMs: 0 }).finally(() => { finished = true; });
        const assertion = expect(result).rejects.toThrow('DB fixture');
        await new Promise(resolve => setImmediate(resolve)); expect(finished).toBe(false);
        release(); await assertion; expect(manager.search(undefined).map(doc => doc.id)).toEqual(['b']);
    });
    it('rejects missing response arrays instead of claiming success', async () => {
        source([]).mockResolvedValue({ items: undefined } as any); await expect(manager.sync()).rejects.toThrow(/items/);
    });
    it('preserves four-character trailing zero and validates the calendar/code/URL', () => {
        expect(disclosureFromApi(row('', { company_code: '1230', document_url: 'https://example.invalid/ABC.PDF?download=1' }))).toMatchObject({ id: 'ABC', ticker: '1230' });
        for (const changes of [{ company_code: '123456' }, { pubdate: '2026-10-01 24:00:00' }, { document_url: 'file:///tmp/a.pdf' }, { document_url: 'https://example.invalid/%2e%2e.pdf' }]) expect(() => disclosureFromApi(row('bad', changes))).toThrow();
    });
});
