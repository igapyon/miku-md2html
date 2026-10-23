# 自己レビューとリファクタリング計画

- 作成日: 2026-10-23
- 状態: **2026-10-23 実施完了。コード変更は未commit。**
- 対象: `miku-md2html`
- 調査時 HEAD: `7b138ae76b6447feae2208fbbbff48035ecf1003`
- 調査時 branch: `devel-tiga1023iab`、作業ツリー clean、`origin/devel` より 1 commit ahead
- package / lockfile / runtime version: `0.3.3`
- 想定実行者: Luna。各段階を順番に実行し、その段階の確認を通してから次へ進む。

本書はソース、既存テスト、仕様書、Git 履歴を読んだ静的レビューと、2026-10-23 に実行した修正・検証の記録をまとめる。
S0 の元実装では `npm test`（75件）と `npm run smoke:all` が成功した。F1–F3 と CLI failure cases は個別テストで再現・修正後を確認した。
現在の実装結果、最終確認コマンド、環境と未確認事項は第 7・8 節に記録する。

## 1. 分類と製品境界

| 項目 | 現状 |
| --- | --- |
| Node.js CLI Review / Layer | 10 Main Application |
| 実行形態 | ローカルの Node.js CLI / importable runtime |
| 主出力 | 明示されたパスへの単一 HTML |
| 診断 | stderr と、明示された場合の JSON report |
| Runtime artifact | 単一 CLI `.mjs`、import runtime `.mjs` |
| Release Automation Review / 配布形態 | GitHub Release assets |
| Trigger | `release: published` |
| 版数の契約 | `package.json` と完全一致する `v<version>` |
| 配布物 | CLI、import runtime、source archive の 3 件 |
| 既存 smoke | CLI/runtime/staged assets のスクリプトあり。今回は未実行 |

利用者が確認した境界を維持する。

- `miku-md2html` 本体は独自の Agent Skill を持たない。
- Skill の提供・同梱先は別リポジトリ `miku-md2formats-skills` とする。
- 本計画で `SKILL.md`、skill bundle、skill 用 runtime コピーを追加しない。
- sibling repository、インストール済み Skills、共有 `igapyon-agent-skills` は編集対象に含めない。
- 現行の release trigger はこのリポジトリの契約として維持する。共有ガイドの別の既定値を理由に移行しない。

## 2. 自己レビュー結果

行番号は調査時 HEAD のもの。実行時には関数名とコードを読み直す。
現在確認できた仕様差と、保守性の課題を区別している。

### F1 — Medium: ローカル画像の容量見積もりが正常な境界値を拒否し得る

根拠: [converter.ts](../src/ts/core/converter.ts) の `prepareImage` L317–319、
`convertMarkdownToHtml` L545–550。

ローカル画像の仮 `src` はすべて `data:image/svg+xml;base64,` を使う。
見積もり時には placeholder 本文の長さだけを Base64 payload 長へ置き換え、MIME prefix の差を補正しない。
SVG prefix は 26 bytes、PNG/GIF prefix は 22 bytes のため、PNG 1 回につき最終出力より 4 bytes 大きく見積もる。
同じ PNG を 2 回表示すれば差は 8 bytes になる。

再現条件: 小さいローカル PNG を含む変換を十分大きい cap で一度成功させ、
得られた `htmlBytes` と同じ `maxOutputBytes` で再変換する。
現在の式では最終出力が上限以内でも preflight が失敗し得る。
これは「等しい値は許容する」REQ-050 と整合しない。
既存の exact-byte テストは画像なしであり、この差を検出しない。

### F2 — Medium: CLI の失敗分類と report の終了コードが一致しない

根拠: [main.ts](../src/ts/cli/main.ts) の `errorDiagnostic` L146–149、
`writeFailureReport` L152–170、`runConversion` L261–270。

- 内部例外の場合、CLI は exit 3 を返すが、failure report は exit 1 固定で作られる。
- `errorDiagnostic` は任意の例外の `.code` を製品の診断コードとして採用する。
  保存処理が返す `EACCES` や `EEXIST` が公開コードの代わりに流れ、
  `.code` 付きの想定外例外も exit 1 に分類され得る。
