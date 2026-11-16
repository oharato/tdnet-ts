# 訂正版の最新自動選択 設計メモ

- 対象リポジトリ: tdnet-ts（ブランチ `feat/corrections-latest`）
- 前提調査: 本番DB `~/workspace/tdnet-ts/tdnet.sqlite` を読み取り専用で確認（2026-11-17）
- 要件: `~/tasks/tdnet-1-corrections.md`

## 0. 調査結果（データ上の訂正の表れ方）

| 項目 | 実測（本番DB） |
|---|---|
| `tdnet_financial_summary` 行数 | 49,219 |
| `is_revision = 1` の行 | 1,747 |
| 同一 `(ticker, period_end)` に複数行ある組 | 1,831 組 / 3,744 行 |
| 訂正行のうち、同一企業・同一期末日の非訂正行がちょうど1件あるもの | 1,514 / 1,618（period_end あり） |
| `period_end` が NULL の訂正行 | 129（すべて数値項目が全null） |
| 訂正行が2件以上ある組（再訂正） | 74 組 |

- `tdnet_documents` / XBRL API には「どの文書を訂正したか」の関連フィールドはない。紐付けは開示タイトルと期間からの推定しかない。
- 訂正行の `period_type` は `unknown` になることが多い（例: 6460 の訂正は `unknown`、元は `Q2`）。一方 `period_end` は元と同じ値が入る（2026-09-30 等）。
- 訂正タイトルは表記揺れが大きい（`（訂正）` / `(再訂正・数値データ訂正)`、全角/半角、`第２半期` のような誤記、`令和9年` と `2027年`）。タイトル正規化での紐付けは不安定。
- `(ticker, period_end)` が同じ組の内訳は「元短信＋訂正」「元短信＋訂正＋再訂正」「元短信＋期中レビュー完了＋訂正」「会計基準の変更で同一期末日に J-GAAP と IFRS」など。いずれも「同一企業・同一期間の最新版を採る」対象として妥当（README の既知の制限(b)と同じ定義）。
- 数値が1つも入っていないサマリー行が 239 行ある（全null）。うち period_end ありが 59 行。これらはスクリーニングで使えないため、版の候補から外す。

## 1. 決定事項リスト

| # | 決定 | 捨てた代替案と理由 | 影響範囲 | 覆せるか | 承認 |
|---|---|---|---|---|---|
| D-1 | 「同一開示」のキーは `(ticker, period_end)` とする（`period_end` が NULL の行は版の対象外、`ticker` が NULL の行は `document_id` で単独行として扱う） | タイトル正規化は表記揺れ・誤記・令和表記で不安定。XBRL の関連IDは存在しない。`period_type` をキーに含めると訂正行の `unknown` で紐付かない | 最新版判定の全体 | 要承認 | 済（本メモ） |
| D-2 | 最新版は `published_at DESC, document_id DESC` の先頭1行 | `MAX(document_id)` だけでは開示時刻の逆行・再取得を説明できない。`published_at` 同刻時の決定性のため ID を第2キーにする | 最新版判定の全体 | 委任 | — |
| D-3 | 数値項目が全nullの行は版の候補から除外する | 全null行を候補に残すと、抽出に失敗した訂正が最新として元の有効な行を隠す（実測1組: 8103）。除外してもスクリーニングで使える情報は失わない | 239行が `screen` に出なくなる | 委任 | — |
| D-4 | 最新版の判定は読み取り用 VIEW `tdnet_financial_summary_latest` で行い、既存テーブルの行は変更しない | `is_latest` 列を追加して全49,219行をバックフィルする案は、更新漏れ・再同期時の再計算・本番DB移行のリスクが大きい。VIEW なら既存データ無変更で、新しい訂正の取込後も自動で最新になる | スキーマ追加は VIEW 1つ。既存49,219行の書き換えなし。`screen` のクエリコストは 49,219行で約0.3秒（ローカル計測） | 要承認 | 済（本メモ） |
| D-5 | `screenFinancials`（CLI `screen` / ライブラリ）は VIEW を読む＝既定で最新版のみ | 全版を返すオプションを追加すると要件（最新版のみ）とデフォルトが曖昧になる。旧版は `tdnet_financial_summary` と `getFinancialSummary(documentId)` で引き続き参照できる | CLI・ライブラリ API の既定結果 | 要承認 | 済（本メモ） |
| D-6 | 文書ID指定の取得は既存 `getFinancialSummary`（保存行をそのまま）を維持し、最新版を返す `getLatestFinancialSummary(documentId)` を追加する | 既存メソッドの意味を変えると「保存した行をIDで読む」用途と既存テストが壊れる。最新版が要る呼び出し元は明示メソッドを使う | ライブラリ API 追加 | 委任 | — |
| D-7 | ダイジェスト（Muse側）と `tdnet_documents` の検索は変更しない | 要件の「やらないこと」。ダイジェストは別リポジトリ | なし | 委任 | — |
| D-8 | 既存DBへの追加は `CREATE VIEW IF NOT EXISTS` のみ。データ移行・列追加・索引追加はしない | 索引は今回の窓関数クエリでは逆に遅くなった（実測 1.2〜5秒）。列追加は D-4 の理由で不要 | 起動時に VIEW を1つ作るだけ | 委任 | — |

### 最新版判定の SQL（VIEW の実体）

