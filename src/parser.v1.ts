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
        if (!markdown) return '';

        // 1. 基本的な正規化
        let cleaned = markdown.replace(/\r\n/g, '\n').trim();
        // ページ番号と思われる行の除去
        cleaned = cleaned.replace(/^\s*(\d+\s*\/\s*\d+|-?\s*\d+\s*-?|page\s*\d+)\s*$/gim, '');

        // 2. スペースの正規化
        cleaned = cleaned.replace(/\u3000/g, ' ').replace(/[ \t]+/g, ' ');

        // 日本語（CJK）文字間のスペース除去
        // 「会 社 名」のような1文字+スペースの繰り返しを重点的に詰める
        const jp = '[\\u3040-\\u309f\\u30a0-\\u30ff\\u4e00-\\u9faf]';
        for (let i = 0; i < 3; i++) {
            // (1文字) + スペース + (1文字) という並びを探す
            // 前後に文字がない、あるいはさらに1文字+スペースが続いている場合に限定して、単語間スペース（会社名 山田）を保護する
            cleaned = cleaned.replace(new RegExp(`(^| )(${jp}) (${jp})($| )`, 'g'), '$1$2$3$4');
            // 日付周り
            cleaned = cleaned.replace(/(\d) (?=[\u5e74\u6708\u65e5])/g, '$1');
            cleaned = cleaned.replace(/([\u5e74\u6708\u65e5]) (?=\d)/g, '$1');
        }

        // 3. 構造の正規化 (事前処理)
        const breakKeywords = /^(各位|20\d{2}|会社名|代表者名|問合せ先|記|以上|#{1,6}|[1-9]\s*[．.]|（|\(|常務取締役|取締役|代表取締役|部長|営業部長|販売、営業担当|氏名|新役職|旧役職)/;
        const frontMatterKeywords = /^(各位|20\d{2}|会社名|代表者名|問合せ先|（コード番号|（TEL)/;

        const stage1Lines = cleaned.split('\n').map(l => {
            let line = l.trim();
            if (line === '') return '';

            // ## を平坦化
            if (line.startsWith('##')) line = line.replace(/^##+\s*/, '').trim();

            // ラベルのスペースを正規化 (会社名 〇〇)
            line = line.replace(/^(会社名|代表者名|問合せ先|取締役|常務取締役|代表取締役社長|営業部長|新役職|旧役職|業務部)(?=[^ ])/, '$1 ');

            // 表形式ヘッダーの分割
            const condensed = line.replace(/\s/g, '');
            if (condensed === '氏名新役職旧役職') return '氏名\n新役職\n旧役職';

            // 人名と役職の分離 (例: まさる常務取締役 -> まさる\n常務取締役)
            // タイトル(#)ではない場合、かつ直前がひらがな・カタカナの場合のみ限定的に実行
            if (!line.startsWith('#')) {
                // 助詞が含まれる場合（例：取締役および...）は分割しない
                line = line.replace(/([あ-んア-ンー])(常務取締役|取締役|代表取締役|代表取締役社長|営業部長|業務部)/g, (m, p1, p2) => {
                    if (/[のはにを]/.test(p1)) return m;
                    return p1 + '\n' + p2;
                });
            }

            return line;
        }).join('\n').split('\n');

        // 4. 行の結合処理
        const joinedLines: string[] = [];
        for (let i = 0; i < stage1Lines.length; i++) {
            let line = stage1Lines[i].trim();
            if (line === '') {
                // フロントマター付近の空行を徹底的に排除
                if (joinedLines.length > 0 && frontMatterKeywords.test(joinedLines[joinedLines.length - 1])) continue;
                joinedLines.push('');
                continue;
            }

            // タイトル(#)または重要ラベルは結合せずに独立
            if (line.startsWith('#') || frontMatterKeywords.test(line)) {
                joinedLines.push(line);
                continue;
            }

            while (i + 1 < stage1Lines.length) {
                let next = stage1Lines[i + 1].trim();
                let nextIdx = i + 1;

                if (next === '' && i + 2 < stage1Lines.length) {
                    const nextNext = stage1Lines[i + 2].trim();
                    if (breakKeywords.test(nextNext)) break;

                    // ルビ（読仮名）と思われる短い行（10文字以下のひらがな・カタカナのみ）の場合は空行を跨ぐ
                    const isRubi = /^[ぁ-んァ-ヶー]{1,10}$/.test(nextNext);
                    if (!isRubi && line.length < 20 && nextNext.length < 20) break;

                    next = nextNext;
                    nextIdx = i + 2;
                }

                if (next === '' || breakKeywords.test(next)) break;

                const isTerminated = /[。！!？\?」』]/.test(line.slice(-1));
                if (!isTerminated) {
                    line = line + (line.match(/[a-zA-Z]$/) ? ' ' : '') + next;
                    i = nextIdx;
                } else {
                    break;
                }
            }
            joinedLines.push(line);
        }
        cleaned = joinedLines.join('\n');

        // 5. レイアウトの最終仕上げ
        // フロントマター付近の空行を詰める
        cleaned = cleaned.replace(/^(各位|20\d{2}|会社名|代表者名|（コード番号|問合せ先|（TEL)\n+/gm, '$1\n');

        // 見出しの再整理
        const finalLines = cleaned.split('\n');
        cleaned = finalLines.map(line => {
            const l = line.trim();
            if (l.startsWith('# ')) {
                const content = l.slice(2).trim();
                // 100文字以上または句点、または特定キーワードの場合は見出し解除
                if (content.length > 100 || /[。]/.test(content) || /^(各位|会社名|代表者名|問合せ先|記|以上)$/.test(content)) return content;
            }
            return l;
        }).join('\n');

        return cleaned
            .replace(/[ \t]+$/gm, '')
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