- HTML 保存後の report commit 失敗、no-force の同時作成は TODO に残り、
  現在の CLI テストにはその失敗段階を決定的に発生させる仕組みがない。

関連契約: [CLI reference](cli.md)、REQ-083、REQ-092。
HTML と report は二つのファイルをまとめた transaction ではなく、
HTML 保存後に report だけが失敗した場合は HTML を保持する必要がある。

### F3 — Medium: 許可した percent-encoded 画像ファイル名を拒否する

根拠: [uri.ts](../src/ts/assets/uri.ts) の `classifyImageSource` L18、L23、L30–31、
[implementation-spec.md](implementation-spec.md) の REQ-042。

仕様は実ファイル名の `#` / `?` を `%23` / `%3F` で指定できるとする。
実装は未 decode の query/fragment を拒否した後、decode 済み文字列の `#` / `?` も拒否する。
そのため `images/a%23b.png` もエラーになる。
エラーメッセージが勧める「encode して指定する」という回避策も成立しない。

### F4 — Medium（保守性）: core の状態と処理段階が集中している

根拠: [converter.ts](../src/ts/core/converter.ts) は 615 行。
`prepareImage` は 14 引数、`sanitizeTree` は 13 引数を受け取り、
cache、pending node、record、重複排除、warning、4 種類の集計状態を引き回している。

同じファイルが request 検証、HTML policy、画像の二段階処理、見出し、TOC、
CSP と document assembly、容量判定を所有する。
複数の failure return で画像集計を手動で result へ反映するため、
責務の追加時に部分的な更新漏れを起こしやすい。
この構造自体を不具合と断定せず、F1 を安全に修正するための分割対象とする。

### F5 — Low: 版数の履歴と Skill の所有先を文章で明確にする余地がある

- 直前の版数更新で [completion.md](completion.md) L7 を
  「その実装 milestone は 0.3.2」と書き換えたが、同節の日付は 2026-10-22。
  現在の履歴では初期実装 `80224d9` の package version は `0.3.0`、
  `9352ec6` は `0.3.1`、highlighting 追加 `fe62ea5` は `0.3.2` である。
  最初の milestone と後日の版数を混ぜた文章は修正対象とする。
- README の `.codex/skills/` 除外はローカルコピーの運用規則であり、
  製品 Skill の所有先が `miku-md2formats-skills` であることまでは説明していない。
  REQ-003 の「Skills/MCP は後続候補」も利用者が確認した境界を明確に表していない。

### 今回は選ばない変更

- release asset の名前一覧は staging / smoke に重複するが、現行 3 件の契約は一致している。
  今回の core/CLI 分割に release helper の再設計を加えない。
- SVG parser、syntax tokenizer、言語 registry、viewer/CSS は既に個別モジュールに分かれている。
  policy の緩和、parser の置換、inline SVG の再 parse 削減は別件とする。
- version を別の生成方式へ移すこと、依存ライブラリ更新、不要 export の一括削除、
  CLI の JSON stdin 化、Web/Java/MCP の追加は扱わない。
- 前回の miku-scm runner が出した汎用 commit title や版数通知は、製品のリファクタリングで修正しない。

## 3. 受け入れ条件と変更を許す範囲

構造だけを移す段階では、同じ入力から得る HTML bytes、metadata、diagnostics の内容と順番、
stats、resolver 呼出回数、CLI stdout/stderr/exit code を一致させる。
F1–F3 の修正は後述の専用段階で行い、差分を次の表に限定する。

| 修正 | 許す外部動作の差 |
| --- | --- |
| F1 | 最終 HTML が cap 以下のローカル画像付き入力が成功する。preflight の `estimatedBytes` は適切な下限値へ変わる |
| F2 | 期待した保存失敗を製品コードで報告する。内部例外は exit/report とも 3、公開診断は汎用 `E_INTERNAL` にする |
| F3 | `%23` / `%3F` が一度だけ decode され、ファイル名として resolver に渡る |
| F5 | 初期実装の履歴と Skill 所有先の文書を事実に合わせる |

