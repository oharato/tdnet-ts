import { PdfReader } from 'pdfreader';

export class PdfParser {
    /**
     * PDFのバイナリデータを受け取り、Markdown形式の文字列に変換して返す (V2: 表形式サポート版)
     * @param pdfBuffer PDFのバイナリデータ (ArrayBuffer, Uint8Array, または Buffer)
     * @returns Markdown形式の文字列
     */
    public async parsePdfToMarkdown(pdfBuffer: ArrayBuffer | Uint8Array | Buffer): Promise<string> {
        return new Promise((resolve, reject) => {
            const buffer = pdfBuffer instanceof Buffer ? pdfBuffer :
                pdfBuffer instanceof Uint8Array ? Buffer.from(pdfBuffer) :
                    Buffer.from(pdfBuffer);

            const pages: any[] = [];
            let currentPage: any[] = [];

            new PdfReader().parseBuffer(buffer, (err, item) => {
                if (err) {
                    reject(err);
                } else if (!item) {
                    // 最後のページを追加
                    if (currentPage.length > 0) pages.push(currentPage);

                    const markdown = this.processPages(pages);
                    resolve(this.cleanMarkdown(markdown));
                } else if (item.page) {
                    if (currentPage.length > 0) pages.push(currentPage);
                    currentPage = [];
                } else if (item.text) {
                    currentPage.push(item);
                }
            });
        });
    }

    private processPages(pages: any[][]): string {
        let fullMarkdown = '';

        for (const pageItems of pages) {
            // y座標でグループ化し、1行ごとのアイテムリストを作成
            const linesMap = new Map<number, any[]>();
            for (const item of pageItems) {
                // y座標の微差を許容（0.5単位程度で丸める）
                const y = Math.round(item.y * 2) / 2;
                if (!linesMap.has(y)) linesMap.set(y, []);
                linesMap.get(y)!.push(item);
            }

            // y座標順にソート
            const sortedY = Array.from(linesMap.keys()).sort((a, b) => a - b);
            const lines: any[][] = sortedY.map(y => linesMap.get(y)!.sort((a, b) => a.x - b.x));

            let i = 0;
            while (i < lines.length) {
                const line = lines[i];

                // 表形式の判定 (2つ以上のアイテムがあり、かつそれなりの距離がある場合)
                if (this.isTableLine(line)) {
                    const tableRows: string[][] = [];
                    // 連続する表形式の行を抽出
                    while (i < lines.length && (this.isTableLine(lines[i]) || lines[i].length === 0)) {
                        if (lines[i].length > 0) {
                            tableRows.push(this.formatTableRow(lines[i]));
                        }
                        i++;
                    }
                    if (tableRows.length > 0) {
                        fullMarkdown += this.generateMarkdownTable(tableRows) + '\n\n';
                    }
                } else {
                    // 通常の行
                    fullMarkdown += line.map(item => item.text).join('') + '\n';
                    i++;
                }
            }
            fullMarkdown += '\n'; // ページ間の区切り
        }

        return fullMarkdown;
    }

    private isTableLine(line: any[]): boolean {
        if (line.length < 2) return false;
        // 特定のヘッダーキーワードが含まれているか
        const text = line.map(item => item.text).join('');
        if (text.includes('氏名') && (text.includes('役職') || text.includes('担当'))) return true;

        // アイテム間のx距離をチェック（かなり離れているか）
        for (let i = 0; i < line.length - 1; i++) {
            const gap = line[i + 1].x - (line[i].x + line[i].text.length * 0.4);
            if (gap > 3) return true;
        }
        return false;
    }

    private formatTableRow(line: any[]): string[] {
        // カラムのグループ化 (近いものは同じ列)
        const columns: string[] = [];
        let currentGroup = line[0].text;

        for (let i = 1; i < line.length; i++) {
            const gap = line[i].x - (line[i - 1].x + line[i - 1].text.length * 0.2);
            if (gap > 2) {
                columns.push(currentGroup.trim());
                currentGroup = line[i].text;
            } else {
                currentGroup += line[i].text;
            }
        }
        columns.push(currentGroup.trim());
        return columns;
    }

