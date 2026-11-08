# 四半期決算データ対応 現状調査

- 調査日: 2026-11-08
- 対象リポジトリ: `tdnet-ts`（HEAD `9efcd57`。作業ツリー上の変更は `.opencode/` の未追跡のみ）
- 目的: 現行の取得・保存・検索の実態を確認し、「四半期決算データを edinet-ts と同じように取得・検索できるようにする」ための不足要素と変更範囲を洗い出す。
- 前提: ここでの「四半期決算データ」は、TDnet の決算短信（第1〜第3四半期および通期）に含まれる XBRL の財務数値を指す。EDINET の四半期報告書（現在は半期報告書へ移行）を対象とするものではない。
- 調査方法: ソース、README、docs、package.json、GitHub Actions、Web/RSS 補助スクリプトを読み、ヤノシン TDnet API の公開仕様と実際の応答、公開されている決算短信 XBRL ZIP の同梱物を確認した。コード変更・本番 DB への書込みは行っていない。依存パッケージが未導入のため、テストは実行できていない。

---

## 0. 結論

1. 現状は「TDnet の一覧 API から PDF を取得し、Markdown に変換して SQLite に保存し、文書単位のキーワード検索を行う」構成である。XBRL の取得・解析・財務数値検索は実装されていない。
2. 四半期決算データを edinet-ts 同等にするには、XBRL ZIP の取得、iXBRL の解析、TDnet 固有のタクソノミー・コンテキストの解決、当期/前期の財務指標抽出、財務数値用の保存・検索（screen/schema 相当）を新設する必要がある。
3. 既存の PDF → Markdown → SQLite の経路と文書検索は維持できる。変更は `api.ts` / `types.ts` / `sync-input.ts` / `index.ts` / `db.ts` / `cli.ts` と新規 XBRL・財務モジュール、DBマイグレーション、テスト、ドキュメントに及ぶ。

---

## 1. 現在のデータ取得の仕組み

### 1.1 全体像

```text
ヤノシン TDnet Web-API
  ├─ recent.json?limit=N        （直近）
  └─ YYYYMMDD.json?limit=N      （指定日）
        ↓
TdnetManager.sync()
  ├─ 応答行の検証・正規化
  ├─ PDF ダウンロード（任意で原本保存）
  ├─ pdf2md-ts で Markdown 変換（worker_threads 内）
  └─ SQLite: tdnet_documents へ保存
        ↓
検索（LIKE） / CLI / JSON エクスポート / Web / RSS
```

XBRL の取得・解析はこの流れに入っていない。

### 1.2 利用している API

| 項目 | 現状 |
| --- | --- |
| 提供元 | ヤノシン TDnet API（非公式） |
| ベース URL | `https://webapi.yanoshin.jp/webapi/tdnet/list`（`src/api.ts`） |
| 直近取得 | `recent.json?limit=N` |
| 日付指定取得 | `YYYYMMDD.json?limit=N` |
| 形式 | JSON のみ |
| 1回の取得上限 | ライブラリ既定 `100`。API 側の既定は `300` |
| HTTP 再試行 | 1試行30秒、最大3試行。通信例外、タイムアウト、HTTP 429/500/502/503/504 のみ再試行。`Retry-After` を尊重 |
| 入力検証 | 件数（正整数）、日付（実在日）、同時実行数、待機時間を通信前に検証 |

現状の `ApiClient` が公開しているメソッドは `fetchRecent(limit)` と `fetchByDate(date, limit)` の2つだけである（`src/api.ts`）。API 仕様が提供している次の機能は使っていない。

- `hasXBRL=1` による XBRL 開示への絞り込み
- `YYYYMMDD-YYYYMMDD` の日付範囲取得
- 証券コードによる絞り込み
- `total_count` を使った取得件数の把握・ページ分割
- `url_xbrl` / `url_report_type_*` / `markets_string` / `update_history` などの追加フィールド

### 1.3 取得対象と保存先

`TdnetManager.sync()`（`src/index.ts`）は、一覧 API の各行を次のように処理する。

