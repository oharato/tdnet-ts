import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

export interface XbrlDimension {
    /** 完全修飾名 (例: tse-ed-t:ConsolidatedNonconsolidatedAxis) */
    dimension: string;
    /** 完全修飾名 (例: tse-ed-t:ConsolidatedMember)。typedMember の場合は null */
    member: string | null;
}

export interface XbrlContext {
    id: string;
    entityIdentifier: string | null;
    entityScheme: string | null;
    instant: string | null;
    startDate: string | null;
    endDate: string | null;
    dimensions: XbrlDimension[];
    sourceFile: string;
}

export interface NumericFact {
    /** 完全修飾名 (例: tse-ed-t:NetSales) */
    concept: string;
    /** ローカル名 (例: NetSales) */
    name: string;
    /** 名前空間プレフィックス (例: tse-ed-t) */
    namespace: string | null;
    contextRef: string;
    unitRef: string | null;
    decimals: string | null;
    scale: number;
    /** iXBRL の sign 属性。-1 または 1 */
    sign: 1 | -1;
    format: string | null;
    rawText: string;
    /** sign 適用後、scale 適用前の数値 */
    value: number;
    /** sign と scale を適用した数値 */
    scaledValue: number;
    sourceFile: string;
}

export interface IgnoredFact {
    sourceFile: string;
    concept: string | null;
    contextRef: string | null;
    reason: 'missing_name' | 'missing_context' | 'nil' | 'empty' | 'not_numeric' | 'invalid_sign' | 'invalid_scale' | 'non_finite';
    rawText: string | null;
}

export interface ParsedXbrl {
    facts: NumericFact[];
    contexts: Map<string, XbrlContext>;
    ignored: IgnoredFact[];
}

export interface XbrlHtmlDocument {
    path: string;
    content: string;
}

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseTagValue: false,
    trimValues: true,
    processEntities: true,
    allowBooleanAttributes: true,
    ignoreDeclaration: true,
});

function localName(name: string): string {
    const index = name.indexOf(':');
    return index === -1 ? name : name.slice(index + 1);
}

function getChild(node: Record<string, unknown>, name: string): unknown {
    for (const [key, value] of Object.entries(node)) {
        if (!key.startsWith('@_') && localName(key) === name) return value;
    }
    return undefined;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

/** 子要素を含むテキストを結合する。iXBRL の数値 Fact は通常 #text のみを持つ。 */
function textOf(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(textOf).join('');
    if (typeof value === 'object') {
        const node = value as Record<string, unknown>;
        let text = '';
        for (const [key, child] of Object.entries(node)) {
            if (key === '#text') text += textOf(child);
            else if (!key.startsWith('@') && key !== '#comment') text += textOf(child);
        }
        return text;
    }
    return '';
}

function collectByLocalName(value: unknown, name: string, out: Record<string, unknown>[]): void {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
        for (const item of value) collectByLocalName(item, name, out);
        return;
    }
    if (typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(node)) {
        if (key.startsWith('@_')) continue;
        if (localName(key) === name) {
            for (const item of asArray(child)) {
                if (item && typeof item === 'object') out.push(item as Record<string, unknown>);
            }
        }
        if (child && typeof child === 'object' && key !== '#text') collectByLocalName(child, name, out);
    }
}

