import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseXbrlHtmlDocuments, parseXbrlZip } from '../src/xbrl/parser.js';
import type { NumericFact, ParsedXbrl } from '../src/xbrl/parser.js';

function fixture(name: string): URL {
    return new URL(`./fixtures/xbrl/${name}`, import.meta.url);
}

function fact(parsed: ParsedXbrl, concept: string, contextRef: string): NumericFact | undefined {
    return parsed.facts.find(item => item.concept === concept && item.contextRef === contextRef);
}

describe('iXBRL parser', () => {
    it('J-GAAP の実在決算短信 ZIP から数値 Fact を読み取る', async () => {
        const parsed = await parseXbrlZip(await readFile(fixture('jgaap-23760-2026-q2.zip')));

        expect(parsed.facts).toHaveLength(345);
        expect(parsed.contexts.size).toBe(53);
        // 欠損値 (xsi:nil) は数値 Fact ではないため ignored に残す。
        expect(parsed.ignored.every(item => item.reason === 'nil')).toBe(true);
        expect(parsed.ignored).toHaveLength(56);
        // 文書判定用のテキスト Fact も読み取る (数値 Fact としては保存しない)。
        expect(parsed.textFacts.find(item => item.name === 'DocumentName')?.rawText).toContain('決算短信');
        expect(parsed.textFacts.find(item => item.name === 'TypeOfCurrentPeriodDEI')?.rawText).toBe('HY');

        const sales = fact(parsed, 'tse-ed-t:NetSales', 'CurrentAccumulatedQ2Duration_ConsolidatedMember_ResultMember');
        expect(sales).toMatchObject({
            name: 'NetSales',
            namespace: 'tse-ed-t',
            unitRef: 'JPY',
            scale: 6,
            sign: 1,
            format: 'ixt:numdotdecimal',
            rawText: '7,071',
            value: 7071,
            scaledValue: 7_071_000_000,
        });

        // sign="-" と scale="-2" の組み合わせ (13.0% の前期比減) を符号込みで解決する。
        const change = fact(parsed, 'tse-ed-t:ChangeInNetSales', 'CurrentAccumulatedQ2Duration_ConsolidatedMember_ResultMember');
        expect(change).toMatchObject({ rawText: '13.0', scale: -2, sign: -1, value: -13, scaledValue: -0.13 });

        const operatingIncome = fact(parsed, 'tse-ed-t:OperatingIncome', 'CurrentAccumulatedQ2Duration_ConsolidatedMember_ResultMember');
        expect(operatingIncome?.scaledValue).toBe(-325_000_000);

        const priorSales = fact(parsed, 'tse-ed-t:NetSales', 'PriorAccumulatedQ2Duration_ConsolidatedMember_ResultMember');
        expect(priorSales?.scaledValue).toBe(8_130_000_000);
    });

    it('IFRS の実在決算短信 ZIP から数値 Fact を読み取る', async () => {
        const parsed = await parseXbrlZip(await readFile(fixture('ifrs-13750-2026-q2.zip')));

        expect(parsed.facts).toHaveLength(380);
        expect(parsed.contexts.size).toBe(89);
        expect(parsed.ignored.every(item => item.reason === 'nil')).toBe(true);
        expect(parsed.ignored).toHaveLength(127);

        const revenue = fact(parsed, 'tse-ed-t:RevenueIFRS', 'CurrentAccumulatedQ2Duration_ConsolidatedMember_ResultMember');
        expect(revenue).toMatchObject({
            name: 'RevenueIFRS',
            namespace: 'tse-ed-t',
            unitRef: 'JPY',
            scale: 6,
            sign: 1,
            rawText: '23,491',
            scaledValue: 23_491_000_000,
        });

        // 添付資料の jpigp_cor 科目も ZIP 全体から抽出する。
        const assets = fact(parsed, 'jpigp_cor:AssetsIFRS', 'InterimInstant');
        expect(assets?.unitRef).toBe('JPY');
        expect(assets?.scaledValue).toBeGreaterThan(0);
    });

    it('数値でない Fact とテキスト Fact は数値 Fact として保存しない', () => {
        const html = `<!DOCTYPE html><html><body>
            <ix:header><ix:resources>
                <xbrli:context id="CurrentYearDuration">
                    <xbrli:entity><xbrli:identifier scheme="http://example.com">1234</xbrli:identifier></xbrli:entity>
                    <xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2027-03-31</xbrli:endDate></xbrli:period>
                </xbrli:context>
            </ix:resources></ix:header>
            <p><ix:nonNumeric name="tse-ed-t:CompanyName" contextRef="CurrentYearDuration">サンプル株式会社</ix:nonNumeric></p>
            <p><ix:nonFraction name="tse-ed-t:NetSales" contextRef="CurrentYearDuration" unitRef="JPY" scale="3" format="ixt:numcommadot">1.234,5</ix:nonFraction></p>
            <p><ix:nonFraction name="tse-ed-t:OperatingIncome" contextRef="CurrentYearDuration" unitRef="JPY" sign="-" scale="3" format="ixt:numcommadot">2.000</ix:nonFraction></p>
            <p><ix:nonFraction name="tse-ed-t:Note" contextRef="CurrentYearDuration">非数値</ix:nonFraction></p>
            <p><ix:nonFraction name="tse-ed-t:NilValue" contextRef="CurrentYearDuration" unitRef="JPY" xsi:nil="true" /></p>
        </body></html>`;

        const parsed = parseXbrlHtmlDocuments([{ path: 'sample-ixbrl.htm', content: html }]);
        expect(parsed.facts.map(item => item.concept)).toEqual(['tse-ed-t:NetSales', 'tse-ed-t:OperatingIncome']);
        expect(parsed.facts[0].scaledValue).toBe(1_234_500);
        expect(parsed.facts[1].scaledValue).toBe(-2_000_000);
        expect(parsed.ignored.map(item => item.reason)).toEqual(['not_numeric', 'nil']);
    });
});