- 対象は「直近」または「指定日1日分」の適時開示で、決算短信に限定していない。
- 各行から `id` / `pubdate` / `company_code` / `company_name` / `title` / `document_url` を取得する（`src/sync-input.ts`）。
- `document_url` のパス末尾が `.pdf` でない場合は `unsupported` としてメタデータだけ保存し、本文変換は行わない。
- PDF をダウンロードし、`@oharato/pdf2md-ts` で Markdown に変換する。変換は Node の worker に隔離され、タイムアウト時も停止を待つ（`src/parser.ts`、`src/pdf-worker.ts`）。
- 変換結果が空文字なら失敗扱いにする。
- `--save-pdf` 指定時は、変換より先に原本を `{id}.pdf` として保存する。既存ファイルは上書きしない。

保存先は SQLite の `tdnet_documents` テーブルである（`src/db.ts`）。

| カラム | 内容 |
| --- | --- |
| `id` | 主キー。PDF URL のベースネームから拡張子を除いたもの（例: `140120260220565990`） |
| `document_url` | PDF の URL（`rd.php?` のリダイレクト文字列を除去済み） |
| `published_at` | 開示日時。JST として解釈し UTC の ISO 文字列で保存 |
| `ticker` | 銘柄コード。5文字形式の末尾 `0` だけを除去した4文字 |
| `company_name` | 会社名 |
| `title` | 件名 |
| `content` | PDF から変換した Markdown 本文。未取得・失敗時は `NULL` |
| `retry_count` | PDF 変換の累積失敗回数 |
| `created_at` | レコード作成日時（UTC ISO） |

DB の既定パスはカレントディレクトリの `tdnet.sqlite`。`--db` で変更できる。

原本 PDF を保存する場合の出力先は `--save-pdf <dir>` で指定し、ファイル名は `{id}.pdf`。Web 運用では `web/pdfs/` を使う。

### 1.4 ID・日時・コードの正規化

`disclosureFromApi()`（`src/sync-input.ts`）が行う変換は次のとおり。

- `pubdate` は `YYYY-MM-DD HH:mm:ss` を JST として UTC に変換する。
- `document_url` の先頭 `https://webapi.yanoshin.jp/rd.php?` を除去する。
- `id` は PDF URL のファイル名から `.pdf` を除いたもの。API の `id` フィールド（例: `1290773`）は使っていない。
- `company_code` は `^[0-9A-Z]{4}(?:0)?$` を検証し、5文字なら末尾 `0` を落とす。

**XBRL 対応時の注意:** 実際の応答では PDF と XBRL ZIP のファイル名が異なる。

```text
PDF : 140120261105565438.pdf
XBRL: 081220261105565438.zip
```

現在の ID は PDF ファイル名由来なので、XBRL ZIP の URL をそのまま `document_url` に入れると ID が変わり、同じ開示を別レコードとして扱う危険がある。XBRL 対応では「文書の正規 ID」と「PDF/XBRL 各資産のファイル名」を分離する必要がある。

### 1.5 同期結果と再試行

`sync()` は `SyncResult` を返し、文書ごとに `synced` / `existing` / `failed` / `exhausted` / `unsupported` の状態を持つ。

- 本文が既に保存済み（`content !== null`）なら `existing` としてスキップする。
- URL が PDF でなければ `unsupported`。メタデータだけ保存する。
- `retry_count >= 3` なら通常同期では `exhausted` として扱う。
- 変換失敗は 3分・10分・30分の3ラウンドで再試行する。既定の並列数は2、バッチ間の待機は1秒。
- 失敗した文書は `recover(ids)` / CLI `recover` で明示的に再処理できる。一覧 API を呼ばず、保存済み URL を使う。
- `limitReached` は「指定上限に達した」という注意であり、全件取得の保証ではない。

### 1.6 Web 運用と自動化

`pnpm run web:export` は次を行う（`scripts/web-export.sh`）。

1. `pnpm build`
2. `sync --save-pdf web/pdfs -l 1000`
3. `search --json -c -l 1000 > web/export.json`
4. `scripts/annotate-pdfs.mjs` で `localPdfAvailable` を付与
5. `scripts/generate-rss.mjs` で `web/feed.xml` を生成

GitHub Actions は平日 JST 18:00 に実行され、`tdnet.sqlite` と `web/pdfs/` をキャッシュする（`.github/workflows/deploy-pages.yml`）。

### 1.7 現状の制約・留意点