    private generateMarkdownTable(rows: string[][]): string {
        const maxCols = Math.max(...rows.map(r => r.length));
        let md = '';
        md += '| ' + rows[0].join(' | ') + ' |\n';
        md += '| ' + Array(maxCols).fill('---').join(' | ') + ' |\n';
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            while (row.length < maxCols) row.push('');
            md += '| ' + row.join(' | ') + ' |\n';
        }
        return md;
    }

    private cleanMarkdown(markdown: string): string {
        if (!markdown) return '';

        let cleaned = markdown.replace(/\r\n/g, '\n').trim();
        cleaned = cleaned.replace(/^\s*(\d+\s*\/\s*\d+|-?\s*\d+\s*-?|page\s*\d+)\s*$/gim, '');
        cleaned = cleaned.replace(/\u3000/g, ' ').replace(/[ \t]+/g, ' ');

        const jp = '[\\u3040-\\u309f\\u30a0-\\u30ff\\u4e00-\\u9faf]';
        for (let i = 0; i < 3; i++) {
            cleaned = cleaned.replace(new RegExp(`(^| )(${jp}) (${jp})($| )`, 'g'), '$1$2$3$4');
            cleaned = cleaned.replace(/(\d) (?=[\u5e74\u6708\u65e5])/g, '$1');
            cleaned = cleaned.replace(/([\u5e74\u6708\u65e5]) (?=\d)/g, '$1');
        }

        const breakKeywords = /^(各位|20\d{2}|会社名|代表者名|問合せ先|記|以上|#{1,6}|[1-9]\s*[．.]|（|\(|常務取締役|取締役|代表取締役|部長|営業部長|販売、営業担当|氏名|新役職|旧役職)/;
        const frontMatterKeywords = /^(各位|20\d{2}|会社名|代表者名|問合せ先|（コード番号|（TEL)/;

        const lines = cleaned.split('\n');
        const processedLines = lines.map(l => {
            let line = l.trim();
            if (line === '' || line.startsWith('|')) return line;
            line = line.replace(/^(会社名|代表者名|問合せ先|取締役|常務取締役|代表取締役社長|営業部長|新役職|旧役職|業務部)(?=[^ ])/, '$1 ');
            if (line.startsWith('#')) return line;
            line = line.replace(/([あ-んア-ンー])(常務取締役|取締役|代表取締役|代表取締役社長|営業部長|業務部)/g, (m, p1, p2) => {
                if (/[のはにを]/.test(p1)) return m;
                return p1 + '\n' + p2;
            });
            return line;
        }).join('\n').split('\n');

        const joinedLines: string[] = [];
        for (let i = 0; i < processedLines.length; i++) {
            let line = processedLines[i].trim();
            if (line === '') {
                if (joinedLines.length > 0 && frontMatterKeywords.test(joinedLines[joinedLines.length - 1])) continue;
                joinedLines.push('');
                continue;
            }
            if (line.startsWith('|')) {
                joinedLines.push(line);
                continue;
            }
            if (line.startsWith('#') || frontMatterKeywords.test(line)) {
                joinedLines.push(line);
                continue;
            }

            while (i + 1 < processedLines.length) {
                let next = processedLines[i + 1].trim();
                if (next === '' || next.startsWith('|') || breakKeywords.test(next)) break;
                const isTerminated = /[。！!？\?」』]/.test(line.slice(-1));
                if (!isTerminated) {
                    line = line + (line.match(/[a-zA-Z]$/) ? ' ' : '') + next;
                    i++;
                } else {
                    break;
                }
            }
            joinedLines.push(line);
        }
        cleaned = joinedLines.join('\n');
        cleaned = cleaned.replace(/^(各位|20\d{2}|会社名|代表者名|（コード番号|問合せ先|（TEL)\n+/gm, '$1\n');

        return cleaned.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    }

    public async downloadAndParse(url: string): Promise<{ markdown: string, buffer: ArrayBuffer }> {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to download PDF: ${response.statusText}`);
        const arrayBuffer = await response.arrayBuffer();
        const markdown = await this.parsePdfToMarkdown(arrayBuffer);
        return { markdown, buffer: arrayBuffer };
    }
}
