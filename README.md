# TDnet TypeScript Library

TDnet（東京証券取引所適時開示情報）APIから開示情報およびPDFをダウンロードし、Markdown形式のテキストとしてSQLiteデータベースに保存・検索するためのTypeScriptライブラリおよびCLIツールです。

## 特徴
- **[ヤノシン TDnet API](https://webapi.yanoshin.jp/tdnet/)** に対応し、指定日や直近の適時開示情報を取得
- PDF内テキストを `@oharato/pdf2md-ts` を利用してMarkdownとして抽出・保存
- `--save-pdf` オプションでダウンロードしたPDF原本もローカルに保存可能
- Node.js v24 組み込みの `node:sqlite` によるデータベース管理
- コマンドラインツール(CLI)と、アプリケーションから直接利用できるライブラリ(ESM/CJS)の両方を提供
- **モダンな Web ビューアー**: 全適時開示情報を2カラムレイアウトで閲覧（ダーク/ライトモード対応）
- **クライアントサイドフィルタリング**: 企業名・タイトル・本文・銘柄コードでのインクリメンタル検索、「🎁 優待のみ」ワンクリック絞り込み
- **ページネーション**: 1ページあたりの表示件数を 20/50/100 件から選択可能
- **Markdownレンダリング**: 本文をMarkdown/プレーンテキストで切り替え表示
- **RSS フィード生成**: 取得したデータを RSS 形式で出力し、各種リーダーでの購読が可能
- **自動化対応**: GitHub Actions による定期実行と自動デプロイをサポート

## 必要環境
- Node.js v22.12.0 以上 (v22の組み込みSQLiteまたはNode.js v24以上を推奨)
- pnpm またはお好みのパッケージマネージャー

---

## インストール

```bash
# リポジトリをクローンしてセットアップする場合
git clone <repository_url>
cd tdnet-ts
pnpm install
pnpm build
```

---

## CLI（コマンドライン）からの使い方

インストール・ビルド後、`npx` またはビルドされたスクリプトを直接実行して利用できます。

### 1. データの同期 (sync)
TDnetから直近の開示情報を取得し、PDFをダウンロード・Markdownに変換してローカルのSQLite (`tdnet.sqlite`) に保存します。
- **データクレンジング**: API経由のURLに含まれるリダイレクト文字列の除去、銘柄コード(ticker)の4桁正規化(末尾の0削除)、開示日時のUTC/ISO形式への変換を行います。
- **テキスト最適化**: PDFから変換されたMarkdownの無駄な見出し(`#`)や余分な改行を圧縮し、スッキリとしたテキストとして保存します。

```bash
# デフォルト(直近100件)の取得
npx tdnet-ts sync

# 件数を指定して取得 (例: 10件)
npx tdnet-ts sync --limit 10   # または -l 10

# 日付を指定して取得 (YYYY-MM-DD または YYYYMMDD)
npx tdnet-ts sync --date 2026-02-20   # または -d 2026-02-20

# PDFファイルをローカルに保存しながら同期する
npx tdnet-ts sync --save-pdf web/pdfs
```

#### 一覧APIの待機と再試行

一覧取得は本文JSONの読み終わりまで1試行30秒、最大3試行です。通信エラー/タイムアウト、HTTP 429・500・502・503・504だけを再試行し、通常は2秒・4秒待ちます。404等、JSON構文エラー、入力不正は繰り返しません。`Retry-After` の秒数またはHTTP日時が長ければそれ以上待ち、60秒超なら短縮して再送せず「後で再試行」として例外を返します。

単体APIでは `new ApiClient(retryDelayMs, requestTimeoutMs)` で待機基準と1試行時間を指定できます。待機基準は0〜30000ms、時間上限は正整数msです。取得上限/日付の検証は通信前に行います。これは呼出し1回の制御であり、提供元の許容レートや全件取得を保証するものではありません。

#### 同期結果と部分失敗

`manager.sync()` は `SyncResult` を返します。受信数、重複、不正行、本文保存成功、本文保存済み、失敗、過去3回の失敗による対象外、非PDF、原本保存失敗を区別し、文書ごとのID・状態・今回の試行回数を返します。CLIは最後に同じ集計を表示し、全成功/既存のみは終了コード0、部分失敗（不正行・上限到達済み・非PDF・保存失敗を含む）は2、一覧取得やDB等の致命的エラーは1です。戻り値を使わずawaitする既存コードはそのまま使えますが、`Promise<void>` を明示した型注釈は変更が必要です。

`limitReached` は取得件数が指定上限に達したという注意で、全件取得の保証ではありません。この注意だけでは終了コード2にしません。1回の応答の同じIDは最初の行だけ処理します。不正な日時・コード・URLの行は他の正常資料を止めずに数え、空本文を成功扱いしません。銘柄コードは4文字を保持し、5文字形式の末尾0だけ除去します。件数/並列数は正整数、待機時間は有限の非負数を要求します。

通常同期では過去3回失敗した資料を自動で無制限にやり直しません。保存済みIDを指定した明示的な復旧と原本後保存は次のrecoverコマンドで行います。DBスキーマや本番取得設定は変更しません。

#### 保存済み資料の復旧・原本の後保存

```bash
# 最新一覧から外れた保存済み失敗IDも、保存URLから明示的に再処理
npx tdnet-ts recover DOCUMENT_ID --db ./tdnet.sqlite
# 本文が保存済みなら再変換せず、不足する原本だけ追加保存
npx tdnet-ts recover DOCUMENT_ID --save-pdf ./pdfs
```

ライブラリでは `await manager.recover(['DOCUMENT_ID'], { savePdfDir: './pdfs' })`。重複IDを1回にまとめ、未知IDはmissing、本文保存済みはexisting、復旧成功はrecovered、失敗はfailedとして返します。毎回最大3回の新しい試行枠を設け、過去の累積失敗回数は消しません。CLIはmissing/failed/PDF保存失敗があれば終了コード2です。IDを指定せず全件を自動で再処理する機能は追加しません。

`sync --save-pdf` と `recover --save-pdf` は変換より先に原本を保存します。変換が失敗しても原本が残り、保存済み原本を次の変換で再利用します。一時ファイルへの書込み完了後に非上書きで原本名へ公開します。既存ファイルは上書きせず、シンボリックリンク等の通常ファイル以外は拒否します。本文保存後の原本追加では本文・その取得元URLを変更しません。ローカル保存だけに失敗しても、本文を回収できた場合は保存し、両結果を区別します。壊れた既存原本の置換・版管理・自動削除は対象外です。

### 2. データの検索 (search)
ローカルのSQLiteに保存されたデータをキーワードで検索します。開示情報の「タイトル」「会社名」「Markdown変換された本文」に対して部分一致検索を行います。

```bash
# キーワードを指定せずに全件取得
npx tdnet-ts search

# キーワードで検索
npx tdnet-ts search "決算"

# 特定の銘柄コードで絞り込み
npx tdnet-ts search "差異" --ticker 4875   # または -t 4875

# タイトル（件名）に特定の文字列が含まれるものだけを検索
npx tdnet-ts search "株式" --title "分割"

# 表示件数を指定する (デフォルト 100件)
npx tdnet-ts search "優待" --limit 5   # または -l 5

# 検索結果にPDFから変換したMarkdown全文も含める
npx tdnet-ts search "優待" --limit 1 --content   # または -c

# 期間を指定して絞り込み (開始日と終了日)
npx tdnet-ts search "配当" --start 2026-01-01 --end 2026-03-31   # または -s, -e

# JSONフォーマットで結果を出力 (jq等との連携に便利)
# ※ --content と併用した場合は"content"キーにMarkdown本文が含まれます
npx tdnet-ts search "決算" --json
```

---

### 検索対象・複数語・ページ指定

従来の検索は互換性のため既定の `--match legacy` として残しています。入力全体を1つの部分一致パターンとして扱い、`%`（任意の文字列）と `_`（任意の1文字）はSQLite LIKEのワイルドカードです。

新しい検索では次のモードを明示できます。どのモードでも、保存済みデータだけを検索します。

| モード | 意味 |
| --- | --- |
| `literal` | 前後の空白を除いた入力全体を、文字どおりの連続部分文字列として検索 |
| `all` | 空白で分けたすべての語を含む開示（AND）。異なる対象項目にまたがって一致しても可 |
| `any` | 空白で分けたいずれかの語を含む開示（OR） |

`all` / `any` では、二重引用符で囲んだ部分を空白も含めた連続フレーズとして扱います。引用符は語全体を囲む必要があり、空フレーズ・閉じ忘れはエラーです。引用符内のエスケープ構文はありません。引用符そのものを探す場合は `literal` を使います。`AND` / `OR` という入力文字列は演算子にはならず、通常の語です。ANDとORを混ぜた式や括弧は未対応です。

新モードは `%`、`_`、バックスラッシュも文字どおり検索し、タイトルfilterにも同じルールを適用します。既定では表記を変換しません。任意の幅・英字大小の対応は下記を参照してください。誤字補正は未対応です。空・空白だけの入力はキーワード条件なしです（legacyは空白も検索文字列として維持）。日本語の「配当」「取得」のような2文字にも対応します。

```bash
# 検索文全体をシェルの引用符で囲む
npx tdnet-ts search '配当 増額' --match all
npx tdnet-ts search '増配 復配' --match any --fields title,body
npx tdnet-ts search '"自己株式取得" 還元' --match all
npx tdnet-ts search '架空' --match literal --fields company
npx tdnet-ts search '10%' --match literal --start 2026-10-01 --end 2026-10-31
npx tdnet-ts search '配当' --match all --limit 20 --offset 20 --json
```

`--fields` は `title`（タイトル）、`body`（取得済み本文）、`company`（会社名）のカンマ区切りで、既定は全3項目です。銘柄コードは既存の `--ticker` による完全一致filterで指定します。NULL本文は本文検索に当たりませんが、タイトルや会社名で該当し得ます。本文未取得を「開示なし」とは解釈しないでください。

結果は公開日時降順、同時刻はID昇順です。`--offset` は条件に合う結果の先頭から飛ばす件数（0以上の整数）。`--limit` は0以上の整数または全件を表す-1で、CLI既定100件です。データが更新されない間は安定したページ分割ができますが、取得・更新を挟むページの固定は保証しません。JSON/端末の本文抜粋は、本文が検索対象の場合に最初に見つかった入力語の周辺を示し、すべての条件の証明ではありません。

ライブラリも同じ条件を `manager.search(query, { match: 'all', fields: ['title', 'body'], offset: 20, limit: 20 })` のように指定できます。`SearchOptions` / `SearchField` / `SearchMatch` を公開します。静的Webでも以下の検索条件を利用できます。

### 任意の全半角・英字大小対応

このオプションはNode.js 22.13以降のSQLite関数機能が必要です（Node 24推奨）。未対応環境でも従来検索は使え、正規化を指定した場合だけ説明付きエラーになります。

`--match literal/all/any` に `--normalize width-case` を追加すると、検索語と対象項目の次の違いを揃えます。指定しなければ既存の検索動作は変わりません。

| 対象 | 変換例 |
| --- | --- |
| 全角ASCII英数字・記号（U+FF01〜U+FF5E） | `ＡＢＣ` → `ABC`、`１０％` → `10%` |
| 全角空白（U+3000） | 通常の半角空白へ |
| ASCII英字の大小 | `ABC` → `abc` |

```bash
npx tdnet-ts search 'm&a' --match literal --normalize width-case --fields title
npx tdnet-ts search '"m&a 決定" 配当' --match all --normalize width-case
npx tdnet-ts search 'abc' --match literal --normalize width-case --fields company
```

ライブラリでは `manager.search('m&a', { match: 'literal', normalize: 'width-case' })` と指定します。`title` filterにも適用し、銘柄コード・日付・URLには適用しません。legacyとの併用はエラーにして、ワイルドカードの意味が暗黙に変わらないようにしています。正規化後に `%`・`_`・バックスラッシュをエスケープするため、全角の `％` 等も任意一致にはなりません。

これは広いUnicode NFKC正規化ではありません。半角カナと全角カナ、ひらがなとカタカナ、丸数字・単位記号・合字・旧字体・結合文字の差、非ASCII文字の大小、誤字や同義語は揃えません。空白の連続数や句読点も消しません。フレーズを囲む構文の引用符はASCIIの `"` のみで、全角引用符は通常文字として検索します。

DBに保存した会社名・タイトル・本文と検索結果の原文は変更しません。本文抜粋も原文の全角表記を保ちます。文字数が変わらない範囲に絞っているため、変換後に当たった位置を原文へ対応付けられます。変換は検索時の一時処理で、DB移行・全件再索引・追加依存はありません。大規模なデータでは走査コストがかかるため、速度改善や索引導入は測定後の別作業です。静的Webでも同じ限定変換を任意に選べます。

### 検索期間の日付と時刻

`search --start YYYY-MM-DD --end YYYY-MM-DD` は両日を含む日本時間（JST）の期間です。同じ日を指定すると、その日の0時以上、翌日の0時未満を検索します。保存日時は従来どおりUTCのままで、既存DBの書換えは不要です。

ライブラリの `startDate` / `endDate` とCLIでは、秒までのISO日時（例: `2026-10-01T00:00:00+09:00`、`2026-09-30T15:00:00.000Z`）も指定できます。時差は必須、小数秒は省略または1〜3桁です。日時を指定した終了境界は従来どおりその瞬間を含みます。存在しない日付、時差のない日時、逆転した期間はエラーになります。

互換性の注意: 日付だけの指定は、以前のUTC日基準からJST日基準に変わります。UTCの1日を指定したい場合は `--start 2026-10-01T00:00:00.000Z --end 2026-10-01T23:59:59.999Z` のように時差付き日時を指定してください。キーワード・銘柄・タイトル・件数・新着順の条件は変わりません。

### 3. Webビューアー

ダウンロードした適時開示情報をブラウザで閲覧できるWebビューアーが付属しています。

```bash
# 1. データを取得し、PDFをローカルに保存しながら同期
#    (web:exportが内部でbuild + syncを実行するため、個別実行は不要)

# 2. 全データをJSONとして出力し、RSSフィードを生成する
pnpm run web:export

# 3. Vite開発サーバーを起動してブラウザで確認
pnpm run web:dev
# → http://localhost:5173/ でアクセス
```

#### Webでの検索

「詳細な検索条件」で、文字どおり / AND / OR、タイトル・本文・会社名、銘柄コードの完全一致、JSTの開始日・終了日、全角英数・空白と英字大小の変換を選び、「検索」で適用します。AND/ORのフレーズは `"m&a 決定" 配当` のように半角引用符で囲みます。既定は文字どおり・変換なしです。従来の「優待のみ」の初期選択は維持しています。

検索条件とページはURLに保存され、ブラウザの戻る・進むで復元できます。条件を変更して検索すると1ページ目に戻ります。繰り返し検索で同じ履歴を増やしません。従来Webの銘柄コード部分一致は専用欄の完全一致に変更しました。APIと比較するときは同じ資料集合に揃え、「優待のみ」を解除してください。

Webはサーバーへの検索API接続ではなく、`export.json` のローカル検索です。本文を出力しなかった資料・抽出失敗の本文・エクスポート上限より古い資料は検索できません。検索語解析・JST日付境界・限定的な表記変換をCLI/APIと共有します。日時はJST表示、並び順は保存日時文字列の降順・同時刻ID昇順です。Text表示では該当箇所を原文のまま強調し、本文がない場合はTDnet元URLの確認を案内します。Markdown表示では検索語の強調は行いません。誤字類似・カナの同一視・意味検索は未対応です。

`pnpm build` はブラウザ用の検索モジュールを `web/search/` に生成します（生成物はGit管理外）。`pnpm web:dev` も事前にbuildを実行します。既存JSONや架空fixtureだけを確認する場合は `web:dev` を使い、同期も行う `web:export` は実行しないでください。新しい依存・モデル・DB変更・索引はありません。従来どおりAlpine/marked等のCDNへの接続は必要です。

#### Webビューアーの機能一覧

| 機能 | 説明 |
|------|------|
| **2カラムレイアウト** | 左側に一覧、右側に詳細を表示するモダンなUI |
| **テーマ切り替え** | ダーク/ライトモードの切り替え（状態はブラウザに保存） |
| **インクリメンタル検索** | 企業名・タイトル・本文・銘柄コードでの瞬時フィルタリング |
| **優待フィルター** | 「🎁 優待のみ」ボタンで株主優待関連の開示に絞り込み（デフォルトON） |
| **ページネーション** | 1ページあたりの表示件数を 20/50/100 件から選択可能 |
| **Markdownレンダリング** | 本文を Text / Markdown 切り替えボタンでHTMLレンダリング |
| **PDF閲覧** | ローカルに保存したPDF原本を1クリックで表示 |
| **RSS フィード** | `web/feed.xml` を生成、RSSリーダーでの購読が可能 |
| **スマホ対応** | レスポンシブ設計によりモバイルでも快適に閲覧 |

#### `web:export` の内部処理

`pnpm run web:export` は以下の処理を順番に行います：

1. `pnpm build` — TypeScriptをビルド
2. `node dist/cli.js sync --save-pdf web/pdfs -l <LIMIT>` — 最新1000件のデータを取得しPDFを `web/pdfs/` に保存
3. `node dist/cli.js search --json -c -l <LIMIT> > web/export.json` — 上限件数までのデータを本文付きJSONで出力
4. `node scripts/generate-rss.mjs` — `web/feed.xml` を生成

### 共通オプション
`--db <path>` オプションをつけることで、書き込み/読み込み先のSQLiteデータベースパスを指定できます。
```bash
npx tdnet-ts sync --db /path/to/my-db.sqlite
npx tdnet-ts search "決算" --db /path/to/my-db.sqlite
```

---

## TypeScript/JavaScriptからライブラリとしての使い方

別プロジェクトにインストールした場合、または本パッケージをローカル依存関係としてインポートして使うことができます。

### インストール
```bash
pnpm add tdnet-ts
```

### Testing

Vitestを使用した単体テスト（Mock化を含む）が組み込まれています。

```bash
# 全てのテストを実行
pnpm test

# 監視モードでテストを実行
pnpm run test:watch
```

### コード例

```typescript
import { TdnetManager } from 'tdnet-ts';

async function main() {
  // マネージャーの初期化 (デフォルトではカレントディレクトリの tdnet.sqlite が使われます)
  const manager = new TdnetManager();

  try {
    // 1. データの同期 (直近10件を取得・PDFパース・DB保存)
    console.log('Syncing data...');
    await manager.sync({ limit: 10 });

    // 特定の日付のデータを取得する場合
    // await manager.sync({ date: '20260220', limit: 50 });

    // 2. データの検索
    console.log('Searching...');
    const results = manager.search('期末配当');
    
    // 3. 結果の表示
    for (const doc of results) {
      // doc は TdnetDocument 型
      // id: string            — TDnetドキュメントID (主キー)
      // publishedAt: string   — 開示日時 (UTC ISO形式)
      // ticker: string        — 銘柄コード (末尾0を除去した4桁)
      // companyName: string   — 会社名
      // title: string         — 件名
      // documentUrl: string   — PDFのURL
      // content: string|null  — 変換されたMarkdown本文
      // createdAt: string     — レコード作成日時
      console.log(`[${doc.publishedAt}] ${doc.companyName} (${doc.ticker})`);
      console.log(`ID: ${doc.id}`);
      console.log(`Title: ${doc.title}`);
      console.log(`URL: ${doc.documentUrl}`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // スクリプト終了時はDBコネクションを閉じる
    manager.close();
  }
}

main();
```

## 自動デプロイ (GitHub Actions)

GitHub Actions を利用して、定期的なデータの更新と GitHub Pages へのデプロイが可能です。

### ワークフローのトリガー
`.github/workflows/deploy-pages.yml` は以下のタイミングで自動実行されます：
- **`main` / `master` ブランチへの Push 時**
- **平日の JST 18:00（UTC 09:00）** に定期実行
- **手動実行**: GitHub の Actions タブから `workflow_dispatch` で随時実行可能

### セットアップ手順
1. GitHub リポジトリの `Settings → Pages` で、Source を **GitHub Actions** に変更します。
2. `tdnet.sqlite` と `web/pdfs/` は実行間でキャッシュされ、差分のみを効率的に処理します。

## 構成・設計

構成の詳細は [docs/SPECIFICATIONS.md](./docs/SPECIFICATIONS.md) を参照してください。

現行実装の確認結果と今後の優先順位は [2026-10-24 改善計画](./docs/plans/2026-10-24-maintenance-plan.md) を参照してください。取得・復旧の保守と、キーワード・あいまい・ベクトル検索の段階的な改善を評価する計画です（検索拡張は未実装）。