- 取得は「直近」または「指定日1日」のみ。日付範囲、銘柄指定、過去分の一括バックフィルはない。
- API の `total_count` を使っていないため、上限到達時に何件取りこぼしたかを厳密には把握できない。
- 対象を決算短信に絞る条件がない。優待・配当・業績予想修正なども同じ経路で PDF 化される。
- `url_xbrl` を型にも処理にも持っていないため、同じ開示に XBRL が併存していても取得しない。
- `document_url` が `.zip` の場合は `unsupported` になり、本文も財務数値も保存されない。
- API は非公式であり、長期の完全性・訂正/削除の保証はない。公式 JPX API は有料で、過去5年・PDF/XBRL を案内している（`docs/plans/2026-10-24-maintenance-plan.md`）。
- 2026-11-08 の確認では、API の応答形状が `limit` によって揺れる例を観測した。`recent.json?limit=1000` は `items[].Tdnet` のラッパーなし、`limit=999` / `1001` はラッパーありだった。現在の `disclosureFromApi()` は `Tdnet` を必須とするため、ラッパーなしの応答では全行が `invalid` になる。API 側の一時的な挙動か再現性があるかは未確認だが、`web:export` の既定 `-l 1000` と関係するため、XBRL 対応とは別に確認が必要である。

---

## 2. 検索・参照の仕組み

### 2.1 ライブラリ API

`src/index.ts` が公開する主な入口は次のとおり。

- `TdnetManager`: `sync()` / `recover()` / `search()` / `getRecent()` / `close()`
- `ApiClient`: `fetchRecent()` / `fetchByDate()`
- `DbClient`: `insertDocument()` / `getDocument()` / `searchDocuments()` / `getRecentDocuments()`
- `PdfParser`: `downloadPdf()` / `parsePdfToMarkdown()` / `downloadAndParse()`
- 型: `TdnetDocument` / `SearchOptions` / `SyncResult` / `RecoveryResult` など

HTTP の検索サーバーは提供していない。ここでの「API」は TypeScript ライブラリの公開 API を指す。Web は `web/export.json` をブラウザで読む静的検索であり、サーバー側の検索 API ではない。

### 2.2 SQLite の検索

`DbClient.searchDocuments()`（`src/db.ts`）は `tdnet_documents` に対する SQL の `LIKE` 検索である。

- 既定は `match: 'legacy'`: 入力全体を1つの部分一致パターンとして扱う。`%` と `_` は SQLite のワイルドカード。
- `literal` / `all` / `any` を明示できる。`all` は語ごとの AND、`any` は OR。引用符で囲んだ連続フレーズに対応。
- `fields` は `title` / `body`（`content`）/ `company`（`company_name`）から選択。既定は3項目すべて。
- `normalize: 'width-case'` で全角 ASCII・全角空白・ASCII 英字大小を検索時に揃える。原文は変更しない。
- `ticker` は完全一致、`title` は部分一致、`startDate` / `endDate` は JST の日付境界または ISO 日時。
- 並び順は `published_at DESC, id ASC`。`limit` / `offset` を適用する。
- FTS 索引、分かち書き、意味検索、財務数値による絞り込みはない。

### 2.3 CLI

`src/cli.ts` のコマンドは次の3つ。

| コマンド | 内容 |
| --- | --- |
| `sync` | 一覧取得、PDF 変換、SQLite 保存。`--limit` / `--date` / `--save-pdf` / `--db` |
| `recover` | 保存済み ID の再処理。`--save-pdf` / `--db` |
| `search` | キーワード・銘柄・タイトル・期間・件数・offset・JSON 出力・本文表示 |

`search` の主なオプションは `--match`、`--normalize`、`--fields`、`--ticker`、`--title`、`--start`、`--end`、`--limit`、`--offset`、`--json`、`--content`。人間向け出力では本文中の一致箇所の抜粋を表示する。

### 2.4 Web と RSS

- `web/index.html` / `web/app.js` は `web/export.json` を読み、ブラウザ内で検索する。
- 検索条件は URL に保存され、戻る/進むで復元される。
- 「🎁 優待のみ」フィルターは既定で ON。タイトルまたは本文に「優待」を含む資料に絞る。
- 本文は Text / Markdown で切り替え表示できる。
- `localPdfAvailable` が true の資料だけローカル PDF リンクを表示する。
- `web/feed.xml` は `export.json` の先頭100件から RSS 2.0 を生成する。

### 2.5 ファイル・DB 構成

