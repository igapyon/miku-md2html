# HTML出力改善の実装計画・検証記録（Luna向け）

- 作成日: 2026-11-17。
- 調査時HEAD: `c397569016383c622aae4b187234e56f08a753fd`。
- 調査時branch: `devel-tiga1024uab`、作業ツリーclean、製品版 `0.5.0`。
- 状態: 2026-11-17に実装・ローカル検証済み。未確認条件は末尾に記録。
- 対象: [Issue #8](https://github.com/igapyon/miku-md2html/issues/8)、[Issue #9](https://github.com/igapyon/miku-md2html/issues/9)、[Issue #5](https://github.com/igapyon/miku-md2html/issues/5) の対応済み判定。

## 1. 対象と設計判断

実装は共通coreのHTML生成に置き、CLIとimport runtimeの両方へ適用する。
目次の対象見出し・ID・リンク・本文順序、metadata、診断、画像処理、report schema 2は継続する。
新しい依存やCLI/APIオプション、版更新、GitHub Actions変更は本計画に含めない。
今回の依頼範囲を保つため、別の保守改善やNode対応範囲の拡張は併せて行わない。

## 2. #8: 先頭H1の直後へ目次を配置する

判定対象は、サニタイズ済みarticleの直下にある、ASCII空白だけのtext nodeを除いた先頭ノード。
ASCII空白はspace、tab、LFに限る。`trim()`で全角空白やNBSPまで捨てて判定しない。

| 本文の先頭 | 出力順序 |
| --- | --- |
| 直下のH1 | 同じarticle内でH1 → 目次 → 残りの本文 |
| 段落、H2、引用、div、リスト、非空白テキスト | main直下の目次 → article全体 |
| 目次なし（`toc: false`、`--no-toc`、見出しなし） | article全体だけ |

H1直後の段落を導入文と推測しない。途中や引用・div内のH1は探さない。
front matterやoptionsのtitleと、先頭ノードの判定を結び付けない。
Setext/raw HTML由来でも、最終的に先頭直下がH1なら同じ規則にする。

`html-document.ts`の`renderDocument`で先頭のindexを求める。
H1の場合だけ、そのH1までと残りのHASTをそれぞれ`toHtml`でシリアライズし、
既存の`renderToc`が返す生成済みHTMLを間に置く。
articleを分割したり、H1をarticleの外へ出したりしない。
既存の`renderToc`・heading収集は継続し、タイトルH1も目次に掲載する。
HTML文字列からH1を正規表現で探す実装にはしない。

目次がarticle内に入る場合はarticleの幅に収める。既存CSSとviewer JSを使い、
`article > p:first-of-type`の対象段落やコードコピーの対象を変えない。

## 3. #9: 整形用の連続空行を最大1行にする

### 再現条件

次の入力で、コメント除去後に別々の改行text nodeが隣接し、H1と段落の間にLFが3個残る。
同じ現象は連続するscriptの除去や、div内の要素除去でも起こる。

```md
# Title

<!-- first -->

<!-- second -->

Paragraph
```

`toc: false`で期待するarticle内部は次のとおり。

```html
<h1 id="miku-h-title">Title</h1>

<p>Paragraph</p>
```

「空行1行」はLFが2個という意味。0～2個のLFはそのまま、3個以上を2個へ制限する。

### 対象を決める規則

新しい内部helper `core/html-whitespace.ts`で、シリアライズ用のHASTをコピーして整形する。
元のarticleや画像のpending nodeを変更しない。protected subtreeはそのまま参照してよい。

1. 親がroot、または次の構造コンテナーの場合だけ、その直下の空白を検査する。
   `div`、`blockquote`、`ul`、`ol`、`li`、`table`、`thead`、`tbody`、`tfoot`、`tr`、`td`、`th`、`caption`、`dl`、`dt`、`dd`、`details`。
2. space/tab/LFだけから成る隣接text nodeを、最大の連続区間としてまとめて判定する。
   1ノードずつ置換すると、コメント除去後に残ったLFをまとめられない。
3. 区間の両端が、親の端または次のブロック要素である場合に限り整形する。
   `p`、`div`、`h1`～`h6`、`blockquote`、`ul`、`ol`、`li`、`pre`、`hr`、
   `table`、`thead`、`tbody`、`tfoot`、`tr`、`td`、`th`、`caption`、`dl`、`dt`、`dd`、`details`、`summary`。
4. 内部コンテナーでは少なくとも一方にブロック要素が必要。空白しかないdivなどは内容として保持する。
   シリアライズ用root全体が空白だけの場合は、article境界の整形用空白として扱う。
5. 直前・直後がinline要素、非空白text、その他のノードなら区間全体を保持する。
6. `pre`または`code`に入ったら子孫を走査しない。ハイライト用spanの内側も保持する。
   p、h1、span、a、summary等の本文内にある空白も整形対象にしない。
7. 属性、本文を含むtext node、NBSP・全角空白・CR・form feedを含むtext nodeは変更しない。

区間の文字列に対する置換は`\n(?:[ \t]*\n){2,}` → `\n\n`とする。
最後の改行の後にあるインデントと、最初の改行の前にある空白は残す。
0～2個のLFの区間は、元ノードをそのまま利用できる。
走査は反復処理で行い、新たに入力の深さに依存した再帰を増やさない。

### article境界・容量・安全性

rendererが付けるarticle開始・終了のLFも、仮のtext nodeとして整形用rootに含める。
元ツリーの端のLFだけを2個へ制限してからテンプレートでLFを加えると、再び3個になるため。
H1/目次の前後を分けてシリアライズする場合も同じ規則を使う。
テンプレート側では、すでに断片に含めたarticle境界のLFを重ねて追加しない。

`renderDocument`は容量見積もりと画像埋め込み後の2回呼ばれる。
両方で同じhelperと組立てを使い、断片や最終HTMLをキャッシュしない。
これによりpending画像のsrc更新を最終出力へ反映でき、見積もりと実容量の整形条件も一致する。
`allowDangerousHtml: false`、CSS/JSの閉じタグ対策、scriptのCSP hash計算は継続する。
完成HTML全体への改行置換や、style/scriptの内容の整形は行わない。

## 4. 変更するファイル

| ファイル | 作業 |
| --- | --- |
| `src/ts/core/html-document.ts` | 先頭ノード判定、目次挿入、article境界を含む断片の整形・シリアライズ |
| `src/ts/core/html-whitespace.ts` | 上記の限定した空白整形。内部helperとして追加 |
| `tests/html-output.test.ts` | rendererの構造・保護対象とconverterの実再現入力を確認 |
| `tests/refactoring-contract.test.ts` | 意図したHTML変更に対応するhash/bytesを、意味を確認して更新 |
| `tests/cli.test.ts` | CLI既定と`--no-toc`の配置を確認 |
| `scripts/smoke-cli-bundle.mjs`、`scripts/smoke-runtime-bundle.mjs` | 配布bundleでも配置と空行規則が適用されることを確認 |
| `README.md`、`docs/api.md`、`docs/cli.md` | 利用者向けに目次の配置と空行の扱いを追記 |
| `docs/implementation-spec.md` | REQ-024、REQ-060付近と受け入れケースへ規則を記載 |
| `docs/development.md`、本書 | 実装判断、実行環境、検証結果、未確認条件を記録 |

converterの処理順序、画像処理、公開型、依存構成は変更しない。
新しいhelperを`src/ts/index.ts`から公開しない。

## 5. 回帰テストと合格条件

`hast-util-from-html`は既存のdevDependencyとして利用する。
DOM要素の順序はHTMLを解析して検査し、CSS中のclass文字列やTOCのリンク文字列を本文要素と混同しない。
コードの内容は生成code配下のtextContentを、既知の期待文字列と照合する。

| ID | 入力・状況 | 合格条件 |
| --- | --- | --- |
| L01 | H1 → 段落 → H2 | article直下がH1 → 目次 → 段落 → H2。目次は1個 |
| L02 | 段落 → H1 / H2 → H1 | main直下が目次 → article。本文順序は同じ |
| L03 | 引用・div・リスト内のH1から始まる | 目次はarticleの前。内側のH1を移動しない |
| L04 | H1のみ、Setext H1、raw H1 | 先頭H1直後に目次。articleは1個 |
| L05 | 先頭コメント/除去scriptの後のH1 | サニタイズ後の先頭で判定してH1直後に目次 |
| L06 | `toc: false`、見出しなし、空文書 | 生成目次なし。見出しIDは必要な文書で残る |
| L07 | front matter title / options.title | metadata/titleの優先順位を保ち、本文の配置は先頭要素だけで決まる |
| L08 | 重複見出し、日本語、fragmentリンク | 既存のID、目次掲載対象・順序、hrefが一致 |
| W01 | 連続コメント/連続scriptを段落間から除去 | LF3個以上がLF2個。既存のサニタイズ診断も残る |
| W02 | div内の複数script除去 | 内側のブロック要素間も最大1空行 |
| W02a | caption内の連続コメント/script除去とinline/pre/code | 段落間の空行を最大1行にし、inline間とコード内の連続改行を保持 |
| W03 | 別々の空白text node、space/tabのある空行 | 区間全体を制限。末尾のインデントは保持 |
| W04 | 0、1、2個のLF | 元の文字列を保持 |
| W05 | 強調/span/リンク間、p内soft break、hard break | 本文テキストと意味のある改行を保持 |
| W06 | raw pre/code、inline code、色付け済み/通常fence | 3個以上の改行、tab、日本語、先頭末尾の空白を保持 |
| W07 | NBSP・全角空白、text混在、属性の改行 | 元の内容を保持。非ASCII空白を構造空白扱いしない |
| W08 | 先頭/末尾の要素除去、H1のみ、TOC挿入境界 | article境界と目次前後にも連続する空行を作らない |
| I01 | 同じHASTを2回render、render前後の構造比較 | HTML同一、入力ツリー不変 |
| I02 | TOC有効、空行整理、embed画像の組合せ | 実bytesちょうどの上限で成功、1 byte未満で失敗 |
| I03 | 画像埋め込み・容量見積もり | 最終画像がplaceholderにならず、超過時の事前停止も既存どおり |
| I04 | CSP、同一入力の再変換 | hashが実scriptに一致、同条件のHTML bytesが一致 |
| I05 | CLI、単体CLI/runtime bundle | L01、L06、W01、W06を主要経路で確認 |

全HTMLに`\n\n\n`がないという検査は使わない。コード内の改行も誤って禁止してしまう。
空白の正例/負例は小さなHASTと実Markdown入力の両方で確認する。
既存snapshot4件のうち、先頭H1のある2件はhash/bytes変更が想定される。
見出しなしの画像・コード例が変わった場合は、更新する前に理由を調べる。
metadata、診断、headingCount、画像統計の差をsnapshot更新で隠さない。

## 6. #5: 対応済み根拠と引き継ぎ

`2a872b7`（PR #6、現HEADに取り込み済み）で直接依存を14個から11個へ削減済み。
`image-size`と`lowlight`はlockfileからも除去済み。
`unist-util-visit`は直接利用を置換済みで、remark/rehype経由の推移依存として残る。
11個の残置理由と開発/テスト依存の用途は[runtime-dependencies.md](runtime-dependencies.md)にある。
Issueには、依存ゼロが妥当でない場合は技術的理由を記録するという完了条件がある。
現状はその条件に沿うため、追加のパーサー置換や依存削減は実施しない。

[development.md](development.md)に記録された延期事項はNode 22/24での検証。
Node 26の成功をNode 22/24の確認済みとは扱わず、既存TODOを継続する。
調査時（実装前）にはNode 26.12.1で124 tests、bundle生成、CLI/runtime smokeが成功した。

GitHub上の#5はOpenのまま。クローズする際は、この根拠と実際の検証結果を添えて
miku-scmのIssue操作を別途進める。本書や実装依頼はIssue書き込みのapprovalを兼ねない。
#8/#9も、ローカル実装とGitHub上の完了状態を区別して報告する。

## 7. 実装・検証の順序

1. `git status -sb`と対象HEADを再確認し、既存の変更を保全する。
2. 再現入力と配置・空白の回帰テストを追加する。
3. 空白helperとrendererの変更を実装し、焦点を絞ったテストを通す。
4. snapshotの差を確認して、意図したhash/bytesだけを更新する。
5. CLIとbundle smokeに主要な受け入れ確認を加え、仕様・利用者文書を更新する。
6. 次のコマンドを順に実行する。

```sh
npm run build
./node_modules/.bin/vitest run tests/html-output.test.ts tests/core.test.ts tests/syntax-highlight.test.ts tests/refactoring-contract.test.ts tests/cli.test.ts
npm test
npm run build:bundle
npm run smoke:bundle
npm run smoke:runtime
git diff --check
git status -sb
```

失敗時は原因を修正し、影響する検証を再実行する。成功後に同じ検証を理由なく繰り返さない。
既存の`release-assets/`はこの検証では再生成しない。
Chromeの`file://`では先頭H1/非H1、目次開閉、JS無効、320px幅、印刷を確認し、
実際に確認できた条件・browser版だけを結果へ記録する。
利用できないNode/browser条件は未確認として残す。
最後にdiff全体を読み、依存構成、source image、CLI/API契約に意図しない変更がないことを確認する。

## 8. 実装・検証結果

- `html-document.ts`と新しい`html-whitespace.ts`に実装した。converterの処理順序や画像pending nodeを変えず、両方のrenderで作業用ツリーを作る。
- 先頭H1、非H1、入れ子H1、Setext/raw H1、title override、no-TOC、空文書を確認した。
- コメント/script除去後の空行、構造コンテナー内、隣接text node、space/tab、article/目次境界を確認した。
- pre/codeとその子孫、inline境界、段落のsoft/hard break、属性、NBSP/全角空白/CR/form feedが保持されることを確認した。
- embed画像を含めて実出力bytesちょうどで成功し、1 byte少ない上限で失敗することを確認した。元HAST不変とscript/CSP hashも確認した。
- Node `v26.12.1`、Vitest `4.1.12`で`npm test`成功（11 files / 159 tests）。初回の型エラーを修正し、意図したsnapshot2件のhash/bytesだけを更新した後の結果。
- `npm run build:bundle`、`npm run smoke:bundle`、`npm run smoke:runtime`成功。bundleは一時ディレクトリへコピーして実行し、今回の配置・空行・コード保持も確認した。
- 既存snapshotの元hashと一致する旧bundle出力を保存して新出力と比較し、先頭H1のある2例の差が目次移動・整形空白だけであることを確認した。見出しなしの画像・コード例のsnapshotは変更していない。
- 比較用HTMLとpreviewはignoredの`workplace/html-output-review-20261117/`に置いた。
- 依存構成・製品版・report schema・viewer CSS/JSは継続。#5の11個の直接依存と208件のlockfile notice inventoryに変更はない。
- Node 22/24の実行確認は引き続き未実施。Chrome操作ツールは`Browser is not available: chrome`を返したため、今回のChrome目視・JS無効・320px・印刷確認は未実施。
- GitHub上のIssue更新・クローズ、stage/commit/pushは実施していない。

## 9. 自己レビュー指摘への対応

- `caption`内の段落間に置いたコメント/scriptを連続して除去すると、LF3個が残ることを確認した。構造コンテナーの一覧に`caption`がなかったため、対象に追加した。
- コメントとscriptの2ケースを回帰テストに追加し、修正前の失敗と修正後の成功を確認した。caption内のinline要素間、pre/code内の連続改行を保持するテストも追加した。
- Node `v26.12.1`で`npm test`成功（11 files / 162 tests）。`npm run build:bundle`、`npm run smoke:bundle`、`npm run smoke:runtime`も成功した。再生成したruntimeでもコメント/script両方のcaption再現例が最大1空行になることを確認した。
