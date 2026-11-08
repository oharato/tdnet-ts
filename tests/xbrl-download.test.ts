import { afterEach, describe, expect, it, vi } from 'vitest';
import { XbrlDownloader } from '../src/xbrl/download.js';

const TDNET_URL = 'https://www.release.tdnet.info/inbs/081220231108582174.zip';
const JPX_URL = 'https://www2.jpx.co.jp/disc/38520/081220231108582174.zip';

describe('XbrlDownloader', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('TDnet が 404 のとき JPX 永続URLへフォールバックする', async () => {
        const calls: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            calls.push(url);
            return url === JPX_URL
                ? new Response(new Uint8Array([1, 2, 3]), { status: 200 })
                : new Response('missing', { status: 404, statusText: 'Not Found' });
        }));

        const bytes = await new XbrlDownloader().download(TDNET_URL, 1000, '38520');

        expect([...bytes]).toEqual([1, 2, 3]);
        expect(calls).toEqual([TDNET_URL, JPX_URL]);
    });

    it('404 以外の失敗や証券コードなしではフォールバックしない', async () => {
        const calls: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            calls.push(url);
            return new Response('error', { status: 500, statusText: 'Server Error' });
        }));

        await expect(new XbrlDownloader().download(TDNET_URL, 1000, '38520')).rejects.toThrow('500');
        expect(calls).toEqual([TDNET_URL]);

        calls.length = 0;
        await expect(new XbrlDownloader().download(TDNET_URL, 1000)).rejects.toThrow('500');
        expect(calls).toEqual([TDNET_URL]);
    });
});