```text
tdnet-ts/
├── src/
│   ├── api.ts             # 一覧 API
│   ├── sync-input.ts      # 入力検証・正規化
│   ├── index.ts           # TdnetManager（同期・復旧・検索）
│   ├── db.ts              # SQLite（node:sqlite）
│   ├── parser.ts          # PDF → Markdown
│   ├── pdf-worker.ts      # PDF 変換 worker
│   ├── cli.ts             # CLI
│   ├── types.ts           # 型定義
│   ├── search-query.ts    # 検索語解析
│   ├── search-date.ts     # JST 日付境界
│   ├── search-normalize.ts# 幅・大小の限定正規化
│   └── search-browser.ts  # 静的 Web 検索
├── web/
│   ├── index.html
│   ├── app.js
│   ├── export.json        # 検索用 JSON（生成物）
│   ├── feed.xml           # RSS（生成物）
│   └── pdfs/              # 原本 PDF（任意）
├── scripts/
│   ├── web-export.sh
│   ├── annotate-pdfs.mjs
│   └── generate-rss.mjs
├── tdnet.sqlite           # 既定 DB（git 管理外）
└── docs/
```

### 2.6 検索できる範囲の限界

現行検索は「保存済み文書のメタデータと Markdown 本文」に対するテキスト検索である。決算短信の PDF 本文に「売上高」「営業利益」などの文字が含まれていればヒットするが、次のことはできない。

- 特定企業の四半期の売上高・営業利益などを数値条件で抽出する
- 当期と前期を比較する
- 営業利益率・ROE・自己資本比率などの指標で並べ替える
- 連結/単体、四半期/累計、実績/予想を構造的に区別する
- 訂正短信と元の短信を関連付ける

---

## 3. 決算短信の XBRL を扱っているか

### 3.1 結論

**扱っていない。XBRL の取得・解析・保存・検索はすべて未対応である。**

対象科目・期間の定義も存在しない。現状できるのは、PDF 本文に含まれる決算短信の文章・表を Markdown として保存し、その文字列をキーワード検索することまでである。

### 3.2 根拠

- `src/` に `xbrl` / `iXBRL` / `taxonomy` / `fact` / `context` を扱うコードがない。
- `src/types.ts` の `ApiDocumentItem` は `id` / `pubdate` / `company_code` / `company_name` / `title` / `document_url` のみで、`url_xbrl` を持たない。
- `src/index.ts` は `document_url` のパスが `.pdf` でなければ `unsupported` にする。XBRL ZIP はここで対象外になる。
- `src/parser.ts` は PDF 専用で、ZIP 展開や XML/iXBRL 解析を行わない。
- `src/db.ts` のテーブルは `tdnet_documents` のみで、財務数値・Fact・Context・期間を保存する表がない。
- `docs/plans/2026-10-24-maintenance-plan.md` でも「XBRL 解析・財務数値抽出」は後回しと明記されている。

### 3.3 API 側の XBRL 情報

ヤノシン API は XBRL を扱える。

- `hasXBRL=1` を付けると、XBRL で報告された開示だけに絞り込める。
- その場合、`document_url` は XBRL ファイル（ZIP）へのリンクになる。
- 通常の一覧でも、決算短信などには `url_xbrl` が入る。実際に `recent.json?limit=500` を確認したところ、500件中204件で `url_xbrl` が非 null だった。
- 通常一覧では `document_url` は PDF、`url_xbrl` は XBRL ZIP という組み合わせになる。例:

```text
document_url: https://www.release.tdnet.info/inbs/140120261105565438.pdf
url_xbrl:     https://www.release.tdnet.info/inbs/081220261105565438.zip
```

### 3.4 決算短信 XBRL ZIP の同梱物

実際の決算短信 ZIP（2027年3月期 第2四半期、日本基準・連結）を確認したところ、次の構成だった。

```text
XBRLData/
├── Summary/
│   ├── tse-scedjpsy-45640-20261105565438-ixbrl.htm   # 決算短信サマリー（iXBRL）
│   ├── tse-scedjpsy-45640-20261105565438.xsd
│   └── tse-scedjpsy-45640-20261105565438-def.xml
└── Attachment/
    ├── 0101010-scbs15-...-ixbrl.htm   # 貸借対照表
    ├── 0102010-scpl15-...-ixbrl.htm   # 損益計算書
    ├── 0102020-scci15-...-ixbrl.htm   # 包括利益計算書
    ├── 0103010-sccf15-...-ixbrl.htm   # キャッシュ・フロー計算書
    ├── 0104010-scsg15-...-ixbrl.htm   # セグメント情報
    ├── qualitative.htm                # 定性情報
    ├── manifest.xml
    └── index.txt
```

