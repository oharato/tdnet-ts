/** TDnet の XBRL ZIP を取得する。PDF のダウンロード経路とは独立している。 */
export class XbrlDownloader {
    constructor(private readonly defaultTimeoutMs: number = 180_000) {}

    public async download(url: string, timeoutMs: number = this.defaultTimeoutMs): Promise<Uint8Array> {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
            throw new Error('Unsupported XBRL URL.');
        }
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) throw new Error(`XBRL download failed: ${response.status} ${response.statusText}`);
        return new Uint8Array(await response.arrayBuffer());
    }
}
