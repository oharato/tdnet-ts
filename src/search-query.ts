import type { SearchField, SearchMatch } from './types.js';

const columns: Record<SearchField, string> = { title: 'title', body: 'content', company: 'company_name' };

export function searchColumns(fields: SearchField[] = ['title', 'body', 'company']): string[] {
    if (!Array.isArray(fields) || fields.length === 0 || fields.some(field => !Object.hasOwn(columns, field))) {
        throw new Error('Search fields must contain title, body or company.');
    }
    return [...new Set(fields)].map(field => columns[field]);
}

/** Explicit modes avoid changing legacy queries containing spaces or SQL wildcards. */
export function searchTerms(query: string | undefined, match: SearchMatch = 'legacy'): string[] {
    if (!['legacy', 'literal', 'all', 'any'].includes(match)) {
        throw new Error('Search match must be legacy, literal, all or any.');
    }
    if (!query) return [];
    if (match === 'legacy') return [query];
    if (match === 'literal') return query.trim() ? [query.trim()] : [];

    const terms: string[] = [];
    let rest = query.trim();
    while (rest) {
        if (rest.startsWith('"')) {
            const close = rest.indexOf('"', 1);
            if (close < 0 || (rest[close + 1] && !/\s/u.test(rest[close + 1]))) {
                throw new Error('Invalid search phrase: quotes must enclose a complete term.');
            }
            const phrase = rest.slice(1, close);
            if (!phrase.trim()) throw new Error('Search phrase must not be empty.');
            terms.push(phrase);
            rest = rest.slice(close + 1).trimStart();
        } else {
            const token = /^\S+/u.exec(rest)![0];
            if (token.includes('"')) throw new Error('Invalid search phrase: quotes must enclose a complete term.');
            terms.push(token);
            rest = rest.slice(token.length).trimStart();
        }
    }
    return [...new Set(terms)];
}

export function literalPattern(term: string): string {
    return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}
