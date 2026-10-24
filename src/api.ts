import { ApiDocumentResponse } from './types.js';
import { delay } from './utils.js';
import { validateSyncOptions } from './sync-input.js';

export class ApiClient {
    private readonly baseUrl = 'https://webapi.yanoshin.jp/webapi/tdnet/list';
    private readonly maxAttempts = 3;
    private readonly maxServerWaitMs = 60000;

    constructor(private readonly retryDelayMs = 2000, private readonly requestTimeoutMs = 30000) {
        if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 30000 || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 2147483647) throw new Error('Invalid API retry delay or timeout.');
    }

    /** Header wait is never shortened. Long server waits stop this invocation instead of retrying early. */
    private retryWait(header: string | null, attempt: number): number {
        let serverWait = 0;
        if (header !== null) {
            if (/^\d+$/.test(header.trim())) serverWait = Number(header) * 1000;
            else if (Number.isFinite(Date.parse(header))) serverWait = Math.max(0, Date.parse(header) - Date.now());
        }
        if (serverWait > this.maxServerWaitMs) throw new Error('TDnet API Retry-After exceeds 60 seconds; retry later.');
        return Math.max(serverWait, this.retryDelayMs * 2 ** (attempt - 1));
    }

    private async request(url: string): Promise<ApiDocumentResponse> {
        for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(new DOMException('TDnet API timed out', 'TimeoutError')), this.requestTimeoutMs);
            let waitMs: number;
            try {
                const response = await fetch(url, { signal: controller.signal });
                if (response.ok) return await response.json() as ApiDocumentResponse;
                // Release the response before waiting; do not buffer an error body.
                void response.body?.cancel().catch(() => {});
                if (![429, 500, 502, 503, 504].includes(response.status) || attempt === this.maxAttempts) {
                    throw new Error(`Failed to fetch from TDnet API: ${response.statusText}`);
                }
                waitMs = this.retryWait(response.headers?.get('retry-after') ?? null, attempt);
            } catch (error) {
                const transient = error instanceof TypeError || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name));
                if (!transient || attempt === this.maxAttempts) throw error;
                waitMs = this.retryDelayMs * 2 ** (attempt - 1);
            } finally {
                clearTimeout(timer);
            }
            await delay(waitMs);
        }
        throw new Error('TDnet API attempts exhausted.');
    }

    public async fetchByDate(date: string, limit = 100): Promise<ApiDocumentResponse> {
        validateSyncOptions({ date, limit });
        return this.request(`${this.baseUrl}/${date.replace(/-/g, '')}.json?limit=${limit}`);
    }

    public async fetchRecent(limit = 100): Promise<ApiDocumentResponse> {
        validateSyncOptions({ limit });
        return this.request(`${this.baseUrl}/recent.json?limit=${limit}`);
    }
}
