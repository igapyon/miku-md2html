# シンタックスハイライト実装計画（Luna向け）

- 作成日: 2026-10-23
- 状態: 実装完了。実行結果は末尾の「実装記録」を参照。
- 対象: miku-md2html の Node CLI と共通変換runtime
- 調査時のHEAD: 44aa973（Merge pull request #2 from igapyon/devel-tiga1022wac）
- 調査時のpackage/runtime version: 0.3.1
- 調査開始時の作業ツリー: clean
- 実装担当: Lunaなど、以下の手順を順番に実行する担当者

この計画を作る作業では、依存追加、製品コード変更、テスト追加、ビルド、テスト実行を行っていない。既存parserのsource位置保持についてだけ、メモリ内の読み取り専用調査を行った。

## 1. 目的と合意済みの範囲

言語が明示されたMarkdownのfenced code blockを、変換時に色分けする。生成HTMLは単独でオフライン閲覧でき、JavaScriptが無効でも色分けが見える。

対象は次の13系統。HTMLとXMLは同じgrammarを使うため、エンジンに登録するgrammarは12個になる。NodeとECMAScriptはJavaScriptの別名、PatchはDiffの別名として扱う。

| 文書上の言語 | 正規ID | 受理する言語名（この表で固定） | 使用grammar |
| --- | --- | --- | --- |
| Markdown | markdown | markdown, md | markdown |
| Java | java | java | java |
| JavaScript / ECMAScript / Node | javascript | javascript, js, ecmascript, node, nodejs | javascript |
| TypeScript | typescript | typescript, ts | typescript |
| Python | python | python, py, python3 | python |
| CSS | css | css | css |
| HTML | html | html, htm | xml |
| XML / SVGソース | xml | xml, svg | xml |
| JSON | json | json | json |
| Shell / Bash | bash | shell, sh, bash | bash |
| YAML | yaml | yaml, yml | yaml |
| Diff / Patch | diff | diff, patch | diff |
| PowerShell | powershell | powershell, pwsh, ps1 | powershell |

言語名はtrimし、最初の空白区切りtokenをlocale非依存で小文字化して照合する。fenceのmeta（例: title=sample）は表示や動作に使わない。aliasはアプリ側の固定Mapを唯一の受付表とし、ライブラリが持つその他のaliasを自動的に公開しない。

SQL、Dockerfile、TOML、C/C++、C#、Go、Rust、PHP、Ruby、JSX/TSX、JSONC/JSON5、Zsh固有構文は初期対応表に追加しない。指定されても通常のコードとして表示する。SVGのコードブロックはXMLのソースを表示し、画像へ変換しない。

Shell/BashはBash grammarによる色分けであり、POSIX shellなどの構文検証を保証する意味ではない。

## 2. この計画で補う実装上の決定

会話で決まった対応範囲を実装可能にするため、以下を計画の初期方針とする。

1. 対応言語が明示されたfenceは標準で色分けする。新しいCLIフラグ、runtime option、front matter fieldは追加しない。
2. コードブロック単位の言語自動推定は行わない。言語なし、未知言語、text / txt / plaintext / none / nohighlightは警告なしで通常表示とする。
3. バッククォートとチルダの両方のfence、list/blockquote内のfenceを対象にする。inline code、言語なしのindented code、入力HTML由来のpre/codeは対象外。
4. 既存のMarkdown正規化・解析後のコード文字列を保持する。CRLF→LF、fenceのindent処理、rendererによる末尾LFの規則を変更しない。「入力Markdown全体のbytesと一致」ではなく「従来のcode.textContentと一致」が条件。
5. 色分けは表示補助とする。対応言語でsyntaxが不完全でもコンパイルや構文検証を行わず、変換エラーにしない。
6. HTML内のscript/styleなど、選択grammar自身が扱う部分構文の色分けは許す。ここでの「自動推定なし」は外側のcode blockの言語を推定しないという意味。内部部分構文でも未登録grammarを通信・動的importで取得しない。
7. コピーは既存のcode.textContentを使い続ける。色分け用span、SVGボタン、行番号、表示ラベルをコピー内容に混ぜない。
8. 行番号、言語ラベル、コード編集、実行、折り返し切替、Mermaid・数式の描画は追加しない。

### 2.1 色分け処理の資源上限（本計画の初期値）

既存の最終HTML容量制限とは別に、追加する色分け処理だけに次の固定上限を設ける。これは今回の計画で補った初期値であり、従来からの既定値ではない。実装時に仕様書へ理由とともに記載する。

