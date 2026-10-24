import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/api.js';
const ok = () => new Response(JSON.stringify({ items: [] }), { status: 200 });
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each([429, 500, 502, 503, 504])('retries temporary HTTP %s with a bounded exponential delay', async status => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status })).mockResolvedValue(ok());
    const result = new ApiClient(100).fetchRecent();
    await vi.advanceTimersByTimeAsync(99); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(await result).toEqual({ items: [] }); expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
});
it.each([400, 401, 404, 501, 505])('does not retry HTTP %s', async status => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status }));
    await expect(new ApiClient(0).fetchRecent()).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it('honors Retry-After seconds and HTTP date without shortening backoff', async () => {
    vi.setSystemTime(new Date('2026-10-24T00:00:00Z'));
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status:429, headers:{'Retry-After':'2'} }))
        .mockResolvedValueOnce(new Response('', {status:503,headers:{'Retry-After':'Sat, 24 Oct 2026 00:00:05 GMT'}})).mockResolvedValue(ok());
    const result = new ApiClient(100).fetchRecent();
    await vi.advanceTimersByTimeAsync(1999); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2999); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); await result; expect(fetch).toHaveBeenCalledTimes(3);
});
it('stops rather than retrying before a long server-requested wait', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('',{status:429,headers:{'Retry-After':'120'}}));
    await expect(new ApiClient().fetchRecent()).rejects.toThrow(/retry later/); expect(fetch).toHaveBeenCalledTimes(1);
});
it('bounds slow response bodies and retries timeout at most three times', async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
        const signal = options!.signal!; signals.push(signal);
        return { ok:true, json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))) } as Response;
    });
    const result = new ApiClient(1, 10).fetchRecent(); const assertion = expect(result).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(40); await assertion;
    expect(fetch).toHaveBeenCalledTimes(3); expect(signals.every(signal => signal.aborted)).toBe(true); expect(vi.getTimerCount()).toBe(0);
});
it('clears timers after invalid JSON and does not retry syntax errors', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{broken', {status:200}));
    await expect(new ApiClient().fetchRecent()).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it('validates standalone API inputs before networking', async () => {
    const client = new ApiClient(); await expect(client.fetchByDate('20260230')).rejects.toThrow(); await expect(client.fetchRecent(0)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled(); expect(()=>new ApiClient(-1)).toThrow(); expect(()=>new ApiClient(1e20)).toThrow();
});
