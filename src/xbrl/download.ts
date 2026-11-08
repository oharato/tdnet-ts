class XbrlDownloadError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = 'XbrlDownloadError';
    }
}

/** TDnet の XBRL ZIP を取得する。PDF のダウンロード経路とは独立している。 */
export class XbrlDownloader {
    constructor(private readonly defaultTimeoutMs: number = 180_000) {}

    private async fetchBytes(url: string, timeoutMs: number): Promise<Uint8Array> {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
            throw new Error('Unsupported XBRL URL.');
        }
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) throw new XbrlDownloadError(`XBRL download failed: ${response.status} ${response.statusText}`, response.status);
        return new Uint8Array(await response.arrayBuffer());
    }

    /**
     * TDnet は XBRL を約30〜40日で削除する。削除済み (403/404) の場合は
     * 東証上場会社情報サービスの永続 URL (www2.jpx.co.jp/disc/{code}/{file}) に切り替える。
     */
    public async download(url: string, timeoutMs: number = this.defaultTimeoutMs, companyCode?: string): Promise<Uint8Array> {
        try {
            return await this.fetchBytes(url, timeoutMs);
        } catch (error) {
            if (!(error instanceof XbrlDownloadError) || ![403, 404].includes(error.status)) throw error;
            if (!companyCode || !/^[0-9A-Z]{4,5}$/.test(companyCode)) throw error;
            const filename = new URL(url).pathname.split('/').pop() ?? '';
            if (!/^[a-zA-Z0-9_.-]+\.zip$/i.test(filename)) throw error;
            return this.fetchBytes(`https://www2.jpx.co.jp/disc/${companyCode}/${filename}`, timeoutMs);
        }
    }
}
