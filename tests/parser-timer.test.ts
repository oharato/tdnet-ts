import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { PdfParser } from '../src/parser.js';
const extract = vi.hoisted(() => vi.fn());
vi.mock('../src/pdf-worker.js', () => ({ extractPdfInWorker: extract }));
afterEach(() => extract.mockReset());
it.each(['success', 'failure'])('cleans input only after worker completion: %s', async outcome => {
    let input = '';
    extract.mockImplementation(async path => {
        input = path; expect(fs.existsSync(path)).toBe(true);
        if (outcome === 'failure') throw new Error('fixture');
        return 'fixture';
    });
    const result = new PdfParser().parsePdfToMarkdown(new Uint8Array([1]), 10);
    if (outcome === 'success') await expect(result).resolves.toBe('fixture');
    else await expect(result).rejects.toThrow();
    expect(fs.existsSync(input)).toBe(false);
});
