---
title: miku-md2html Node版 詳細設計・実装契約
type: implementation-spec
status: implemented
created: 2026-10-22
updated: 2026-10-22
audience:
  - miku-md2html Node implementation
sources:
  - type: human-input
    label: 単一HTML・CSS/JavaScript/SVG/画像の同梱、Node版から開始
  - type: repository
    url: https://github.com/igapyon/local-html-tools
    revision: 9e4e8fcb71ddecc055fcc0add6b75c97df70e9d9
  - type: repository
    url: https://github.com/igapyon/miku-md2docx
    revision: a25d302c742e6950183d60e0cda88f97bc65a265
---

# miku-md2html Node版 詳細設計・実装契約

## 1. この文書の位置づけ

この文書は、実装の契約と受け入れ基準です。Node版の初版を実装し、core/CLIテストと単体bundleのsmokeを実施しました。Node 22/24両方での実行、3ブラウザーのfile://確認、代表サイズの性能計測などは別途未完了として記録しています。実装と検証の最新状況は[完了・検証記録](completion.md)を参照してください。

利用者が示した条件は、Node版から始めること、出力を単一HTMLとすること、CSS・JavaScript・SVG・画像をHTMLに含めること、既存igapyonリポジトリとigapyon-miku-soft-developerの知見を使うことです。

細部のうち、サイズ既定値、HTML/SVG許可範囲、Node最低版は、利用者が個別に確定した値ではなく、本書で初版向けに決めた設計判断です。実装はこれらを初期製品契約として採用しました。変更時は理由と影響を設計記録へ残してください。

要求IDをREQ、受け入れケースをACで表します。例示コードは型・契約を説明するためのもので、実装済みAPIを意味しません。

## 2. 確認済みの出発点と参照元

### 2.1 対象

- Repository: https://github.com/igapyon/miku-md2html
- 確認時のdefault branch: devel
- 確認時のHEAD: 892f1b3d70b8731b53215361788ca83b9c7fa63e
- 確認時の内容: LICENSEのみ。ライセンスはApache-2.0です。
- 実装checkoutはdaybookのignored `workplace/miku-md2html-work/` に作成しました。開始時点ではHEADが上記revision、`devel`、LICENSEのみで、未コミット差分はありませんでした。初版実装は同checkout内にあります。

### 2.2 参照したノウハウと採用範囲

| 参照 | 取り入れる判断 | 適用上の注意 |
| --- | --- | --- |
| local-html-tools/scripts/lib/single-html.mjs | 編集元を分割し、CSS/JSを生成HTMLへ埋め込む | 現行helperは主にstylesheet/scriptを処理します。Markdown内画像の埋め込み機能は別途必要です。正規表現helperを任意HTML用の汎用parserとして転用しません。 |
| local-html-tools/scripts/build-text.mjs | sourceとgenerated artifactの対応、再生成可能なbuild | 生成済みHTMLの手編集を正本にしません。 |
| local-html-tools/docs/img/img2svg-src.html | 画像縮小を明示操作にする考え方 | ラスター画像のSVGトレースは本製品の初版機能にしません。 |
| miku-md2docx README/package.json | TypeScript/Node coreとCLI、単体runtime配布、remark系parserの利用 | DOCX出力や固有fixtureをコピーしません。 |
| miku-soft 10/11設計 | coreとI/O adapterの分離、単一HTML、通常利用のoffline化、診断 | 本書のHTMLは変換結果です。将来の変換ツール自身のWeb UIとは別の成果物です。 |

参照用checkoutはdaybookのignored `workplace/miku-md2docx-reference/` に作成し、指定revisionを確認しました。採用内容と不採用範囲は[development notes](development.md)に記録しています。ユーザーの追加指定がある場合はそれを優先します。

