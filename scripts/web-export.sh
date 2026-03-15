#!/bin/sh
LIMIT=${1:-20}
mkdir -p web/pdfs &&
node --no-warnings dist/cli.js sync --save-pdf web/pdfs -l "$LIMIT" &&
node --no-warnings dist/cli.js search --title '優待' --json -c > web/yutai.json &&
node scripts/generate-rss.mjs