- 1ブロック: code.textContent相当のUTF-8 bytesが256 KiB以下。
- 1文書: エンジンへ渡すコードの累計が1 MiB以下。
- 境界値ちょうどは処理する。1 byte超えたらそのブロックを通常表示にする。
- 空ブロックは処理も累計加算も不要。
- 1ブロック上限でskipした分は累計に入れない。次の小さいブロックは処理できる。
- 文書の残量に収まらないブロックはskipし、後続で残量に収まるものは処理できる。
- エンジンを呼んだ分は、結果が例外になっても累計へ加算する。
- 判定順は文書source順とする。
- この制限は処理量の抑制であり、正規表現処理の実行時間に対する厳密なtimeout保証ではない。

skipしたコード本文は保持し、次の診断を1ブロックにつき1件出す。

| code | severity | 条件 | details |
| --- | --- | --- | --- |
| W_CODE_HIGHLIGHT_SKIPPED | warning | block上限または文書budget超過 | reason: block-size / document-budget, bytes, limit |
| W_CODE_HIGHLIGHT_FAILED | warning | エンジン呼び出し例外、token tree不正、本文不一致 | language: 正規ID |

診断messageは既存方針に合わせ英語とする。コード本文、例外stack、入力由来の不審な言語名をそのままmessageへ含めない。sourceはfenceの位置を使い、front matterのlineOffsetを既存helperで加える。警告だけならCLIはexit 0とする。未知言語はこれらの警告の対象ではない。

## 3. 採用する実装方式と依存

lowlightでHASTのtoken treeを生成し、highlight.jsの必要なgrammarだけを明示登録する。HTML文字列を返すAPIやブラウザー実行用highlighterは使わない。

採用予定の固定版:

| 区分 | package | 版 | 用途 |
| --- | --- | --- | --- |
| runtime dependency | lowlight | 3.3.0 | 文字列をtoken HASTへ変換 |
| runtime dependency | highlight.js | 11.11.1 | 上記12個のgrammarを個別import |
| dev dependency | @types/mdast | 4.0.4 | Markdown ASTの型を直接参照 |
| dev dependency | hast-util-from-html | 2.0.3 | テストで生成HTMLをASTとして読む |

