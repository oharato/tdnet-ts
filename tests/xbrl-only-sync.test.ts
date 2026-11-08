import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { ApiClient, PdfParser, TdnetManager } from '../src/index.js';
import { runCli } from '../src/cli.js';
import { XbrlDownloader } from '../src/xbrl/download.js';
import type { ApiDocumentItem } from '../src/types.js';

function fixture(name: string): URL {
    return new URL(`./fixtures/xbrl/${name}`, import.meta.url);
}

function row(id: string, xbrlUrl: string | null): ApiDocumentItem {
    return {
        Tdnet: {
            id,
            pubdate: '2023-11-08 15:00:00',
            company_code: '23760',
            company_name: '株式会社サイネックス',
            title: '第2四半期決算短信〔日本基準〕（連結）',
            document_url: `https://example.invalid/${id}.pdf`,
            url_xbrl: xbrlUrl,
        },
    };
}

function source(items: ApiDocumentItem[]) {
    return vi.spyOn(ApiClient.prototype, 'fetchByDate').mockResolvedValue({ items, total_count: items.length });
}

async function fixtureBytes(): Promise<Uint8Array> {
    return new Uint8Array(await readFile(fixture('jgaap-23760-2026-q2.zip')));
}

async function notSummaryZip(): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file('XBRLData/Summary/not-summary-ixbrl.htm', `<!DOCTYPE html><html><body>
        <ix:header><ix:resources>
            <xbrli:context id="CurrentYearDuration">
                <xbrli:entity><xbrli:identifier scheme="http://example.com">1234</xbrli:identifier></xbrli:entity>
                <xbrli:period><xbrli:startDate>2023-04-01</xbrli:startDate><xbrli:endDate>2024-03-31</xbrli:endDate></xbrli:period>
            </xbrli:context>
        </ix:resources></ix:header>
        <p><ix:nonNumeric name="tse-ed-t:DocumentName" contextRef="CurrentYearDuration">業績予想の修正に関するお知らせ</ix:nonNumeric></p>
    </body></html>`);
    return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

