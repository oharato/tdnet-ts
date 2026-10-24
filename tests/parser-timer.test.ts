import { afterEach, expect, it, vi } from 'vitest';
import { PdfParser } from '../src/parser.js';
const extract = vi.hoisted(() => vi.fn());
vi.mock('@oharato/pdf2md-ts', () => ({ extractTablesFromPdf: extract }));
afterEach(() => { vi.useRealTimers(); extract.mockReset(); });
it.each(['success', 'failure', 'timeout'])('clears the conversion timer after %s', async outcome => {
    vi.useFakeTimers();
    extract.mockImplementation(() => outcome === 'success' ? Promise.resolve({ markdown: 'fixture' }) : outcome === 'failure' ? Promise.reject(new Error('fixture')) : new Promise(() => {}));
    const result = new PdfParser().parsePdfToMarkdown(new Uint8Array([1]), 10);
    const assertion = outcome === 'success' ? expect(result).resolves.toBe('fixture') : expect(result).rejects.toThrow();
    if (outcome === 'timeout') await vi.advanceTimersByTimeAsync(10);
    await assertion; expect(vi.getTimerCount()).toBe(0);
});
