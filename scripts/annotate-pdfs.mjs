import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Existence at export time, not content integrity or a promise that a later deployment contains it. */
export function markPdfAvailability(records, directory) {
    if (!Array.isArray(records)) throw new Error('Export must be an array.');
    return records.map(record => {
        if (!record || typeof record.id !== 'string') throw new Error('Export record needs an ID.');
        let localPdfAvailable = false;
        if (/^[a-zA-Z0-9_.-]+$/.test(record.id) && !['.', '..'].includes(record.id)) {
            try {
                const stat = fs.lstatSync(path.join(directory, `${record.id}.pdf`));
                localPdfAvailable = stat.isFile() && stat.size > 0;
            } catch { /* Missing/unreadable originals remain unconfirmed. */ }
        }
        return { ...record, localPdfAvailable };
    });
}

export function annotatePdfExport(exportPath, directory) {
    const records = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    const annotated = markPdfAvailability(records, directory);
    const staging = fs.mkdtempSync(path.join(path.dirname(exportPath), '.tdnet-export-'));
    try {
        const file = path.join(staging, 'export.json');
        fs.writeFileSync(file, JSON.stringify(annotated, null, 2) + '\n');
        fs.renameSync(file, exportPath);
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    annotatePdfExport(process.argv[2] ?? 'web/export.json', process.argv[3] ?? 'web/pdfs');
}