describe('sync --xbrl-only', () => {
    afterEach(() => vi.restoreAllMocks());

    it('PDF を一切取得・変換・保存せず、XBRL だけを取り込む', async () => {
        const manager = new TdnetManager(':memory:');
        try {
            source([
                row('doc-ok', 'https://example.invalid/ok.zip'),
                row('doc-none', null),
                row('doc-other', 'https://example.invalid/other.zip'),
            ]);
            const pdfParse = vi.spyOn(PdfParser.prototype, 'downloadAndParse');
            const pdfDownload = vi.spyOn(PdfParser.prototype, 'downloadPdf');
            const pdfToMarkdown = vi.spyOn(PdfParser.prototype, 'parsePdfToMarkdown');
            const summaryZip = await notSummaryZip();
            const download = vi.spyOn(XbrlDownloader.prototype, 'download').mockImplementation(async url =>
                url.endsWith('/other.zip') ? summaryZip : await fixtureBytes());

            const result = await manager.sync({ date: '2023-11-08', limit: 10, downloadDelayMs: 0, xbrlOnly: true });

            expect(result).toMatchObject({
                received: 3,
                duplicates: 0,
                invalid: 0,
                synced: 0,
                existing: 0,
                failed: 0,
                exhausted: 0,
                unsupported: 0,
                pdfSaveFailed: 0,
                documents: [],
                xbrl: { synced: 1, existing: 0, skipped: 2, failed: 0, unsupported: 0 },
            });
            expect(download).toHaveBeenCalledTimes(2);
            expect(download).toHaveBeenCalledWith('https://example.invalid/ok.zip', undefined, '23760');
            expect(pdfParse).not.toHaveBeenCalled();
            expect(pdfDownload).not.toHaveBeenCalled();
            expect(pdfToMarkdown).not.toHaveBeenCalled();

            const db = (manager as any).db;
            expect(db.getDocument('doc-ok')).toBeUndefined();
            expect(db.getXbrlDocument('doc-ok')).toMatchObject({ status: 'parsed', factCount: 345 });
            expect(db.getFinancialSummary('doc-ok')?.current.netSales).toBe(7_071_000_000);
            expect(db.getFinancialFacts('doc-ok')).toHaveLength(345);
            expect(db.getXbrlDocument('doc-none')).toMatchObject({ status: 'skipped', xbrlUrl: null, factCount: 0 });
            expect(db.getXbrlDocument('doc-other')).toMatchObject({ status: 'skipped', factCount: 0 });
            expect(db.getFinancialFacts('doc-other')).toHaveLength(0);
            expect(db.getFinancialSummary('doc-other')).toBeUndefined();
        } finally {
            manager.close();
        }
    });

    it('取込済み・スキップ済みは再取得せず existing として数える', async () => {
        const manager = new TdnetManager(':memory:');
        try {
            source([
                row('doc-ok', 'https://example.invalid/ok.zip'),
                row('doc-none', null),
                row('doc-other', 'https://example.invalid/other.zip'),
            ]);
            const summaryZip = await notSummaryZip();
            const download = vi.spyOn(XbrlDownloader.prototype, 'download').mockImplementation(async url =>
                url.endsWith('/other.zip') ? summaryZip : await fixtureBytes());

            await manager.sync({ date: '2023-11-08', limit: 10, downloadDelayMs: 0, xbrlOnly: true });
            const second = await manager.sync({ date: '2023-11-08', limit: 10, downloadDelayMs: 0, xbrlOnly: true });

            expect(second).toMatchObject({ xbrl: { synced: 0, existing: 3, skipped: 0, failed: 0 } });
            expect(download).toHaveBeenCalledTimes(2);
        } finally {
            manager.close();
        }
    });

    it('XBRL の取得失敗は failed として記録し、次回 XBRL だけ再試行する', async () => {
        const manager = new TdnetManager(':memory:');
        try {
            source([row('doc-ok', 'https://example.invalid/ok.zip')]);
            const pdfParse = vi.spyOn(PdfParser.prototype, 'downloadAndParse');
            const download = vi.spyOn(XbrlDownloader.prototype, 'download').mockRejectedValueOnce(new Error('XBRL fixture error'));

            const first = await manager.sync({ date: '2023-11-08', limit: 10, downloadDelayMs: 0, xbrlOnly: true });
            expect(first).toMatchObject({ failed: 0, xbrl: { synced: 0, failed: 1 } });
            expect((manager as any).db.getXbrlDocument('doc-ok')).toMatchObject({ status: 'failed', error: 'XBRL fixture error' });

            download.mockResolvedValue(await fixtureBytes());
            const second = await manager.sync({ date: '2023-11-08', limit: 10, downloadDelayMs: 0, xbrlOnly: true });
            expect(second).toMatchObject({ xbrl: { synced: 1, failed: 0 } });
            expect(download).toHaveBeenCalledTimes(2);
            expect(pdfParse).not.toHaveBeenCalled();
        } finally {
            manager.close();
        }
    });

    it('不正な xbrlOnly は一覧取得前に拒否する', async () => {
        const manager = new TdnetManager(':memory:');
        try {
            const fetch = source([]);
            await expect(manager.sync({ xbrlOnly: 'yes' as any })).rejects.toThrow('xbrlOnly');
            expect(fetch).not.toHaveBeenCalled();
        } finally {
            manager.close();
        }
    });

    it('CLI --xbrl-only は PDF を呼ばず、XBRL の集計だけを返す', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'tdnet-xbrl-only-'));
        const dbPath = path.join(directory, 'test.sqlite');
        try {
            source([row('doc-ok', 'https://example.invalid/ok.zip'), row('doc-none', null)]);
            const pdfParse = vi.spyOn(PdfParser.prototype, 'downloadAndParse');
            vi.spyOn(XbrlDownloader.prototype, 'download').mockResolvedValue(await fixtureBytes());
            const lines: string[] = [];
            const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')); });
            try {
                await runCli(['sync', '--db', dbPath, '--date', '2023-11-08', '--limit', '10', '--xbrl-only']);
            } finally {
                log.mockRestore();
            }
            const output = JSON.parse(lines.join('\n')) as Record<string, any>;
            expect(output).toMatchObject({ documents: [], xbrl: { synced: 1, skipped: 1, failed: 0 } });
            expect(pdfParse).not.toHaveBeenCalled();
            expect(process.exitCode ?? 0).toBe(0);
        } finally {
            process.exitCode = 0;
            await rm(directory, { recursive: true, force: true });
        }
    });

    it('CLI --xbrl-only は XBRL 失敗時に終了コード2を返す', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'tdnet-xbrl-only-'));
        const dbPath = path.join(directory, 'test.sqlite');
        try {
            source([row('doc-ok', 'https://example.invalid/ok.zip')]);
            vi.spyOn(XbrlDownloader.prototype, 'download').mockRejectedValue(new Error('XBRL fixture error'));
            const log = vi.spyOn(console, 'log').mockImplementation(() => {});
            try {
                await runCli(['sync', '--db', dbPath, '--date', '2023-11-08', '--limit', '10', '--xbrl-only']);
            } finally {
                log.mockRestore();
            }
            expect(process.exitCode).toBe(2);
        } finally {
            process.exitCode = 0;
            await rm(directory, { recursive: true, force: true });
        }
    });
});
