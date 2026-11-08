import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseXbrlHtmlDocuments, parseXbrlZip } from '../src/xbrl/parser.js';
import { classifyXbrlDocument } from '../src/xbrl/classify.js';

function fixture(name: string): URL {
    return new URL(`./fixtures/xbrl/${name}`, import.meta.url);
}

function html(fields: { documentName?: string; netSales?: string; amendment?: string }): string {
    return `<!DOCTYPE html><html><body>
        <ix:header><ix:resources>
            <xbrli:context id="CurrentYearDuration">
                <xbrli:entity><xbrli:identifier scheme="http://example.com">1234</xbrli:identifier></xbrli:entity>
                <xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2027-03-31</xbrli:endDate></xbrli:period>
            </xbrli:context>
        </ix:resources></ix:header>
        ${fields.documentName ? `<p><ix:nonNumeric name="tse-ed-t:DocumentName" contextRef="CurrentYearDuration">${fields.documentName}</ix:nonNumeric></p>` : ''}
        ${fields.amendment ? `<p><ix:nonNumeric name="jpdei_cor:XBRLAmendmentFlagDEI" contextRef="CurrentYearDuration">${fields.amendment}</ix:nonNumeric></p>` : ''}
        ${fields.netSales ? `<p><ix:nonFraction name="tse-ed-t:NetSales" contextRef="CurrentYearDuration" unitRef="JPY">${fields.netSales}</ix:nonFraction></p>` : ''}
    </body></html>`;
}

describe('XBRL document classification', () => {
    it('J-GAAP と IFRS の実在決算短信を決算短信と判定する', async () => {
        const jgaap = classifyXbrlDocument(await parseXbrlZip(await readFile(fixture('jgaap-23760-2026-q2.zip'))));
        expect(jgaap).toMatchObject({
            isFinancialSummary: true,
            documentName: '第２四半期（中間期）決算短信〔日本基準〕（連結）',
            quarterlyPeriod: 2,
            typeOfCurrentPeriod: 'HY',
            accountingStandard: 'Japan GAAP',
            isRevision: false,
            hasFinancialStatements: true,
        });

        const ifrs = classifyXbrlDocument(await parseXbrlZip(await readFile(fixture('ifrs-13750-2026-q2.zip'))));
        expect(ifrs).toMatchObject({
            isFinancialSummary: true,
            documentName: '第２四半期（中間期）決算短信〔ＩＦＲＳ〕（連結）',
            accountingStandard: 'IFRS',
            hasFinancialStatements: true,
        });
    });

    it('XBRL の DocumentName が決算短信で財務諸表がなければ対象外にする', () => {
        const parsed = parseXbrlHtmlDocuments([{
            path: 'not-summary-ixbrl.htm',
            content: html({ documentName: '業績予想の修正に関するお知らせ' }),
        }]);
        expect(classifyXbrlDocument(parsed)).toMatchObject({
            isFinancialSummary: false,
            hasFinancialStatements: false,
        });
    });

    it('DocumentName が決算短信で財務諸表があれば四半期情報が欠けていても受理する', () => {
        const parsed = parseXbrlHtmlDocuments([{
            path: 'summary-ixbrl.htm',
            content: html({ documentName: '第１四半期決算短信〔日本基準〕（連結）', netSales: '1,000' }),
        }]);
        expect(classifyXbrlDocument(parsed)).toMatchObject({
            isFinancialSummary: true,
            hasFinancialStatements: true,
        });
    });

    it('訂正フラグを XBRL から読む', () => {
        const parsed = parseXbrlHtmlDocuments([{
            path: 'summary-ixbrl.htm',
            content: html({ documentName: '第２四半期決算短信〔日本基準〕（連結）', netSales: '1,000', amendment: 'true' }),
        }]);
        expect(classifyXbrlDocument(parsed).isRevision).toBe(true);
    });
});