```sql
SELECT s.*
FROM tdnet_financial_summary s
JOIN (
  SELECT document_id FROM (
    SELECT document_id,
           ROW_NUMBER() OVER (
             PARTITION BY COALESCE(ticker, document_id), period_end
             ORDER BY published_at DESC, document_id DESC
           ) AS version_rank
    FROM tdnet_financial_summary
    WHERE period_end IS NOT NULL
      AND (<数値カラムのいずれかが NOT NULL>)
  )
  WHERE version_rank = 1
) latest ON latest.document_id = s.document_id
```

## 2. 要件トレーサビリティ

| 設計要素 | 対応する要件ID | 判定 |
|---|---|---|
| 訂正の紐付け調査（期間キー・タイトル・フラグの実測） | R-1 | 対応 |
| VIEW `tdnet_financial_summary_latest` | R-2 | 対応 |
| `screenFinancials` を VIEW 読み取りに変更 | R-2 | 対応 |
| `getLatestFinancialSummary(documentId)` 追加 | R-2 | 対応（「サマリー取得」の明示API） |
| 既存 `getFinancialSummary` 維持 | R-2 の補助（旧版参照） | 対応 |
| 既存DB無変更・VIEW のみ | R-6 | 対応 |
| 訂正1回・複数回・数値のみのテスト | R-4 | 対応 |
| README の既知の制限(b)更新 | R-2 | 対応 |
| 本番DBへの書き込みなし | R-6 | 対応 |
| ダイジェスト変更なし | R-7 | 対応 |

要件IDは本メモで付番した（元タスクにIDがないため）。

- R-1: 訂正と元開示のデータ上の表れ方を調査する
- R-2: 訂正版がある場合、サマリー取得とスクリーニングで最新版のみを使う
- R-3: 設計メモを design スキルの流儀で書く
- R-4: 訂正ケースのテストを追加し、全テストを合格させる
- R-5: push して PR を作成する
- R-6: 本番DBへの書き込み・マイグレーション実行をしない。スキーマ変更は最小限にし、既存データへの影響を明記する
- R-7: ダイジェスト配信（Muse側）を変更しない

## 3. 自己批判

- **最簡案**: `screenFinancials` の SQL に `WHERE document_id IN (最新版の副問い合わせ)` を直接埋め込む。VIEW を作らない分だけ小さい。差分は「VIEW の定義を init に置くか、screen の SQL に直書きするか」だけ。VIEW にしたのは、外部の読み取り専用利用者（SQL を直接書く人・将来のダイジェスト）が同じ定義を使えることと、screen 以外の取得経路を増やさないため。今すぐ必要かと言われると VIEW は若干の先回りだが、定義の重複を避ける効果がある。
- **過剰かもしれない点**: `getLatestFinancialSummary` は今回の CLI からは呼ばない。要件の「サマリー取得」を文書ID指定の取得と読んだための API 追加で、不要なら削れる。残す理由は、旧版の文書IDしか持っていない呼び出し元が最新値を引けるようにするため。
- **D-3 の副作用**: 数値が全nullの239行は `screen` に出なくなる。これは「サマリー取得」の結果から抽出失敗行が消えることを意味する。ただし全null行は絞り込み条件で使えず、元々ノイズだった。
- **既知の限界**: 訂正版の XBRL が一部の科目しか抽出できない場合、最新版の行はその科目が null になる（旧版の値を引き継がない）。実測では IFRS の売上高などで13件、元行にあった `current_net_sales` が訂正行で null になる。これは「最新版のみ」という要件どおりの挙動だが、数値の穴は別途抽出側の改善が必要。本設計では版のマージはしない。
- **性能**: 49,219行で約0.3秒（メモリ上のコピーで計測）。現行の単純 SELECT は約20msなので劣化するが、CLI の分析用途では許容。索引を張ると窓関数のソート計画が悪化して遅くなったため張らない。

## 4. 要件への差分提案

| 対象（要件ID／新規） | 種別（追加・変更・削除） | 内容 | きっかけになった設計判断 | 承認 |
|---|---|---|---|---|
| R-2 | 追加 | 「最新版」の定義は `(ticker, period_end)` 単位とする。会計基準の変更や期中レビュー完了の再開示も同じ組に入り、最新のみ残る | データに関連IDがなく、期間以外に安定したキーがない | 要 |
| R-2 | 追加 | 数値が全nullの行はサマリーとして扱わない（`screen` に出さない） | 抽出失敗行が最新として有効行を隠すのを防ぐ | 要 |
| 新規 | 追加 | 旧版を明示的に見たい場合は `tdnet_financial_summary` を直接 SQL で参照する（`screen` の `--where` では見えない） | 既定を最新版のみにしたため | 要 |
| 新規 | 追加 | Muse 側が `tdnet_financial_summary` を直接読んでいる場合、最新版を得るには VIEW `tdnet_financial_summary_latest` に切り替える別タスクが必要 | ダイジェストは今回のスコープ外 | 要（別タスク） |

## 5. 別提案

- 訂正版 XBRL の科目マッピング改善（`SalesIFRS` など）。今回のスコープ外だが、最新版の数値の穴を減らすには効果が大きい。
- 全null行 239 件の原因調査（訂正告知のみの XBRL を summary として保存している可能性）。保存自体を止めるかは別判断。