以下は全段階で維持する。

1. runtime の公開値 `productName` / `version` / `AssetAccessError` / `convertMarkdownToHtml` と公開型。
2. `ConvertRequest` / `ConvertResult`、`runCli(argv, io)`、CLI 引数、schemaVersion `1` の report fields。
3. Node.js >=22、現在の依存版、`0.3.3`。自動で版数を上げない。
4. 5 MiB / 40 million pixels / 20 MiB / 100 MiB の既定値、highlighting の 256 KiB / 1 MiB。
5. 元画像 bytes の保持、同一 ID の読取共有、出現回数分の payload 加算、変換ごとの独立した状態。
6. 明らかな超過をローカル画像の全文読取前に拒否し、最終 HTML bytes でも必ず判定する。
7. HTML/属性の許可集合、SVG 制限、sanitizer の順序、CSP/hash、source line/column、code.textContent。
8. no-force の既存ファイル保護、symlink / inode / 参照画像衝突の拒否、HTML commit が先という順序。
9. 失敗時は自分の temporary だけを片づける。HTML 保存後の report 失敗で正常な HTML を削除しない。
10. runtime 通常実行でネットワークへアクセスしない。release の 3 artifact と trigger を変更しない。

Git add/commit、履歴変更、push、tag、Release 操作、インストール先 Skill へのコピーは実行範囲に含めない。

## 4. 目標とする内部構成

新しい関数・型は内部モジュール用とし、`src/ts/index.ts` の公開 export を増やさない。
行数削減を単独の完了条件にはせず、状態の所有者と処理順が読めることを条件にする。
新しい core モジュールから公開 barrel `index.ts` を逆 import せず、下位モジュールを直接参照する。

| ファイル | 責務 |
| --- | --- |
| `core/converter.ts` | request 検証、parse、処理段階の順序、metadata、上限判定、結果の組立て |
| `core/hast-utils.ts`（新規） | 現行 `plainText` / `getSource` の内部共通処理 |
| `core/diagnostics.ts`（既存） | 診断整列と、期待した asset error の記録。想定外例外は rethrow |
| `core/document-structure.ts`（新規） | `Heading`、ID 割当、fragment の書換え |
| `core/html-document.ts`（新規） | `escapeHtml`、TOC、CSS/viewer/CSP を含む document rendering |
| `core/image-embedding.ts`（新規） | 1 conversion 内の画像 cache、pending、warning、集計、画像 read/embed |
| `core/article-sanitizer.ts`（新規） | allowed/dropped tags、属性処理、inline SVG 変換、独自 tree cleanup、最終 sanitize schema |
| `cli/main.ts` | 引数 parse、help/version、`runCli`、直接起動判定 |
| `cli/convert-file.ts`（新規） | 入力 → core → 衝突確認 → 保存 → レポートの orchestration |
| `cli/markdown-input.ts`（新規） | UTF-8、上限付き Markdown read |
| `cli/output-files.ts`（新規） | 出力先の実体確認、衝突、temporary、commit、cleanup と部分保存状態 |
| `cli/reporting.ts`（新規） | 診断整列・表示、report 組立て、型のある failure 分類 |

汎用 plugin registry、サービスコンテナ、共通 mutable context は導入しない。

### ImageEmbeddingSession の内部契約

factory または class のどちらでもよいが、呼出側に渡す操作と状態の所有先は次に固定する。

```ts
type AssetStats = Pick<ConversionStats,
  'imageOccurrences' | 'uniqueAssets' |
  'uniqueSourceAssetBytes' | 'embeddedPayloadBytes'>;

interface ImageEmbeddingSession {
  prepare(sourceValue: string, node: Element): Promise<void>;
  prepareInlineSvg(bytes: Uint8Array, info: SvgInfo, node: Element): Promise<void>;
  rebindPendingNodes(tree: Root): void;
  pendingSizeDelta(): number;
  embedPending(): Promise<void>;
  snapshotStats(): AssetStats;
}
```

