import { describe, it, expect, beforeEach } from 'vitest';
import { PdfParser } from '../src/parser.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('PdfParser Integration Tests with real PDFs', () => {
    let parser: PdfParser;
    const fixtureDir = path.resolve(process.cwd(), 'tests/fixtures/pdfs');

    beforeEach(() => {
        parser = new PdfParser();
    });

    it('should list and parse all fixture PDFs using local @oharato/pdf2md-ts', async () => {
        const files = await fs.readdir(fixtureDir);
        const pdfFiles = files.filter(f => f.endsWith('.pdf'));

        expect(pdfFiles.length).toBeGreaterThan(0);

        for (const filename of pdfFiles) {
            const filePath = path.join(fixtureDir, filename);
            const buffer = await fs.readFile(filePath);

            console.log(`Testing file: ${filename} (local parser)`);
            const markdown = await parser.parsePdfToMarkdown(buffer);
            console.log(`Markdown length for ${filename}: ${markdown.length}`);

            expect(markdown).toBeDefined();
            expect(typeof markdown).toBe('string');
            expect(markdown.length).toBeGreaterThan(0);

            // 日本語文字が含まれていること
            expect(markdown).toMatch(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/);
        }
    });
});