function parseContexts(document: XbrlHtmlDocument, parsed: unknown, contexts: Map<string, XbrlContext>): void {
    const nodes: Record<string, unknown>[] = [];
    collectByLocalName(parsed, 'context', nodes);
    for (const node of nodes) {
        const id = typeof node['@_id'] === 'string' ? node['@_id'] : '';
        if (!id || contexts.has(id)) continue;

        const entity = getChild(node, 'entity');
        const entityNode = entity && typeof entity === 'object' ? entity as Record<string, unknown> : undefined;
        const identifier = entityNode ? getChild(entityNode, 'identifier') : undefined;
        const identifierNode = identifier && typeof identifier === 'object' ? identifier as Record<string, unknown> : undefined;
        const period = getChild(node, 'period');
        const periodNode = period && typeof period === 'object' ? period as Record<string, unknown> : undefined;

        const scenario = getChild(node, 'scenario');
        const segment = entityNode ? getChild(entityNode, 'segment') : undefined;
        const dimensionNodes: Record<string, unknown>[] = [];
        collectByLocalName(scenario, 'explicitMember', dimensionNodes);
        collectByLocalName(segment, 'explicitMember', dimensionNodes);
        collectByLocalName(scenario, 'typedMember', dimensionNodes);
        collectByLocalName(segment, 'typedMember', dimensionNodes);

        const dimensions: XbrlDimension[] = [];
        for (const dimensionNode of dimensionNodes) {
            const dimension = typeof dimensionNode['@_dimension'] === 'string' ? dimensionNode['@_dimension'] : '';
            if (!dimension) continue;
            const member = textOf(dimensionNode).trim() || null;
            dimensions.push({ dimension, member });
        }
        dimensions.sort((a, b) => a.dimension.localeCompare(b.dimension) || String(a.member).localeCompare(String(b.member)));

        contexts.set(id, {
            id,
            entityIdentifier: identifier ? textOf(identifier).trim() || null : null,
            entityScheme: identifierNode && typeof identifierNode['@_scheme'] === 'string' ? identifierNode['@_scheme'] : null,
            instant: periodNode ? textOf(getChild(periodNode, 'instant')).trim() || null : null,
            startDate: periodNode ? textOf(getChild(periodNode, 'startDate')).trim() || null : null,
            endDate: periodNode ? textOf(getChild(periodNode, 'endDate')).trim() || null : null,
            dimensions,
            sourceFile: document.path,
        });
    }
}

function normalizeFormat(format: string | null): string {
    return (format ?? '').toLowerCase().replace(/^ixt:/, '').replace(/[^a-z]/g, '');
}

