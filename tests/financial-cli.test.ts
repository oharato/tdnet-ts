import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbClient } from '../src/db.js';
import { TdnetManager } from '../src/index.js';
import { runCli } from '../src/cli.js';
import { parseXbrlZip } from '../src/xbrl/parser.js';
import { resolveFacts } from '../src/xbrl/context.js';
import { extractFinancialSummaryFromFacts } from '../src/financial/extractor.js';

function fixture(name: string): URL {
    return new URL(`./fixtures/xbrl/${name}`, import.meta.url);
}

async function captureLogs(run: () => Promise<void>): Promise<string> {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
    });
    try {
        await run();
    } finally {
        spy.mockRestore();
    }
    return lines.join('\n');
}

async function saveFixture(db: DbClient, name: string, documentId: string, ticker: string, companyName: string) {
    const parsed = await parseXbrlZip(await readFile(fixture(name)));
    const facts = resolveFacts(parsed);
    const summary = extractFinancialSummaryFromFacts(facts, { documentId, ticker, companyName });
    const now = '2026-11-08T00:00:00.000Z';
    db.saveXbrlExtraction({
        document: {
            documentId,
            xbrlUrl: null,
            status: 'parsed',
            periodType: summary.periodType,
            periodStart: summary.periodStart,
            periodEnd: summary.periodEnd,
            accountingStandard: summary.accountingStandard,
            isConsolidated: summary.isConsolidated,
            isRevision: false,
            factCount: facts.length,
            error: null,
            createdAt: now,
            updatedAt: now,
        },
        facts,
        summary,
    });
}

describe('screen / schema / parse CLI', () => {
    let directory: string;
    let dbPath: string;

    beforeAll(async () => {
        directory = await mkdtemp(path.join(tmpdir(), 'tdnet-financial-cli-'));
        dbPath = path.join(directory, 'tdnet.sqlite');
        const db = new DbClient(dbPath);
        await saveFixture(db, 'jgaap-23760-2026-q2.zip', 'doc-jgaap', '2376', '株式会社サイネックス');
        await saveFixture(db, 'ifrs-13750-2026-q2.zip', 'doc-ifrs', '1375', 'ユキグニファクトリー株式会社');
        db.close();
    });

    afterAll(async () => {
        await rm(directory, { recursive: true, force: true });
    });

    it('screen は --where の SQL 条件で tdnet_financial_summary を検索する', async () => {
        const output = await captureLogs(() => runCli([
            'screen', '--db', dbPath, '--where', 'roe_current >= 0.05', '--json',
        ]));
        const rows = JSON.parse(output) as Array<Record<string, any>>;
        expect(rows).toHaveLength(1);
        expect(rows[0].documentId).toBe('doc-ifrs');
        expect(rows[0].currentNetSales).toBe(23_491_000_000);
        expect(rows[0].roeCurrent).toBeGreaterThan(0.05);
    });

    it('screen は表形式でも出力し、limit/offset を適用する', async () => {
        const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});
        try {
            const output = await captureLogs(() => runCli([
                'screen', '--db', dbPath, '--where', 'is_consolidated = 1', '--limit', '1', '--offset', '1',
            ]));
            expect(output).toContain('スクリーニング結果 (1 件)');
            expect(tableSpy).toHaveBeenCalledTimes(1);
        } finally {
            tableSpy.mockRestore();
        }
    });

    it('schema --json は summary と facts の全カラムを返す', async () => {
        const output = await captureLogs(() => runCli(['schema', '--json']));
        const schema = JSON.parse(output) as {
            columns: Array<{ name: string }>;
            tables: Array<{ name: string; description: string; columns: Array<{ name: string; type: string; description: string }> }>;
            examples: Array<{ title: string; sql: string }>;
        };
        expect(schema.columns.map(column => column.name)).toContain('operating_margin_current');
        expect(schema.tables.map(table => table.name)).toEqual([
            'tdnet_financial_summary',
            'tdnet_financial_facts',
        ]);
        const summaryColumns = schema.tables[0].columns.map(column => column.name);
        expect(summaryColumns).toContain('operating_margin_current');
        expect(summaryColumns).toContain('free_cash_flow_current');
        expect(summaryColumns).toContain('prior_period_end');
        const factColumns = schema.tables[1].columns.map(column => column.name);
        expect(factColumns).toContain('scaled_value');
        expect(factColumns).toContain('dimensions');
        expect(factColumns).toContain('unresolved_reasons');
        expect(schema.tables.every(table => table.columns.every(column => column.type && column.description))).toBe(true);
        expect(schema.examples.length).toBeGreaterThan(0);
    });

    it('schema は人間向けに2テーブル分のカラム表を出す', async () => {
        const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});
        try {
            const output = await captureLogs(() => runCli(['schema']));
            expect(output).toContain('tdnet_financial_summary');
            expect(output).toContain('tdnet_financial_facts');
            expect(output).toContain('クエリ例');
            expect(tableSpy).toHaveBeenCalledTimes(2);
        } finally {
            tableSpy.mockRestore();
        }
    });

    it('parse は単一 ZIP の Fact・Context・サマリーを返す', async () => {
        const zipPath = fileURLToPath(fixture('jgaap-23760-2026-q2.zip'));
        const output = await captureLogs(() => runCli(['parse', zipPath, '--json']));
        const result = JSON.parse(output) as {
            documentId: string;
            factCount: number;
            contextCount: number;
            summary: { periodType: string; current: { netSales: number; operatingIncome: number } };
            facts: Array<{ name: string }>;
            contexts: Array<{ id: string; status: string }>;
        };
        expect(result.documentId).toBe('jgaap-23760-2026-q2');
        expect(result.factCount).toBe(345);
        expect(result.contextCount).toBe(53);
        expect(result.summary.periodType).toBe('Q2');
        expect(result.summary.current.netSales).toBe(7_071_000_000);
        expect(result.summary.current.operatingIncome).toBe(-325_000_000);
        expect(result.facts.some(fact => fact.name === 'NetSales')).toBe(true);
        expect(result.contexts.some(context => context.id === 'InterimDuration')).toBe(true);
    });

    it('ライブラリ API から screenFinancials を呼べる', () => {
        const manager = new TdnetManager(dbPath);
        try {
            const rows = manager.screenFinancials({ where: 'is_consolidated = 1' });
            expect(rows).toHaveLength(2);
            expect(rows.map(row => row.documentId).sort()).toEqual(['doc-ifrs', 'doc-jgaap']);
        } finally {
            manager.close();
        }
    });

    it('不正な limit は SQL 実行前に拒否する', () => {
        const db = new DbClient(':memory:');
        try {
            expect(() => db.screenFinancials({ limit: 1.5 })).toThrow('Screen limit');
            expect(() => db.screenFinancials({ offset: -1 })).toThrow('Screen offset');
        } finally {
            db.close();
        }
    });
});