- 生成時に渡す依存は `assets?`、`diagnostics`、`lineOffset`、`maxOutputBytes` に限定する。
- 既存 cache / record / Set / counter は session 内へ移す。外から `.value` を書かない。
- `prepare` が local 画像を describe して placeholder を置く。読取は行わない。
- `prepareInlineSvg` は sanitizer が serialize 済みの bytes と `SvgInfo` を受け取り、
  現行の data URI 経由の検査と record の寸法更新を内部で実行する。
  sanitizer から record Map を直接操作させない。
  `SvgInfo` は既存の `assets/svg.ts` の型を使う。
- `rebindPendingNodes` は最終 rehype-sanitize 後の node へ参照を付け直す。
- `embedPending` は ID 単位で read を共有し、各出現 node の `src` を更新する。
- `snapshotStats` は新しい値の object を返す。failure 時の集計時点も現行動作を保つ。
- inline SVG の二重検査や record lookup は最初はそのまま移す。抽出と最適化を混ぜない。

### converter の処理順

1. request / options 検証、BOM・改行正規化、入力サイズ、front matter。
2. mdast parse → fenced code の source 収集 → remark/rehype 変換。
3. image session 生成 → 独自 sanitizer（image describe / inline SVG を含む）。
4. 見出し ID → fragment rewrite → title/lang → TOC。
5. rehype-sanitize → pending image node の rebind。
6. 既存エラーの確認 → syntax highlighting。
7. placeholder を含む HTML 生成 → pending image のサイズ評価。
8. local image read/embed → エラー確認。
9. 完成 HTML 生成 → 正確な byte cap / warning → 結果。

特に 5 の後に 6 を置くことと、7 より前に画像全文を読まないことを守る。

## 5. 実施段階

以下は今回実行した段階とその順序。各段階で対象を絞り、確認後に次へ進んだ。

### S0 — 実行環境と互換性基準を固定する

変更対象: 新規 `tests/refactoring-contract.test.ts` と必要最小限の
`tests/fixtures/refactoring/`。製品ソースはまだ変えない。

1. `git status -sb`、HEAD、版数、現在のスクリプトを確認する。
   HEAD が変わっていたら本書の参照関数と変更箇所を比較し、行番号だけで patch しない。
   他者の差分を取り消さない。機能差が基準を変えていたら計画の該当箇所を更新する。
2. `npm test`、`npm run smoke:all` を元実装で実行し、Node / npm / OS と結果を記録する。
   既存失敗があれば先に切り分け、期待値更新で隠さない。
3. 以下の小さい入力について、元実装で HTML の SHA-256 と完全な
   metadata / diagnostics / stats を採取し、期待値 fixture として固定する。
   hash 不一致時は実際の HTML を temporary に保存し、原因を読めるようにする。
4. 構造変更後に基準 fixture を再生成しない。F1–F3 の不具合再現入力は
   互換性 golden に混ぜず、それぞれの修正段階に期待仕様のテストを置く。

| 基準ケース | 固定する契約 |
| --- | --- |
| front matter + 日本語/重複 heading + fragment | title/lang/source 位置、ID/TOC/fragment |
| GFM table/task/footnote + raw HTML | HTML bytes、属性除去、warning の順序 |
| local PNG を同じ path で 2 回 | describe/read 各 1 回、payload は 2 回、placeholder が残らない |
| 異なる path が同一 resolver ID を返す | describe は path ごと、read は ID ごと、unique stats |
| data PNG + inline SVG | resolver なし、alt、元データ、asset 集計 |
| YAML 後の fence + list/blockquote 内 fence | highlight、code text、source 行 |
| 未知言語 + skip/fallback | plain 表示と既存 diagnostic の形 |
| 明らかに大きい local image | read 0 回の preflight failure と failure stats |