function parseNumericText(text: string, format: string | null): { magnitude: number; negative: boolean } | null {
    let value = text.normalize('NFKC').trim().replace(/[\s\u00a0\u3000']/g, '');
    if (!value) return null;

    let negative = false;
    if (/^[-−–—△▲]/.test(value)) {
        negative = true;
        value = value.slice(1);
    }
    if (/[-−–—△▲]$/.test(value)) {
        negative = true;
        value = value.slice(0, -1);
    }
    if (value.startsWith('(') && value.endsWith(')')) {
        negative = true;
        value = value.slice(1, -1);
    }

    const normalized = normalizeFormat(format);
    const commaDecimal = normalized.includes('commadot');
    if (commaDecimal) {
        value = value.replace(/\./g, '').replace(/,/g, '.');
    } else {
        value = value.replace(/,/g, '');
    }
    if (!/^\d*\.?\d+$/.test(value)) return null;

    const magnitude = Number(value);
    return Number.isFinite(magnitude) ? { magnitude, negative } : null;
}

function parseFact(
    document: XbrlHtmlDocument,
    node: Record<string, unknown>,
    ignored: IgnoredFact[],
): NumericFact | undefined {
    const concept = typeof node['@_name'] === 'string' ? node['@_name'].trim() : '';
    if (!concept) {
        ignored.push({ sourceFile: document.path, concept: null, contextRef: null, reason: 'missing_name', rawText: textOf(node).trim() || null });
        return undefined;
    }
    const colon = concept.indexOf(':');
    const name = colon === -1 ? concept : concept.slice(colon + 1);
    const namespace = colon === -1 ? null : concept.slice(0, colon);
    const contextRef = typeof node['@_contextRef'] === 'string' ? node['@_contextRef'] : '';
    if (!contextRef) {
        ignored.push({ sourceFile: document.path, concept, contextRef: null, reason: 'missing_context', rawText: textOf(node).trim() || null });
        return undefined;
    }
    if (String(node['@_xsi:nil']).toLowerCase() === 'true') {
        ignored.push({ sourceFile: document.path, concept, contextRef, reason: 'nil', rawText: null });
        return undefined;
    }
    const rawText = textOf(node).trim();
    if (!rawText) {
        ignored.push({ sourceFile: document.path, concept, contextRef, reason: 'empty', rawText: null });
        return undefined;
    }
    const format = typeof node['@_format'] === 'string' ? node['@_format'] : null;
    const parsedText = parseNumericText(rawText, format);
    if (!parsedText) {
        ignored.push({ sourceFile: document.path, concept, contextRef, reason: 'not_numeric', rawText });
        return undefined;
    }

    const rawSign = node['@_sign'] === undefined || node['@_sign'] === null ? '' : String(node['@_sign']).trim();
    if (rawSign && rawSign !== '-' && rawSign !== '+') {
        ignored.push({ sourceFile: document.path, concept, contextRef, reason: 'invalid_sign', rawText });
        return undefined;
    }
    const sign: 1 | -1 = rawSign === '-' ? -1 : 1;

    const rawScale = node['@_scale'] === undefined || node['@_scale'] === null || String(node['@_scale']).trim() === ''
        ? 0
        : Number(String(node['@_scale']).trim());
    if (!Number.isSafeInteger(rawScale)) {
        ignored.push({ sourceFile: document.path, concept, contextRef, reason: 'invalid_scale', rawText });
        return undefined;
    }

    const textNegative = rawSign ? false : parsedText.negative;
    const value = (textNegative ? -1 : 1) * sign * parsedText.magnitude;
    const scaledValue = value * 10 ** rawScale;
    if (!Number.isFinite(scaledValue)) {
        ignored.push({ sourceFile: document.path, concept, contextRef, reason: 'non_finite', rawText });
        return undefined;
    }

    return {
        concept,
        name,
        namespace,
        contextRef,
        unitRef: typeof node['@_unitRef'] === 'string' ? node['@_unitRef'] : null,
        decimals: node['@_decimals'] === undefined || node['@_decimals'] === null ? null : String(node['@_decimals']),
        scale: rawScale,
        sign,
        format,
        rawText,
        value,
        scaledValue,
        sourceFile: document.path,
    };
}

function parseFacts(document: XbrlHtmlDocument, parsed: unknown, facts: NumericFact[], ignored: IgnoredFact[]): void {
    const walk = (value: unknown): void => {
        if (value === undefined || value === null) return;
        if (Array.isArray(value)) {
            for (const item of value) walk(item);
            return;
        }
        if (typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (localName(key).toLowerCase() === 'nonfraction') {
                for (const item of asArray(child)) {
                    if (item && typeof item === 'object') {
                        const fact = parseFact(document, item as Record<string, unknown>, ignored);
                        if (fact) facts.push(fact);
                    }
                }
                continue;
            }
            if (child && typeof child === 'object' && key !== '#text') walk(child);
        }
    };
    walk(parsed);
}

/** iXBRL HTML 群を解析する。ZIP を介さないテスト・呼び出し用。 */
export function parseXbrlHtmlDocuments(documents: XbrlHtmlDocument[]): ParsedXbrl {
    const facts: NumericFact[] = [];
    const contexts = new Map<string, XbrlContext>();
    const ignored: IgnoredFact[] = [];

    for (const document of documents) {
        const parsed = parser.parse(document.content) as unknown;
        parseContexts(document, parsed, contexts);
        parseFacts(document, parsed, facts, ignored);
    }

    return { facts, contexts, ignored };
}

/** TDnet 決算短信など iXBRL を含む ZIP を展開して解析する。 */
export async function parseXbrlZip(input: Uint8Array | ArrayBuffer): Promise<ParsedXbrl> {
    const zip = await JSZip.loadAsync(input);
    const documents: XbrlHtmlDocument[] = [];
    const names = Object.values(zip.files)
        .filter(entry => !entry.dir && /\.(?:htm|html|xhtml)$/i.test(entry.name))
        .map(entry => entry.name)
        .sort();

    for (const name of names) {
        const file = zip.file(name);
        if (!file) continue;
        const content = await file.async('string');
        // 数値 Fact も Context も持たない定性情報ページは解析対象外。
        if (!/<ix:nonFraction\b/i.test(content) && !/<(?:xbrli:)?context\b/i.test(content)) continue;
        documents.push({ path: name, content });
    }

    return parseXbrlHtmlDocuments(documents);
}
