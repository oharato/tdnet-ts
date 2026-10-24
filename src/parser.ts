import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extractPdfInWorker } from './pdf-worker.js';

/**
 * PdfParser class using pdf2md-ts for PDF to Markdown conversion.
 */
export class PdfParser {
    /**
     * PDFのバイナリデータを受け取り、Markdown形式のテキストに変換して返す (pdf2md-ts版)
     */
    public async parsePdfToMarkdown(pdfBuffer: ArrayBuffer | Uint8Array | Buffer, timeoutMs: number = 30 * 60 * 1000): Promise<string> {
        const buffer = pdfBuffer instanceof Buffer ? pdfBuffer :
            pdfBuffer instanceof Uint8Array ? Buffer.from(pdfBuffer) :
                Buffer.from(pdfBuffer);

        // 一時PDFファイルを作成してpdf2md-tsに渡す
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf2md-'));
        const inputPath = path.join(tempDir, 'document.pdf');

        try {
            fs.writeFileSync(inputPath, buffer);

            console.error(`  [debug] extracting tables from PDF (${buffer.length} bytes)...`);

            const markdown = await extractPdfInWorker(inputPath, timeoutMs);
            const processed = this.postProcess(markdown);

            return processed;
        } catch (e: any) {
            throw new Error(`PDF変換処理に失敗しました: ${e.message}`);
        } finally {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (err) {
                console.error('一時ディレクトリの削除に失敗しました:', err);
            }
        }
    }

    private postProcess(markdown: string): string {
        let res = markdown;

        // base64埋め込み画像を除去
        res = res.replace(/!\[[^\]]*\]\(data:[^)]+\)/g, '');

        // <br> タグをセル内で結合（表セル内の改行除去）
        res = res.replace(/<br\s*\/?>/gi, '');

        // 全角英数字・記号 (U+FF01–U+FF5E) → 半角, 全角スペース → 半角スペース
        res = res.replace(/[\uFF01-\uFF5E]/g, c =>
            String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
        );
        res = res.replace(/\u3000/g, ' ');

        // 余分な連続改行を2つまでに制限
        res = res.replace(/\n{3,}/g, '\n\n').trim();

        return res;
    }

    /**
     * 指定されたURLからPDFをダウンロードしてMarkdownに変換する
     */
    public async downloadAndParse(url: string, timeoutMs: number = 30 * 60 * 1000): Promise<{ markdown: string; buffer: ArrayBuffer }> {
        const arrayBuffer = await this.downloadPdf(url, timeoutMs);
        const markdown = await this.parsePdfToMarkdown(arrayBuffer, timeoutMs);
        return { markdown, buffer: arrayBuffer };
    }

    /** Download independently so an original can be saved before conversion. */
    public async downloadPdf(url: string, timeoutMs: number = 30 * 60 * 1000): Promise<ArrayBuffer> {
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) throw new Error(`PDF download failed: ${response.status} ${response.statusText}`);
        return response.arrayBuffer();
    }
}