CLI の既存 stdout/stderr 形式、report field、help/version も確認する。
temporary の絶対パスを比較する場合は、自分で作った root だけを `<ROOT>` に置換する。
任意のパスや診断本文を広く正規化して差を隠さない。

完了条件: 元実装で基準テストと既存テストが通り、fixture が元実装由来と説明できる。

### S1 — 見出しと HTML assembly を抽出する

変更対象: `core/converter.ts`、新規 `hast-utils.ts` / `document-structure.ts` / `html-document.ts`。

1. `plainText` / `getSource` を `hast-utils.ts` へそのまま移す。
2. `Heading` / `collectAndAssignHeadings` / `rewriteFragments` を `document-structure.ts` へ移す。
   未使用の `diagnostics` / `lineOffset` 引数は、使われていない関数だけから外す。
3. `escapeHtml` / `renderToc` / `renderDocument` を `html-document.ts` へ移す。
   trim、改行、attribute order、script/style 閉じタグ対策、CSP の計算対象 bytes を変えない。
4. converter は新しい内部関数を呼ぶだけにする。

確認:

```sh
npm run build
./node_modules/.bin/vitest run tests/refactoring-contract.test.ts tests/core.test.ts tests/syntax-highlight.test.ts
```

完了条件: HTML hash とすべての基準値が一致し、public export が増えていない。

### S2 — 画像の状態を conversion ごとにまとめる

変更対象: `core/converter.ts` / `core/diagnostics.ts`、新規 `core/image-embedding.ts`、
新規 `tests/image-embedding.test.ts`。

1. `PendingLocal`、data URI/hash helpers、画像 warning、cache、record、集計と local read を session へ移す。
   `mapAssetError` は既存 `core/diagnostics.ts` の内部 export へ移し、session と sanitizer から共用する。
   `AssetAccessError` の記録と、その他の例外を rethrow する動作を維持する。
2. `prepareImage` の 14 引数列 / `sanitizeTree` の 13 引数列を session の受渡しへ置き換える。
3. converter の各 failure return が同じ session の stats snapshot を使うようにする。
4. この段階では F1 の見積もり式を変更しない。
5. 連続 2 conversion と同時 2 conversion で状態が混ざらないテストを追加する。
   describe/read、warning 重複排除、data/local/inline の集計を確認する。

確認: S1 のコマンドに `tests/image-embedding.test.ts` を加える。

完了条件: mutable state が session 内へ収まり、各呼出で新規生成され、基準値が一致する。

### S3 — sanitizer の責務を抽出する

変更対象: `core/converter.ts`、新規 `core/article-sanitizer.ts`。

1. allowed/dropped tags、schema、`sourceIsRawHtml`、`safeLink`、footnote ID、
   `sanitizeProperties`、`sanitizeTree` を一緒に移す。
2. sanitizer から画像操作は session の `prepare`、inline SVG は `prepareInlineSvg` を呼ぶ。
3. inline SVG の source 切出し、alt 優先順、serialize/inspect の順序を維持する。
4. schema を内部 export し、rehype-sanitize を現行と同じタイミングで converter から呼ぶ。
   独自 cleanup と最終 sanitizer を早い段階でまとめて実行しない。
5. 最終 sanitizer 後の pending-node rebind と、その後の highlighting を維持する。

確認: S1/S2 のテストと typecheck。raw HTML / unsafe SVG / footnote / token safety の既存期待値を変えない。

完了条件: converter を読むと第 4 節の処理順が追え、policy が 1 モジュールに集まる。

### S4a — F1 の容量見積もりを修正する

変更対象: `core/image-embedding.ts`、`core/converter.ts`、`tests/core.test.ts`、
`tests/image-embedding.test.ts`。

1. local PNG の実出力 bytes と cap が等しいケース、1 byte 下、同一画像 2 回のケースを追加する。
   修正前に前述の false rejection が再現することを確認する。