サマリーの iXBRL には、例えば次のような Fact が入っている。

```html
<ix:nonFraction
  contextRef="CurrentAccumulatedQ2Duration_ConsolidatedMember_ResultMember"
  decimals="-6" format="ixt:numdotdecimal"
  name="tse-ed-t:NetSales" scale="6" unitRef="JPY">335</ix:nonFraction>
```

つまり、TDnet の XBRL は「ZIP + iXBRL HTML」であり、EDINET の有報のような「単体の XBRL XML」ではない。

### 3.5 edinet-ts の解析器をそのまま使えるか

そのままでは使えない。主な差分は次のとおり。

| 観点 | edinet-ts | TDnet 決算短信 |
| --- | --- | --- |
| 入力 | 生の XBRL XML（`.xbrl`） | ZIP 内の iXBRL HTML（`.htm`） |
| 事実の表現 | `<jppfs_cor:NetSales contextRef="...">` | `<ix:nonFraction name="tse-ed-t:NetSales" contextRef="...">` |
| パーサーの見方 | XML タグ名をローカル名として取得 | `ix:nonFraction` / `ix:nonNumeric` の `name` 属性を読む必要がある |
| タクソノミー | `jppfs_cor` / `jpcrp_cor` など | サマリーは `tse-ed-t`、添付は `jppfs_cor` など |
| コンテキスト ID | `CurrentYearDuration` / `CurrentYTDDuration` / `CurrentQuarterDuration` など | `CurrentAccumulatedQ2Duration_ConsolidatedMember_ResultMember` など |
| 期間の考え方 | 年次を優先し、必要なら HY/Q1〜Q3 に分岐 | 四半期累計（YTD）と四半期単独、実績/予想、連結/単体が次元で分かれる |
| 取得単位 | 1書類 = 1 XML | 1書類 = ZIP（Summary + Attachment + taxonomy） |

edinet-ts の `XbrlParser` は `contextRef` 属性を見るが、iXBRL の `name` 属性から概念名を取る処理を持たない。`FinancialExtractor` の比率計算ロジック（営業利益率、ROE、ROA、FCF など）は参考・移植候補になるが、パーサーとコンテキスト解決は TDnet 用に別実装が必要である。

### 3.6 現状の XBRL に対する実際の挙動

- `hasXBRL=1` を使わない通常同期: PDF は処理されるが、`url_xbrl` は無視される。結果として決算短信の本文検索はできるが、財務数値は構造化されない。
- `hasXBRL=1` を使う、または `document_url` が ZIP の行を同期する: `document_url` の拡張子が `.pdf` でないため `unsupported` になり、メタデータだけ保存される。
- したがって、現状の DB には XBRL の Fact も財務指標も存在しない。

---

## 4. 「edinet-ts と同じように取得・検索できるようにする」ための不足要素と変更範囲

### 4.1 ゴールの分解

「edinet-ts と同じように」を、次の5つに分解する。

| 段階 | できるようにすること |
| --- | --- |
| A. 取得 | TDnet の決算短信 XBRL（ZIP）を取得する。必要なら PDF と XBRL の両方を保持する |
| B. 解析 | ZIP を展開し、iXBRL から Fact・Context・期間・単位を抽出する |
| C. 財務抽出 | 当期/前期の売上高・営業利益・純利益・資産・CF・EPS などを抽出し、指標を計算する |
| D. 保存 | 文書、Fact、財務サマリーを DB に保存する。訂正・連結/単体・四半期/累計を区別する |
| E. 検索 | 数値条件・期間・企業・指標で検索/スクリーニングできる CLI/ライブラリ API を提供する |

edinet-ts の CLI 全体（`parse` / `load` / `screen` / `schema` / `sync` / `facts`）をそのまま真似る必要はないが、少なくとも「単一 XBRL の解析」「一括取込」「指標検索」「スキーマ案内」に相当する入口が必要になる。

### 4.2 不足要素の一覧

