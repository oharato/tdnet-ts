import fs from 'node:fs/promises';
import { PdfParser } from '../dist/parser.js';

const files = [
  '140120260106529570',
  '140120260113532690',
  '140120260119535576'
];

async function run() {
  const parser = new PdfParser();
  for (const id of files) {
    const pdfPath = `tests/fixtures/pdfs/${id}.pdf`;
    const testFile = `tests/parser_fixed_file.${id}.test.ts`;
    
    let testCode = await fs.readFile(testFile, 'utf8');
    
    // get new markdown
    const md = await parser.parsePdfToMarkdown(await fs.readFile(pdfPath));
    
    // replace inside test
    testCode = testCode.replace(/const expected = `[\s\S]*?`\.trim\(\);/, `const expected = \`\n${md.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$')}\n\`\.trim();`);
    
    await fs.writeFile(testFile, testCode);
    console.log('Fixed', id);
  }
}

run();
