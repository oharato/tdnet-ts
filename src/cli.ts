#!/usr/bin/env -S node --no-warnings

import { parseArgs } from 'node:util';
import path from 'node:path';
import { TdnetManager } from './index.js';

async function main() {
    const { values, positionals } = parseArgs({
        args: process.argv.slice(2),
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
            end: {
                type: 'string',
                short: 'e',
            }
        },
        allowPositionals: true,
    });

    const command = positionals[0] ? String(positionals[0]) : 'help';
    const dbPath = values.db ? path.resolve(process.cwd(), String(values.db)) : undefined;

    const manager = new TdnetManager(dbPath);

    try {
        switch (command) {
            case 'sync': {
                const limit = values.limit ? parseInt(String(values.limit), 10) : 100;
                const date = values.date ? String(values.date) : undefined;
                const savePdfDir = values['save-pdf'] ? String(values['save-pdf']) : undefined;
                await manager.sync({ limit, date, savePdfDir });
                break;
            }

            case 'search': {
                const keyword = positionals[1] ? String(positionals[1]) : undefined;
                if (!keyword && !values.title && !values.ticker) {
                    console.error('Keyword, --title, or --ticker is required for search command.');
                    console.error('Usage: tdnet-ts search [keyword] [options]');
                    process.exit(1);
                }

                const limit = values.limit ? parseInt(String(values.limit), 10) : 100;

                const searchOptions = {
                    ticker: values.ticker ? String(values.ticker) : undefined,
                    title: values.title ? String(values.title) : undefined,
                    startDate: values.start ? String(values.start) : undefined,
                    endDate: values.end ? String(values.end) : undefined,
                    limit: limit,
                };
                const results = manager.search(keyword, searchOptions);

                if (values.json) {
                    const jsonOutput = results.map(doc => {
                        let snippet = undefined;
                        if (doc.content && keyword) {
                            const contentLower = doc.content.toLowerCase();
                            const keywordLower = keyword.toLowerCase();
                            const index = contentLower.indexOf(keywordLower);

                            if (index !== -1) {
                                const snippetStart = Math.max(0, index - 30);
                                const snippetEnd = Math.min(doc.content.length, index + keyword.length + 30);
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

                const displayKeyword = keyword || (values.title ? `title:${values.title}` : `ticker:${values.ticker}`);
                console.log(`Found ${results.length} records matching "${displayKeyword}":\n`);
                for (const doc of results) {
                    console.log(`\n[${doc.publishedAt}] ${doc.ticker} ${doc.companyName}`);
                    console.log(`Title: ${doc.title}`);
                    console.log(`URL: ${doc.documentUrl}`);
                    console.log(`ID: ${doc.id}`);

                    // Create snippet if content is available and contains keyword
                    if (doc.content && keyword) {
                        const contentLower = doc.content.toLowerCase();
                        const keywordLower = keyword.toLowerCase();
                        const index = contentLower.indexOf(keywordLower);

                        if (index !== -1) {
                            const snippetStart = Math.max(0, index - 30);
                            const snippetEnd = Math.min(doc.content.length, index + keyword.length + 30);
                            let snippet = doc.content.substring(snippetStart, snippetEnd).replace(/\n/g, ' ');

                            if (snippetStart > 0) snippet = '...' + snippet;
                            if (snippetEnd < doc.content.length) snippet = snippet + '...';

                            // highlight the keyword in terminal
                            const reset = '\x1b[0m';
                            const red = '\x1b[31m';
                            const regex = new RegExp(`(${keyword})`, 'gi');
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

            case 'help':
            default: {
                console.log(`
Usage: tdnet-ts <command> [options]

Commands:
  sync       Fetch latest disclosures and sync to DB. Parses PDF to markdown.
  search     Search the SQLite DB for given keyword.

Options:
  --limit, -l   (sync) Number of items to fetch. (search) Max number of results (default: 100)
  --date,  -d   (sync only) Fetch items for specific date (YYYY-MM-DD or YYYYMMDD)
  --save-pdf    (sync only) Directory to save the downloaded PDFs (e.g. ./web/pdfs)
  --db          Path to SQLite database file (default: ./tdnet.sqlite)
  --json        (search only) Output results in JSON format
  --content, -c (search only) Include the full converted markdown document content
  --ticker, -t  (search only) Filter by company ticker code
  --title       (search only) Filter specifically by document title
  --start,  -s  (search only) Filter by start date (YYYY-MM-DD)
  --end,    -e  (search only) Filter by end date (YYYY-MM-DD)

Examples:
  tdnet-ts sync --limit 10
  tdnet-ts sync --date 20231001 --limit 50
  tdnet-ts search "決算"
  tdnet-ts search "決算" --json
  tdnet-ts search "決算" --ticker 4875
  tdnet-ts search "決算" --start 2026-01-01 --end 2026-03-31
        `.trim());
                break;
            }
        }
    } catch (err: any) {
        console.error('Error executing command:', err.message);
        process.exit(1);
    } finally {
        manager.close();
    }
}

main().catch(console.error);