lowlight 3.3.0はhighlight.jsの~11.11.0を依存として宣言しており、上記の組合せはその範囲に収まる。[固定tagのpackage定義](https://github.com/wooorm/lowlight/blob/3.3.0/package.json)
lowlightがHASTを返し、grammarを明示登録できることは[公式API](https://github.com/wooorm/lowlight/blob/3.3.0/readme.md)で確認済み。

highlight.jsは直接個別grammarをimportするため、lowlightの推移依存だけに頼らず直接dependencyとしても宣言する。lowlightのall/commonを登録しない。highlight.js本体の全言語入口やcommon入口もimportしない。

- lowlight: MIT
- highlight.js: BSD-3-Clause
- ライセンスの実体と表示義務は固定版の配布物を確認し、既存notice生成処理へ反映する。
- 版は「最新」とは主張しない。本計画で調べたAPIと依存範囲の再現用固定版である。
- 実行開始時にnpm registryのmetadataと依存auditを確認する。指定版が取得不能、Node 22/24と非互換、または追加dependencyに要対応の問題が出た場合は、無断で別majorや別エンジンへ切り替えず根拠を記録して扱いを判断する。

## 4. 現行コードで押さえる場所

| 現在のfile / 関数 | 状態と今回の意味 |
| --- | --- |
| src/ts/core/converter.ts / convertMarkdownToHtml | CLIとruntimeが共有する変換入口。ここへ組み込む |
| 同 / processor.parse → processor.run | Markdown ASTからHASTを作る。parse後・run前に言語情報を採取できる |
| 同 / sanitizeProperties | 入力由来classNameを出力へ残していない。language-*を読む方式では言語情報を失う |
| 同 / sanitizeTree | 元のpositionをcopyしている。位置情報を使ってMarkdown fenceを識別できる |
| 同 / articleSanitizeSchema | code/spanの任意classを通さない。今回も入力classの許可を広げない |
| 同 / rehypeSanitize後 | 入力HTMLが安全なtreeになった後。ここから内部生成tokenを付ける |
| 同 / skeleton = renderDocument | 最終HTMLの容量見積り開始。色分けはこの前に完了させる |
| src/viewer/theme.css | Material風のlight/dark/print CSSの編集元 |
| src/viewer/viewer.viewer | code.textContentをコピーするSVGボタン。色分け処理はここへ入れない |
| scripts/generate-viewer-assets.mjs | CSS/JSの生成入口。生成済みviewer-assets.tsを手編集しない |
| scripts/build-bundles.mjs | esbuildでCLIとruntimeを独立した単一fileへbundle |
| scripts/generate-third-party-notices.mjs | lockfileとインストール済みlicenseからnoticeを生成 |
| tests/core.test.ts / tests/cli.test.ts | 既存の契約テスト |
| scripts/smoke-cli-bundle.mjs / smoke-runtime-bundle.mjs | repo外へコピーしたbundle単体の動作確認 |

調査では、既存remark→rehypeRaw→rehypeSanitizeの処理で、fenceのMDAST CodeとHAST codeのstart/end offsetが一致し、raw HTMLのcodeは別offsetを持つことをメモリ上のサンプルで確認した。現行rendererは非空Code.valueへLFを1つ足し、空codeは空文字にしている。実装ではこの位置保持を統合テストでも固定する。

## 5. 追加する内部moduleと処理順

### 5.1 src/ts/core/code-languages.ts（新規）

役割は言語受付表だけとする。

- LanguageId: 上表の13個の正規IDのunion。
- GrammarId: 上表の12個のgrammar IDのunion。
- resolveCodeLanguage(lang): 正規IDとgrammar IDを返す。未知・未指定・plain指定ならundefined。
- 外部入力をobjectのprototype経由で引かない。Mapを使う。
- ファイル名、本文、info stringのmetaから言語を推測しない。
- registryとaliasの内容をアプリのpublic exportへ追加する必要はない。

### 5.2 src/ts/core/syntax-highlight.ts（新規）

内部interfaceの形:

~~~ts
type CodeBlockSource = {
  language: LanguageId;
  grammar: GrammarId;
  startOffset: number;
  endOffset: number;
  text: string;
  position: Code['position'];
};

declare function collectCodeBlockSources(mdast: MdastRoot): ReadonlyMap<number, CodeBlockSource>;

declare function applySyntaxHighlighting(
  tree: HastRoot,
  sources: ReadonlyMap<number, CodeBlockSource>,
  diagnostics: Diagnostic[],
  lineOffset: number,
): void;
~~~

必要なtypeはtype-only importとする。上記は実装するinterfaceの設計図であり、この計画書自体をコード生成器にしない。

collectCodeBlockSourcesの処理:

1. MDASTのtype=codeをvisitする。
2. langが上表に一致し、start/end offsetがあるものだけMapへ記録する。
3. textは既存rendererと同じく、非空valueならvalue + LF、空なら空文字とする。
4. source位置はfront matterを除いた本文を基準に保存する。bodyStartOffsetはここで加算しない。

applySyntaxHighlightingの処理:

1. highlighterは選定した12grammarだけを固定順で登録したinstanceを使う。registry設定は変換要求ごとに変更しない。
2. 文書のsource順でpre直下のcodeを確認する。codeのstart/end offsetとMapが一致し、text内容も保存値と一致するものだけ対象にする。
3. codeの子がtextだけであることを確認する。position欠落やMap不一致のraw HTML codeへは色を付けない。既知sourceに一致するのに本文が異なる場合はFAILEDとして通常表示を維持する。
4. 空codeを除き、bytesと文書budgetを判定する。
5. lowlight.highlight(grammar, text)を呼ぶ。アプリからhighlightAutoを呼ばない。
6. 返されたHASTをそのまま混ぜず、textとspanだけを新しいnodeへ再構築する。
7. spanのpropertiesはclassNameの安全なASCII class token配列だけとする。tokenは英字またはunderscoreで始まり、残りは英数字/underscore/hyphenだけ、1個64文字以下。その他の属性は引き継がない。不正なnodeやclassなら全体をFAILEDへ戻す。
8. 再構築した全textの連結が元textと完全一致することを確認してから、code.childrenを置換する。
9. 成功時にcodeへ内部生成classとしてmiku-md2html-highlightとlanguage-正規IDを付ける。生成classへ入力langを直接連結しない。
10. 例外を捕まえる範囲はhighlight呼び出しとtoken検証に限る。入力読取、画像、serializerなどの例外をまとめて飲み込まない。
11. fallbackでは元code.childrenとpropertiesをそのまま維持し、理由に応じたwarningを出す。

token scopeはlowlight標準のhljs-*を用いる。function_などの補助classや部分構文用classも前述の安全な形なら保持できる。ただし、ライブラリが出すタグや属性を無条件で許可する実装にはしない。

### 5.3 converter.tsへ入れる順序

~~~text
normalizeSource
→ parseFrontMatter
→ processor.parse(frontMatter.body)
→ collectCodeBlockSources（MDASTから言語と位置を採取）
→ processor.run（既存Markdown→HTML AST処理）
→ sanitizeTree / 見出し / fragment / metadata（既存）
→ rehypeSanitize（既存allowlist）
→ pending image nodeの再対応付け（既存）
→ 既存hasErrorsの判定
→ applySyntaxHighlighting（安全なtreeへ内部生成tokenを追加）
→ skeleton = renderDocument
→ 画像payloadを含む容量preflight
→ 実画像読取 / 埋め込み
→ 最終renderDocument / 実bytes上限判定
~~~

parseを2回行わない。色分けも2回行わない。元コードの退避Mapとbyte budgetはconvert呼び出しごとに作る。highlighterの登録状態へ文書内容を保存しない。

内部生成tokenをsanitizerの後へ追加する代わりに、上記のtoken再構築で信頼境界を閉じる。入力HTMLのclass/style/event属性を許可する変更で対応しない。

色分けによるspanとCSSを含む実サイズが、既存の事前見積りと最終bytes判定の両方に入る順序を守る。

## 6. CSSの仕様

src/viewer/theme.cssだけを色定義の正本にする。ライブラリ配布themeをそのまま追加せず、現在の淡い背景・藍色の設計に合わせる。

selectorはpre > code.miku-md2html-highlightと、その内部のtokenに限定する。一般のspan、本文、inline codeへ影響させない。

初期の色案:

| 役割 | light | dark | 主なtoken |
| --- | --- | --- | --- |
| keyword | #5263a6 | #b4c2ff | keyword, selector-tag, doctag |
| string | #2f6b48 | #a5d6ac | string, regexp |
| number | #805313 | #e5c07b | number, literal |
| name | #6f4b85 | #d9b4e7 | title, section, type, built_in, attr, attribute, variable |
| comment | #5d606b | #b9bdc7 | comment, quote |
| addition文字 / 背景 | #2f6b48 / #e6f0e8 | #a5d6ac / #203c2c | addition |
| deletion文字 / 背景 | #993f43 / #f8e7e7 | #f0b1b5 / #462a2d | deletion |

- rootで--syntax-*変数を定義し、dark media queryで役割を維持して差し替える。
- 実際のpre背景色に対する文字contrastを4.5:1以上で確認する。満たさない色は同じ色相の明暗を調整して記録する。
- 未定義tokenは通常のcode色を継承する。
- strong/emphasisのtokenには太字/italicを使い、本文やcode全体のfontは変更しない。
- Diffは元の+ / -を残し、addition/deletionの色と薄い背景を補助に使う。
- printではtokenの文字を黒系へ統一し、token背景は透明にする。Diffの+ / -は残る。
- 既存のコード枠、局所横scroll、SVGコピーボタンの見た目を保つ。

## 7. Lunaの実行手順

各段階の確認が済んでから次へ進む。実行時点のHEADが変わっていたら、関係fileを再読し、関数位置の違いをこの設計に合わせる。行番号だけに依存してpatchしない。

### S0: 現状と前提を記録する

読むfile: README.md、TODO.md、本計画、docs/implementation-spec.mdのREQ-020〜026/061〜066、docs/api.md、package.json、converter.ts、theme.css、既存テスト、bundle/smoke script。

実行:

~~~sh
git status --short
git rev-parse HEAD
node --version
npm --version
~~~

- 開始前からの差分を記録する。無関係な差分を戻さない。
- Node 22/24のruntimeが使えるか確認する。現在の既存記録ではNode 26での実行が中心で、22/24の確認が残っている。
- node_modulesがなければ既存lockfileでnpm ciを行う。実装前のnpm testを1回実行し、既存失敗があれば記録して今回の変更に起因する失敗と区別する。
- 変更前の測定をここで済ませる。§8の代表例を含む同一のMarkdownをworkplace/syntax-highlighting-baseline.mdへ用意し、npm run build:bundleで現行bundleを作る。runtimeをimportしてそのMarkdownの変換時間・HTML bytesを測り、CLI/runtime bundleのfile bytesとともにworkplace/syntax-highlighting-baseline.jsonへ保存する。fixtureの内容と測定環境も残す。
- S2で追加するtracked fixtureはこのbaseline入力と同じ内容にする。baselineの生成HTMLはworkplaceへ置く。S5の変更後測定でも同じ入力と測定方法を使う。
- 今回の保守はこの機能に範囲を絞り、無関係なMaintenance Upliftの追加採用は行わない。
- この段階ではversion、GitHub Actions、release、Git操作の方針を変えない。

### S1: 固定依存を追加する

まずregistryのmetadataと版を確認する。以下は将来の実装時に実行するコマンドであり、計画作成時には実行しない。

~~~sh
npm view lowlight@3.3.0 version dependencies license --json
npm view highlight.js@11.11.1 version engines license --json
npm install --save-exact lowlight@3.3.0 highlight.js@11.11.1
npm install --save-dev --save-exact @types/mdast@4.0.4 hast-util-from-html@2.0.3
npm ls lowlight highlight.js
npm audit --omit=dev
~~~

合格条件: 直接依存とlowlight内部で使うhighlight.jsが同じ11.11.1へ解決され、lockfileに固定される。依存監査の結果は記録し、既存の無関係な依存更新を混ぜない。

### S2: 言語解決と色分けmoduleを作る

変更file:

- src/ts/core/code-languages.ts（追加）
- src/ts/core/syntax-highlight.ts（追加）
- tests/syntax-highlight.test.ts（追加）
- tests/fixtures/syntax-highlighting.md（追加）

最初にalias表と13系統の代表例をテストへ用意し、§5のmoduleを実装する。代表例はすべてtokenが実際に付く内容にする。単にgrammarが登録されているだけの確認では不十分。

個別grammar importの例:

~~~ts
import { createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
~~~

登録する12個はxml、css、javascript、typescript、java、python、json、bash、yaml、diff、powershell、markdown。必要なgrammar importをこの一覧から展開する。

確認:

~~~sh
npm run build
./node_modules/.bin/vitest run tests/syntax-highlight.test.ts
~~~

合格条件: aliases、13系統、未知言語、token本文一致、資源上限、highlighter失敗時のfallbackが単体で確認できる。

### S3: 共通converterへ組み込む

変更file:

- src/ts/core/converter.ts
- tests/core.test.ts（必要な既存assertionのみ）
- tests/syntax-highlight.test.ts（converter統合を追加）

§5.3の順序を適用する。診断codeはDiagnostic.codeがstringであるため、そのまま追加できる。warningをAssetAccessErrorのunionへ追加する必要はない。

CLI adapter、ConvertOptions、report schema、statsへ今回専用fieldを追加しない。

確認:

~~~sh
npm run build
./node_modules/.bin/vitest run tests/syntax-highlight.test.ts tests/core.test.ts
~~~

合格条件: 入力の危険なHTMLが従来通り除去され、内部生成tokenは残る。raw HTML codeには色が付かない。容量preflightにtokenの増分が入る。

### S4: themeへ色を追加する

変更file:

- src/viewer/theme.css

§6の範囲にCSSを追加する。src/viewer/viewer.viewerにhighlighterを追加しない。既存のcode.textContentコピーでspan内の本文を正しく取得できる設計なので、動作上の理由がなければviewer scriptは変更不要。

生成されるsrc/ts/generated/viewer-assets.tsは手編集しない。

確認:

~~~sh
npm run build
~~~

合格条件: light/dark/printの定義が同じ正本から生成される。コピー領域、scroll、既存のinline code表示が保たれる。

### S5: CLI/runtimeと配布物を確認する

変更file:

- tests/cli.test.ts（色分け済み出力とwarning成功を確認）
- scripts/smoke-cli-bundle.mjs
- scripts/smoke-runtime-bundle.mjs

smoke用Markdownへ、少なくともJavaScript、Java、PowerShell、HTML、Diffのfenceを追加する。repo外へコピーした単体CLI/runtimeから色分け済みHTMLを生成できることを確認する。外部node_modules参照、grammar fileの後読み、CDN参照が不要であることが条件。

計測は同じfixtureと同じ環境で、変更前のCLI/runtime bundle bytes、変更後bytes、生成HTML bytes、変換時間を記録する。bundle増分と生成HTML増分を混同しない。

esbuildの解析が必要な場合は、既存設定に一時的にmetafileを有効化して、各output.inputsのbytesInOutputが正のgrammarだけを調べる。metafile.inputsに載っただけで「全grammarをbundleした」と判断しない。unsupported grammarが実出力へ混ざっていたらimportの仕方を修正する。恒久的な新しいbundle方式やブラウザー用bundleは作らない。

依存追加後のnotice生成:

~~~sh
npm run licenses
~~~

THIRD_PARTY_NOTICES.mdの差分を見て、追加packageのlicense識別子と本文を確認する。ライセンスの記録を空欄にして完了としない。

### S6: 仕様書・説明を実装と揃える

変更fileと内容:

| file | 作業 |
| --- | --- |
| README.md | 「syntax highlightingなし」の説明を置換し、対応言語・fallback・offlineを説明 |
| docs/implementation-spec.md | REQ-022を更新。コード本文保持、alias表、fallback、生成tokenの信頼境界、資源上限、warningを記載 |
| docs/implementation-spec.mdの受け入れ表 | この計画のH01〜H16相当の受け入れ条件を追加。既存IDを重複させない |
| docs/api.md | 既存convert関数で標準適用されること、追加option不要、warningと上限を説明 |
| docs/cli.md | 対応fenceの標準色分け、unknownは通常表示、skip/failureはwarning成功と説明 |
| docs/development.md | 依存版・方式・検証環境と結果・残った確認を記録 |
| TODO.md | 今回の未実施確認だけを追記。無関係な既存項目を完了扱いにしない |
| THIRD_PARTY_NOTICES.md | 手編集ではなく既存generatorの結果を反映 |

この計画の状態欄は「実装済み」と先に変更せず、最後に実装commitと検証記録へのリンクを付ける。過去のcompletion記録は当時の事実として残す。

### S7: 最終確認と引き渡し

順番に実行する:

~~~sh
npm test
npm run smoke:all
git diff --check
git status --short
git diff --stat
~~~

npm testはbuildと全unit/CLI test、smoke:allはCLI/runtimeのbundle再生成・repo外smoke・release staging確認を含む。成功したチェックを理由なく何度も繰り返さない。失敗後の修正は関係するfocused testから確認し、必要な最終gateを再実行する。

- 計画時点ではpublic release、push、commit、tag、version incrementをこのfeature実装へ混ぜない方針だった。実行中にversionを`0.3.2`へincrementし、featureとともにcommit `34141b4`として作業branchへ記録された。push、tag、public releaseは行わない。
- GitHub Actionsの新規追加やCI baseline変更は行わない。
- diffを確認し、関係するmodule・CSS・tests・docs・lockfile・notices以外の差分は元からあったものか説明できる状態にする。

## 8. 受け入れテストの具体例

生成HTMLを調べるtestではhast-util-from-htmlのfromHtmlを使い、pre直下codeを抽出する。spanを正規表現で除去して本文を復元する方法を使わない。text nodeを再帰連結して比較する。

| ID | 入力・条件 | 必須の結果 |
| --- | --- | --- |
| H01 | 13系統それぞれのtokenが付く代表例 | 全件成功。code配下に内部生成markerとspanがある |
| H02 | alias表の全項目、大小文字混在 | 同じgrammarへ解決。出力language classは正規ID |
| H03 | 未指定、plain各alias、未知言語、SQL、JSX/TSX、JSONC、constructor、__proto__、不審なinfo token | 通常表示。色分け専用warningなし。info tokenをHTML属性へ直接出さない |
| H04 | backtick/tilde fence、list/blockquote内、meta付き | 正しいブロックだけ色が付く。metaをHTML属性へ出さない |
| H05 | inline code、indented code、raw pre/code、raw spanにhljs-* | 対象外。入力由来class/event/styleは既存どおり除去 |
| H06 | HTML/XML/SVG/JSコード内のscript、終了tag、onerror、&、引用符 | すべてコード文字列。code内部にspan以外の要素、href、src、style、event属性が生まれない |
| H07 | tabs、Unicode、日本語、空行、先頭末尾space、LF、CRLF、空fence | 従来rendererのtextContentと完全一致。空fenceは空のまま |
| H08 | YAML front matter付き、見出し付き、raw HTML code混在 | position対応が保たれ、warningの行位置がfront matter分だけ正しく補正される |
| H09 | 同じ入力を2回、別の文書を挟んで再変換 | HTML bytesと診断が一致。文書間でtoken/budgetの状態が漏れない |
| H10 | highlighter例外、偽token node、本文不一致をmockで再現 | 通常コードを保持しW_CODE_HIGHLIGHT_FAILED。入力本文やstackは診断へ出さない |
| H11 | block上限ちょうど/1byte超、文書budgetちょうど/1byte超 | 境界ちょうどは処理。超過blockはSKIPPED。多byte文字もUTF-8 bytesで判定 |
| H12 | 上限skipの後に小さいcode、失敗blockの後に次のcode | §2.1通りの累計管理。後続へ予期しない影響がない |
| H13 | code-onlyの生成HTML bytes上限ちょうど / 1byte小さいcap | ちょうどは成功、cap超過はE_OUTPUT_TOO_LARGE。失敗時HTMLなし |
| H14 | supported fenceとplain版で出力差が出る文書＋local画像 | 両者の出力サイズ間にcapを置くと、色分け分を含むpreflightで失敗し画像readを呼ばない |
| H15 | HTMLのscript/CSP、埋め込みCSS、no-toc、画像、footnotes | 既存の正本・安全性・機能の契約が保たれる。CSPのscript hashが実scriptと一致 |
| H16 | source CLI、repo外へコピーしたCLI/runtime、JSON report | 色分け済み出力。skip警告でも保存成功ならexit0/success:true。FAILED時のcore成功はH10のmockで確認。reportに新規必須fieldを増やさない |

H07の比較基準は、正規化したMDAST Code.valueを既存handlerの規則でtextへ変換した値とする。highlighterの戻り値を期待値に使わない。

H10はmodule内部だけで使うtokenizer引数を差し替え、例外・不正HASTを再現する。テスト用のpublic option/APIは追加しない。この実装では`SyntaxTokenizer`型と内部関数引数をテストから使用し、runtimeの公開indexへexportしない。

H14はまず余裕のあるcapでsupported版/plain版の実出力bytesを取得し、その間に十分な差があるcapを設定する。asset MIME prefix等の既存見積り差より余裕を持つfixtureにし、厳密な1byte境界の確認はH13へ分ける。

代表fixtureには次を入れる:

- Java: classと文字列
- JavaScript/TypeScript: const、function、型注釈、文字列
- Python: def、return、文字列
- CSS: selector、property、値
- HTML/XML: tag、属性、comment。HTMLにはscript/styleのサンプルも置く
- JSON/YAML: key、文字列、数値、boolean
- Shell: 変数、文字列、command
- PowerShell: param、変数、Write-Output
- Diff: header、@@、追加行、削除行
- Markdown: heading、emphasis、link

## 9. Chromeでの確認と性能記録

自動テストとは別に、代表fixtureからworkplace/syntax-highlighting.htmlを生成してChromeのfile://で確認する。

1. light/darkで文字と背景のcontrast、薄いコメント、長い行の局所scrollを見る。
2. JavaScript無効でも色分け済みコードが見えることを確認する。
3. JavaScript有効でSVGコピー操作を行い、clipboard成功または既存の手動copy fallbackの選択内容がcode.textContentと一致することを確認する。
4. 320px幅で本文全体が横へはみ出さず、code内部だけがscrollすることを見る。
5. print previewでtoken背景が消え、本文が読め、コピー操作が非表示になることを見る。
6. ハイライトのための通信や外部script/font/styleの読込が発生しないことを確認する。

Chromeの操作手段が使えない場合は「未実施」と記録し、実施済みと表明しない。ブラウザー操作環境の導入・変更をこの実装へ混ぜず、他の確認は進める。

性能測定は通常例、256 KiB付近の対応code、上限超のfallback、累計1 MiB付近の複数blockで行う。時間とpeak RSS、生成HTML bytes、Node/OS情報を記録する。host依存の厳密な時間assertionをunit testへ入れない。極端な遅延や出力増分が見つかった場合は原因を確認し、上限を黙って変えない。

Node 22/24で確認できた結果と、Node 26等でしか確認できなかった結果は分けて記録する。利用できないruntimeを理由にenginesを引き上げない。

## 10. 完了条件と実行担当への指示

実装の完了報告には、変更内容、§8の結果、CLI/runtime smoke、依存/notice、性能記録、Chrome確認、Node 22/24の実施状況を記載する。未実施項目は残件として明示する。特にChromeと対象Node版の未実施を「全環境で確認済み」と表現しない。

次の条件をすべて満たすこと:

- [x] 13系統とalias表が実装・仕様・testで一致する。
- [x] 入力由来classの許可を広げず、内部生成spanだけで色分けできる。
- [x] コード本文とコピー対象を保持する。
- [x] 自動推定なし・未知言語の通常表示・警告fallbackが仕様どおり。
- [x] 追加tokenを含む容量判定が画像読取前と最終出力で働く。
- [x] light/dark/printのCSSが正本から生成される。
- [x] npm testとnpm run smoke:allが成功する。
- [x] CLI/runtimeがrepo外へコピーされても単独で使える。
- [x] 追加依存の固定版とlicense noticeを記録する。
- [x] ChromeとNode 22/24の実施済み・残件が明記される。
- [x] `0.3.2`へのversion incrementとsyntax highlighting実装がpackage/lock/runtimeで一致し、commit `34141b4`に記録される。push、tag、公開操作は行わない。

Lunaへ渡す開始指示の例:

> docs/syntax-highlighting-plan.mdを読み、S0からS7まで順に実装してください。13系統と固定alias、sanitize後のtoken追加、通常表示fallback、コード本文保持を契約として扱ってください。各段階の確認が通ってから次へ進み、失敗はその段階で解消してください。利用できないChromeやNode版の確認は未実施と記録し、実施済みと主張しないでください。無関係な差分は保持し、commit・push・release・version変更は行わないでください。

## 11. 調査した一次資料

- [lowlight 3.3.0 APIとHAST出力](https://github.com/wooorm/lowlight/blob/3.3.0/readme.md)
- [lowlight 3.3.0依存とMIT license宣言](https://github.com/wooorm/lowlight/blob/3.3.0/package.json)
- [lowlightのhighlight処理とHAST emitter](https://github.com/wooorm/lowlight/blob/3.3.0/lib/index.js)
- [highlight.js 11.11.1 packageとBSD-3-Clause宣言](https://github.com/highlightjs/highlight.js/blob/11.11.1/package.json)
- [Markdown grammarのXML依存](https://github.com/highlightjs/highlight.js/blob/11.11.1/src/languages/markdown.js)
- [HTML/XML共通grammar](https://github.com/highlightjs/highlight.js/blob/11.11.1/src/languages/xml.js)
- [hast-util-from-html 2.0.3 package](https://github.com/syntax-tree/hast-util-from-html/blob/2.0.3/package.json)

shared skillは継続適用中のigapyon-miku-soft-developer（10-node-app-workflow / maintenance-workflow）を参照した。計画は以下の記録のとおり実行済み。

## 12. 実装記録

- 実装日: 2026-10-23。開始時HEADは`44aa973`、作業ツリーにはこの計画書だけが未追跡で存在した。開始時のpackage/runtime versionは`0.3.1`。作業中にversion incrementを含むcommit `34141b4 Add syntax highlighting and bump version to 0.3.2`が作成され、package/lock/runtimeとREADMEのversionが`0.3.2`へ揃った。
- `src/ts/core/code-languages.ts`に13系統/29 aliasを固定Mapで登録し、`syntax-highlight.ts`で12 grammarを個別登録。MDASTでfence情報を保存し、sanitize後にpositionと本文が一致した`pre > code`だけを再構築済みtoken treeで色付けする。
- `src/viewer/theme.css`へlight/dark/print paletteを追加。コード背景に対する初期palette文字contrastはlightで最小4.77:1、darkで最小7.04:1。diff用背景に対する文字contrastはlightで最小5.42:1、darkで最小7.16:1（色相ごとに算出）。printは文字を黒系、diff背景を透明にする。
- `lowlight@3.3.0`と`highlight.js@11.11.1`をruntime依存、`@types/mdast@4.0.4`と`hast-util-from-html@2.0.3`をdev依存としてexact pin。install時のnpm auditは追加時点で0 vulnerabilities。license generatorは210 locked package/version entriesを出力。
- 代表Markdownを固定して変更前後を測定した。baseline/current結果はignoredな`workplace/syntax-highlighting-baseline.json`にあり、入力は各1,513 bytes。Node v26.12.0 / macOS Darwin 25.6.0 arm64 / Apple M2で、変換中央値は2.316 msから4.240 ms、HTMLは12,287から19,547 bytes、CLI/runtime bundleは各1,606,629/1,583,325から1,771,358/1,748,054 bytesへ変化した。単一代表入力の測定であり、一般的な性能保証ではない。
- 上限付近の代表入力は256 KiB blockで中央値178.272 ms、block超過plain fallbackで7.911 ms、4 block合計1 MiBのdocument budgetで699.735 msだった（各ケース5回、初回除外）。連続した高負荷ケース全体のprocess peak RSSは265.44 MiB。環境とMarkdownはignoredな計測JSONに記録しており、時間はhost依存で厳密な性能保証ではない。
- `npm test`は最終で75 tests、`npm run smoke:all`はCLI/runtime bundleのrepo外smoke、release stagingとrelease asset smokeを含めて成功した。
- Browser UIを操作するbrowser surfaceがこのsessionでavailableでなく、Chromeのlight/dark/JS無効/320px/print/network確認は未実施。Node 22/24 executableはPATH上になく未検証であり、Node 26の結果で代用しない。
- baselineの変換後HTMLは`workplace/syntax-highlighting-before.html`、色付け版は`workplace/syntax-highlighting.html`に保存した（両方ともignore対象）。未検証のChrome・Node版、その他の残件は`docs/completion.md`とTODOで扱う。

## 13. Issue #5 dependency-reduction follow-up (2026-10-24)

初期実装で使用した`lowlight`を外し、`src/ts/core/highlight-hast-emitter.ts`でHighlight.jsのscope eventからHAST token treeを直接構築する。HTML文字列の生成・再解析は行わず、既存のclass検証と本文一致確認を維持する。emitter hookはHighlight.jsのprivate APIなので、`highlight.js@11.11.1`をexact pinし、更新時には`tests/syntax-highlight.test.ts`を含む関連suiteを実行する。依存理由の現行一覧は[docs/runtime-dependencies.md](runtime-dependencies.md)を参照。
