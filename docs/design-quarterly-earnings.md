# 決算短信（四半期決算）データ対応 設計書（たたき台）

- 対象リポジトリ: tdnet-ts
- 前提調査: `docs/survey-quarterly-earnings.md`（2026-11-08、opencode実施）
- 設計方針の基準: edinet-ts のシンプル化後の設計原則（2026-11-07版 ARCHITECTURE.md）
  1. 取得は決算短信のサマリー＋財務三表の標準勘定科目まで。注記等のスクレイピングはしない
  2. 外部マスタは抱え込まない（証券コード＋TDnet文書IDで足りる）
  3. 検索の絞り込みは CLI オプションを増やさず `--where` の SQL パススルーで受ける
  4. ドキュメントは最小限（README 追記＋本書。恒常化するなら ARCHITECTURE 相当に統合）
  5. 同期は差分 CLI のみ（常駐・世代管理なし）

## 1. 目的

TDnet の決算短信 XBRL から財務数値を読み取り、当期・前期を突合して
利益率・収益性の変化を SQL で高速にスクリーニングできるようにする。
既存の PDF → Markdown → SQLite の文書検索はそのまま維持する。

## 2. 対象範囲

- 対象文書: 決算短信のみ。判定はタイトル依存にせず、XBRL の DocumentName /
  四半期情報（QuarterlyPeriod 等）と財務諸表の有無で行う
- 対象期間: 第1〜第3四半期および通期。Fact 保存は四半期単独値も含め
  数値全件とする。サマリー構築は四半期累計（YTD）を正とする
- 連結・単体: 連結優先、なければ単体。どちらを採用したかフラグで保持する
- 実績・予想: Fact 保存は予想（業績予想・配当予想）も含め数値全件とする。
  サマリーの指標計算は実績のみを使う
- 過去分: バックフィルはしない。日次同期で今後分を蓄積する
- Web 画面: 対象外（CLI / ライブラリ API のみ）

## 3. 取得

- 一覧 API の `url_xbrl` を型に追加し、決算短信については PDF と XBRL ZIP の
  両方を取得する（PDF は既存経路、XBRL は新規経路）
- 文書 ID は現行どおり固定し、PDF / XBRL の各 URL・ファイル名は資産として
  別に保持する
- XBRL の取得・解析・保存は PDF とは独立した状態で管理し、片方の失敗が
  もう片方を巻き込まない。再試行・重複排除は既存の同期の流儀に合わせる

## 4. 解析

新規モジュール `src/xbrl/` と `src/financial/` を追加する。

- `src/xbrl/parser.ts`: ZIP を展開し、iXBRL（`ix:nonFraction` /
  `ix:nonNumeric` の `name` / `contextRef` / `unitRef` / `scale` / `sign`）から
  Fact を抽出する。edinet-ts のパーサーは入力形式が違うため流用せず、
  比率計算の考え方だけを移植する
- Context 解決: 次元から「当期/前期 × 累計 × 連結/単体 × 実績」を解決する。
  TDnet 固有の Context ID 命名（`CurrentAccumulatedQ2Duration_...` 等）に対応する
- `src/financial/extractor.ts`: タクソノミー科目マッピング（`tse-ed-t` サマリー、
  `jppfs_cor` 等の添付）と指標計算。J-GAAP / IFRS の両方に対応する

## 5. 保存

数値 Fact はすべて保存する（2026-11-08 ユーザー決定）。テキストデータ
（文字列型 Fact・テキストブロック）は保留とし、今回は保存しない。
既存テーブルは変更しない。

- `tdnet_xbrl_documents`（新規）: 文書ごとの XBRL 取得状態、ZIP URL、
  期間種別、会計基準、連結/単体、訂正フラグ
- `tdnet_financial_facts`（新規）: 数値 Fact の全件保存。concept、context、
  期間、連結/単体、値、単位、scale 解決後の金額を持つ
- `tdnet_financial_summary`（新規）: 1行 = 1文書の当期・前期の主要科目と指標。
  主キーは `document_id`（訂正は別文書として保持し、screen 側で最新を採る
  運用を README に明記）

主要科目（固定セット。これ以上広げない）:

- 売上高 / 営業収益、営業利益、経常利益、親会社株主に帰属する当期純利益
- 純資産、総資産
- 営業CF、投資CF、現金及び現金同等物
- EPS、BPS、1株当たり配当金、従業員数

計算指標:

- 営業利益率と前年比ポイント差、売上高・営業利益の前年比成長率
- FCF（営業CF + 投資CF）、自己資本比率、ROE、ROA
- 従業員1人当たり営業利益

## 6. 検索

edinet-ts と同じ使い勝手を CLI に追加する。

- `screen --where "<SQL>"`: `tdnet_financial_summary` への SQL パススルー検索
- `schema` / `schema --json`: カラム自己記述
- `parse <zip>`: 単一 XBRL の解析確認（開発・検証用）
- 同期への組み込み: `sync` が決算短信の XBRL も差分取得する

## 7. DB の選択（決定済み： 案A＝SQLite継続、2026-11-08）

- 案A（推奨）: 既存の SQLite（node:sqlite）をそのまま使い、新テーブルと
  `--where` を SQLite の SQL で受ける。DB が1つで済み、構成が最小。
  edinet-ts との違いはエンジンだけで、使い勝手（SQL パススルー）は揃う
- 案B: 財務だけ DuckDB を追加し edinet-ts と完全に揃える。分析性能は上がるが
  DB 二重管理と依存追加（@duckdb/node-api）のコストがある

## 8. 実装順（opencode 担当、段階ごとにテスト必須）

1. 実在の決算短信 ZIP を fixture 化し、iXBRL パーサーで Fact が読めること
2. Context 解決（当期/前期・累計・連結/単体・実績）
3. 科目マッピングと指標計算 → `tdnet_financial_summary` へ保存
4. `screen` / `schema` CLI と検索 API
5. 通常同期への `url_xbrl` 組み込み（PDF 経路と並行）
6. README への追記（対象範囲・未対応事項）

各段階で J-GAAP と IFRS の実例を最低1社ずつ fixture に含める。

## 9. リスク・未確認

- 企業ごとのタクソノミー拡張・Context 付け方のばらつき（fixture だけで
  全社保証はできない）
- 非公式 API の応答形状・件数上限の揺れ
- 単位（円/千円/百万円）と scale/sign の取り違えによる数値破壊
  → 既知の決算短信（公表値）と突合する検証を段階1〜3の完了条件にする
- XBRL 全件適用時の通信量・保存量は未測定（段階5で実測する）

## 10. 判断が必要な点（ユーザー確認）

1. DB: 案A（SQLite 継続）か案B（DuckDB 追加）か → 推奨は案A
2. （決定済み）四半期単独値も数値 Fact として保存する。サマリーは YTD ベース
3. （決定済み）業績予想・配当予想も数値 Fact として保存する。指標計算は実績のみ
4. （決定済み）数値 Fact は全件保存する。テキストデータは保留
