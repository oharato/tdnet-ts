import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';


/**
 * PdfParser class using IBM Docling for PDF to Markdown conversion.
 * Docling provides advanced layout analysis for tables, headers, and figures.
 */
export class PdfParser {
    /**
     * PDFのバイナリデータを受け取り、Markdown形式のテキストに変換して返す (Docling版)
     * @param pdfBuffer PDFのバイナリデータ
     * @returns Markdown形式の文字列
     */
    public async parsePdfToMarkdown(pdfBuffer: ArrayBuffer | Uint8Array | Buffer): Promise<string> {
        const buffer = pdfBuffer instanceof Buffer ? pdfBuffer :
            pdfBuffer instanceof Uint8Array ? Buffer.from(pdfBuffer) :
                Buffer.from(pdfBuffer);

        // 一時ディレクトリとファイルを作成
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docling-'));
        const inputPath = path.join(tempDir, 'document.pdf');

        try {
            fs.writeFileSync(inputPath, buffer);

            // Docling (IBM) の CLI を呼び出す
            // コマンドは環境によって docling-convert または docling の可能性があるため、
            // 一般的に推奨される docling コマンドを試みる。
            // また、Python モジュールとして直接呼び出す (-m docling.cli.conv) 方法も一般的。

            // docling source --output output_dir
            // デフォルトで Markdown に変換される。日本語の精度を上げるため ja を指定。
            try {
                execSync(`docling ${inputPath} --output ${tempDir} --ocr-lang ja`, { stdio: 'inherit' });
            } catch (e: any) {
                throw new Error(`Docling (IBM) の実行に失敗しました。docling が正しくインストールされているか、パスが通っているか確認してください。\n${e.message}`);
            }

            // 変換された Markdown ファイルを検索
            const outputPath = path.join(tempDir, 'document.md');
            let markdown = '';
            if (fs.existsSync(outputPath)) {
                markdown = fs.readFileSync(outputPath, 'utf-8');
            } else {
                // 出力ディレクトリ内の .md ファイルを探す
                const files = fs.readdirSync(tempDir);
                const mdFile = files.find(f => f.endsWith('.md'));
                if (mdFile) {
                    markdown = fs.readFileSync(path.join(tempDir, mdFile), 'utf-8');
                }
            }

            if (!markdown) {
                throw new Error('Docling による変換後の Markdown ファイルが見つかりませんでした。');
            }

            return this.postProcessDocling(markdown);
        } finally {
            // 一時ファイルの削除
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (err) {
                console.error('一時ディレクトリの削除に失敗しました:', err);
            }
        }
    }

    private postProcessDocling(markdown: string): string {
        let res = markdown;

        // 1. 画像データの除去 (Doclingが埋め込むbase64画像の削除)
        res = res.replace(/!\[(?:Image)\]\(data:image\/[^;]+;base64,[^)]+\)/gi, '');
        // altがないパターンも念の為
        res = res.replace(/!\[\]\(data:image\/[^;]+;base64,[^)]+\)/gi, '');

        // 2. 全角英数字・記号を半角に変換 (統一感のため)
        res = res.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
        res = res.replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
        res = res.replace(/[（）]/g, (s) => s === '（' ? '(' : ')');
        res = res.replace(/．/g, '.');
        res = res.replace(/－/g, '-');
        res = res.replace(/％/g, '%');
        res = res.replace(/：/g, ':');
        res = res.replace(/～/g, '~');

        // 余分な連続改行を2つまでに制限
        res = res.replace(/\n{3,}/g, '\n\n').trim();

        return res;
    }

    /**
     * 指定されたURLからPDFをダウンロードしてMarkdownに変換する
     * @param url PDFのURL
     * @returns Markdown形式の文字列とバイナリデータ
     */
    public async downloadAndParse(url: string): Promise<{ markdown: string, buffer: ArrayBuffer }> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`PDFのダウンロードに失敗しました: ${response.status} ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const markdown = await this.parsePdfToMarkdown(arrayBuffer);
        return { markdown, buffer: arrayBuffer };
    }
}
