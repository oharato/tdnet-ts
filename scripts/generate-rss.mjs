#!/usr/bin/env node
// export.json → RSS フィード (web/feed.xml) を生成するスクリプト
import { readFileSync, writeFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('web/export.json', 'utf-8'));

const escXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const items = data.slice(0, 100).map(item => `    <item>
      <title>${escXml(`[${item.ticker}] ${item.companyName} - ${item.title}`)}</title>
      <link>${escXml(item.documentUrl)}</link>
      <guid isPermaLink="false">${item.id}</guid>
      <pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate>
      <description>${escXml(item.snippet || item.title)}</description>
    </item>`).join('\n');

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>TDnet 新着開示情報</title>
    <description>TDnetから取得した最新の適時開示情報</description>
    <link>https://example.com</link>
    <language>ja</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;

writeFileSync('web/feed.xml', rss);
console.log(`Generated RSS feed with ${Math.min(data.length, 100)} items.`);