| # | 不足要素 | 現状 | 必要なこと | 主な変更対象 |
| --- | --- | --- | --- | --- |
| 1 | XBRL 対象の一覧取得 | `recent` / 指定日のみ。`url_xbrl` を無視 | 通常一覧の `url_xbrl` を型に追加して取得する。必要なら `hasXBRL=1`、日付範囲、銘柄指定も追加 | `src/api.ts`, `src/types.ts` |
| 2 | 取得対象の判定 | `.pdf` 以外は `unsupported` | PDF / XBRL ZIP / 両方 / 対象外を区別する。決算短信かどうかの判定を持つ | `src/index.ts`, `src/sync-input.ts` |
| 3 | 文書 ID と資産の分離 | ID は PDF ファイル名由来 | 正規の文書 ID を固定し、PDF/XBRL の各 URL・ファイル名を別に保持する | `src/sync-input.ts`, `src/db.ts` |
| 4 | ZIP 展開 | なし | XBRL ZIP をダウンロードし、Summary / Attachment / manifest を展開する | 新規 XBRL 取得モジュール, `package.json` |
| 5 | iXBRL パーサー | なし | `ix:nonFraction` / `ix:nonNumeric` の `name`、`contextRef`、`unitRef`、`scale`、`sign`、`format` を読む | 新規 `src/xbrl/parser.ts` |
| 6 | Context / 期間解決 | なし | 当期/前期、四半期累計/四半期単独、連結/単体、実績/予想、instant/duration を解決する | 新規 XBRL モジュール |
| 7 | 財務指標の抽出 | なし | TDnet タクソノミーの科目マッピング、J-GAAP / IFRS の候補タグ、当期/前期の比較、比率計算 | 新規 `src/financial/extractor.ts` |
| 8 | 財務データの保存 | `tdnet_documents` のみ | 文書メタデータ、Fact、財務サマリー、取込状態のテーブルを追加する | `src/db.ts` + マイグレーション |
| 9 | 同期・復旧 | PDF 前提の状態機械 | XBRL のダウンロード/解析/保存を別状態として扱い、再試行・復旧・重複排除を定義する | `src/index.ts`, `src/types.ts` |
| 10 | 数値検索・スクリーニング | テキスト LIKE のみ | 期間・企業・指標・閾値・並び順で検索する。`screen` / `schema` 相当の CLI/API を追加する | `src/db.ts`, `src/cli.ts`, `src/index.ts` |
| 11 | Web への反映 | 文書検索のみ | 財務データを `export.json` に含めるか、別の財務 JSON / 画面を追加する。不要なら対象外と明記する | `web/`, `scripts/web-export.sh` |
| 12 | テスト | XBRL 関連テストなし | 最小の XBRL ZIP fixture、iXBRL 解析、Context 解決、指標抽出、DB、CLI のテストを追加する | `tests/`, `tests/fixtures/` |
| 13 | 依存関係 | ZIP/XML パーサーなし | `jszip` と `fast-xml-parser` 等の追加を検討する。Node のバージョン要件も確認する | `package.json` |
| 14 | ドキュメント | PDF/文書検索の説明のみ | XBRL の対象範囲、未対応事項、取得元、検索 API を追記する | `README.md`, `docs/` |

### 4.3 保存データの候補

既存の `tdnet_documents` はそのまま残し、財務用のテーブルを追加する案が最小である。例:

```text
tdnet_documents                 # 既存: 文書メタデータ + Markdown 本文
tdnet_xbrl_documents            # XBRL の取得状態、ZIP URL、期間種別、会計基準、連結区分
tdnet_financial_facts           # Fact: concept, qname, context_id, value, unit, period, dimensions
tdnet_financial_summary         # 当期/前期の主要科目と指標（スクリーニング用）
```

`tdnet_financial_summary` の候補科目は edinet-ts と同程度とする。

- 売上高 / 営業収益
- 営業利益
- 経常利益
- 親会社株主に帰属する当期純利益
- 純資産（自己資本）
- 総資産
- 営業活動キャッシュ・フロー
- 投資活動キャッシュ・フロー
- 現金及び現金同等物
- 1株当たり配当金
- EPS / BPS
- 従業員数
- 営業利益率、自己資本比率、ROE、ROA、FCF、増収率、増益率など

期間は少なくとも次を区別する必要がある。

