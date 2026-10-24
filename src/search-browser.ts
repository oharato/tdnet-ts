import { searchColumns, searchTerms } from './search-query.js';
import { searchDateBound } from './search-date.js';
import { normalizeSearchText } from './search-normalize.js';
import type { SearchOptions, TdnetDocument } from './types.js';

/** Static export search: explicit modes only, same ASCII LIKE case behavior as SQLite. */
export function searchExport(items: TdnetDocument[], query: string, options: SearchOptions = {}): TdnetDocument[] {
    const match = options.match ?? 'literal';
    if (match === 'legacy') throw new Error('Web search supports literal, all or any.');
    if (options.normalize !== undefined && options.normalize !== 'width-case') throw new Error('Invalid normalization.');
    const columns = searchColumns(options.fields);
    const fold = (value: string) => options.normalize ? normalizeSearchText(value) : value.replace(/[A-Z]/g, c => c.toLowerCase());
    const terms = searchTerms(query, match).map(fold);
    const start = options.startDate === undefined ? undefined : searchDateBound(options.startDate, false);
    const end = options.endDate === undefined ? undefined : searchDateBound(options.endDate, true);
    if (start && end && (start.iso > end.iso || (end.exclusive && start.iso === end.iso))) throw new Error('Search startDate must not be after endDate.');
    if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < -1)) throw new Error('Invalid limit.');
    if (options.offset !== undefined && (!Number.isSafeInteger(options.offset) || options.offset < 0)) throw new Error('Invalid offset.');
    const values = (item: TdnetDocument) => columns.map(column => column === 'company_name' ? item.companyName : column === 'content' ? item.content : item.title);
    const result = items.filter(item => {
        if (options.ticker && item.ticker !== options.ticker) return false;
        if (options.title && !fold(item.title).includes(fold(options.title))) return false;
        const time = Date.parse(item.publishedAt);
        if (start && !(time >= Date.parse(start.iso))) return false;
        if (end && !(end.exclusive ? time < Date.parse(end.iso) : time <= Date.parse(end.iso))) return false;
        const hits = terms.map(term => values(item).some(value => value != null && fold(value).includes(term)));
        return !terms.length || (match === 'any' ? hits.some(Boolean) : hits.every(Boolean));
    }).sort((a, b) => a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const offset = options.offset ?? 0;
    return result.slice(offset, options.limit === undefined || options.limit === -1 ? undefined : offset + options.limit);
}

/** Do not treat a broken export as an empty successful search. Body may be omitted. */
export function validateExport(data: unknown): TdnetDocument[] {
    if (!Array.isArray(data)) throw new Error('Export must be an array.');
    const ids = new Set<string>();
    for (const item of data) {
        if (!item || ['id', 'title', 'companyName', 'ticker', 'publishedAt', 'documentUrl'].some(key => typeof item[key] !== 'string') ||
            (item.content != null && typeof item.content !== 'string') || ids.has(item.id)) throw new Error('Invalid export record.');
        ids.add(item.id);
    }
    return data;
}

/** Highlight matching raw substrings without replacing inside escaped HTML or changing source text. */
export function highlightExport(text: string, query: string, options: SearchOptions = {}): string {
    const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br/>');
    const fold = (value: string) => options.normalize ? normalizeSearchText(value) : value.replace(/[A-Z]/g, c => c.toLowerCase());
    const source = fold(text);
    const ranges: [number, number][] = [];
    for (const term of searchTerms(query, options.match ?? 'literal').map(fold)) {
        if (!term) continue;
        for (let index = source.indexOf(term); index >= 0; index = source.indexOf(term, index + 1)) ranges.push([index, index + term.length]);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const range of ranges) {
        const previous = merged[merged.length - 1];
        if (previous && previous[1] >= range[0]) previous[1] = Math.max(previous[1], range[1]);
        else merged.push([...range]);
    }
    let position = 0, html = '';
    for (const [start, end] of merged) {
        html += escape(text.slice(position, start)) + '<mark>' + escape(text.slice(start, end)) + '</mark>';
        position = end;
    }
    return html + escape(text.slice(position));
}
