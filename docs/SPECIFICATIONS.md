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

## 検索期間の境界（2026-10-24更新）

`DbClient.searchDocuments` と `TdnetManager.search` の `startDate` / `endDate`、およびCLIの `--start` / `--end` は、`YYYY-MM-DD` ならJSTの暦日として解釈する。開始日の0時以上、終了日の翌日0時未満をUTCへ変換して比較する。

秒までのISO日時（時差 `Z` または `±HH:mm` 必須、小数秒は省略または1〜3桁）も受け付け、UTCに正規化する。日時指定の終了境界はその瞬間を含む。日付と日時は混在可能。不正日付・曖昧な日時・逆転範囲は検索前にエラーにする。DBスキーマや保存済み公開日時は変更しない。

日付だけの検索は従来のUTC日からJST日へ変わるため、UTC日を求める利用側は明示的なUTC日時を渡す。日付以外の部分一致・銘柄・タイトル・件数・公開日時降順の挙動は維持する。Webの日付表示、AND/OR、あいまい検索、ベクトル検索はこの変更の対象外。

## キーワード検索の土台（2026-10-24更新）

`SearchOptions` に `match`、`fields`、`offset` を追加。既定 `legacy` は従来のLIKEパターン検索を維持し、明示モード `literal` / `all` / `any` は `%`・`_`・バックスラッシュをエスケープする。`all` は語ごとの一致条件をAND、`any` はORで連結し、全体を既存の企業・タイトル・期間filterとANDで組み合わせる。空白区切りと引用符フレーズの詳細はREADMEを参照。

SQLの列名は固定の対応表からのみ選び、検索語とfilter値はすべてパラメータとして渡す。本文NULLを特別な一致にしない。日時降順とID昇順を維持し、その後にlimit/offsetを適用する。limitは整数>=-1、offsetは整数>=0。スキーマ・保存データの変更、FTS索引、分かち書き、意味検索、Web側の変更は行わない。

## 任意の幅・大小対応（2026-10-24更新）

`SearchOptions.normalize?: 'width-case'` は `match: literal/all/any` との併用に限る。対象は全角ASCII（U+FF01〜U+FF5E）、全角空白（U+3000）、ASCII大文字のみ。トークン/フレーズ構文の解析後に検索語を変換し、その後LIKE用の記号をエスケープする。タイトルfilterも同じ変換を使う。

接続ごとのSQLite関数 `tdnet_width_case` を正規化の初回使用時に登録し、対象列を比較時だけ変換する。NULLはNULLのまま。原文・schema・索引を変更しない。コード/日時filterは変換しない。CLIは同じ長さの比較文字列で見つけた範囲から原文を切り出し、幅の違いを保った抜粋を返す。