2. MIME が describe 時に不明である点を保ち、preflight を**最終サイズの下限**で計算する。
   仮 src 全体の UTF-8 長を引き、対応 MIME 中で最短の data URI prefix 長と
   `4 * ceil(byteLength / 3)` を各出現分加える。
   SVG prefix のまま payload だけを差し替える式を使わない。
3. 下限が cap を超えた場合に read 前の拒否を行う。
   下限が収まっても、実画像 read 後の完成 HTML bytes 判定は必ず残す。
4. data URL と inline SVG は skeleton に実データが既にあるため、pending 分として二重加算しない。
5. PNG 以外も、既存の小さい有効画像または妥当な fixture を使い、
   SVG/JPEG など prefix 長が異なる形式で false rejection がないことを確認する。

確認: core / image-embedding / syntax-highlight の targeted tests。
highlight markup を容量へ含める既存テストも通す。

完了条件: exact cap は成功、1 byte 下は失敗、明らかな大画像の read は 0 回、反復 payload は出現回数分。

### S4b — F3 の画像 URI 契約を修正する

変更対象: `assets/uri.ts`、新規 `tests/uri.test.ts`、必要な core/Node resolver の integration test。

1. `%23` / `%3F` を一度 decode した結果が resolver に渡る仕様テストを追加する。
2. decode 前の literal `?` / `#` 拒否は維持し、decode 後の filename 文字の拒否だけを修正する。
3. `%2523` は `%23` という文字列になり、再 decode されないことを確認する。
4. NUL、backslash、絶対 path、drive/UNC/file URL、不正 percent、remote URI の拒否を維持する。
5. `#` を含む実画像ファイルの integration test を追加する。
   `?` は OS の filename 制約に依存させず、mock resolver で decoded value を確認する。

確認:

```sh
./node_modules/.bin/vitest run tests/uri.test.ts tests/core.test.ts tests/node-assets.test.ts tests/cli.test.ts
```

完了条件: REQ-042 が満たされ、root 制限や一度だけ decode する契約が保たれる。

### S5 — CLI の入力・保存・report を分割する

変更対象: `cli/main.ts`、新規 `convert-file.ts` / `markdown-input.ts` /
`output-files.ts` / `reporting.ts`、新規 `tests/output-files.test.ts`。

1. `readMarkdown` を `markdown-input.ts`、target/同一実体判定/stage/commit/cleanup を `output-files.ts` へ移す。
2. 診断表示と `reportObject` を `reporting.ts` へ移し、`runConversion` を `convert-file.ts` へ移す。
   `writeFailureReport` も `convert-file.ts` へ置き、reporting のデータ組立てと output-files の保存を呼ぶ。
   `output-files.ts` から `reporting.ts` を呼ぶ循環は作らない。
3. `main.ts` は `runCli`、help/version、isMainModule と起動処理を担当する。
4. 保存は HTML を stage、report を stage、HTML commit、report commit の順を保つ。
5. 保存結果を `htmlCommitted` が分かる discriminated union で返す。
   report commit 失敗時に outer catch から `output.written:false` の failure report を書き直さない。
6. 保存関数の内部に限り `stage` / `commit` / `cleanup` の依存を差し替えられるようにする。
   production の既定値は現行 Node fs 処理。public CLI に test 用 option を追加しない。
7. 内部 `runFileConversion` の依存引数は core conversion 関数と保存 helper に限定し、
   想定外例外や部分保存を決定的に起こせるようにする。
   production の既定値を用意し、既存 `runCli(argv, io)` は変更しない。
8. F2 の分類修正は次段階で行い、この段階では既存の正常系・保存順・衝突拒否を一致させる。

保存 helper の必要な状態は `not-committed` / `html-committed` / `complete` の 3 段階。
原子性を表すならファイル 1 件単位とし、HTML と report 全体の atomic 性を約束しない。

確認:

```sh
npm run build
./node_modules/.bin/vitest run tests/output-files.test.ts tests/cli.test.ts tests/refactoring-contract.test.ts
```

完了条件: 本来の entrypoint から同じ処理が動き、temporary の所有と部分保存が一箇所で追える。

### S6 — F2 の失敗分類と不足テストを補う

