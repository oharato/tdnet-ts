# XBRL fixtures

TDnet 一覧 API の `recent.json?limit=500`（2026-11-08 取得）から、`url_xbrl` を持つ決算短信をそのまま保存したもの。

| ファイル | 企業 | 期間 | 会計基準 | TDnet 文書 ID | 元の XBRL ZIP |
| --- | --- | --- | --- | --- | --- |
| `jgaap-23760-2026-q2.zip` | サイネックス (2376) | 2027年3月期 第2四半期（中間期） | 日本基準・連結 | 1290345 | `081220261105565082.zip` |
| `ifrs-13750-2026-q2.zip` | ユキグニファクトリー (1375) | 2027年3月期 第2四半期（中間期） | IFRS・連結 | 1290367 | `081220261106567731.zip` |

- ZIP は TDnet の実物をそのまま置いている（再圧縮・切り詰めなし。各 70〜80KB）。
- 内容は `XBRLData/Summary`（決算短信サマリー）と `XBRLData/Attachment`（財務三表ほか）。
- Context は各 iXBRL ファイル内の `ix:header/ix:resources` に定義されている。