[Unicode UAX #15](https://unicode.org/reports/tr15/) のNFKCは互換分解を含むため、今回は意味や表示の違いを広く畳む実装を選ばず、変換表を限定した。カナ、丸数字、単位記号、非ASCII大小、誤字、同義語は未対応。未指定時の検索は従来どおり。静的Webへの展開は次節のとおり。性能最適化は別作業。

正規化にはNode.js 22.13以降のSQLite関数登録機能が必要。未対応ランタイムでは通常検索の初期化を妨げず、正規化指定時だけ説明付きエラーを返す。Node22実機は未検証で、機能欠如はテスト内で模擬している。


### 静的Web検索（2026-10-24）

`src/search-browser.ts` はエクスポートJSONを検索し、語の解析・列の検証・日付境界・限定変換は既存モジュールを共有する。SQLiteはブラウザに導入しない。literal/all/anyのみを提供し、既定literal、対象title/body/company、任意width-case、ticker完全一致、JST日付、日時降順/ID昇順、ページ分割を扱う。未指定時の英字大小はSQLite LIKEと同じASCII範囲に限定する。legacyワイルドカード・誤字・意味検索はWebに提供しない。

`web/app.js` はフォーム適用時に結果を更新し、条件変更時はページ1へ戻す。URLの既知パラメータに条件とページを保存しpopstateで復元する。無効な検索条件はエラー表示、空クエリは他のfilterだけを適用する。取得失敗・不正JSONは空の成功結果と区別して再読込を案内する。本文省略/NULLは許容し、本文未収録を表示する。Textの強調は生テキスト上の一致位置を求めてからHTMLエスケープする。Markdown表示ではHTMLへの検索語置換はしない。

buildの最後に `scripts/build-web-search.mjs` がブラウザで安全な4モジュールだけを `web/search/` へコピーする。DB・PDF変換・取得モジュールを含めない。静的配信の構造と既存workflowは維持する。条件フォームは折畳みと高さ制限/スクロールを持ち、小画面でも一覧領域を残す。

試験: 架空55件のメモリDBとJSONで同じ条件の結果を比較し、Back・繰返し・条件変更/ページ・入力エラー・欠損本文・読み込み再試行・原文/HTML記号を検証。接続ブラウザは利用できなかったが、既存Playwright/Chromiumのheadless実画面QAを架空JSONだけで実施。1280×900と390×844でページ移動・条件変更・戻る・引用句/AND/表記揺れ・不正入力・読込失敗/再読込を確認し、ページ内例外0件。空選択への切替と未検証引用句の強調で見つかった例外を修正した。実資料・本番DB・取得・デプロイは実行しない。


### 同期結果（2026-10-24）

`sync(): Promise<SyncResult>` は受信数と排他的な文書状態（synced/existing/failed/exhausted/unsupported）を返す。不正行/重複は文書状態とは別に集計し、PDF保存失敗は本文成功と重なり得る。`limitReached` は指定上限に達した注意だけを表す。既存本文は通常同期で上書きしない。3回失敗済みはexhaustedとし自動再処理しない。空本文は失敗として最大3ラウンドで試行する。DB保存エラーはPDF再試行の対象にせず、同一並列バッチの終了を待って例外を返す。

CLIは最終集計と終了コード0/2/1で全成功/部分失敗/致命的失敗を区別する。保存原本は排他的作成で上書きを避ける。不正な一覧行は集計して飛ばし、一覧全体の形式が不正なら例外とする。同期設定の検証は通信より前に行う。


### 明示復旧と原本（2026-10-24）

`recover(ids, options): Promise<RecoveryResult>` は保存済みURLを使い、一覧APIを呼ばない。重複IDを除き、最大3ラウンドを今回の枠として適用する。累積retryCountをリセットせず失敗ごと加算する。保存済み本文を再変換/上書きしない。原本後保存時も既存本文のdocumentUrlを使う。

downloadPdfとparsePdfToMarkdownを分離し、savePdfDir指定時は同一ディレクトリ内の一時ファイルへ書き終え、非上書きのハードリンクで原本名へ公開してから変換する。途中の書込み失敗で不完全な原本を残さない。既存の通常ファイルは再利用し、非通常ファイルや安全でないIDを拒否する。原本保存失敗と本文復旧成功を別に報告する。recoverではダウンロード済みbytesを同一呼出しの再変換に使い、次の呼出しでは指定先の保存原本を利用する。スキーマ/自動同期設定は変更しない。


### 一覧APIの再試行境界（2026-10-24）

fetchとresponse.jsonを同じAbortControllerの30秒枠に置き、finallyでtimerを解除。最大3試行、TypeError/AbortError/TimeoutErrorとHTTP429/500/502/503/504だけを限定再試行する。JSON構文エラー・その他statusは直ちに返す。失敗応答bodyを解放して待機する。Retry-Afterの秒数/HTTP日時と指数待機の長い方を採用し、60秒超のサーバー要求は早く再送せず例外にする。ApiClientの第1引数の既存互換を維持し、第2引数でrequestTimeoutMsを指定可能。入力検証は単体API呼出しにも適用。


### PDF抽出worker（2026-10-24）

抽出器の非キャンセル処理をNode worker_threads内に限定する。依存moduleの解決済みURLと入力パスをworkerDataで渡し、固定のESM data URLで起動する。成功本文は文字列を確認し、error/結果なしexit/timeoutを例外として扱う。finallyでタイマー解除とworker停止完了を待ち、その後にparserが一時ファイルを削除する。変換後処理とdownloadPdfの公開APIは維持。worker起動オーバーヘッドは未計測。


### Web原本リンクの存在確認（2026-10-24）

web:exportでJSON出力後にannotate-pdfsを実行し、出力先PDFのlstatによる通常ファイル/非空確認をlocalPdfAvailableとして付加する。安全でないID・symlink・欠損/読取不能は未確認(false)。JSON本文は変更せず、一時ファイルからrenameして出力を置換する。Webはtrueの時だけローカルPDFリンクを表示し、旧JSON/不明/欠損は元URLを案内する。完全性や版同一性の検証ではない。


### npm配布契約（2026-10-24）

declaration:trueでdistのJavaScriptと対応する型宣言を生成し、package.jsonのmain/types/binを満たす。filesをdist/READMEへ限定し試験原本・JSON・DBを梱包しない。CJS専用出力は提供せず、ESMとして扱う。CIはbuild後に利用側型チェックを実行し、有効な検索/同期/復旧型と不正指定の型エラーを確認する。Web開発/取得補助スクリプトはソースチェックアウトで利用する。
