import { Worker } from 'node:worker_threads';

/** Isolate the uncancellable extractor; never return while its worker is still running. */
export async function extractPdfInWorker(inputPath: string, timeoutMs: number, moduleUrl = import.meta.resolve('@oharato/pdf2md-ts')): Promise<string> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) throw new Error('Invalid PDF conversion timeout.');
    const bootstrap = `
        import { parentPort, workerData } from 'node:worker_threads';
        import(workerData.moduleUrl).then(async ({ extractTablesFromPdf }) => {
            const result = await extractTablesFromPdf(workerData.inputPath);
            parentPort.postMessage(result.markdown);
        }).catch(error => { throw error; });
    `;
    const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(bootstrap)), { workerData: { inputPath, moduleUrl } });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await new Promise<string>((resolve, reject) => {
            worker.once('message', value => typeof value === 'string' ? resolve(value) : reject(new Error('Invalid PDF extraction result.')));
            worker.once('error', reject);
            worker.once('exit', code => reject(new Error(`PDF extractor exited without a result (${code}).`)));
            timer = setTimeout(() => reject(new Error('PDF変換がタイムアウトしました')), timeoutMs);
        });
    } finally {
        clearTimeout(timer);
        await worker.terminate();
        worker.removeAllListeners();
    }
}
