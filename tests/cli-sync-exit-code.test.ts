import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ApiClient, PdfParser } from '../src/index.js';
import { runCli } from '../src/cli.js';
import { XbrlDownloader } from '../src/xbrl/download.js';
import type { ApiDocumentItem } from '../src/types.js';

const row = (id = 'fixture', changes = {}): ApiDocumentItem => ({ Tdnet: { id, company_code: '130A0', company_name: '架空社',
    pubdate: '2026-10-01 00:00:00', title: '架空の配当', document_url: `https://example.invalid/${id}.pdf`, ...changes } });

const source = (items: ApiDocumentItem[]) => vi.spyOn(ApiClient.prototype, 'fetchRecent').mockResolvedValue({ items, total_count: items.length });

async function runSync(args: string[]): Promise<Record<string, any>> {
    const lines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => { lines.push(values.map(String).join(' ')); });
    try {
        await runCli(['sync', ...args]);
    } finally {
        log.mockRestore();
    }
    return JSON.parse(lines.join('\n')) as Record<string, any>;
}

describe('sync CLI exit codes', () => {
    afterEach(() => {
        process.exitCode = 0;
        vi.restoreAllMocks();
    });

    it('invalid だけなら終了コード0のまま、件数は集計に残す', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'tdnet-exit-code-'));
        try {
            source([row(), row('bad', { pubdate: '2026-02-30 00:00:00' })]);
            vi.spyOn(PdfParser.prototype, 'downloadAndParse').mockResolvedValue({ markdown: '架空本文', buffer: new ArrayBuffer(0) });

            const output = await runSync(['--db', path.join(directory, 'test.sqlite'), '--limit', '10']);

            expect(output).toMatchObject({ received: 2, invalid: 1, synced: 1, failed: 0, exhausted: 0, unsupported: 0, pdfSaveFailed: 0 });
            expect(process.exitCode ?? 0).toBe(0);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it('PDF 取り込みの failed が1件でもあれば終了コード2', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'tdnet-exit-code-'));
        try {
            source([row()]);
            vi.spyOn(PdfParser.prototype, 'downloadAndParse').mockRejectedValue(new Error('fixture error'));

            const output = await runSync(['--db', path.join(directory, 'test.sqlite'), '--limit', '10']);

            expect(output).toMatchObject({ failed: 1 });
            expect(process.exitCode).toBe(2);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it('xbrl-only で xbrl.failed があれば終了コード2', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'tdnet-exit-code-'));
        try {
            source([row('fixture', { url_xbrl: 'https://example.invalid/fixture.zip' })]);
            vi.spyOn(XbrlDownloader.prototype, 'download').mockRejectedValue(new Error('XBRL fixture error'));

            const output = await runSync(['--db', path.join(directory, 'test.sqlite'), '--limit', '10', '--xbrl-only']);

            expect(output).toMatchObject({ failed: 0, xbrl: { failed: 1 } });
            expect(process.exitCode).toBe(2);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