変更対象: `cli/output-files.ts` / `reporting.ts` / `convert-file.ts`、
新規 `tests/cli-failures.test.ts`、`tests/output-files.test.ts`。

1. 期待される fs 失敗は、その I/O 呼出境界で `AssetAccessError` の製品コードへ変換する。
   no-force commit の `EEXIST` は `E_OUTPUT_EXISTS`、HTML 書込失敗は `E_OUTPUT_WRITE`、
   report 書込失敗は `E_REPORT_WRITE` とする。
   プログラムの `TypeError` や契約違反まで I/O error に包まない。
2. 中央の failure 分類は `AssetAccessError` と想定外例外を区別する。
   任意の `.code` を公開診断として採用しない。内部失敗は汎用 `E_INTERNAL` / exit 3 とする。
3. failure report は固定値 1 を使わず、決定した process exit code を引数で受け取る。
   `success` / `output.written` / `exitCode` を実際の保存状態から組み立てる。
4. 次の表の期待値を先にテストへ書き、該当経路だけを修正する。

| 発生条件 | 期待結果 |
| --- | --- |
| core が code なしの内部例外を throw | exit 3、stderr/report は `E_INTERNAL`、report.exitCode 3、HTML なし |
| core が任意の `.code` と機密的な message を持つ例外を throw | 同じ内部失敗扱い。raw code/message/stack を公開しない |
| HTML の stage/commit が期待される fs error | exit 1、`E_OUTPUT_WRITE`、自分の temporary を cleanup、既存ファイルを保持 |
| no-force commit 直前に他者が target を作成 | exit 1、`E_OUTPUT_EXISTS`、他者の bytes を保持、自分の temporary だけ削除 |
| report の stage が失敗 | HTML commit はまだ 0 回、既存の HTML/report を保持、`E_REPORT_WRITE` |
| HTML 成功後に report commit が失敗 | exit 1、`E_REPORT_WRITE` と HTML 保存済み表示、正常 HTML を保持、成功 summary なし |
| failure report 自体の保存に失敗 | 元の失敗の exit code を維持し、report failure を stderr に追加、繰返し書込をしない |
| 既存の symlink / input inode / referenced asset 衝突 | 現行の拒否結果とファイル bytes を維持 |

sleep を使った race テストは作らない。commit 直前の hook または内部 I/O 依存で、
他者のファイル作成と fs error を決定的に発生させる。
`--force` の rename を事前 unlink に変更しない。

確認: `cli-failures` / `output-files` / 既存 CLI の focused tests を通し、その後 `npm test` を 1 回実行する。

完了条件: report と process の終了コードが一致し、許可した F2 の差以外の CLI 契約が変わらない。

### S7 — 文書と配布を確認して引き渡す

変更対象: README、`docs/implementation-spec.md` / `api.md` / `cli.md` /
`development.md` / `completion.md`、必要な TODO の状態、
`scripts/smoke-release-assets.mjs` の source archive 必須ファイル一覧。

1. runtime の公開 API を維持したことと、新しい内部責務の場所を development notes に短く記す。
2. README と REQ-003 に、Skill の所有先が `miku-md2formats-skills` であると明記する。
   companion の公開・実装状況を確認せず「利用可能」「release 済み」とは記載しない。
3. completion の初期 milestone と `0.3.2` を混ぜた文章を F5 の履歴に沿って直す。
   過去の feature 記録や実行中 commit ID を一括置換しない。
4. TODO は実際に確認した report commit / 同時作成 / preflight 項目だけを完了にする。
   Node22/24、browser、未実施の 5 MiB/20 MiB 境界や license review をまとめて完了にしない。
5. source archive smoke の required files に新しい core/CLI の主要モジュールも加え、
   分割後の source archive が再 build に必要な実装を含むことを確かめる。
6. `npm run smoke:all` を実行する。S6 後にコードやテストを変えた場合だけ `npm test` も再実行する。
7. 利用可能な Node22/24 環境では既存テストと runtime smoke を確認する。
   利用できない版は未確認と記録し、Node26 の成功で代用したと主張しない。
   環境の導入や依存更新を本計画の実行へ暗黙に混ぜない。
