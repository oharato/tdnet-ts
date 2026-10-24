import { readFileSync } from 'node:fs';
import { DbClient } from '../dist/db.js';
import { searchExport } from '../dist/search-browser.js';
const fixture = JSON.parse(readFileSync(new URL('../tests/fixtures/search-evaluation.json', import.meta.url), 'utf8'));
const db = new DbClient(':memory:');
let failures = 0;
try {
    for (const doc of fixture.documents) db.insertDocument(doc);
    const queries = fixture.queries.map(query => {
        const ids = db.searchDocuments(query.query, query.options).map(doc => doc.id);
        const webIds = searchExport(fixture.documents, query.query, query.options).map(doc => doc.id);
        const currentPass = JSON.stringify(ids) === JSON.stringify(query.expectedIds) && JSON.stringify(ids) === JSON.stringify(webIds);
        if (!currentPass) failures++;
        const top = ids.slice(0, 10), relevant = new Set(query.relevantIds), hits = top.filter(id => relevant.has(id)).length;
        const rank = ids.findIndex(id => relevant.has(id));
        return { id: query.id, currentPass, returnedIds: ids, gap: query.gap ?? null,
            precisionInReturnedTop10: top.length ? hits / top.length : null,
            recallKnownTargetsTop10: relevant.size ? hits / relevant.size : null,
            firstRelevantRank: rank < 0 ? null : rank + 1 };
    });
    console.log(JSON.stringify({ scope: fixture.description, documents: fixture.documents.length, queries: queries.length,
        currentFailures: failures, knownGapQueries: queries.filter(q => q.gap).length, results: queries }, null, 2));
    if (failures) process.exitCode = 1;
} finally { db.close(); }
