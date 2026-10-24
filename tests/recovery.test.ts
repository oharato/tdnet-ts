import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApiClient, PdfParser, TdnetManager } from '../src/index.js';
import type { TdnetDocument } from '../src/types.js';
const doc = (id = 'fixture', content: string | null = null): TdnetDocument => ({ id, content, retryCount: 3,
    publishedAt: '2026-10-01T00:00:00.000Z', createdAt: '2026-10-01T01:00:00.000Z',
    ticker: '130A', title: '架空資料', companyName: '架空社', documentUrl: `https://example.invalid/${id}.pdf` });
describe('explicit saved-document recovery and original preservation', () => {
    let manager: TdnetManager, directory: string;
    beforeEach(() => {
        manager = new TdnetManager(':memory:'); directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tdnet-recovery-fixture-'));
        vi.spyOn(ApiClient.prototype, 'fetchRecent').mockRejectedValue(new Error('API must not be called'));
        vi.spyOn(PdfParser.prototype, 'downloadPdf').mockResolvedValue(new Uint8Array([37,80,68,70]).buffer);
        vi.spyOn(PdfParser.prototype, 'parsePdfToMarkdown').mockResolvedValue('架空復旧本文');
        vi.spyOn(PdfParser.prototype, 'downloadAndParse').mockRejectedValue(new Error('combined parser must not be called'));
    });
    afterEach(() => { manager.close(); fs.rmSync(directory, { recursive: true, force: true }); vi.restoreAllMocks(); });
    const seed = (record: TdnetDocument) => (manager as any).db.insertDocument(record);
    it('recovers an exhausted ID absent from the latest listing with a new bounded attempt budget', async () => {
        seed(doc()); const result = await manager.recover(['fixture', 'fixture'], { downloadDelayMs: 0 });
        expect(result).toMatchObject({ requested: 1, recovered: 1, failed: 0 }); expect(result.documents[0].attempts).toBe(1);
        expect(manager.search(undefined)[0]).toMatchObject({ content: '架空復旧本文', retryCount: 3, createdAt: doc().createdAt });
        expect(ApiClient.prototype.fetchRecent).not.toHaveBeenCalled();
    });
    it('keeps a downloaded original after all parse attempts fail, then reuses it on the next explicit recovery', async () => {
        seed(doc()); vi.mocked(PdfParser.prototype.parsePdfToMarkdown).mockRejectedValue(new Error('fixture parse failure'));
        const first = await manager.recover(['fixture'], { savePdfDir: directory });
        expect(first).toMatchObject({ failed: 1, pdfSaved: 1 }); expect(first.documents[0].attempts).toBe(3);
        expect(manager.search(undefined)[0].retryCount).toBe(6);
        expect(fs.readFileSync(path.join(directory, 'fixture.pdf'))).toEqual(Buffer.from([37,80,68,70]));
        vi.mocked(PdfParser.prototype.parsePdfToMarkdown).mockResolvedValue('次回成功');
        expect(await manager.recover(['fixture'], { savePdfDir: directory })).toMatchObject({ recovered: 1, pdfSaved: 0 });
        expect(PdfParser.prototype.downloadPdf).toHaveBeenCalledTimes(1);
    });
    it('adds an original after a body has been saved, without changing or re-parsing the body', async () => {
        const record = doc('saved', 'Ｍ＆Ａ 原文保持'); seed(record);
        expect(await manager.recover(['saved'], { savePdfDir: directory })).toMatchObject({ existing: 1, pdfSaved: 1 });
        expect(manager.search(undefined)[0]).toEqual(record); expect(PdfParser.prototype.parsePdfToMarkdown).not.toHaveBeenCalled();
        await manager.recover(['saved'], { savePdfDir: directory }); expect(PdfParser.prototype.downloadPdf).toHaveBeenCalledTimes(1);
    });
    it('does not overwrite an existing local original', async () => {
        seed(doc()); fs.writeFileSync(path.join(directory, 'fixture.pdf'), 'existing fixture');
        await manager.recover(['fixture'], { savePdfDir: directory });
        expect(PdfParser.prototype.downloadPdf).not.toHaveBeenCalled();
        expect(fs.readFileSync(path.join(directory, 'fixture.pdf'), 'utf8')).toBe('existing fixture');
        expect(PdfParser.prototype.parsePdfToMarkdown).toHaveBeenCalledWith(Buffer.from('existing fixture'), 180000);
    });
    it('reports missing IDs and leaves successful content alone when no save is requested', async () => {
        seed(doc('saved', 'saved body')); const result = await manager.recover(['missing', 'saved']);
        expect(result).toMatchObject({ missing: 1, existing: 1 }); expect(PdfParser.prototype.downloadPdf).not.toHaveBeenCalled();
        await expect(manager.recover([])).rejects.toThrow(/IDs/);
    });
    it('reports save failure separately while recovering the body', async () => {
        seed(doc()); const file = path.join(directory, 'not-a-directory'); fs.writeFileSync(file, 'fixture');
        expect(await manager.recover(['fixture'], { savePdfDir: file })).toMatchObject({ recovered: 1, pdfSaveFailed: 1 });
    });
    it('does not publish a partially written original and can retry saving later', async () => {
        seed(doc()); const write = fs.writeFileSync;
        const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation((...args: any[]) => {
            if (String(args[0]).includes('.tdnet-original-')) { write(args[0], 'partial'); throw new Error('fixture disk full'); }
            return (write as any)(...args);
        });
        expect(await manager.recover(['fixture'], { savePdfDir: directory })).toMatchObject({ recovered: 1, pdfSaveFailed: 1 });
        expect(fs.readdirSync(directory)).toEqual([]); spy.mockRestore();
        expect(await manager.recover(['fixture'], { savePdfDir: directory })).toMatchObject({ existing: 1, pdfSaved: 1 });
        expect(fs.readFileSync(path.join(directory, 'fixture.pdf'))).toEqual(Buffer.from([37,80,68,70]));
    });
    it('never follows local symlinks or unsafe stored IDs', async () => {
        seed(doc()); fs.writeFileSync(path.join(directory, 'other'), 'other'); fs.symlinkSync(path.join(directory, 'other'), path.join(directory, 'fixture.pdf'));
        expect(await manager.recover(['fixture'], { savePdfDir: directory })).toMatchObject({ failed: 1 });
        seed(doc('../unsafe')); expect(await manager.recover(['../unsafe'], { savePdfDir: directory })).toMatchObject({ failed: 1 });
        expect(PdfParser.prototype.downloadPdf).not.toHaveBeenCalled(); expect(PdfParser.prototype.parsePdfToMarkdown).not.toHaveBeenCalled();
    });
    it('saves original before parsing on ordinary sync and reuses it between rounds', async () => {
        vi.mocked(ApiClient.prototype.fetchRecent).mockResolvedValue({ items: [{ Tdnet: { id:'fresh',company_code:'130A0',company_name:'架空社',title:'架空',pubdate:'2026-10-01 09:00:00',document_url:'https://example.invalid/fresh.pdf' } }], total_count:1, condition_desc:'fixture' });
        vi.mocked(PdfParser.prototype.parsePdfToMarkdown).mockImplementation(async () => {
            expect(fs.existsSync(path.join(directory, 'fresh.pdf'))).toBe(true); throw new Error('fixture');
        });
        expect(await manager.sync({ savePdfDir: directory, downloadDelayMs:0 })).toMatchObject({ failed:1 });
        expect(PdfParser.prototype.downloadPdf).toHaveBeenCalledTimes(1);
    });
    it('ordinary sync can backfill an existing body original without re-parsing', async () => {
        seed(doc()); seed(doc('saved', 'body'));
        vi.mocked(ApiClient.prototype.fetchRecent).mockResolvedValue({ items: [{ Tdnet: { id:'saved',company_code:'130A0',company_name:'架空社',title:'架空',pubdate:'2026-10-01 09:00:00',document_url:'https://example.invalid/new-source/saved.pdf' } }], total_count:1, condition_desc:'fixture' });
        expect(await manager.sync({ savePdfDir: directory })).toMatchObject({ existing:1, pdfSaveFailed:0 });
        expect(PdfParser.prototype.downloadPdf).toHaveBeenCalledWith('https://example.invalid/saved.pdf', 180000);
        expect(PdfParser.prototype.parsePdfToMarkdown).not.toHaveBeenCalled(); expect(manager.search(undefined).find(d=>d.id==='saved')?.content).toBe('body');
    });
});
