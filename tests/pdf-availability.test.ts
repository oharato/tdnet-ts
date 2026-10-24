import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { annotatePdfExport, markPdfAvailability } from '../scripts/annotate-pdfs.mjs';
let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tdnet-export-fixture-')); });
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
it('marks only nonempty regular files and preserves raw export fields', () => {
    fs.writeFileSync(path.join(directory,'present.pdf'),'fixture PDF'); fs.writeFileSync(path.join(directory,'empty.pdf'),'');
    fs.mkdirSync(path.join(directory,'folder.pdf')); fs.symlinkSync(path.join(directory,'present.pdf'),path.join(directory,'link.pdf'));
    const records = ['present','missing','empty','folder','link','../unsafe'].map(id => ({ id, title:'Ｍ＆Ａ原文', content:null, localPdfAvailable:true }));
    const before=JSON.stringify(records), result=markPdfAvailability(records,directory);
    expect(result.map(record=>record.localPdfAvailable)).toEqual([true,false,false,false,false,false]); expect(JSON.stringify(records)).toBe(before);
    expect(result[0]).toMatchObject({title:'Ｍ＆Ａ原文',content:null});
});
it('updates a synthetic export and removes staging files', () => {
    const file=path.join(directory,'export.json'); fs.writeFileSync(file, JSON.stringify([{id:'missing',content:'本文'}]));
    annotatePdfExport(file,directory); expect(JSON.parse(fs.readFileSync(file,'utf8'))).toEqual([{id:'missing',content:'本文',localPdfAvailable:false}]);
    expect(fs.readdirSync(directory)).toEqual(['export.json']);
});
it('rejects malformed input before replacing the previous export', () => {
    const file=path.join(directory,'export.json'); fs.writeFileSync(file,'{}');
    expect(()=>annotatePdfExport(file,directory)).toThrow(); expect(fs.readFileSync(file,'utf8')).toBe('{}');
});