- 第1四半期 / 第2四半期 / 第3四半期 / 通期
- 四半期累計（YTD）と四半期単独
- 当期実績と前期実績
- 連結と単体
- 実績と予想（予想は検索対象から除外するか、別フラグにする）

### 4.4 変更が及ぶ範囲

#### 新規

- `src/xbrl/download.ts`（または同等）: XBRL ZIP の取得・キャッシュ・展開
- `src/xbrl/parser.ts`: iXBRL / XBRL の Fact・Context 解析
- `src/financial/extractor.ts`: TDnet タクソノミーの科目マッピングと指標計算
- `src/finance-db.ts`（または `db.ts` 内）: 財務テーブルと検索
- `tests/xbrl-*.test.ts` / `tests/financial-*.test.ts` / 最小 fixture
- 必要なら `src/screen.ts` など

#### 変更

- `src/api.ts`: `url_xbrl`、`hasXBRL`、日付範囲、必要なら銘柄指定
- `src/types.ts`: API 応答、XBRL、Fact、財務指標、検索条件の型
- `src/sync-input.ts`: ID の扱い、XBRL URL の検証、PDF/XBRL の資産判定
- `src/index.ts`: XBRL 同期、解析、復旧、検索の公開 API
- `src/db.ts`: 新テーブル、マイグレーション、財務検索
- `src/cli.ts`: `sync --xbrl`、`parse`、`screen`、`schema` など
- `package.json`: ZIP/XML パーサー、必要なら DuckDB
- `README.md` / `docs/SPECIFICATIONS.md` / `docs/REQUIREMENTS.md`
- `scripts/web-export.sh` / `web/*`: Web に財務検索を出す場合のみ

#### 変更しないで済む可能性が高いもの

- `src/parser.ts` / `src/pdf-worker.ts`（PDF 経路は維持）
- `src/search-query.ts` / `src/search-date.ts` / `src/search-normalize.ts`（文書検索を維持）
- `src/search-browser.ts` / `web/app.js`（Web に財務検索を出さない場合）
- 既存の `tdnet_documents` のスキーマと保存データ

### 4.5 設計上の判断が必要な点

1. **SQLite のままか、DuckDB を追加するか**
   - edinet-ts は DuckDB の `--where` パススルーでスクリーニングする。
   - tdnet-ts は `node:sqlite` で完結している。財務データだけ DuckDB を追加すると、DB が二重管理になる。
   - 小規模なら SQLite の新しいテーブル + 厳格な検索オプションで始め、性能要件が出た場合に DuckDB を比較するのが小さい。DuckDB を採るなら `@duckdb/node-api` と Node バージョンの確認が必要。

2. **対象を決算短信だけにするか、XBRL 全般にするか**
   - `hasXBRL=1` には配当修正・業績予想修正なども含まれる。
   - 決算短信だけを対象にするなら、タイトル（「決算短信」）だけでなく、XBRL の `DocumentName` / `QuarterlyPeriod` / 財務諸表の有無で判定する方が安定する。

3. **四半期累計（YTD）か、四半期単独か**
   - TDnet のサマリーには `CurrentAccumulatedQ2Duration` と `CurrentQuarterDuration` のような複数の Context がある。
   - edinet-ts は暫定で YTD を優先する。TDnet でも同じ意味を採用するか、両方を保持するかを決める必要がある。

4. **PDF と XBRL の両方を保持するか**
   - 通常一覧では PDF と `url_xbrl` の両方が取れる。人間向け閲覧には PDF、数値検索には XBRL が必要になる可能性が高い。
   - その場合、1文書に複数資産を持たせるデータモデルが必要になる。

5. **Web まで対象にするか**
   - 現行 Web は静的な `export.json` 検索である。財務データのスクリーニングを Web に出すなら、JSON の拡張と UI の追加が必要。
   - CLI/ライブラリだけでよいなら、Web は変更対象外にできる。

6. **訂正・削除・版管理**
   - 現在は同一 ID の本文を上書きしない。XBRL の訂正短信をどう扱うか（別 ID として保持、最新版を選ぶ、元資料と関連付ける）を決める必要がある。
   - edinet-ts の `financial_summary` は `(company_name, period_end)` 主キーだが、TDnet では連結/単体、四半期/通期、訂正版が衝突し得る。`document_id` や `(ticker, period_end, period_type, is_consolidated, revision)` を検討する。

