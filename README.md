# TDnet TypeScript Library

TDnet（東京証券取引所適時開示情報）APIから開示情報およびPDFをダウンロードし、Markdown形式のテキストとしてSQLiteデータベースに保存・検索するためのTypeScriptライブラリおよびCLIツールです。

## 特徴
- **[ヤノシン TDnet API](https://webapi.yanoshin.jp/tdnet/)** に対応し、指定日や直近の適時開示情報を取得
- PDF内テキストを `@opendocsg/pdf2md` を利用してMarkdownとして抽出・保存
- `--save-pdf` オプションでダウンロードしたPDF原本もローカルに保存可能
- Node.js v24 組み込みの `node:sqlite` によるデータベース管理
- コマンドラインツール(CLI)と、アプリケーションから直接利用できるライブラリ(ESM/CJS)の両方を提供
- **モダンな Web ビューアー**: 株主優待情報の閲覧に特化した2カラムレイアウト（ダーク/ライトモード対応）
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
# キーワードのみで検索
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

### 3. Webビューアー (優待一覧)

ダウンロードした優待関連の開示情報をブラウザで一覧表示するWebビューアーが付属しています。

```bash
# 1. PDFをローカルに保存しながらデータを同期
npx tdnet-ts sync --save-pdf web/pdfs

# 2. 優待関連のデータをJSONとして出力
pnpm run web:export

# 3. Vite開発サーバーを起動してブラウザで確認
pnpm run web:dev
# → http://localhost:5173/ でアクセス
```

Webビューアーでは以下の機能を提供します：
- **2カラムレイアウト**: 左側に一覧、右側に選択した情報の詳細を表示するモダンなUI
- **テーマ切り替え**: ダークモードとライトモードの切り替えに対応（状態はブラウザに保存）
- **インクリメンタル検索**: 企業名・タイトル・本文・銘柄コードでの瞬時のフィルタリング
- **RSS フィード**: `web/feed.xml` が生成され、RSSリーダーでの購読が可能
- **コンテンツ閲覧**: PDFから変換されたMarkdown本文を直接ブラウザで閲覧可能
- **ブラウザ内PDF表示**: 1クリックでローカルのPDF原本を表示
- **スマホ対応**: レスポンシブ設計により、モバイル環境でも快適に閲覧可能

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

*(※ npmレジストリに公開した場合の例です)*

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
      interface TdnetDocument {
        id: string;             // TDnetドキュメントID (主キー、例: 140120260220565990)
        publishedAt: string;    // 開示日時 (UTC ISO形式)
        ticker: string;         // 銘柄コード (末尾0を除去した4桁)
        companyName: string;    // 会社名
        title: string;          // 件名
        documentUrl: string;    // PDFのURL
        content: string | null; // 変換されたMarkdown本文
        createdAt: string;      // レコード作成日時
      }
      console.log(`[${doc.publishedAt}] ${doc.companyName} (${doc.ticker})`);
      console.log(`ID: ${doc.id}`);
      console.log(`Title: ${doc.title}`);
      console.log(`URL: ${doc.documentUrl}`);
      // console.log(doc.content); // 抽出されたMarkdown本文
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

### 設定方法
1. GitHub リポジトリの `Settings -> Pages` で、Source を **GitHub Actions** に変更します。
2. `.github/workflows/deploy-pages.yml` に定義されたワークフローが、平日の JST 18:00 に自動実行されます。
3. 同時に `tdnet.sqlite` と `web/pdfs/` がキャッシュされ、差分のみを効率的に処理します。

## 構成・設計

構成の詳細は [docs/SPECIFICATIONS.md](./docs/SPECIFICATIONS.md) を参照してください。
