import { afterEach, beforeEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DbClient } from '../src/db.js';
import { searchExport } from '../src/search-browser.js';
import type { SearchOptions, TdnetDocument } from '../src/types.js';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/search-evaluation.json', import.meta.url), 'utf8')) as {
    documents: TdnetDocument[]; queries: { id: string; query: string; options: SearchOptions; expectedIds: string[]; relevantIds: string[]; gap?: string }[];
};
let db: DbClient;
beforeEach(() => { db = new DbClient(':memory:'); fixture.documents.forEach(doc => db.insertDocument(doc)); });
afterEach(() => db.close());
it.each(fixture.queries)('$id: fixed expected results agree in DB and static export', query => {
    expect(db.searchDocuments(query.query, query.options).map(doc => doc.id)).toEqual(query.expectedIds);
    expect(searchExport(fixture.documents, query.query, query.options).map(doc => doc.id)).toEqual(query.expectedIds);
    expect(db.getDocument('e')).toEqual(fixture.documents.find(doc => doc.id === 'e'));
});
it('refreshes results after content changes without retaining stale excerpts or removing independent corrections', () => {
    const before = db.getDocument('a')!;
    db.insertDocument({ ...before, content: '更新された架空本文' });
    expect(db.searchDocuments('コバルト', { match:'literal' })).toEqual([]);
    expect(db.searchDocuments('更新された', { match:'literal' }).map(doc => doc.id)).toEqual(['a']);
    expect(db.getDocument('j')!.title).toContain('訂正');
    expect(searchExport(db.searchDocuments(undefined), 'コバルト')).toEqual([]);
});
it('labels unsupported intent separately from current implementation expectations', () => {
    const gaps = fixture.queries.filter(query => query.gap);
    expect(gaps).toHaveLength(3);
    for (const query of gaps) { expect(query.expectedIds).toEqual([]); expect(query.relevantIds.length).toBeGreaterThan(0); }
});
