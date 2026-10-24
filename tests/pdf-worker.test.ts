import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractPdfInWorker } from '../src/pdf-worker.js';
const module = (body: string) => 'data:text/javascript,' + encodeURIComponent(body);
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, {recursive:true,force:true}); });
it('returns extraction text and terminates a worker that retains an active interval', async () => {
    const result = await extractPdfInWorker('unused', 5000, module('export async function extractTablesFromPdf() { setInterval(()=>{},10); return {markdown:"fixture"}; }'));
    expect(result).toBe('fixture');
});
it('propagates extractor failures and invalid output', async () => {
    await expect(extractPdfInWorker('unused', 5000, module('export async function extractTablesFromPdf() { throw new Error("fixture failure"); }'))).rejects.toThrow('fixture failure');
    await expect(extractPdfInWorker('unused', 5000, module('export async function extractTablesFromPdf() { return {markdown:123}; }'))).rejects.toThrow('Invalid');
});
it('rejects an early worker exit instead of waiting for the timeout', async () => {
    await expect(extractPdfInWorker('unused', 5000, module('export async function extractTablesFromPdf() { process.exit(0); }'))).rejects.toThrow('without a result');
});
it('stops CPU-bound extraction before returning a timeout, preventing later writes', async () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tdnet-worker-fixture-')); directories.push(dir);
    const marker=path.join(dir,'should-not-exist');
    const body='import fs from "node:fs"; export async function extractTablesFromPdf(file) { fs.writeFileSync(file+".started","yes"); const end=Date.now()+1500; while(Date.now()<end){} fs.writeFileSync(file,"late"); return {markdown:"late"}; }';
    await expect(extractPdfInWorker(marker, 1000, module(body))).rejects.toThrow('タイムアウト');
    expect(fs.existsSync(marker+".started")).toBe(true);
    await new Promise(resolve=>setTimeout(resolve,600)); expect(fs.existsSync(marker)).toBe(false);
});
it.each([0,-1,Infinity,2147483648])('rejects invalid timeout %s before starting a worker', async timeout => {
    await expect(extractPdfInWorker('unused',timeout)).rejects.toThrow('timeout');
});
it('works when the parent uses --input-type=module', async () => {
    const previous = [...process.execArgv];
    process.execArgv.push('--input-type=module');
    try {
        await expect(extractPdfInWorker('unused', 5000, module('export async function extractTablesFromPdf() { return {markdown:"esm fixture"}; }'))).resolves.toBe('esm fixture');
    } finally { process.execArgv.splice(0, process.execArgv.length, ...previous); }
});
