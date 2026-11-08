import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { ApiClient, PdfParser, TdnetManager } from '../src/index.js';
import { disclosureFromApi } from '../src/sync-input.js';
import { XbrlDownloader } from '../src/xbrl/download.js';
import type { ApiDocumentItem } from '../src/types.js';

function fixture(name: string): URL {
    return new URL(`./fixtures/xbrl/${name}`, import.meta.url);
}

function row(id: string, xbrlUrl: string | null): ApiDocumentItem {
    return {
        Tdnet: {
            id,
            pubdate: '2026-11-06 15:00:00',
            company_code: '23760',
            company_name: '株式会社サイネックス',
            title: '第2四半期決算短信〔日本基準〕（連結）',
            document_url: `https://example.invalid/${id}.pdf`,
            url_xbrl: xbrlUrl,
        },
    };
}

function source(items: ApiDocumentItem[]) {
    return vi.spyOn(ApiClient.prototype, 'fetchRecent').mockResolvedValue({ items, total_count: items.length });
}

function pdf() {
    return vi.spyOn(PdfParser.prototype, 'downloadAndParse').mockResolvedValue({
        markdown: '架空本文',
        buffer: new ArrayBuffer(0),
    });
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
                <xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2027-03-31</xbrli:endDate></xbrli:period>
            </xbrli:context>
        </ix:resources></ix:header>
        <p><ix:nonNumeric name="tse-ed-t:DocumentName" contextRef="CurrentYearDuration">業績予想の修正に関するお知らせ</ix:nonNumeric></p>
    </body></html>`);
    return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

describe('sync with XBRL', () => {
    afterEach(() => vi.restoreAllMocks());

    it('PDF と XBRL を独立して同期し、取込済み XBRL は再取得しない', async () => {
        const manager = new TdnetManager(':memory:');
        try {
            source([row('doc-1', 'https://example.invalid/081220261105565082.zip')]);
            const pdfParse = pdf();
            const download = vi.spyOn(XbrlDownloader.prototype, 'download').mockResolvedValue(await fixtureBytes());

            const first = await manager.sync({ downloadDelayMs: 0 });
            expect(first).toMatchObject({ synced: 1, failed: 0, xbrl: { synced: 1, failed: 0 } });
            expect(first.xbrl.documents[0]).toMatchObject({ id: 'doc-1', status: 'synced', factCount: 345 });
            expect(first.xbrl.documents[0].bytes).toBeGreaterThan(0);
            expect(first.xbrl.documents[0].durationMs).toBeGreaterThanOrEqual(0);

            const db = (manager as any).db;
            expect(db.getFinancialSummary('doc-1')?.current.netSales).toBe(7_071_000_000);
            expect(db.getFinancialFacts('doc-1')).toHaveLength(345);
            expect(db.getXbrlDocument('doc-1')).toMatchObject({
                status: 'parsed',
                xbrlUrl: 'https://example.invalid/081220261105565082.zip',
                factCount: 345,
            });

            const second = await manager.sync({ downloadDelayMs: 0 });
            expect(second).toMatchObject({ existing: 1, xbrl: { existing: 1 } });
            expect(pdfParse).toHaveBeenCalledTimes(1);
            expect(download).toHaveBeenCalledTimes(1);
        } finally {
            manager.close();
        }
    });

    it('PDF が失敗しても XBRL の取込は成功する', async () => {
        const manager = new TdnetManager(':memory:');
        try {
            source([row('doc-1', 'https://example.invalid/0812.zip')]);
            pdf().mockRejectedValue(new Error('PDF fixture error'));
            vi.spyOn(XbrlDownloader.prototype, 'download').mockResolvedValue(await fixtureBytes());

            const result = await manager.sync({ downloadDelayMs: 0 });
            expect(result).toMatchObject({ failed: 1, synced: 0, xbrl: { synced: 1, failed: 0 } });
            expect((manager as any).db.getFinancialSummary('doc-1')?.current.netSales).toBe(7_071_000_000);
        } finally {
            manager.close();
        }
    });

    it('XBRL が失敗しても PDF の同期は成功し、次回は XBRL だけ再試行する', async () => {
        const manager = new TdnetManager(':memory:');
        try {
            source([row('doc-1', 'https://example.invalid/0812.zip')]);
            pdf();
            const download = vi.spyOn(XbrlDownloader.prototype, 'download').mockRejectedValueOnce(new Error('XBRL fixture error'));

            const first = await manager.sync({ downloadDelayMs: 0 });
            expect(first).toMatchObject({ synced: 1, failed: 0, xbrl: { synced: 0, failed: 1 } });
            expect((manager as any).db.getXbrlDocument('doc-1')?.status).toBe('failed');
            expect((manager as any).db.getFinancialSummary('doc-1')).toBeUndefined();

            download.mockResolvedValue(await fixtureBytes());
            const second = await manager.sync({ downloadDelayMs: 0 });
            expect(second).toMatchObject({ existing: 1, xbrl: { synced: 1, failed: 0 } });
            expect(download).toHaveBeenCalledTimes(2);
        } finally {
            manager.close();
        }
    });

    it('決算短信でない XBRL は skipped として記録し、Fact を保存しない', async () => {
        const manager = new TdnetManager(':memory:');
        try {
            source([row('doc-1', 'https://example.invalid/0912.zip')]);
            pdf();
            const download = vi.spyOn(XbrlDownloader.prototype, 'download').mockResolvedValue(await notSummaryZip());

            const first = await manager.sync({ downloadDelayMs: 0 });
            expect(first).toMatchObject({ synced: 1, xbrl: { synced: 0, skipped: 1 } });
            const db = (manager as any).db;
            expect(db.getXbrlDocument('doc-1')).toMatchObject({ status: 'skipped', factCount: 0 });
            expect(db.getFinancialSummary('doc-1')).toBeUndefined();
            expect(db.getFinancialFacts('doc-1')).toHaveLength(0);

            const second = await manager.sync({ downloadDelayMs: 0 });
            expect(second).toMatchObject({ existing: 1, xbrl: { existing: 1 } });
            expect(download).toHaveBeenCalledTimes(1);
        } finally {
            manager.close();
        }
    });

    it('訂正短信は別文書としてそれぞれ保存する', async () => {
        const manager = new TdnetManager(':memory:');
        try {
            source([
                row('doc-original', 'https://example.invalid/0812a.zip'),
                row('doc-revision', 'https://example.invalid/0812b.zip'),
            ]);
            pdf();
            vi.spyOn(XbrlDownloader.prototype, 'download').mockResolvedValue(await fixtureBytes());

            const result = await manager.sync({ downloadDelayMs: 0 });
            expect(result).toMatchObject({ synced: 2, xbrl: { synced: 2 } });
            const db = (manager as any).db;
            expect(db.getFinancialSummary('doc-original')?.documentId).toBe('doc-original');
            expect(db.getFinancialSummary('doc-revision')?.documentId).toBe('doc-revision');
        } finally {
            manager.close();
        }
    });

    it('url_xbrl を正規化し、不正な URL は未対応として扱う', () => {
        const base = row('doc-1', null).Tdnet;
        expect(disclosureFromApi({ Tdnet: {
            ...base,
            url_xbrl: 'https://webapi.yanoshin.jp/rd.php?https://www.release.tdnet.info/inbs/081220261105565082.zip',
        } }).xbrlUrl).toBe('https://www.release.tdnet.info/inbs/081220261105565082.zip');
        expect(disclosureFromApi({ Tdnet: { ...base, url_xbrl: 'file:///tmp/a.zip' } }).xbrlUrl).toBeNull();
        expect(disclosureFromApi({ Tdnet: { ...base, url_xbrl: 'https://example.invalid/a.pdf' } }).xbrlUrl).toBeNull();
        // 一部 limit のラッパーなし応答も受け付ける。
        expect(disclosureFromApi(base).id).toBe('doc-1');
    });
});
