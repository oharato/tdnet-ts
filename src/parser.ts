import pdf2mdPkg from '@opendocsg/pdf2md';

// ESMとCommonJSの互換性のため、exportの形に合わせて関数を取得する
const pdf2md = (pdf2mdPkg as any).pdf2md || pdf2mdPkg;

// NOTE: pdf2md のインターフェースはUint8ArrayまたはBufferを受け付ける想定
export class PdfParser {
    /**
     * PDFのバイナリデータを受け取り、Markdown形式の文字列に変換して返す
     * @param pdfBuffer PDFのバイナリデータ (ArrayBuffer または Uint8Array)
     * @returns Markdown形式の文字列
     */
    public async parsePdfToMarkdown(pdfBuffer: ArrayBuffer | Uint8Array): Promise<string> {
        try {
            // pdf2md は内部で fs 等を使用せず、Buffer/Uint8Array の形式で処理できるか確認
            const buffer = pdfBuffer instanceof Uint8Array ? pdfBuffer : new Uint8Array(pdfBuffer);

            // pdf2md関数が存在するかどうか確認して実行
            if (typeof pdf2md !== 'function') {
                throw new Error('pdf2md is not a function: ' + typeof pdf2md);
            }

            const markdown = await pdf2md(buffer, undefined);
            return this.cleanMarkdown(markdown);
        } catch (error) {
            console.error('Failed to parse PDF:', error);
            throw error;
        }
    }

    /**
     * PDF変換後のMarkdownテキストから不要な装飾や改行を取り除く
     */
    private cleanMarkdown(markdown: string): string {
        return markdown
            // pdf2md はプレーンテキストを過剰に見出し(####)にしてしまうため、行頭の#を除去
            .replace(/^#{1,6}\s+/gm, '')
            // 3つ以上連続する改行を2つに圧縮して詰める
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    /**
     * 指定したURLからPDFをダウンロードしてMarkdownに変換しつつ、生データも返す
     * @param url PDFのURL
     * @returns 変換されたMarkdown文字列と、PDFの生データ (ArrayBuffer)
     */
    public async downloadAndParse(url: string): Promise<{ markdown: string, buffer: ArrayBuffer }> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download PDF: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const markdown = await this.parsePdfToMarkdown(arrayBuffer);
        return { markdown, buffer: arrayBuffer };
    }
}
