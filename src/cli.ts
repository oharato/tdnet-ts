#!/usr/bin/env -S node --no-warnings

import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TdnetManager } from './index.js';
import type { SearchOptions } from './types.js';
import { searchTerms } from './search-query.js';
import { normalizeSearchText } from './search-normalize.js';
import { parseXbrlZip } from './xbrl/parser.js';
import { resolveContexts, resolveFacts } from './xbrl/context.js';
import { extractFinancialSummaryFromFacts } from './financial/extractor.js';
import { FINANCIAL_SCHEMAS, QUERY_EXAMPLES } from './financial/schema-info.js';

function formatYen(value: number | undefined): string {
    return value === undefined ? '-' : (value / 100_000_000).toFixed(1);
}

function formatPercent(value: number | undefined): string {
    return value === undefined ? '-' : (value * 100).toFixed(2);
}

function truncate(value: string | null, length: number): string {
    if (!value) return '-';
    return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

export async function runCli(args: string[] = process.argv.slice(2)) {
    const { values, positionals } = parseArgs({
        args,
        options: {
            limit: {
                type: 'string',
                short: 'l',
            },
            date: {
                type: 'string',
                short: 'd',
            },
            db: {
                type: 'string',
            },
            json: {
                type: 'boolean',
            },
            'save-pdf': {
                type: 'string',
            },
            'xbrl-only': {
                type: 'boolean',
            },
            content: {
                type: 'boolean',
                short: 'c',
            },
            ticker: {
                type: 'string',
                short: 't',
            },
            title: {
                type: 'string',
            },
            start: {
                type: 'string',
                short: 's',
            },
            match: { type: 'string' },
            normalize: { type: 'string' },
            fields: { type: 'string' },
            offset: { type: 'string' },
            where: {
                type: 'string',
                short: 'w',
            },
            end: {
                type: 'string',
                short: 'e',
            }
        },
        allowPositionals: true,
    });

    const command = positionals[0] ? String(positionals[0]) : 'help';
    const dbPath = values.db ? path.resolve(process.cwd(), String(values.db)) : undefined;
    let manager: TdnetManager | undefined;
    const getManager = () => (manager ??= new TdnetManager(dbPath));

    try {
        switch (command) {
            case 'sync': {
                const limit = values.limit !== undefined ? Number(values.limit) : 100;
                const date = values.date ? String(values.date) : undefined;
                const savePdfDir = values['save-pdf'] ? String(values['save-pdf']) : undefined;
                const xbrlOnly = values['xbrl-only'] === true;
                const result = await getManager().sync({ limit, date, savePdfDir, xbrlOnly });
                console.log(JSON.stringify(result, null, 2));
                // XBRL 専用モードでは PDF の集計は常に 0 なので、XBRL の失敗を終了コードに反映する。
                // invalid は TDnet API レコード側の形式不正（disclosureFromApi の変換エラー）であり、
                // 取り込み処理自体の失敗ではないため、終了コードには反映しない（集計には残す）。
                if (result.failed || result.exhausted || result.unsupported || result.pdfSaveFailed
                    || (xbrlOnly && result.xbrl.failed)) process.exitCode = 2;
                break;
            }

            case 'recover': {
                const result = await getManager().recover(positionals.slice(1), { savePdfDir: values['save-pdf'] });
                console.log(JSON.stringify(result, null, 2));
                if (result.failed || result.missing || result.pdfSaveFailed) process.exitCode = 2;
                break;
            }

            case 'search': {
                if (positionals.length > 2) throw new Error('Wrap the search query in shell quotes.');
                const keyword = positionals[1] ? String(positionals[1]) : undefined;

                const limit = values.limit ? parseInt(String(values.limit), 10) : 100;

                const searchOptions: SearchOptions = {
                    match: values.match as SearchOptions['match'],
                    normalize: values.normalize as SearchOptions['normalize'],
                    fields: values.fields?.split(',').map(field => field.trim()) as SearchOptions['fields'],
                    offset: values.offset !== undefined ? Number(values.offset) : undefined,
                    ticker: values.ticker ? String(values.ticker) : undefined,
                    title: values.title ? String(values.title) : undefined,
                    startDate: values.start ? String(values.start) : undefined,
                    endDate: values.end ? String(values.end) : undefined,
                    limit: values.limit !== undefined ? Number(values.limit) : limit,
                };
                const results = getManager().search(keyword, searchOptions);
                const fold = searchOptions.normalize === 'width-case';
                const terms = searchTerms(keyword, searchOptions.match).map(term => fold ? normalizeSearchText(term) : term);
                const comparable = (text: string) => fold ? normalizeSearchText(text) : text.toLowerCase();

                if (values.json) {
                    const jsonOutput = results.map(doc => {
                        let snippet = undefined;
                        if (doc.content && keyword && (!searchOptions.fields || searchOptions.fields.includes('body'))) {
                            const contentLower = comparable(doc.content);
                            const matched = terms.find(term => contentLower.includes(comparable(term)));
                            const keywordLower = matched === undefined ? undefined : comparable(matched);
                            const index = keywordLower ? contentLower.indexOf(keywordLower) : -1;

                            if (index !== -1) {
                                const snippetStart = Math.max(0, index - 30);
                                const snippetEnd = Math.min(doc.content.length, index + (keywordLower?.length ?? 0) + 30);
                                snippet = doc.content.substring(snippetStart, snippetEnd).replace(/\n/g, ' ');

                                if (snippetStart > 0) snippet = '...' + snippet;
                                if (snippetEnd < doc.content.length) snippet = snippet + '...';
                            }
                        }

                        return {
                            id: doc.id,
                            publishedAt: doc.publishedAt,
                            ticker: doc.ticker,
                            companyName: doc.companyName,
                            title: doc.title,
                            documentUrl: doc.documentUrl,
                            snippet,
                            ...(values.content ? { content: doc.content } : {}),
                        };
                    });
                    console.log(JSON.stringify(jsonOutput, null, 2));
                    break;
                }

                const displayKeyword = keyword || (values.title ? `title:${values.title}` : (values.ticker ? `ticker:${values.ticker}` : 'all'));
                console.log(`Found ${results.length} records matching "${displayKeyword}":\n`);
                for (const doc of results) {
                    console.log(`\n[${doc.publishedAt}] ${doc.ticker} ${doc.companyName}`);
                    console.log(`Title: ${doc.title}`);
                    console.log(`URL: ${doc.documentUrl}`);
                    console.log(`ID: ${doc.id}`);

                    // Create snippet if content is available and contains keyword
                    if (doc.content && keyword && (!searchOptions.fields || searchOptions.fields.includes('body'))) {
                        const contentLower = comparable(doc.content);
                        const matched = terms.find(term => contentLower.includes(comparable(term)));
                        const keywordLower = matched === undefined ? undefined : comparable(matched);
                        const index = keywordLower ? contentLower.indexOf(keywordLower) : -1;

                        if (index !== -1) {
                            const snippetStart = Math.max(0, index - 30);
                            const snippetEnd = Math.min(doc.content.length, index + (keywordLower?.length ?? 0) + 30);
                            let snippet = doc.content.substring(snippetStart, snippetEnd).replace(/\n/g, ' ');

                            if (snippetStart > 0) snippet = '...' + snippet;
                            if (snippetEnd < doc.content.length) snippet = snippet + '...';

                            // highlight the keyword in terminal
                            const reset = '\x1b[0m';
                            const red = '\x1b[31m';
                            const originalMatch = doc.content.slice(index, index + (keywordLower?.length ?? 0));
                            const escaped = originalMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const regex = new RegExp(`(${escaped})`, 'gi');
                            const highlightedSnippet = snippet.replace(regex, `${red}$1${reset}`);

                            console.log(`Snippet: ${highlightedSnippet}`);
                        }
                    }

                    if (values.content && doc.content) {
                        console.log(`\n--- Content Start ---`);
                        console.log(doc.content);
                        console.log(`--- Content End ---\n`);
                    }

                    console.log('---');
                }
                break;
            }

            case 'screen': {
                const where = values.where ? String(values.where) : undefined;
                const limit = values.limit !== undefined ? Number(values.limit) : 50;
                const offset = values.offset !== undefined ? Number(values.offset) : 0;
                const rows = getManager().screenFinancials({ where, limit, offset });

                if (values.json) {
                    console.log(JSON.stringify(rows, null, 2));
                    break;
                }
                if (rows.length === 0) {
                    console.log('条件に合致する企業は見つかりませんでした。');
                    break;
                }

                console.log(`\nスクリーニング結果 (${rows.length} 件):`);
                console.table(rows.map(row => ({
                    文書ID: row.documentId,
                    コード: row.ticker ?? '-',
                    会社名: truncate(row.companyName, 12),
                    期間: row.periodType,
                    期末: row.periodEnd ?? '-',
                    '売上(億)': formatYen(row.currentNetSales),
                    '営業益(億)': formatYen(row.currentOperatingIncome),
                    '利益率(%)': formatPercent(row.operatingMarginCurrent),
                    'ROE(%)': formatPercent(row.roeCurrent),
                    '自己資本比率(%)': formatPercent(row.equityRatioCurrent),
                    'FCF(億)': formatYen(row.freeCashFlowCurrent),
                })));
                break;
            }

            case 'schema': {
                if (values.json) {
                    // edinet-ts と同じく summary の columns をトップレベルにも置く。
                    const summaryColumns = FINANCIAL_SCHEMAS.find(table => table.name === 'tdnet_financial_summary')?.columns ?? [];
                    console.log(JSON.stringify({ columns: summaryColumns, tables: FINANCIAL_SCHEMAS, examples: QUERY_EXAMPLES }, null, 2));
                    break;
                }

                for (const table of FINANCIAL_SCHEMAS) {
                    console.log(`\n=== ${table.name} ===`);
                    console.log(table.description);
                    console.table(table.columns.map(column => ({
                        カラム名: column.name,
                        型: column.type,
                        単位: column.unit,
                        説明: column.description,
                        条件指定例: column.example,
                    })));
                }
                console.log('\n=== クエリ例 ===\n');
                for (const example of QUERY_EXAMPLES) {
                    console.log(`【${example.title}】`);
                    console.log(`  説明: ${example.description}`);
                    console.log(`  SQL:  tdnet-ts screen --where "${example.sql}"\n`);
                }
                break;
            }

            case 'parse': {
                const input = positionals[1];
                if (!input) throw new Error('parse requires a ZIP path.');
                const zipPath = path.resolve(process.cwd(), input);
                const parsed = await parseXbrlZip(await readFile(zipPath));
                const facts = resolveFacts(parsed);
                const contexts = resolveContexts(parsed);
                const documentId = path.basename(zipPath, path.extname(zipPath));
                const summary = extractFinancialSummaryFromFacts(facts, { documentId });
                const resolvedCount = facts.filter(fact => fact.contextStatus === 'resolved').length;
                const unresolvedCount = facts.length - resolvedCount;

                if (values.json) {
                    console.log(JSON.stringify({
                        documentId,
                        factCount: facts.length,
                        contextCount: contexts.size,
                        ignoredCount: parsed.ignored.length,
                        resolvedFactCount: resolvedCount,
                        unresolvedFactCount: unresolvedCount,
                        summary,
                        facts,
                        contexts: [...contexts.values()],
                        ignored: parsed.ignored,
                    }, null, 2));
                    break;
                }

                console.log(`\n=== XBRL parse: ${documentId} ===`);
                console.log(`Facts: ${facts.length} (resolved ${resolvedCount} / unresolved ${unresolvedCount})`);
                console.log(`Contexts: ${contexts.size} / ignored: ${parsed.ignored.length}`);
                console.log(`Period: ${summary.periodType} ${summary.periodStart ?? '-'} .. ${summary.periodEnd ?? '-'}`);
                console.log(`Accounting: ${summary.accountingStandard} / ${summary.isConsolidated === null ? 'unknown' : summary.isConsolidated ? '連結' : '単体'}`);
                console.log(`売上高:   当期 ${formatYen(summary.current.netSales)} 億円 / 前期 ${formatYen(summary.prior.netSales)} 億円`);
                console.log(`営業利益: 当期 ${formatYen(summary.current.operatingIncome)} 億円 / 前期 ${formatYen(summary.prior.operatingIncome)} 億円`);
                console.log(`純利益:   当期 ${formatYen(summary.current.netIncome)} 億円 / 前期 ${formatYen(summary.prior.netIncome)} 億円`);
                console.log(`EPS:      当期 ${summary.current.eps ?? '-'} 円 / 前期 ${summary.prior.eps ?? '-'} 円`);
                console.log(`営業利益率: 当期 ${formatPercent(summary.indicators.operatingMarginCurrent)}% / 前期 ${formatPercent(summary.indicators.operatingMarginPrior)}%`);

                const unresolved = [...contexts.values()].filter(context => context.status === 'unresolved');
                console.log(`\nUnresolved contexts: ${unresolved.length}`);
                for (const context of unresolved.slice(0, 10)) {
                    console.log(`  ${context.id}: ${context.unresolvedReasons.join(', ')}`);
                }
                if (unresolved.length > 10) console.log(`  ... ${unresolved.length - 10} more`);
                break;
            }

            case 'help':
            default: {
                console.log(`
Usage: tdnet-ts <command> [options]

Commands:
  sync       Fetch latest disclosures and sync to DB. Parses PDF to markdown.
  recover    Retry saved document IDs; optionally save missing original PDFs.
  search     Search the SQLite DB for given keyword. (keyword is optional)
  screen     Screen tdnet_financial_summary with a SQL --where expression.
  schema     Show tdnet_financial_summary / tdnet_financial_facts columns.
  parse      Parse a single XBRL ZIP and show facts, contexts and summary.

Options:
  --limit, -l   (sync) Number of items to fetch. (search/screen) Max number of results
  --date,  -d   (sync only) Fetch items for specific date (YYYY-MM-DD or YYYYMMDD)
  --save-pdf    (sync/recover) Directory to save the downloaded PDFs (e.g. ./web/pdfs)
  --xbrl-only   (sync only) Ingest only XBRL ZIPs; never download, convert or save PDFs
  --db          Path to SQLite database file (default: ./tdnet.sqlite)
  --json        (search/screen/schema/parse) Output results in JSON format
  --where, -w   (screen only) SQL WHERE expression for tdnet_financial_summary
  --content, -c (search only) Include the full converted markdown document content
  --match       (search) legacy (default), literal, all (AND), any (OR)
  --normalize   (search) width-case; requires --match literal, all or any
  --fields      (search) Comma-separated title,body,company (default: all fields)
  --offset      (search/screen) Skip matching rows (default: 0)
  --ticker, -t  (search only) Filter by company ticker code
  --title       (search only) Filter specifically by document title
  --start,  -s  (search only) Filter by start date (YYYY-MM-DD, JST; or ISO timestamp)
  --end,    -e  (search only) Filter by end date (YYYY-MM-DD, JST; or ISO timestamp)

Examples:
  tdnet-ts sync --limit 10
  tdnet-ts sync --date 20231001 --limit 50
  tdnet-ts sync --date 2023-11-08 --xbrl-only --limit 2000
  tdnet-ts recover DOCUMENT_ID --save-pdf ./pdfs
  tdnet-ts search                # Search all (up to limit)
  tdnet-ts search "決算"
  tdnet-ts search "決算" --json
  tdnet-ts search "決算" --ticker 4875
  tdnet-ts search "決算" --start 2026-01-01 --end 2026-03-31
  tdnet-ts screen --where "operating_margin_current >= 0.15"
  tdnet-ts screen --where "roe_current >= 0.15" --json
  tdnet-ts schema
  tdnet-ts schema --json
  tdnet-ts parse ./xbrl.zip
        `.trim());
                break;
            }
        }
    } catch (err: any) {
        console.error('Error executing command:', err.message);
        process.exitCode = 1;
    } finally {
        manager?.close();

    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runCli().catch(console.error);
}
