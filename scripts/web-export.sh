#!/bin/sh
LIMIT=${1:-1000}
mkdir -p web/pdfs &&
node --no-warnings dist/cli.js sync --save-pdf web/pdfs -l "$LIMIT" &&
node --no-warnings dist/cli.js search --json -c > web/export.json &&
node scripts/generate-rss.mjs