7. **過去分の取得**
   - 現在の API は直近/指定日で、長期のバックフィル保証がない。過去5年が必要なら JPX 公式 API（有料）との比較が必要。
   - まずは「直近の決算短信を日次で取り込み、四半期分を蓄積する」範囲に限定するのが現実的。

### 4.6 実装順の候補（調査時点の提案）

1. 1つの決算短信 ZIP を固定 fixture にし、iXBRL から Fact を読む。
2. TDnet の Context を「当期/前期 × 四半期累計/単独 × 連結/単体 × 実績/予想」に解決する。
3. 主要科目と比率を `tdnet_financial_summary` に保存する。
4. SQLite の検索 API と CLI（`screen` / `schema` 相当）を追加する。
5. 通常同期に `url_xbrl` の取得を追加し、PDF 経路と並行して動かす。
6. 必要なら Web へ財務検索を追加する。

### 4.7 リスクと未確認事項

- **iXBRL の多様性**: 企業ごとにタクソノミーの拡張要素・Context の付け方が異なる。最小 fixture だけで全社対応を保証できない。
- **IFRS / 日本基準の差**: 科目名・タクソノミーが異なる。両方の実例が必要。
- **XBRL ZIP の内容差**: 決算短信でも Summary のみ、Attachment の構成が異なる場合がある。
- **API の不安定さ**: 非公式 API の応答形状・件数上限・長期保証がない。`limit=1000` の応答形状の揺れも確認が必要。
- **データ品質**: 訂正、単位（円/千円/百万円）、`scale` / `sign` / `decimals`、欠損値の扱いを誤ると数値が壊れる。
- **性能**: XBRL ZIP のダウンロードと解析を全決算短信に適用した場合の通信量・CPU・保存量は未測定。
- **テスト**: 現行テストは PDF・検索・同期・復旧が中心で、XBRL のテストはない。依存未導入のため、本調査では既存テストの合否も未確認。

---

## 5. まとめ

- 現行 tdnet-ts は PDF ベースの文書検索ツールであり、XBRL は取得も解析もしていない。
- 四半期決算データを edinet-ts 同等にするには、XBRL ZIP/iXBRL の解析、TDnet 固有の Context/タクソノミー解決、財務数値テーブル、screen/schema 相当の検索入口が不足している。
- 既存の PDF・Markdown・文書検索は残したまま、財務パイプラインを並列に追加するのが変更範囲を抑えられる。
- 最大の設計課題は「文書 ID と PDF/XBRL 資産の分離」「四半期累計/単独と連結/単体の区別」「SQLite のままにするか DuckDB を追加するか」である。

---

## 付録A. 主に確認したファイル

- `README.md`
- `docs/REQUIREMENTS.md`
- `docs/SPECIFICATIONS.md`
- `docs/plans/2026-10-24-maintenance-plan.md`
- `src/api.ts`
- `src/sync-input.ts`
- `src/index.ts`
- `src/db.ts`
- `src/types.ts`
- `src/parser.ts`
- `src/pdf-worker.ts`
- `src/cli.ts`
- `src/search-query.ts`
- `src/search-date.ts`
- `src/search-normalize.ts`
- `src/search-browser.ts`
- `web/index.html`
- `web/app.js`
- `scripts/web-export.sh`
- `scripts/annotate-pdfs.mjs`
- `scripts/generate-rss.mjs`
- `.github/workflows/deploy-pages.yml`
- `package.json`
- `tests/` 配下のテスト一覧

参照した外部資料:

- ヤノシン TDnet Web-API: <https://webapi.yanoshin.jp/tdnet/>
- `edinet-ts`（同一ワークスペース上の実装）: `README.md`、`docs/ARCHITECTURE.md`、`src/xbrl/parser.ts`、`src/financial/extractor.ts`、`src/db/store.ts`、`src/edinet/client.ts`、`src/cli.ts`

## 付録B. 未確認事項

- 実 DB（`tdnet.sqlite`）の中身。リポジトリには DB ファイルが存在しないため、保存済み件数・失敗件数・実データの分布は未確認。
- API 応答形状の再現性（特に `limit=1000` のラッパーなし応答）。
- 全上場企業・全四半期の XBRL に対するタクソノミー・Context の網羅性。
- IFRS 決算短信の XBRL 実例。
- 既存テストの合否（依存未導入のため未実行）。
- Web に財務検索を追加する場合の容量・表示性能。