8. `git diff --check`、最終 diff、`git status -sb` を確認する。

完了条件:

- 構造変更段階の互換性基準は一致し、F1–F3 の再現テストは修正後に成功する。
- core は処理順を所有し、画像状態 / sanitizer policy / document assembly が独立している。
- CLI は部分保存状態を明示し、内部例外と期待した保存失敗を区別できる。
- CLI/runtime/source の 3 artifact が従来名・同一版数で生成される。
- 実行コマンド、結果、Node 版、未確認事項、許可した動作差を記録して引き渡す。
- Skill ファイル、sibling repository への変更、version/SCM/公開操作が混入していない。

## 6. 将来の再確認で使う実行指示テンプレート

初回の実行は完了済み。別環境で再確認・再実行する場合は、以下を指示文として利用できる。

> docs/refactoring-plan.md を読み、S0 から S7 を順に実行してください。
> まず HEAD・作業ツリー・元実装のテスト結果を確認し、S0 で互換性基準を固定してください。
> 純粋な抽出と F1–F3 の不具合修正を、それぞれ指定された段階で行ってください。
> 各段階の対象ファイル、処理順、テストと完了条件を守り、失敗はその段階で切り分けてください。
> HTML や diagnostic の期待値を一括更新して差を隠さないでください。
> miku-md2html に独自の Skill は追加せず、他リポジトリ・共有 Skill は変更しないでください。
> version 変更、Git add/commit、push、tag、Release 操作は行わず、実行結果と未確認事項を報告してください。

## 7. 段階の記録

- [x] S0 元実装と互換性基準 — 元実装で `npm test` 75件、`npm run smoke:all` 成功。4つのHTML SHA-256とmetadata/diagnostics/statsをinline snapshotへ固定。
- [x] S1 見出し・HTML assembly の抽出 — 4 goldenのHTML hashと値が一致。
- [x] S2 画像 session — 連続・並行 conversion、別path同一ID、warning重複排除、繰返し画像、data PNG + inline SVGを確認。
- [x] S3 sanitizer の抽出 — sanitization/GFM/footnote goldenと既存 testsが一致。
- [x] S4a 画像付き exact-cap の修正 — PNG、SVG、繰返しPNGで上限ちょうどを確認。1 byte未満は失敗、既存preflight testはread 0回。
- [x] S4b percent-encoded filename の修正 — `%23` / `%3F`、一度だけdecode、実ファイル名の `#` を確認。
- [x] S5 CLI の責務分割 — input/conversion/output/reportingを分割し、既存CLI testsを維持。
- [x] S6 CLI の失敗分類と不足テスト — 内部例外のexit/report 3、HTML/report stage/commit、既存bytes維持、no-force競合、cleanup、部分保存を確認。
- [x] S7 文書・配布・最終引渡し — ownership/architecture/docs/source archive smokeを更新。全testsと`smoke:all`を実行。

## 8. 実行記録

- 実行開始 HEAD: `7b138ae76b6447feae2208fbbbff48035ecf1003`、branch `devel-tiga1023iab`。
- version: `0.3.3` のまま。public runtime exports、依存、Agent Skillや別repositoryは変更していない。
- 元実装: Node.js `v26.12.0` / npm `11.20.0`、`npm test` は4 files / 75 tests、`npm run smoke:all` 成功。
- リファクタリング後: Node.js `v26.12.0` / npm `11.20.0` で `npm test` は9 files / 97 tests、`npm run smoke:all` 成功。Release stagingは従来名/版数で3 artifactsを確認。
- Node.js 22 / 24 の実行環境はこの shell の PATH にないため未確認。browser visual smoke、5 MiB / 20 MiB warningの exact threshold、license reviewも未確認のまま残す。
- `git diff --check` は成功。変更はworking tree上にあり、commit / push / tag / releaseは行っていない。