参照skillは[共有skill repository](https://github.com/igapyon/igapyon-agent-skills/tree/devel/skills/igapyon-miku-soft-developer)から利用しました。個人端末上のskill install pathは公開文書に記録しません。

参照skill source repositoryのローカルHEAD: 5a7376da5db640749e7a9e0a9169221aaeea5cb2。インストール済みSKILL.mdと当該checkoutのSKILL.mdの内容一致を確認しました。詳細reference全部のrevision一致を保証する記録ではありません。

インストール済みreferenceのSHA-256:

- SKILL.md: e3c8a776f14791de46e59f8d3f3bb2987fc2b90a1fd866736a981d0cbf624ae4
- references/10-node-app-workflow.md: ee2fa58dd29aacd54b32f9c76d4b05f6967d5776bdad54d2d0cc198faf2c9236
- references/miku-soft-basic/miku-soft-11-web-design.md: 64d5fc4ae6b825381035748cd2c80bb2d01d5e6176f58398a49c2b62b8319c6a

### 2.3 一次資料

- [単一HTML生成helper（確認revision）](https://github.com/igapyon/local-html-tools/blob/9e4e8fcb71ddecc055fcc0add6b75c97df70e9d9/scripts/lib/single-html.mjs)
- [build-text（確認revision）](https://github.com/igapyon/local-html-tools/blob/9e4e8fcb71ddecc055fcc0add6b75c97df70e9d9/scripts/build-text.mjs)
- [miku-md2docx（確認revision）](https://github.com/igapyon/miku-md2docx/tree/a25d302c742e6950183d60e0cda88f97bc65a265)
- [共有skill](https://github.com/igapyon/igapyon-agent-skills/tree/devel/skills/igapyon-miku-soft-developer)
- [remark-gfm](https://github.com/remarkjs/remark-gfm): Markdown拡張の仕様とAPIを確認する資料です。
- [remark-rehype](https://github.com/remarkjs/remark-rehype)、[rehype-sanitize](https://github.com/rehypejs/rehype-sanitize): Markdown/HTML AST連携とsanitizeの資料です。
- [yaml](https://eemeli.org/yaml/): front matterのYAML処理の資料です。
- [xmldom](https://github.com/xmldom/xmldom)、[CSS Tree](https://github.com/csstree/csstree): SVGのXML/CSS解析候補です。
- [SVG 2 processing modes](https://www.w3.org/TR/SVG2/conform.html): SVGを画像として利用するときの制約の資料です。
- [CSP script-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src): 生成HTMLの固定scriptをhashで許可する資料です。
- [Node.js Releases](https://nodejs.org/en/about/previous-releases): 2026-10-22時点でNode 20はEOL、22/24はLTSです。

これらの資料が本書の具体的な容量閾値、UI、CLI名、診断コードを定めているわけではありません。それらは本製品向けの設計案です。

## 3. 製品境界

REQ-001: 正本は入力Markdownとその参照画像です。主出力は完全なHTML文書1ファイルです。HTMLを編集元としてMarkdownを逆生成する契約は持ちません。

REQ-002: HTMLだけを別のディレクトリへ移し、file://で開いて、本文・表・コード・SVG・画像と補助操作を利用できます。通常の読み込み・閲覧でHTTP(S)、ローカル隣接ファイル、外部font、CDN、APIへのアクセスを必要としません。外部リンクを利用者がクリックした後の遷移はこの条件から除きます。

REQ-003: 初版は単一のローカルMarkdown入力を扱います。ディレクトリ一括変換、サイト生成、テンプレート言語、任意JS/CSSの取り込み、画像の再圧縮/縮小、PDF生成、ブラウザー版UI、Java版、MCPは後続候補です。このリポジトリは独自のAgent Skillを提供せず、製品向けAgent Skillの同梱先は `miku-md2formats-skills` とします。入力にMermaid/数式コードがあれば、初版は通常のコードとして表示します。

REQ-004: 初期実装時のpackage version案は0.1.0でした。利用者指定により0.3.2へ変更され、現在のpackage/runtime versionは0.3.5です。Node.js >=22を対象とし、22と24で動作確認し、配布buildは24を使います。skill既定の>=20からの変更理由は、設計確認時点でNode20がEOLであることです。実装時には公式状況と使用dependencyのengine条件を再確認します。

## 4. 入力、文字列、front matter

REQ-010: CLIの入力は通常ファイルの.md/.markdown（拡張子の大文字小文字は不問）1件です。ディレクトリ、stdin、URLは受け付けません。シェル上で入力パスは絶対/相対の両方を指定できます。

REQ-011: 入力はUTF-8、BOMあり/なしを受理します。不正なUTF-8は置換して続けずE_INPUT_ENCODINGです。BOMを除去し、CRLF/CRをLFへ正規化して解析します。診断の行番号は入力の行に対応し、列は1始まりのUTF-16 code unitです。front matterを外したために本文の診断行番号がずれてはいけません。

REQ-012: front matterは先頭行が厳密に---で始まり、後続の厳密な---または...行で閉じるYAMLブロックです。空ブロックは空map相当です。閉じ忘れはE_FRONT_MATTER、YAML構文エラー、複数document、重複key、非map rootも同コードです。先頭以外の---はMarkdownの構文です。

REQ-013: YAMLは1.2系の通常schemaで解析し、aliasの展開量を制限します。任意objectをHTMLやレポートへ展開しません。使うfieldはtitle/description/langの文字列だけです。未知fieldは無視します。既知fieldの非文字列はW_METADATA_TYPEで無視します。空白だけのtitle/langは未指定相当とします。title/descriptionの改行は単一spaceへ置換し、前後をtrimします。

REQ-014: title優先順位はCLI --title、front matter.title、sanitize後の最初のH1のplain text、入力ファイル名の拡張子除去部分です。最終的に空ならUntitledです。H1をtitleに使っても本文からは削除せず、別の見出しを自動追加しません。

REQ-015: lang優先順位はCLI --lang、front matter.lang、jaです。初版の受理形式はASCIIの英字2〜8文字、その後はhyphenと英数字1〜8文字の組合せを0回以上とします（ja、en、ja-JP、zh-Hans等）。private-use専用tag等の完全なBCP47対応は初版の保証外です。前後をtrimし、受理した大小文字は保持してHTML属性へescapeします。CLIの不正langはusage error、front matterの不正langはW_METADATA_TYPEで無視します。descriptionはfront matterからmeta descriptionへ設定します。metadataをHTML/JSとして評価しません。

## 5. Markdown、見出し、リンク

REQ-020: CommonMarkを基礎に、表、task list、strikethrough、autolink、脚注を扱います。段落、ATX/Setext見出し、strong/emphasis、inline code、escape、水平線、引用、入れ子の箇条書き/番号付きlist、fenced/indented code、reference link/imageを含めます。GitHubの全機能や見た目の完全互換を表明しません。

REQ-021: soft breakは通常のMarkdownとして扱い、明示hard breakだけbrへ変換します。task listのcheckboxはdisabledとし、閲覧者のクリックで保存状態が変わるUIにはしません。表のalignmentは生成側の固定CSS classへ変換します。

REQ-022: 言語を明示したfenced code blockは変換時にsyntax highlightingします。対応言語名とaliasは[README](../README.md#code-block-languages)の表に固定します。未知/未指定/plain指定は自動推定せず通常表示にします。inline code、indented code、author raw HTML由来のpre/codeは色付けしません。code本文はHTMLとして解釈せず、色付け前後のcode.textContentを一致させます。コピー対象はcode.textContentであり、token markupやbutton textを混ぜません。CSSとtoken markupをHTMLへ同梱し、browser runtimeでhighlighterを取得・実行しません。

REQ-023: H1-H6にdocument内で一意なIDを付けます。slugはplain textをNFC正規化、locale非依存の小文字化、Unicode whitespaceをhyphen化、文字/数字/結合文字/underscore/hyphen以外を除去し、連続hyphenと両端hyphenを整理します。空ならsectionです。IDはmiku-h-を前置します。重複時は-2、-3…を試し、既使用IDとの衝突がなくなるまで進めます。全見出しをsource順に処理します。

例: 「設計 メモ」→miku-h-設計-メモ、同名2件目→miku-h-設計-メモ-2。「foo」「foo」「foo-2」の順はmiku-h-foo、miku-h-foo-2、miku-h-foo-2-2です。

REQ-024: 目次はH1-H6をsource順に含め、階層はlevel情報で表現します。headingがなければ目次を出しません。--no-tocでもheading IDは作ります。fragment linkは一度だけpercent decodeして照合し、既知の生成IDか、prefixなしの割当済みslugへ一致すれば実際のIDへ書き換えます。不明なfragmentは安全なhrefを残しW_ANCHOR_UNRESOLVEDにします。曖昧な重複への無接尾辞linkは最初のheadingです。

REQ-025: 脚注IDとbackrefは生成側の予約namespaceへ統一し、sanitize後も相互リンクを維持します。入力HTMLのid/nameでheading・脚注・UIのIDを上書きできない設計にします。parser/sanitizerのprefix処理をfixtureで確かめてからmappingを固定してください。

REQ-026: 通常リンクはhttp/https/mailto、相対URL、fragmentを許可し、javascript/data/file等の明示schemeを拒否してW_LINK_REMOVEDにします。外部リンクは同一tabで通常遷移します。.mdを.htmlへ自動変換しません。リンク先ファイルをコピーする処理はありません。

REQ-027: 色分け対象本文のUTF-8 bytesは1 blockあたり256 KiB、1 documentあたり合計1 MiBを上限とします。空codeは対象外です。上限超過したblockはplain codeで保持し、`W_CODE_HIGHLIGHT_SKIPPED` warningをsource位置、reason、bytes、limit付きで記録します。engine/token tree処理の例外、不正node/class、本文不一致はplain codeへfallbackし、`W_CODE_HIGHLIGHT_FAILED` warningをlanguage正規ID付きで記録します。これらのwarningだけでは変換失敗にしません。code本文や例外stackを診断へ含めません。境界値ちょうどは処理対象です。block上限でskipしたbytesはdocument budgetへ加算しません。engineへ渡したbytesは例外時も加算します。後続blockは残量へ収まれば処理します。このbyte budgetは正規表現処理の実行時間timeoutではありません。

## 6. HTML本文とSVGの処理

### 6.1 通常のraw HTML

REQ-030: HTML parserとallowlist sanitizerを使います。タグを正規表現だけで除去する実装にはしません。表示用の許可tagは、p/div/span、h1-h6、br/hr、em/strong/del/s/ins/u/sub/sup、code/pre/kbd/samp、blockquote、ul/ol/li、a/img、table/thead/tbody/tfoot/tr/th/td/caption、details/summary、dl/dt/ddです。

REQ-031: authorのscript/style/link/base/meta/iframe/object/embed/form/input/button/audio/video/source等は許可しません。script/style/iframe/object/embed等の能動的要素は内容も除去します。通常の未知containerはtagを外して安全な子を保持します。許可されない要素・属性の除去はW_HTML_SANITIZEDにし、source位置と除去種別を示します。除去した危険なソース全文を診断へ複写しません。

REQ-032: author属性のon*、style、id/name、class、srcset、ping、target、form属性を除去します。title、img alt、table cellの妥当なcolspan/rowspan、details open、ol start等の表示用属性だけをschemaで許可します。img width/heightは正の整数を許可します。生成側のtask checkbox/heading ID/CSS class/脚注属性は自前変換後に制御して付け、author値と区別します。

### 6.2 SVG

REQ-033: 外部.svgファイル、SVG data URL、本文中のraw inline SVGを画像として扱います。最終文書ではSVGをdata:image/svg+xml;base64のimgとして挿入し、親documentへsvg subtreeを直接混ぜません。fenced code中のSVGは画像化しません。inline SVGのaltはaria-label、子titleのplain text、空文字の順です。

REQ-034: SVGはXML parserで検証します。UTF-8のSVG namespaceのroot svgを必要とし、不正XML、DOCTYPE/ENTITY、外部entity依存、xml:base、script、on*、foreignObject、SMIL animation要素はエラーです。SVGファイルは受理した元bytesを保ち、inline SVGはXML serializerでnamespaceとescapeを正しく生成します。安全確認のために勝手に図形を削除して成功にしません。

REQ-035: SVGのstyle要素/style属性/presentation属性内のCSSはCSS parserで確認します。@import、font-face、animation、parseできないRaw token、fragment以外のurl()、外部href/xlink:href等はエラーです。CSS escapeの意味を解決して検査します。ローカルの#id参照、基本図形、text、defs、gradient、clipPath、mask、marker、通常filterを扱えます。SVG内imageのdata URLは対応ラスター形式だけを許可し、nested SVG data URLは初版ではエラーです。SVG内部の隣接ファイルを再帰取得しません。

REQ-036: SVGの判定はE_SVG_INVALID、E_SVG_UNSAFE、E_SVG_EXTERNAL_RESOURCE、E_SVG_UNSUPPORTEDのいずれかで失敗を示します。foreignObject等を含む一部diagramのSVGが初版では使えない制限をREADMEに明示します。対応拡大は、勝手なfallbackを追加する代わりにfixtureと方針を更新して行います。

## 7. 画像、参照パス、単一HTMLの保証

REQ-040: PNG/JPEG/GIF/WebP/SVGを扱います。PNG等のラスター画像は再エンコードせず、data URLへBase64で格納します。GIFのanimationを勝手に静止画へ変えません。SVGZ、AVIF、BMP、TIFF等はE_IMAGE_FORMATです。拡張子や申告MIMEだけで形式を確定せず、magic/container headerを確認します。既知形式の寸法・明らかな切断を検査しますが、全pixelを復号する完全な破損検査は初版の保証範囲ではありません。

REQ-041: 参照パスはMarkdownファイルの親directoryを基準に解決します。default asset rootもそのdirectoryです。--asset-rootで明示した場合はそのroot内まで読めますが、参照の解決起点は変わりません。親directoryの画像を使う場合は、包含するrootを指定します。

REQ-042: 画像参照は相対URL pathを受理し、一度だけpercent decodeします。space/日本語は通常のMarkdown URL記法を通して扱います。NUL、不正percent encoding、backslash、絶対path、drive/UNC/file URL、query/fragment付きの画像参照は初版ではE_IMAGE_URIです。実ファイル名の#/?は%23/%3Fで指定できます。

REQ-043: Node adapterはrealpath後の包含関係をpath segment単位で確認します。..やsymlinkでasset root外へ出る場合はE_ASSET_OUTSIDE_ROOTです。symlink自体を一律禁止せず、最終実体がroot内の通常ファイルであることを条件とします。単純な文字列prefix比較で包含判定しません。describe時とread時の両方で包含/実体条件を検査し、readはmaxBytesを超えて無制限にbufferへ取り込みません。並行する悪意あるfilesystem変更に対する完全なsandboxをこのconverter単体で保証する仕様ではありません。

REQ-044: http/https、scheme-relative、その他remote画像はE_REMOTE_IMAGEです。ネットワーク取得機能はありません。既存data URLはBase64形式の対応画像MIMEだけを受け入れ、decode後の形式と一致を確認します。空画像、未知MIME、MIME偽装、不正Base64はエラーです。通常リンクと画像のremote方針を混同しません。

REQ-045: 欠落画像はE_IMAGE_NOT_FOUND、読取不能はE_IMAGE_READです。alt textだけを残して成功にはしません。画像の自動縮小、外部参照への切替、asset folder/ZIPの自動生成をしません。

REQ-046: 同一実体は読取/cacheを共有できますが、初版のHTMLは各imgへdata URLを直接入れます。同一画像の複数回出現は出現回数分のpayloadとして容量計算します。JSによるasset registryやBlob URLへの後付けに依存しません。

## 8. 容量の既定値と評価順

REQ-050: MiBは1,048,576 bytesです。文字数ではなくUTF-8出力bytesで上限を判定します。警告・上限の境界は「超えたとき」で、等しい値は許容します。

| 項目 | 設計上の初期値 | 動作 |
| --- | --- | --- |
| 元画像1件の容量 | 5 MiB超 | W_LARGE_IMAGE。元画像を埋め込みます。 |
| ラスター画像の寸法 | 40,000,000 pixels超 | W_LARGE_IMAGE_DIMENSIONS。容量とは別に記録します。 |
| 最終HTML容量 | 20 MiB超 | W_LARGE_OUTPUT。生成を継続します。 |
| 最終HTML上限 | default 100 MiB | E_OUTPUT_TOO_LARGE。--max-output-mibで変更できます。 |

これらは特定browserの公式上限を意味しません。代表データの生成時間/peak RSS/browser表示の検証は[完了・検証記録](completion.md)の残項目です。値を変更する場合は測定条件と理由を記録します。

REQ-051: max-output-mibは1以上1024以下の整数です。値を上げても、そのサイズを全環境で処理できる保証にはしません。上限に適合しても実行環境のresource不足があれば失敗し、黙って内容を欠落させません。

REQ-052: ローカル画像はまずstat相当の情報を取り、Base64 payload長4×ceil(bytes/3)を出現回数分見積もります。見積もりには固定HTML/CSS/JSと本文も含めます。明らかに上限を超える巨大画像を全文読取してから判定しません。describe後に実体またはbyteLengthが変わったと分かればE_ASSET_CHANGEDで失敗し、自動再試行を繰り返しません。読取上限へ先に到達した場合はE_OUTPUT_TOO_LARGEにできます。いずれもHTMLをcommitしません。

REQ-053: 完成HTMLのUTF-8 byte lengthでも必ず再判定します。XML/HTML escapeやmetadataなどによる見積もり差を許容しても、実出力の超過を許容しません。診断JSONの容量はHTML上限に含めません。

REQ-054: CLIは入力Markdownのstatサイズが設定HTML上限より大きい場合、読取前にE_INPUT_TOO_LARGEとします。これは保守的な入力resource上限としてhelpへ明記します。coreへ巨大stringを渡すcallerの割当済みメモリまではcoreで制御できません。

## 9. 出力HTML、CSS、JavaScript

REQ-060: UTF-8、BOMなし、LF、末尾newline1個とします。doctype/html/head/body、charset/viewport/title、任意description、固定style、目次、main/article、固定scriptを持つ完全文書です。sourceの絶対path、生成日時、host名を自動挿入しません。

REQ-061: CSSはsystem font、本文max-width、320pxからの可読性、見出し間隔、code/tableの局所横scroll、画像max-width:100%/height:autoを扱います。Material Design 3の色の役割を参考に、ニュートラルな背景と控えめな藍色を使い、light/darkで意味を保ったまま切り替えます。角丸のsurfaceと十分な余白で本文を読みやすくします。body全体が横overflowする状態を避けます。元画像の画素数をCSSの縮小表示で減らしたことにしません。印刷では操作ボタンと目次の開閉UIを非表示にし、本文とtableを読める状態にします。

REQ-062: 目次はnative details/summaryで開閉でき、JavaScript無効でも使えます。コードのコピーボタンはJSが動く場合だけ追加し、インラインSVGアイコンとaria-labelで操作を示します。clipboard.writeText成功後だけ成功表示し、利用できない場合はコードを選択して手動copyの案内を出します。readonly codeの内容を変更しません。statusはaria-liveで伝えます。

REQ-063: UI文字列はlangがja系なら日本語、それ以外は英語です。CLI helpと診断messageは英語を基本とし、diagnostic codeを安定識別子にします。本文を不必要に翻訳しません。

REQ-064: scriptは固定のviewer補助処理だけです。入力値をscript文字列やevent handlerへ連結せず、本文はAST serializerでescapeし、viewerはtextContent/DOM APIを使います。eval、dynamic import、fetch、外部font/analytics/service workerを使いません。許可されない外部資源参照が最終DOMに残らないことを確認します。

REQ-065: headにはmeta CSPを置きます。default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'sha256-<固定scriptのhash>'; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'を初期方針にします。styleのinline許可は固定themeとSVG内styleのためです。author styleはREQ-032で除去します。固定scriptの正確な出力bytesからbuild時にhashを計算し、実行時に乱数nonceを生成しません。

REQ-066: style/script raw-textを途中で閉じる文字列が固定assetに入ってもHTML構造を壊さないbuild処理と検証を用意します。入力由来の内容をこのescapeで安全化できると考えず、本文と固定assetを別経路で組み立てます。

## 10. CLI契約

~~~text
miku-md2html <input.md> --out <output.html> [options]
miku-md2html --help
miku-md2html --version
~~~

単体配布後の実行形はnode miku-md2html-0.3.5.mjs input.md --out output.htmlです。これは将来の配布asset名の案であり、現時点で公開済みではありません。

| 引数/option | 契約 |
| --- | --- |
| input | 必須1件。.md/.markdown通常ファイル。 |
| --out <file> | 必須。拡張子.htmlの出力path。-によるstdout出力は初版対象外。 |
| --title <text> | titleの最優先値。空白のみはusage error。 |
| --lang <tag> | html langの最優先値。 |
| --asset-root <dir> | 読取可能なローカル画像root。defaultは入力の親。 |
| --no-toc | 目次を出力しない。 |
| --max-output-mib <integer> | default 100。REQ-051の範囲。 |
| --report-json <file> | version付き機械可読レポートを指定fileへ書く。defaultでは作成しない。 |
| --force | HTML/指定レポートの既存通常ファイルを置換可能にする。 |
| --help / --version | 入力や--outなしで成功。読み書きやconversionを起動しない。 |

REQ-070: optionの重複、未知option、引数不足、余分なinput、不正数値はusage errorです。値付きoptionは--key valueと--key=valueの両方を受理し、boolean optionに=値は受理しません。hyphenから始まるoption値は=形式で指定します。--help/--versionはそれぞれ単独利用を正式契約とし、両者同時またはconversion用引数との混在はusage errorにします。引数なしは短いusageをstderrへ出しexit2です。--によりoption解釈を終了できます。出力拡張子.htmlも大小文字不問です。

REQ-071: default stdoutは成功時の1行summaryです。HTML本文や診断JSONをstdoutへ混在させません。stderrは警告とerrorです。形式はseverity code source:line:column messageを基礎にし、ANSI装飾や端末幅へ依存させません。失敗時のstdoutは空です。

| exit | 意味 |
| --- | --- |
| 0 | HTMLの保存成功。警告があっても成功。指定reportも保存成功。 |
| 1 | 想定された入力/変換/I/O/容量失敗。report失敗だけでも1。 |
| 2 | CLI使用方法が不正。 |
| 3 | 想定外の内部例外。内部stackや入力内容の不用意な露出を避ける。 |

## 11. 出力ファイルと失敗時の整合性

REQ-080: 入力、出力、reportが同一path/同一inodeになる指定を拒否します。出力/reportが参照画像を上書きすることも、画像発見後の最終preflightで拒否します。既存のsymlink、directory、special fileを出力先にしません。--forceもこれを解除しません。

REQ-081: --forceなしで出力またはreportが存在すればE_OUTPUT_EXISTSです。存在判定後の競合でも既存fileを上書きしないcommit方法にします。--forceありでは、完成したtemporary通常ファイルからreplaceします。変換が失敗した段階では既存HTMLを変更しません。

REQ-082: 必要な親directoryは作成できます。temporaryは出力と同一filesystem上へ置き、conversionと最終容量検証が成功してから書き込みます。各fileは完成内容をcommitする単位とし、途中HTMLを正式出力pathへ書きません。失敗時は自分のtemporaryだけを片づけ、既存利用者fileやdirectoryを巻き戻し削除しません。

REQ-083: HTMLとreportの2ファイルを一つのatomic transactionとは表明しません。両方のpath条件と可能なI/O条件をpreflightし、HTMLを先にcommitします。reportのcommitだけが後で失敗した場合、正常なHTMLは保持し、stderrにE_REPORT_WRITEとHTML保存済みを示してexit1にします。

REQ-084: conversion失敗時でも、CLIの引数とreport destinationが妥当なら、指定reportへsuccess:false/output.written:falseを保存するよう試みます。usage error時はreportを書きません。reportを書けない場合はstderrだけでその失敗を示します。HTML保存済みなのにfalseと報告する等の矛盾を作りません。

REQ-085: 同じ入力bytes、同じ参照資産bytes、同じlogical name/options、同じtool/dependency版ならHTML bytesが一致することを要求します。並列処理完了順やOS localeをoutput順に使いません。安定順はsource位置、必要時はPOSIX形式のlogical pathのUTF-16 code unit順です。

ここで定義するfile整合性とexit/reportの保証は、制御可能な通常失敗を対象にします。OSによる強制終了、process OOMによるhard crash、filesystem障害の完全な復旧やreport出力までは保証しません。temporaryを本出力へcommitする前に正常性を確認する設計で、破損した途中HTMLを正式成果物にしないことを重視します。

## 12. Core API案と責任分離

以下は公開runtimeの型契約です。Node filesystemやDOM objectをcoreの引数にしません。

~~~ts
type SourcePosition = { line: number; column: number };
type Diagnostic = {
  severity: 'warning' | 'error';
  code: string;
  message: string;
  source?: { label: string; start?: SourcePosition; end?: SourcePosition };
  details?: Record<string, string | number | boolean>;
};
type AssetInfo = { id: string; label: string; byteLength: number };
declare class AssetAccessError extends Error {
  readonly code: 'E_IMAGE_NOT_FOUND' | 'E_IMAGE_READ' | 'E_ASSET_OUTSIDE_ROOT' | 'E_ASSET_CHANGED';
}
interface AssetResolver {
  describe(decodedRelativePath: string): Promise<AssetInfo>;
  read(id: string, maxBytes: number): Promise<Uint8Array>;
}
type ConvertRequest = {
  markdown: string;
  inputName: string;
  options?: { title?: string; lang?: string; toc?: boolean; maxOutputBytes?: number };
  assets?: AssetResolver;
};
type ConvertResult = {
  success: boolean;
  html?: string;
  metadata: { title: string; lang: string; description?: string };
  diagnostics: Diagnostic[];
  stats: {
    headingCount: number;
    imageOccurrences: number;
    uniqueAssets: number;
    uniqueSourceAssetBytes: number;
    embeddedPayloadBytes: number;
    htmlBytes?: number;
  };
};
declare function convertMarkdownToHtml(request: ConvertRequest): Promise<ConvertResult>;
declare const productName: string;
declare const version: string;
~~~

REQ-090: success:trueならhtml必須、error診断なしです。success:falseならhtmlを返しません。公開型はこの条件を表すdiscriminated unionへ具体化できます。failureでmetadataをまだ決定できない場合はtitle=Untitled/lang=jaとし、statsは完了した範囲の値です。未完成のhtmlBytesは省略します。期待されるparse/asset失敗は診断へ正規化し、内部bugまですべて変換失敗に隠しません。inputNameは空でないfilename相当のlogical nameで、slash/backslash/NULを含めません。CLIはbasenameを渡します。coreのmaxOutputBytesは1以上1,073,741,824以下のsafe integer、default104,857,600です。APIの不正request/optionsはE_OPTIONSのfailureで返し、CLI側の引数誤りexit2と区別します。coreでも入力UTF-8 byte lengthの上限を確認します。

REQ-091: Node resolverがbase/root/realpath/通常file/読取制限を担当し、coreがURL分類、対応形式、SVG規則、埋め込み、容量、HTML生成を担当します。resolverのbyteLengthは読取後にも検査します。assets未指定でローカル画像が現れたらE_ASSET_RESOLVER_REQUIREDです。data URL/inline SVGはresolverなしで扱えます。

REQ-092: resolverの想定失敗は公開するAssetAccessErrorのcodeでcoreへ渡します。他の例外を入力errorと決めつけて握りつぶしません。診断のlabelはlogical root-relative名を基本にし、asset bytes、Base64、絶対内部path、stackをcore診断へ不用意に含めません。実装されたerror型のconstructorと公開exportはAPI文書に記載します。AssetInfo.byteLengthは非負のsafe integerです。不正metadataやUint8Array以外のread結果はadapter契約違反の内部errorとして扱います。

## 13. 機械可読レポート

REQ-100: --report-jsonはschemaVersion:'1'、tool、success、exitCode、input、output、metadata、stats、diagnosticsを持つJSONです。report自体はHTML閲覧の必須ファイルではありません。日時/処理時間は初版の安定schemaへ含めません。

~~~json
{
  "schemaVersion": "1",
  "tool": { "name": "miku-md2html", "version": "0.3.5" },
  "success": true,
  "exitCode": 0,
  "input": { "path": "input.md", "bytes": 128 },
  "output": { "path": "output.html", "written": true, "bytes": 4096 },
  "metadata": { "title": "設計メモ", "lang": "ja" },
  "stats": {
    "headingCount": 2,
    "imageOccurrences": 1,
    "uniqueAssets": 1,
    "uniqueSourceAssetBytes": 512,
    "embeddedPayloadBytes": 684,
    "htmlBytes": 4096
  },
  "diagnostics": []
}
~~~

REQ-101: input/output pathはCLIで指定された表記を基本にします。generated HTMLへそのpathを転記しません。failure時のoutput.bytesは未完成なら省略し、writtenは実際にHTMLをcommitしたかを示します。statsのembeddedPayloadBytesは最終imgのdata URLのBase64 payload部分の出現回数合計です。SVG内に既存のdata rasterがあってもouter SVG payloadとは別に二重加算しません。uniqueAssets/uniqueSourceAssetBytesはresolver.id単位です。data URL/inline SVGはMIMEと内容hashを基に内部idを付け、同じidの元bytesを重複加算しません。別idのassetが同じbytesである場合に、content dedupまで行う契約はありません。inline SVGもassetに数えます。

REQ-102: diagnosticsはsource位置順、同位置はcodeのUTF-16 code unit順で安定化します。位置不明は後ろです。同一理由を何千属性分も繰り返さず、同一node/除去種別をまとめられます。網羅的な全error収集は保証せず、fatal limit時は早期停止できます。

### 主要診断コード

| code | severity | 条件 |
| --- | --- | --- |
| E_INPUT_READ / E_INPUT_ENCODING / E_INPUT_TOO_LARGE | error | 入力I/O/UTF-8/resource境界 |
| E_OPTIONS | error | public core APIのrequest/optionsが契約外 |
| E_FRONT_MATTER | error | front matter構文/形 |
| E_IMAGE_URI / E_REMOTE_IMAGE | error | 画像URL契約外/remote |
| E_ASSET_OUTSIDE_ROOT / E_ASSET_RESOLVER_REQUIRED | error | 読取境界/API adapter不足 |
| E_IMAGE_NOT_FOUND / E_IMAGE_READ | error | 画像欠落/読取不能 |
| E_ASSET_CHANGED | error | describe後の実体/サイズ変更を検出 |
| E_IMAGE_FORMAT / E_IMAGE_INVALID | error | 形式契約外/検出された破損 |
| E_SVG_INVALID / E_SVG_UNSAFE / E_SVG_EXTERNAL_RESOURCE / E_SVG_UNSUPPORTED | error | SVGの検証失敗 |
| E_OUTPUT_TOO_LARGE | error | 見積もりまたは実出力が上限超過 |
| E_OUTPUT_EXISTS / E_OUTPUT_COLLISION / E_OUTPUT_WRITE | error | 出力保護/I/O |
| E_REPORT_WRITE | error | reportの保存失敗 |
| E_INTERNAL | error | 想定外例外。CLI exit3 |
| W_CODE_HIGHLIGHT_SKIPPED / W_CODE_HIGHLIGHT_FAILED | warning | syntax highlightingのbyte上限超過またはengine/token tree fallback |
| W_METADATA_TYPE / W_HTML_SANITIZED / W_LINK_REMOVED | warning | 不正shape、明示された表示内容の変更 |
| W_ANCHOR_UNRESOLVED | warning | 同一文書の参照先heading/脚注が見つからない |
| W_LARGE_IMAGE / W_LARGE_IMAGE_DIMENSIONS / W_LARGE_OUTPUT | warning | 既定の容量/寸法警告 |

## 14. 処理順とmoduleの構成案

1. CLI引数、input/output/report/rootを検証し、help/versionなら即終了します。
2. inputのstat/UTF-8を確認し、front matterとMarkdownをsource位置付きで解析します。fenced codeの言語とsource位置をAST変換前に記録します。
3. MarkdownをHTML ASTへ変換し、raw HTMLを構文解析します。SVG subtreeを独立資産化し、通常HTMLをsanitizeします。sanitize後、記録済みのMarkdown fenceと位置・本文が一致するcodeだけに安全なtoken spanを付けます。
4. heading/title/目次/脚注のIDとリンクを確定し、画像参照を収集します。
5. image resolverのdescribe、root/衝突確認、payload見積もりを行います。明らかな超過で打ち切ります。
6. 制限付きで画像bytesを読み、画像/SVGを検証し、data URLへ置換します。
7. 固定theme/viewer資源と本文ASTからHTMLを生成し、正確なUTF-8容量を判定します。
8. result/reportを作り、CLIがREQ-080以降の規則でfileをcommitします。

~~~text
src/
  index.ts                 public exports / product metadata
  core/                    request、AST pipeline、document assembly
  markdown/                front matter、見出し/脚注/link、HTML policy
  assets/                  reference分類、画像/SVG検証、容量集計
  adapters/node-assets.ts  filesystem resolver
  cli/                     argv、stdout/stderr、file commit、JSON report
  viewer/                  編集元theme.css / viewer.js / template
  generated/               buildで生成するviewer文字列/hash。正本にしない
scripts/                   build/bundle/smoke用の薄いentrypoint
tests/                     core、CLI、browser artifactのfixtureと確認
docs/                      spec、API、CLI、development、shared reference
workplace/.gitkeep          実データ/参照checkout/検証出力のignored領域
~~~

実装moduleは責任分離を保つ構成にしました。Markdown parserはremark/unified系、raw HTMLはrehype-rawからrehype-sanitize、XML/CSSはxmldom/CSS Treeのparserを利用します。独自の正規表現sanitizerは使いません。

dependencyの解決版はpackage-lockへ固定しました。現在の実行環境でbuild/tests/bundlesを検証し、Node22/24両方の検証と公開時点の脆弱性確認は未完了です。選定構成と参照理由はdevelopment記録にあります。本文assemblyやasset policyをlibrary default任せにしないことが設計契約です。

## 15. 配布・リポジトリ契約

REQ-110: CLI bundleとimport可能runtime bundleを別々に作ります。

- bundle/miku-md2html.mjs
- bundle/miku-md2html-runtime.mjs
- bundle/miku-md2html-sources.tgz

release asset名はそれぞれmiku-md2html-<version>.mjs、miku-md2html-runtime-<version>.mjs、miku-md2html-sources-<version>.tgzです。CLI/runtimeには必要なparser、theme、viewerを同梱し、配布file単体からnpm installなしで使えることを確認します。CLIをimportした際にconversionやprocess.exitを起動させません。--version、runtime version export、reportのtool.versionは同じbuild metadataを使います。release tagのdot suffixを採用した場合もその完全な版をbuildへ反映し、package版の末尾を黙って落としません。

REQ-111: build、typecheck、test、cli、build:bundle、smoke:bundle、smoke:runtime、test:browserのlocal commandを用意します。--helpには必要入力、生成file、overwrite、remote画像方針、容量、stdout/stderr、exit、実配布fileの実行例を載せます。CI baselineの新規追加とGitHub上の操作をこの仕様から暗黙に要求しません。

REQ-112: release workflowを準備する場合はskillのNode main app契約に従い、release:published、v* version検証、tag checkout、Node24 build、local smoke、staged asset uploadを使います。remote publish/secret設定等は利用者の担当です。

REQ-113: .gitignore、workplace/.gitkeep、README、実際の残作業を記すTODO、CONTRIBUTING/CONTRIBUTORS/THIRD_PARTY_NOTICES、docs/miku-soft-reference.mdを必要な内容で整えます。shared skill文書を丸ごと複写せず、参照日/参照revision/例外理由をdevelopment文書へ記録します。初版でindex.jsonは必須にしません。

## 16. 受け入れケース

ここでは受け入れケースを定義しています。ケースの実施状況は[完了・検証記録](completion.md)に記録します。未確認ケースを通過済みとは扱いません。

| ID | 入力/状況 | 期待結果 |
| --- | --- | --- |
| AC-001 | 最小のheading/paragraph | 完全文書、UTF-8/LF、title、exit0 |
| AC-002 | 空Markdown | 有効な空article、filename fallback title |
| AC-003 | UTF-8 BOM/CRLF/日本語 | 文字化けせず、source行番号が一致 |
| AC-004 | 不正UTF-8 | E_INPUT_ENCODING、既存HTML保持 |
| AC-005 | front matter titleとCLI title | 優先順位どおり。H1二重追加なし |
| AC-006 | 未知field/既知fieldがobject | 未知field無視、既知shapeはW_METADATA_TYPE |
| AC-007 | YAML重複key/alias過多/閉じ忘れ | E_FRONT_MATTER。無制限展開なし |
| AC-008 | 見出しなし/--no-toc | TOCを出さず本文正常。heading ID規則は保持 |
| AC-009 | 日本語、記号のみ、重複heading | REQ-023のIDと衝突回避 |
| AC-010 | #slug/#生成ID/#不明ID | 書換え、維持、W_ANCHOR_UNRESOLVEDを区別 |
| AC-011 | 脚注複数とbackref、raw id衝突 | 全linkが実在IDへ着き、author idでUIを上書きできない |
| AC-012 | 入れ子list、task、表alignment、hard/soft break | 構造と表示規則どおり。checkbox disabled |
| AC-013 | code内のHTML/SVG/閉じscript文字列 | literal表示。生成DOM/scriptを壊さない |
| AC-014 | Markdown imageとraw HTML img | 同じ埋め込み/失敗規則 |
| AC-015 | PNG/JPEG/GIF/WebP各1件 | 元bytesがdata URLから復元可能 |
| AC-016 | 通常SVG、defs/use/gradient/style | vector表示、内部ID参照保持 |
| AC-017 | raw inline SVGとfenced SVG | 前者を画像化、後者をcode表示 |
| AC-018 | SVG script/onload/DOCTYPE/foreignObject | 対応するSVG error、HTML出力なし |
| AC-019 | SVG CSSの@import/url外部/escapeされたURL | E_SVG_EXTERNAL_RESOURCE等、通信/外部読取なし |
| AC-020 | SVG内data raster/外部image/nested SVG | 許可/エラー/エラーの区別 |
| AC-021 | MIME偽装、不正data URL、空/切断画像 | 形式または検出可能な破損error |
| AC-022 | 日本語/space/%23/%3Fを含む相対path | 入力MD所在基準で正しく解決 |
| AC-023 | CWDを変えて同じ入力絶対pathを実行 | asset解決とHTML bytesが変わらない |
| AC-024 | .. / symlinkでroot外、prefix似の別dir | E_ASSET_OUTSIDE_ROOT、内容を読まない |
| AC-025 | --asset-root拡張、root内symlink | 許可範囲内で解決。解決基準は入力親のまま |
| AC-026 | remote/protocol-relative画像 | E_REMOTE_IMAGE、network呼出し0 |
| AC-027 | 欠落画像/読取権限なし | error。altだけで成功扱いにしない |
| AC-028 | 同じ画像を複数回参照 | 容量は出現回数分。cacheで実読取の共有可 |
| AC-029 | 5MiB画像/5MiB+1、20MiB HTML/20MiB+1 | 等しい時は当該警告なし、超過だけ警告 |
| AC-030 | 画素数だけ巨大な圧縮画像 | bytes警告とは別のdimension警告 |
| AC-031 | 上限ちょうど/上限+1、--max-output-mib変更 | 前者許可、後者失敗。既存HTML保持 |
| AC-032 | statだけで明らかに上限超の巨大asset | 全bytesを読まず失敗。mock resolverでread未実行を確認 |
| AC-033 | describe後にasset実体/長さが変わる | E_ASSET_CHANGED。読取limit到達なら容量error可。HTMLは出さない |
| AC-034 | script/style/base/iframe/onclick危険href | 無害化と診断。生成viewerは動作 |
| AC-035 | outputを画像のない別dirへ移しfile://で開く | 全画像/本文正常、元path不要 |
| AC-036 | offline + browser全request記録 | 初回file読取を除きhttp(s)/隣接file参照0 |
| AC-037 | JS無効 | 本文/画像/目次が読める。無動作のcopyボタンなし |
| AC-038 | clipboard成功/拒否/未提供 | 正しい成功表示、または選択とmanual copy案内 |
| AC-039 | viewport 320px/desktop/print | bodyの不必要な横overflowなし。印刷に操作buttonなし |
| AC-040 | no input、未知option、重複、無効数値 | exit2、stdout空、出力変更なし |
| AC-041 | 単体bundle --help/--version | inputなし成功、内容がpackage/release versionに一致 |
| AC-042 | no-forceで既存file/競合出現 | 既存fileを上書きしない |
| AC-043 | --force後にconversion失敗 | 既存HTML bytes不変 |
| AC-044 | input/report/output/assetのpath/inode衝突 | E_OUTPUT_COLLISION、元資料保持 |
| AC-045 | outputがsymlink/directory | force有無に関係なく拒否 |
| AC-046 | HTML commit成功後report commit失敗 | HTML正常保持、E_REPORT_WRITE、exit1、保存済みと通知 |
| AC-047 | conversion失敗、report指定あり | success:false/written:falseのreport、HTML変更なし |
| AC-048 | 同じ入力を複数回、Node22/24、別CWD | 同じ版/設定のHTML bytesが一致 |
| AC-049 | runtimeをimportしcoreを直接呼出し | process終了/I/O副作用なし、公開export/結果契約どおり |
| AC-050 | mock resolverで画像なし/あり/想定error | coreがNode FS/DOMなしで動作し、診断を返す |
| AC-051 | generated CSS/JS内の閉じtag境界とCSP hash | HTML構造正常、意図したscriptのみ実行 |
| AC-052 | repo外にCLI/runtime単体をコピーして実行 | npm install/source tree不要で変換/import成功 |
| AC-053 | 不正core request/maxOutputBytes/resolver戻り値 | API入力failureとadapter内部errorを区別 |
| AC-054 | --key=value、boolean=値、--とhyphen名 | 受理/usage error/positionalの規則どおり |
| AC-055 | title/description/altにHTMLや閉じtag文字列 | text/属性としてescapeされ、実行されない |
| AC-056 | HTML temporary書込失敗、既存reportのみ存在 | 規則に従う非zero終了、既存成果物を保持 |
| AC-057 | source assetを読取中に上限を超える | adapterのmaxBytesで停止し、無制限buffer化しない |

boundaryテストは小さいconfigやmockを使い、大量の実データをGitへ置きません。5/20/100MiB等の実寸確認はignored workplaceへ生成して行い、fixtureの目的を明記します。

初期検証は利用者指定に従いChromeのfile://を対象にし、本文・table・画像/SVG・操作UIを確認します。JavaScript無効時、320px/print、通信記録の確認は別ケースとして結果を記録します。Firefox/WebKitへの拡張は初期対象外です。未確認項目を通過したと表明しません。

容量の測定では、画像なしの約1MiB Markdown、約6MiB画像1枚、複数画像で生成HTML約30MiB、同一画像の反復参照、上限超過がstatで分かる大画像を少なくとも含めます。tool版、Node版、OS、CPU/メモリ、入力/実出力bytes、wall time、peak RSS、browserで開けたかを記録します。現時点に測定済みの速度/メモリ保証値はなく、測定後の既定値変更は設計記録へ残します。

## 17. 実装順序と完了基準

1. 対象HEAD/ローカル規則/skill/姉妹参照を確認し、設計の差分があればdevelopmentへ記録します。（実施済み）
2. package、TypeScript、public contract、diagnostic model、CLI metadataのみを足場として整えます。
3. Markdown/front matter/HTML policy/heading/脚注を実装し、画像なしのcore受け入れを通します。
4. resolverと画像/SVG、path境界、容量preflightを実装し、資産ありのcore受け入れを通します。
5. theme/viewer/template/CSPを組み立て、file://の実artifactを確認します。
6. CLI/file commit/reportを実装し、失敗時の整合性を確認します。
7. CLI/runtime/source bundleを作り、repo外でsmokeを通します。
8. README/API/CLI/制限/TODO/third-party noticesを実装結果へ合わせ、型/関連テスト/build/browser確認を完了します。

受け入れには、REQへの対応、AC結果、実行commandと実行環境、未確認項目、容量既定値の測定記録、final diff/git diff --checkの確認が必要です。未実装をhelpで実装済みのように案内しません。初版コードは実装済みで、残る検証を[完了・検証記録](completion.md)とTODOへ明記しています。対象branchへのcommit/pushや公開は別の作業指示・既存の承認範囲に従います。

## 18. 実装時に記録すべき判断

- 正確なdependency版とbundle可能性。Node22/24で検証していない組合せを確定済みとしません。
- 画像の実際のbyte/pixel上限に対する生成時間、peak RSS、表示確認。現時点に測定結果はありません。
- SVGの初期subsetで扱えなかった実例と、拡張する場合のfixture。
- sanitizerと脚注/heading ID mappingの整合性。library default変更を無検証で受け入れません。
- file://下のclipboard/CSP/browser差。fallbackの実際の動作を記録します。

本書の重大な契約変更、たとえば出力を複数fileにする、remote画像を取得する、本文scriptを許可する、上限超過画像を勝手に縮小する等は、単なる実装都合として混ぜず、設計変更として理由と影響を提示してください。
