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

新モードは `%`、`_`、バックスラッシュも文字どおり検索し、タイトルfilterにも同じルールを適用します。正規化・誤字補正はまだ行いません。空・空白だけの入力はキーワード条件なしです（legacyは空白も検索文字列として維持）。日本語の「配当」「取得」のような2文字にも対応します。

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

ライブラリも同じ条件を `manager.search(query, { match: 'all', fields: ['title', 'body'], offset: 20, limit: 20 })` のように指定できます。`SearchOptions` / `SearchField` / `SearchMatch` を公開します。静的Webの検索は従来のままで、今回の新モードはCLI/ライブラリが対象です。

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
3. `node dist/cli.js search --json -c -l <LIMIT> > web/export.json` — 全データを本文付きJSONで出力
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
