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

    it('should list and parse all fixture PDFs without throwing', async () => {
        const files = await fs.readdir(fixtureDir);
        const pdfFiles = files.filter(f => f.endsWith('.pdf'));

        expect(pdfFiles.length).toBeGreaterThan(0);

        for (const filename of pdfFiles) {
            const filePath = path.join(fixtureDir, filename);
            const buffer = await fs.readFile(filePath);

            // パースが例外なく実行されること
            const markdown = await parser.parsePdfToMarkdown(buffer);

            expect(markdown).toBeDefined();
            expect(typeof markdown).toBe('string');
            expect(markdown.length).toBeGreaterThan(0);

            // 日本語文字が含まれていることを緩くチェック
            // (TDnetのPDFなので必ず含まれているはず)
            expect(markdown).toMatch(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/);

            // クレンジング結果の簡易的な確認
            // - 3つ以上の連続改行がないこと
            expect(markdown).not.toMatch(/\n{3,}/);

            // - ページ番号ノイズが除去されているか（完璧ではないが、代表的なパターンが残っていないか）
            expect(markdown).not.toMatch(/^\s*\d+\s*\/\s*\d+\s*$/m);
        }
    });


});
