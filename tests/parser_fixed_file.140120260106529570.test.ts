import { describe, it, expect } from 'vitest';
import { PdfParser } from '../src/parser.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('PdfParser: 140120260106529570.pdf test', () => {
    it('should match exact expected layout for 140120260106529570.pdf', async () => {
        const parser = new PdfParser();
        const filePath = path.resolve(process.cwd(), 'tests/fixtures/pdfs/140120260106529570.pdf');
        const buffer = await fs.readFile(filePath);
        const markdown = await parser.parsePdfToMarkdown(buffer);

        // 現在のパーサー出力をベースにした期待値 (ベタ書き)
        const expected = `
各 位

2026 年 2 月 20 日

会 社 名 川 口 化 学 工 業 株 式 会 社

代表者名 代表取締役社長 山田秀行

(コード番号 4361 東証スタンダード・名証メイン)

問合せ先 取締役 本間義隆

(TEL 048‐222‐5171)

# 取締役および部長人事に関するお知らせ

当社は、本日開催の取締役会において、2026 年 2 月 20 日付取締役人事および部長人事について下記のとおり決定いたしましたので、お知らせいたします。

記

## 1.取締役人事

| 氏名 | 新役職 | 旧役職 |
| --- | --- | --- |
| いずもと まさる 泉本 勝 | 常務取締役販売、営業担当 | 常務取締役販売、営業担当、営業部長 |

## 2.部長人事

| 氏名 | 新役職 | 旧役職 |
| --- | --- | --- |
| お が た ひろし 小形 浩 | 営業部長 | 業務部 参事 |

以上
`.trim();

        // 比較（改行コードの差異などは無視できるように trim して比較）
        expect(markdown).toBe(expected);
    });
});
