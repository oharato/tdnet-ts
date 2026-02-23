# 技術仕様書 (SPECIFICATIONS)

## 技術スタック一覧
- **ランタイム環境**: Node.js v24
- **開発言語**: TypeScript
- **パッケージマネージャー**: pnpm
- **ビルドツール**: Vite
- **TypeScriptコンパイラ**: tsgo (`@typescript/native-preview`)
- **リンター / フォーマッター**: oxlint, oxfmt
- **データベース**: SQLite (Node.js v24 組み込みモジュール `node:sqlite` を利用)
- **PDF-to-Markdown 変換**: `@opendocsg/pdf2md`

## システムアーキテクチャ概要

### 1. ディレクトリ構造
```text
tdnet-ts/
├── docs/           # ドキュメントディレクトリ
├── src/            # ソースコード
│   ├── api.ts      # TDnet API クライアント処理
│   ├── db.ts       # SQLite アクセス処理 (node:sqlite)
│   ├── parser.ts   # PDF のダウンロードおよび Markdown 変換処理
│   ├── cli.ts      # CLI 用のコマンド実装
│   ├── types.ts    # 型定義
│   ├── utils.ts    # ユーティリティ関数
│   ├── index.ts    # ライブラリのエクスポート
│   └── utils.ts    # ユーティリティ関数
├── scripts/        # 補助スクリプト
│   └── generate-rss.mjs # RSS生成スクリプト
├── web/            # Webビューアー
│   ├── index.html  # Alpine.jsベースのUI
│   ├── style.css   # スタイルシート
│   ├── feed.xml    # RSSフィード (git対象外)
│   └── pdfs/       # ダウンロード済みPDFファイル (git対象外)
├── .github/
│   └── workflows/
│       └── deploy-pages.yml # GitHub Actionsワークフロー
├── package.json
├── tsconfig.json
└── vite.config.ts  # ビルド設定
```

### 2. データストア (SQLite) 設計
組み込みの `node:sqlite` を利用し、データベーススキーマを設計する。

#### `tdnet_documents` テーブル
| カラム名 | データ型 | 説明 |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | TDnetドキュメントID (PDFのURLベースネームから抽出、例: `140120260220565990`) |
| `document_url` | TEXT | PDFファイルのオリジンURL (※リダイレクト用文字列は除去済み) |
| `published_at` | TEXT | 公開日時 (JSTからUTC/ISO8601形式へ変換済み) |
| `ticker` | TEXT | 銘柄コード (末尾0を除去済みの4桁) |
| `company_name` | TEXT | 会社名 |
| `title` | TEXT | 開示ドキュメントの件名 |
| `content` | TEXT | 変換された Markdown 本文 (見出しや改行をクレンジング済み) |
| `created_at` | TEXT | ローカル保存日時 |

### 3. APIとデータクレンジング
- 利用API: `https://webapi.yanoshin.jp/tdnet/`
- APIから返却されたURLに含まれるリダイレクト (`rd.php?`) は保存前にクレンジングする。
- PDFのダウンロード時には適切なディレイ (`setTimeout` を利用した待機) を設け、DoS攻撃とみなされないように対応。

### 4. アプリケーションインターフェース (API)
ライブラリ側では以下の主要な機能（関数）を提供する。
- `fetchRecent(limit?: number)`: 直近のデータ一覧を取得する。
- `fetchAndSaveByDateRange(startDate: string, endDate: string)`: 期間を指定してPDFダウンロードと変換、DBへの保存を一括実施。
- `sync(options)`: `--limit` や `--date` に基づき最新情報を同期する。リトライロジック（最大3回）を内蔵。
- `searchDocuments(query)`: DB内のドキュメントを検索して返却。

### 5. CLIインターフェース
パッケージをグローバルインストールするか `npx` で実行可能な CLI を提供。
- `tdnet-ts sync [--limit N] [--date YYYYMMDD] [--save-pdf DIR]`: データの同期と変換処理を実行。`--save-pdf` で元PDFもローカルに保存。
- `tdnet-ts search "キーワード" [--ticker CODE] [--title TITLE] [--limit N] [--content] [--json] [--start DATE] [--end DATE]`: 引数に与えられた条件で検索

### 6. Webビューアー & RSS
- `web/index.html`: Alpine.jsベースのSPA。2カラムレイアウトで詳細情報を表示。ダーク/ライトモード対応。
- `web/style.css`: CSS変数を用いたテーマ管理とモダンなUIデザイン。
- `scripts/generate-rss.mjs`: `web/yutai.json` から RSS 2.0 形式の `web/feed.xml` を生成。
- `pnpm run web:export`: データの同期、優待JSON出力、RSS生成を一括して行う。
- `pnpm run web:dev`: Vite開発サーバーを起動。
- ローカルに保存されたPDFを `/pdfs/{id}.pdf` として直接参照可能。

### 7. 自動化 (GitHub Actions)
- `.github/workflows/deploy-pages.yml`:
  - 平日 JST 18:00 に定期実行。
  - `actions/cache` により `tdnet.sqlite` と `web/pdfs/` をキャッシュし、高速な増分更新を実現。
  - 成功時に `web/` ディレクトリを GitHub Pages にデプロイ。

## テストと品質管理
- **テストフレームワーク**: `vitest` を用いて単体テストを記述・実行する。
- 外部APIへの依存を排除するため、HTTPリクエスト（API呼び出しやPDFダウンロード）をすべて**Mock（モック）**化してテストできる設計とする。
- `oxlint` と `oxfmt` による静的解析と自動フォーマットを適用。
- `tsgo` を用いることでTypeScriptを高速にコンパイル・実行可能な状態にする。
