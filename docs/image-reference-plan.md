# SVG埋め込み・元画像参照への変更計画（Luna向け）

- 作成日: 2026-10-24
- 状態: 2026-10-24に実装・ローカル検証済み。未確認のNode/browser条件は末尾に記録。
- 対象: このリポジトリの共通変換runtime、Node CLI、診断JSON、文書、配布bundleの検証。
- 調査時HEAD: `b18a6e3`。
- 調査時branch: `devel-tiga1024aed`。作業ツリーはcleanだった。
- 現在版: `0.4.0`。利用者指定 `a.b++.0` による実装時の予定版: `0.5.0`。
- 実装開始条件: 利用者から実装依頼を受けたため、本書の手順を実施した。
- 計画作成時点ではbuild、test、bundle再生成、版更新、Gitのstage/commitを行っていない。実装・検証結果は末尾を参照。

## 1. 目的と合意した方向

通常の変換では、SVGを検証してHTMLに埋め込む。SVG以外のローカル画像はコピーせず、元の画像ファイルを生成HTMLから相対URLで参照する。Markdown原本と画像を同じ作業ツリーで管理し、生成HTMLをローカルのブラウザーで読む用途を中心にする。

CSSとviewer JavaScriptは従来どおりHTMLに含める。`assets/`やZIPは生成せず、画像の縮小・再圧縮も行わない。元画像の変更は次にHTMLを開いた際の表示に反映される。HTMLだけを移動・配布して全画像が表示できる、という保証は通常モードには付けない。

形式とrootの検査は生成時に確認した実体へ適用する。生成後に元ファイルやsymlinkが変更された場合まで内容を固定するものではない。表示内容や形式の確定が必要になった時点で再生成するかembedモードを使う。

利用者は「画像の存在・形式・参照範囲は検査するが、それを理由に変換を失敗させず警告にする」と修正した。この計画では、ローカル画像ファイルの検査に関する想定失敗を警告として扱う。危険なSVGの埋め込み、不正な入力URL、出力先の衝突、内部の契約違反は別の失敗として扱う。詳細は第4節の表を唯一の判断表にする。

### 1.1 この計画で具体化する決定

1. CLIに `--image-mode reference|embed` を追加し、既定を `reference` にする。
2. runtimeには `options.imageMode?: 'reference' | 'embed'` を追加し、既定を `reference` にする。
3. `reference` はSVG埋め込みと元画像への相対参照、`embed` は受理できた画像をすべて埋め込む配布・保存向けモードとする。
4. 元からMarkdownに含まれる画像data URLは、どちらのモードでも埋め込みを維持する。元ファイルがないため外部化しない。
5. Markdown記法の画像と入力HTMLの `img` に同じ規則を適用する。raw inline SVGは既存の検証を通して埋め込む。
6. 存在しないラスター画像は、参照範囲内と確認できてURLを生成できる場合、相対参照を残して警告する。後で元画像を配置すれば表示できる。
7. 範囲外などで参照自体を許可できない画像は `src` を出さず、`alt` を保って警告する。`src=""` は出さない。
8. 欠落した `.svg` は埋め込む実体がないため `src` を省略して警告する。読み取ったSVGのXML/CSS安全性検査失敗は従来どおりエラーにする。
9. `embed` でファイル検査を警告にした画像は `src` を省略する。元画像への参照へ自動で切り替えない。
10. 参照画像の総容量をHTML出力上限へ加算しない。検査用の読取り上限はHTML出力上限から独立させる（第6節）。
11. 新しい画像形式parser、依存ライブラリ、ブラウザー用fetch処理は追加しない。形式・寸法・検出可能なcontainer破損の検査範囲はPNG/JPEG/GIF/WebP/SVGのまま。全画素を復号して画像の完全性を保証する検査は追加しない。
12. JSON reportは意味の変わる統計を明示するため `schemaVersion: '2'` にする。旧schemaを選択するフラグは追加しない。

CLI/runtimeの既定動作変更、resolver契約の追加、report schema変更は `0.5.0` の移行事項として記載する。既存の利用者が単独で持ち運べるHTMLを必要とする場合は `--image-mode embed` / `imageMode: 'embed'` を指定する。

## 2. 調査した現行コードと変更点

| ファイル・関数 | 現在の状態と必要な変更 |
| --- | --- |
| `src/ts/types.ts` | optionsに画像モードなし。resolverはdescribe/readだけ。型、診断code、統計を追加する |
| `src/ts/index.ts` | 公開型exportとruntime版の定義場所。追加する型をexportする |
| `src/ts/core/converter.ts` | 全ローカル画像を仮data URLにして、出力容量を見積もってから読取り・埋め込み。参照画像と埋め込み画像の処理を分ける |
| `src/ts/core/image-embedding.ts` | 変換ごとのcache・pending node・診断・容量・画像検査を所有。新しい判断もこの共通coreで行う |
| `src/ts/assets/image.ts` | magic判定、SVG判定、container検査、寸法検査。prefixによる種別判定を共有関数へ切り出す |
| `src/ts/assets/uri.ts` | 入力相対URLの1回decode。生成相対URLの検査も共通化する |
| `src/ts/adapters/node-assets.ts` | Markdownの親を基準に実体とrootを検査。出力先を基準にしたURL生成、prefix読取り、欠落参照の記録を追加する |
| `src/ts/core/article-sanitizer.ts` | `img`のsrcを画像処理へ渡す。警告後に未検査の元srcが残らないようにする |
| `src/ts/core/image-references.ts` | 参照先を記録し、レポートによる画像破壊を防ぐ。警告で継続する参照も完全に記録する |
| `src/ts/core/html-document.ts` | CSPが `img-src data:`。通常モードの相対画像はこのままではブロックされる |
| `src/ts/cli/args.ts` | option、既定、helpを追加する |
| `src/ts/cli/convert-file.ts` | 変換後のrealpath/stat失敗で再び停止する。警告化と衝突検査を分ける必要がある |
| `src/ts/cli/reporting.ts` | schemaVersionは1。fallbackの空statsも新しい型に合わせる |
| `tests/cli-failures.test.ts` | 欠落画像をfailureとするケースに加え、欠落参照へのreport書込みを止める重要な回帰ケースがある |
| `scripts/build-bundles.mjs` | package、lockfileの2か所、runtime版の一致を検査している |

内部ファイル名 `image-embedding.ts` と `createImageEmbeddingSession` はこの変更では改名しない。公開API以外まで大量に改名して機能差分を見失わないようにする。

## 3. 公開契約と責務

### 3.1 型の追加案（名前と意味を固定）

```ts
export type ImageMode = 'reference' | 'embed';

export type ConvertOptions = {
  // 既存fieldは継続
  imageMode?: ImageMode;
};

export interface AssetResolver {
  describe(decodedRelativePath: string): Promise<AssetInfo>;
  read(id: string, maxBytes: number): Promise<Uint8Array>;

  // URL生成は存在確認と独立させる。欠落ファイルも指せる。
  reference?(decodedRelativePath: string): Promise<string>;

  // 最大maxBytesの先頭部分。ファイル全体が大きくても成功できる。
  readPrefix?(id: string, maxBytes: number): Promise<Uint8Array>;
}
```

`reference` と `readPrefix` は既存のembed用resolverを壊さないようoptionalにする。`reference` はファイルのコピー・書込み・ネットワークアクセスをしない。root内と確認した元ファイルへの、生成HTMLを基準とする相対URLを返す。

coreはfilesystemの絶対path、CLIの出力path、CWDを知らない。出力先と元画像の関係はNode adapterまたはruntime呼出し側が `reference` で解決する。runtime API利用者が `reference` を実装する際は、自分がHTMLを保存する場所を基準にURLを返す。

- localの非SVG画像を参照する必要があり、`reference` がない場合は `E_ASSET_REFERENCE_REQUIRED` で失敗する。これは画像欠落の警告ではなく、APIの設定不足。
- `imageMode: 'embed'` なら `reference` は不要。
- data URLとraw inline SVGだけの文書にはresolverが不要。
- local SVGだけなら `describe/read` で処理できる。SVGと判明する前に `reference` 不在を理由に失敗させない。
- local画像にresolverそのものがない場合の `E_ASSET_RESOLVER_REQUIRED` は維持する。
- 不正なimageModeはruntimeの `E_OPTIONS`、CLIのusage error / exit 2。
- `reference` が絶対path、file URL、remote URL、不正escape等を返した場合はadapterの契約違反としてTypeError。想定されるroot逸脱・別drive等はadapterがAssetAccessErrorで返す。
- 生成hrefの検査は `./` / `../` 始まり、raw control文字なし、既存classifyImageSourceでlocalに分類できることを条件にする。検査でdecodeした値をそのままsrcへ書かず、受け取ったencoded hrefをserializerへ渡す。
- `readPrefix` がないresolverは、検査上限以内なら既存の `read` で代用する。上限を超え、種別を判断できない場合は警告し画像を省略する（無制限読取りはしない）。

`readPrefix` のmaxBytesは正のsafe integer、戻り値は `Uint8Array`、長さは `min(maxBytes, describedByteLength)` とする。通常fileが途中で短くなった場合は変更エラーにする。Node adapterではreadと同じroot/identity条件を検査し、必要な長さまでbounded readを行ってhandleをfinallyで閉じる。これは完全な画像検証ではない。

### 3.2 Node adapterと相対URL

`NodeAssetResolver.create(markdownFile, assetRoot?, outputFile?)` とし、既存2引数の呼出しを維持する。CLIは `input.realPath`、`options.assetRoot`、`outputTarget.path` を渡す。

1. 画像の解決起点は既存の `base`（入力Markdown実体の親）を維持する。`--asset-root` は許可範囲だけを変える。
2. 元画像候補は `path.resolve(base, decodedRelativePath)`。正規化した候補と、存在する親までrealpathした候補の両方がroot内か検査する。
3. 欠落fileでも、最長の既存親を調べてsymlinkによるroot外参照を防ぐ。`canonicalPotentialPath` を新設する `src/ts/adapters/node-paths.ts` へ移し、相対URL生成helperも同fileへ置く。既存 `cli/path-identity.ts` は新helperのre-exportにして呼出し側の互換を保つ。Node adapterからCLI配下をimportしない。
4. URL生成用の画像pathは元の候補pathを使う。検査用realpathの最終targetに置き換えない。root内symlinkを通した元の配置を尊重する。
5. `path.relative(path.dirname(path.resolve(outputFile)), candidate)` を `/` 区切りにし、各segmentを `encodeURIComponent` する。日本語・space・`%`・`#`・`?`をURLとして正しく表す。URL全体をencodeして `/` を消さない。
6. `..` は生成URLの正当なsegmentとして許可する。root検査はMarkdownから元画像への解決に適用し、HTMLから元画像へ戻るための `..` を拒否しない。
7. 生成URLは必ず `./` または `../` で始める。schemeや `//` と誤認される先頭を作らない。HTML属性のescapeはHAST serializerに任せる。
8. outputFile未指定でreferenceを呼ばれた場合、またはWindowsで別driveになり相対URLを作れない場合は `E_IMAGE_REFERENCE`。coreは警告して `src` を省略する。絶対file URLへfallbackしない。
9. Node adapterは入力Markdown directoryと出力fileのcanonicalな親directoryを使ってURLを計算する。macOSの`/var`と`/private/var`のようなfilesystem aliasで相対pathがずれないようにする。別のsymlink alias経由でHTMLを開いた場合の相対URL解決は保証しないことを文書化する。書込み衝突検査はcanonical pathで別に行う。

例:

```text
Markdown: /project/docs/guide.md
元画像:   /project/docs/img/a.png
入力src:  img/a.png

出力 /project/docs/guide.html    -> ./img/a.png
出力 /project/preview/guide.html -> ../docs/img/a.png
```

### 3.3 統計・JSON report

`ConversionStats` に次を追加し、`converter.ts` と `reporting.ts` の初期値を揃える。

```ts
embeddedImageOccurrences: number;
referencedImageOccurrences: number;
omittedImageOccurrences: number;
```

- successで完全走査できた場合、上記3項目の和が `imageOccurrences` になる。
- `embeddedImageOccurrences`: 最終HTMLで画像data URLを持つimg数。SVGと入力data URLを含む。
- `referencedImageOccurrences`: 最終HTMLで生成した相対srcを持つimg数。欠落警告のまま残した参照を含む。
- `omittedImageOccurrences`: 警告によりsrcを省略したimg数。altは保つ。
- `embeddedPayloadBytes`: 実際に埋め込んだBase64 payloadの出現回数分のみ。参照画像を加えない。
- `uniqueAssets` / `uniqueSourceAssetBytes`: describeに成功したローカル実体と検証できたdata URL/inline SVGをid単位で集計する。欠落fileは不明なので加算しない。describeできた参照画像は、全bytesを読まなくても既知サイズとして加算できる。
- hrefのcacheは元のdecoded path単位、読取りcacheはid単位にする。同じidへの異なる参照URLを取り違えない。
- failureのstatsは従来どおり途中まで。成功時の和の条件をfailureに強制しない。
- reportは `schemaVersion: '2'` とし、`output.imageMode: 'reference' | 'embed'` を追加する。stdoutは既存の1行summaryを継続し、警告はstderrとreportへ出す。

## 4. 警告・エラー・出力srcの判断表

以下のローカルfile検査の警告化は両モードに適用する。`AssetErrorCode` のE系はadapterの内部通知として残し、画像処理内の限定した箇所で対応するW系診断へ変換する。`mapAssetError` 全体をwarningへ変えない。

| 状況 | 診断 | referenceモードの出力 | embedモードの出力 |
| --- | --- | --- | --- |
| ローカルの受理できる非SVG画像 | 必要に応じ容量・画素数warning | 元画像への相対src | 元bytesのdata URL |
| 検証できたSVG | 必要に応じ容量warning | data URLへ埋め込む | 同左 |
| 元画像欠落 | `W_IMAGE_NOT_FOUND` | 安全に計算した相対srcを残す。`.svg`は省略 | src省略 |
| 読取不能・通常fileでない | `W_IMAGE_READ` | 安全な非SVG候補の相対srcを残す。`.svg`は省略 | src省略 |
| 非SVGの未知形式/対応外形式 | `W_IMAGE_FORMAT` | 安全な相対srcを残す。表示可否はbrowserに依存 | src省略 |
| 非SVGの検出可能な破損/不正寸法 | `W_IMAGE_INVALID` | 安全な相対srcを残す | src省略 |
| root外・root外symlink | `W_ASSET_OUTSIDE_ROOT` | src省略、root外の内容は読まない | src省略 |
| describe/read間に実体変更 | `W_ASSET_CHANGED` | 参照を再び安全と確認できた場合だけsrcを残す。再読取りしない | src省略 |
| 相対URL生成不能 | `W_IMAGE_REFERENCE` | src省略 | referenceを呼ばない |
| 非SVGの全体検査を容量上限でskip | `W_IMAGE_INSPECTION_SKIPPED` | prefixで対応ラスターと確認できた場合は参照を残す。種別不明はsrc省略 | このskip方式を使わない |
| `.svg`欠落・読取不能 | 上記のfile warning | src省略 | src省略 |
| SVGの不正XML、危険要素・CSS、非対応構造、外部resource | 既存 `E_SVG_*` | HTMLを成功扱いで返さない | 同左 |
| 入力data URLの不正Base64/MIME/画像内容 | 既存 `E_IMAGE_URI` / `E_IMAGE_INVALID` 等 | error | error |
| remote、file URL、絶対path、不正な入力相対URL | 既存 `E_REMOTE_IMAGE` / `E_IMAGE_URI` | error | error |
| resolver不足・reference実装不足 | `E_ASSET_RESOLVER_REQUIRED` / `E_ASSET_REFERENCE_REQUIRED` | error | 必要なresolver不足だけerror |
| 入出力衝突・HTML/report保存失敗 | 既存 `E_OUTPUT_*` / `E_REPORT_WRITE` | error | error |
| resolverが不正metadata/型/生成URLを返す、予期しない例外 | 既存の内部例外経路 | CLI exit 3 | 同左 |

補足:

- 「警告だけ」はCLI exit 0 / runtime `success: true` / report `success: true`。ほかのerrorがある場合はそのerrorに従う。
- `src` を省略するときは、検査前の入力srcやpending placeholderを残さない。alt/title/妥当なwidth/heightは保つ。
- ファイル拡張子だけで成功時の形式を決めない。内容がSVGなら `.png` という名前でもSVG検証・埋め込み経路へ送る。`.svg`の拡張子は読取不能時の省略判断と、内容を検査する必要性の手掛かりとしてのみ使う。
- SVGのXML/CSS安全性失敗を単なる形式warningへ落とさない。未知形式catchの前に `E_SVG_*` を識別する。
- 実装が完全に理解している範囲の `AssetAccessError` だけを警告化する。予期しない例外、E_OUTPUT_TOO_LARGE等を一括で握りつぶさない。
- 例外として、非SVG参照の全体検査で `read(id, inspectionLimit)` 自体が上限を通知した場合だけは `W_IMAGE_INSPECTION_SKIPPED` とし、追加readをしない。prefixで種別を確認できていれば安全な相対参照を残し、それ以外は省略する。SVG/embedのread、出力見積り、最終HTMLで起きた `E_OUTPUT_TOO_LARGE` はこの変換の対象外。
- 同じ変換内の同じ画像・同じ理由は1回だけ警告し、最初のMarkdown source位置を使う。絶対内部path、画像bytes、Base64、stackは診断へ出さない。
- SVG/data URL/HTMLの埋め込み結果が出力上限を超える場合は `E_OUTPUT_TOO_LARGE`。画像検査warningに置き換えない。

## 5. 画像処理の順序

### 5.1 共通coreの処理

1. `validateRequest` でimageModeを正規化する。
2. parsed HASTのローカル画像参照を、警告や早期失敗の前に漏れなく記録する。既存の `recordLocalImageReferences` を活用する。
3. 各imgを処理する際は元srcをローカル変数へ退避し、未検査srcが出力へ残らないようにする。
4. URL分類後、data URLは既存検証・埋め込みを行う。
5. ローカル画像はdescribeを試みる。file検査の想定失敗は第4節へ送る。欠落非SVGでもreference callbackから安全なURLを計算できれば保持できる。
6. 読取り可能な画像はprefixまたはcacheした全bytesから種別を判断する。SVG候補は必ず既存SVG検査・埋め込み経路へ送る。
7. `reference` の非SVGは、reference callbackの生成URLをcoreでも検査する。範囲外warningならsrcを落とす。検査できた画像情報から容量/寸法warningを出し、相対srcを設定する。
8. `embed` の非SVG、両モードのSVG/data URLだけを埋め込み用pendingに置く。参照画像のbyteLengthはBase64容量見積りへ加算しない。
9. 第二段sanitizer後にpending nodeをrebindし、許可された参照srcが残っていることをテストする。現在のsanitize schemaは相対URLを許可するので、安易に `src` の許可schemeへhttp/fileを追加しない。
10. 出力見積り、埋め込みpendingの読取り、最終出力上限判定を行う。preflightで欠落等がwarningへ変わる場合も、placeholderを最終HTMLへ残さない。
11. 最終treeから3種類のoccurrenceと実payloadを確定し、HTMLと統計を返す。

`prepare` / `pendingSizeDelta` / `embedPending` の各責務を明示して変更する。特に、現状の「全ローカル画像がBase64へ展開される」という `pendingSizeDelta` の前提を残さない。参照画像はその相対URLの実際のUTF-8長だけを数える。

画像専用の診断変換は `image-embedding.ts` 内の内部helper `mapLocalImageFailure` にまとめる。E系からW系への対応を固定Mapで定義し、SVG/data URLの検証経路からこのhelperを呼ばない。公開error型へW系を追加する必要はない。

### 5.2 prefix判定の実装範囲

`assets/image.ts` に既存の先頭判定を共有する内部関数を作る。SVG判定（先頭256 bytesの既存規則）とPNG/JPEG/GIF/WebPのmagic判定を `inspectImage` と参照経路で共有し、判定表を二重管理しない。

- Node adapterのreadPrefix上限は256 bytes。
- prefixでSVG候補の場合、prefixだけで安全としない。全体を既存SVG parserへ渡す。
- `.svg`でprefixが不明の場合もSVGの全体検査を試みる。既知ラスターmagicの場合は内容の形式を優先する。
- prefixが未知で上限以内なら全体検査を試みる。未知の巨大fileは無制限に読まずwarning＋src省略。
- 検査中に分かった実体変更はwarningとし、安全確認できない参照は省略する。

## 6. 容量と読取り制限

通常モードでHTMLを小さくしても、ブラウザーで画像を復号する際の画素数と負荷は変わらない。そのため5 MiB画像warningと40-million-pixel warningは継続する。messageは「embedded at its original size」を両モードへ一律に出さず、参照/埋め込みの状態に合う内容へ変更する。

- 最終HTML上限: 既存のdefault 100 MiB / CLI指定1..1024 MiBを継続。
- HTML警告: 既存20 MiB超を継続。
- 参照する非SVGの全体検査上限: **固定100 MiB**。これは新しい検査資源上限として文書化する。HTML上限を小さくしても参照画像の検査上限は変わらない。新CLI optionは追加しない。
- 100 MiBちょうどは全体検査、超過はprefix検査まで。対応ラスターmagicが確認できれば相対srcを残し、`W_IMAGE_INSPECTION_SKIPPED` を出す。全体をbufferへ読み込まない。
- SVGとembed用画像の読取りは、従来の埋め込みpayload予算・出力preflightで制限する。SVGの内部にdata rasterがある場合もouter SVGの実payloadに含める。
- SVGとdata URLの容量を無条件に免除しない。大きなSVGも出力上限に従う。
- prefixのみで受理した参照画像は完全な破損検査と寸法検査ができない場合がある。その場合は検査skip警告に理由を含め、画素数の検証済みとは報告しない。

## 7. CSP・ブラウザー読込み

`renderDocument` に正規化済みimageModeを渡し、画像ポリシーを固定文字列から選ぶ。

- reference: `img-src data: file: 'self'`
- embed: `img-src data:`

`file:` はローカル起動用、`'self'` はHTTP(S)で同じ配置を配信した際の同一origin画像用。`file://`のoriginには実装差があるため、ローカル表示を `'self'` だけに依存させない。その他のCSP（connect、script hash、object、base等）の役割は継続する。`img-src *` や `https:` 全般の許可へ広げない。

画像は通常の `<img src="相対URL">` で表示する。`fetch`、XHR、Blob registry、JSによるsrc後付け、`crossorigin` は使わない。JavaScriptを無効にしても本文と画像が読めることを受入条件にする。

`file:`を許可するCSPはasset-rootのディレクトリ境界を表現するものではない。core/adapterで参照を検査し、root外のsrcを出さないことが必要。

## 8. CLIの再確認と出力保護

ここは欠落画像をwarningにする際の必須回帰対策。`convert-file.ts` の `getAssetPaths()` に対するrealpath/stat loopをそのまま残すと、coreがwarningで成功してもCLIが再びerrorで停止する。

1. 相対参照の記録をdescribe成功とは独立させる。欠落・範囲外・変更を検出した参照先も、出力衝突判定に必要な候補pathとして残す。
2. 変換後の「出力衝突検査」と「画像の状態再確認」を分ける。画像1が欠落しても、後ろの画像2とreportの衝突検査を飛ばさない。
3. HTMLとreportの両方について、全参照候補のlexical path、canonicalPotentialPath、得られたdev/inoを比較する。欠落画像と同じpathへreport/HTMLを新規作成することも `E_OUTPUT_COLLISION` で拒否する。
4. 存在する画像実体のhardlink、root内symlink、入力、HTML、reportの衝突保護を維持する。`--force`でも許可しない。
5. core処理中に発見した画像消失・変更は第4節に従い、その時点でsrc保持/省略を確定する。coreが返した後は、CLIが元画像を再読取りしてHTML文字列を正規表現等で修正することはしない。CLI側の衝突検査で元fileの消失・変更が分かった場合は `W_ASSET_CHANGED` を追加できるが、確定済みHTMLを画像I/Oだけでerrorへ戻さない。embedで確定したdata URLも維持する。生成後の参照元変更は第1節の動的な参照として扱う。
6. canonical化の失敗等で出力を安全に書けるか証明できない場合は、出力I/Oの失敗として停止する。画像警告にして危険な書込みを続けない。
7. failure reportだけでなくsuccess reportにも同じ衝突防止条件を適用する。`reportCanWrite` がfailure経路専用のままにならないよう確認する。
8. 画像warningしかなければ通常のstage/commitへ進み、stdout summary、exit 0、report success=trueを返す。report保存失敗等は従来のexit規則に従う。

既存の `failureReportDoesNotOverwriteAsset` と共通化できる判定を内部helperへまとめる。ファイル書込み保護のための失敗を、第4節の画像warning変換関数へ渡してはいけない。

## 9. Luna向けの実装手順

各段階の完了条件を満たしてから次へ進む。変更を分担する場合も、types/core/adapterの契約をこの順で固定してから行う。

### Step 0: 開始時確認と版候補検証

- [x] 適用対象のAGENTS、明示されたskill、現在のbranch/HEAD/statusを読み直す。`-done` branchでは変更しない。
- [x] 現在版とこの計画の前提を照合する。開始時に版が `0.4.0` から変わっていれば、利用者指定のminor incrementを現在版へ適用し、`0.5.0`へ戻す編集はしない。
- [x] 第11節のmiku-scm READONLY preflightを実行し、候補を記録する。実装開始の依頼を受ける前には実行・版編集を先行させない。

### Step 1: 型、option、診断、統計の契約

- [x] types/indexへ第3節の型とexportを追加する。
- [x] converterのoptions検証へimageModeを追加する。
- [x] CLI argsのvalueOptions、parse結果、equals形式、重複/不正値のusage error、helpを対応する。
- [x] 第4節のallowlistだけを変換する画像専用warning helperを作る。既存mapAssetErrorの意味は維持する。
- [x] stats初期値とschemaVersion 2、output.imageModeを対応する。

### Step 2: Node adapterのURL生成とbounded prefix読取り

- [x] 第3.2節のURL helperを純粋関数として分ける。pathの相対化とURL encodeのテストを先に整える。
- [x] `adapters/node-paths.ts` を追加して最長既存親のcanonical化と相対URL生成を置く。`cli/path-identity.ts` はre-exportにし、既存のCLI利用も同じ処理にする。
- [x] reference callbackを実装し、欠落パスでもroot内確認、root外symlink拒否、参照記録を行う。
- [x] readPrefixを実装し、通常readと共通のidentity/root確認、bounded read、handle解放を守る。

### Step 3: 共通画像処理と容量評価

- [x] 第5節の種別判定とmode分岐を実装する。画像処理をCLIだけに実装しない。
- [x] reference callbackの必要性をSVG分類後に判断する。
- [x] warningの各ケースでsrc保持/省略、alt保持、cache、診断重複排除を対応する。
- [x] SVG/data URLとembedモードだけを埋め込みpendingへ入れる。参照画像をBase64見積りから除く。
- [x] sanitizer後の参照src保持とpending nodeのrebindを確認する。
- [x] 成功時の統計の不変条件、HTML上限、独立した検査上限を対応する。

### Step 4: CSPとCLIの出力保護

- [x] 第7節のmode別CSPを適用する。
- [x] CLIからresolverへHTML出力先とmodeを渡す。
- [x] 第8節の衝突検査を実装し、画像warningでsuccessになる経路のreport安全性も確認する。
- [x] 変換後の画像欠落を不用意にerrorへ戻すrealpath/stat処理を除く。

### Step 5: 意味のある回帰テストとbundle smoke

- [x] 第10節のテストを追加・変更する。旧埋め込み契約の検査は明示 `imageMode: 'embed'` に移し、byte保存・GIF・容量検査を捨てない。
- [x] refactoring-contractのsnapshotは、新mode・schema・統計による意図した差分だけ更新する。見出し、脚注、sanitizer、コード色付けの不一致をまとめて受け入れない。
- [x] 既存の110テストという過去記録を新しい合格数として使わない。実際の結果を記録する。
- [x] CLI/runtime/staged releaseのsmokeへ参照モードとembedモードを追加する。作業tree外へ配布bundleをコピーした検証を維持する。

### Step 6: 版・文書・最終確認

- [x] 第11節の一括版更新を行う。
- [x] 第12節の現行仕様文書を更新する。過去の実装・測定記録は日付つき履歴として残す。
- [x] 第13節の確認を行い、未確認のNode/browser条件を完了と記載しない。
- [x] この計画へ実装結果を追記し、TODOの当該タスクだけを実績に沿って更新する。

## 10. 必須テスト表

| ID | 対象・操作 | 期待結果 | 主な配置先 |
| --- | --- | --- | --- |
| P01 | option省略 / reference / embed / 不正値 / 重複 / equals形式 | default reference、正しいruntime/CLI失敗分類 | core / CLI tests |
| P02 | MarkdownとHTMLが同じdirectory、出力先が別directory、異なるCWD | 元画像を指す正しい相対src | node-assets / CLI tests |
| P03 | 日本語・space・`#`・`?`・`%`を含む元画像名 | 1回decodeと正しいsegment encode。URLから元fileへ解決できる | URI / node-assets tests |
| P04 | PNG/JPEG/GIF/WebPと同じ画像の反復 | defaultはdata URLなし、コピーなし、反復分はsrcだけ。embedは元bytes復元可能 | image-embedding tests |
| P05 | SVG file / inline SVG / SVG data URL / SVGを含む.png | 既存検証を通して両modeで埋め込み、SVG subtreeを本文へ直挿入しない | core tests |
| P06 | 元からラスターdata URL | 両modeで検証・埋め込み維持 | core tests |
| P07 | 欠落非SVG / 欠落SVG / 読取不能 / 非通常file | 判断表のW系、正しいsrc保持/省略、alt保持、warningだけならexit 0/report success | core / CLI tests |
| P08 | root外の `..` / root外symlink / 欠落fileの親がroot外symlink | warning＋src省略、内容readなし。後続画像も処理される | node-assets / image tests |
| P09 | 不正ラスター / 未知形式 / 不正SVG / remote / 不正URL | 前二者はW、SVG安全性とURLはE。Eがある場合はHTML成功出力なし | core tests |
| P10 | missing resolver / missing reference callback / 不正callback戻り値 / 予期しない例外 | 設定不足Eと内部例外を区別。未知例外をwarningにしない | core / CLI-failures tests |
| P11 | 同一idの別path、連続・並行convert | hrefの取り違えなし、cacheと診断がconvert間で漏れない | image-embedding tests |
| P12 | 1 MiBのHTML上限＋6 MiB画像 | referenceは検査でき、HTMLが収まれば成功。元画像容量を出力見積りへ加えない | core / CLI tests |
| P13 | 参照画像検査100 MiBちょうど/超過、巨大未知file | mocked resolverでread予算とskipを検査。巨大な実fixtureを常設しない | image-embedding tests |
| P14 | SVG/data URL/embedのHTML上限ちょうど/1 byte下 | 既存の正確な上限、明らかな超過はread前停止 | core / image tests |
| P15 | 5 MiB画像ちょうど/超過、40M pixelちょうど/超過、20 MiB HTMLちょうど/超過 | 等しい時は警告なし、超過だけwarning。modeに合うmessage | core tests |
| P16 | 画像1消失＋後続画像2がreport先、missing画像pathがreport/HTML先 | 衝突を必ずEで検出し、画像/欠落画像pathへ何も書かない | CLI-failures tests |
| P17 | 参照画像が変換後に消失/変更、出力衝突なし | 想定file warningで継続。output安全性errorはwarning化しない | CLI-failures tests |
| P18 | symlink/hardlink出力、stage/commit失敗、report失敗、同時no-force作成 | 既存の書込み保護・部分成功状態を維持 | output-files / CLI-failures tests |
| P19 | 完全successの統計、欠落参照ありの統計、report fallback | schema 2、mode、3分類合計、実embeddedPayload、未知bytesを捏造しない | image / CLI tests |
| P20 | mode別CSPとsanitizer | defaultで安全な相対srcが残る。embedはdata限定。script/event/fetch許可を増やさない | core tests |
| P21 | copied CLI/runtime/final staged asset | 新modeが実際に動き、0.5.0版と3配布assetの名前が一致 | smoke scripts |

ブラウザー受入確認は第13節。NodeのHTML文字列assertだけをもって `file://` 表示確認済みとしない。

## 11. miku-scmによる予定版更新

利用者指定はminor incrementでpatchを0にする `a.b++.0`。現在の既知の版源は以下4値。

| 編集対象 | JSON field / literal | 現在 | 予定 |
| --- | --- | --- | --- |
| `package.json` | version | 0.4.0 | 0.5.0 |
| `package-lock.json` | version | 0.4.0 | 0.5.0 |
| `package-lock.json` | packages[""].version | 0.4.0 | 0.5.0 |
| `src/ts/index.ts` | exported version | 0.4.0 | 0.5.0 |

実装開始時に、インストール済みmiku-scm skillから固定runnerを呼ぶ。現在環境の実行形:

```sh
node /Users/igapyon/.codex/skills/igapyon-miku-scm/scripts/miku-scm-run.mjs \
  --format human version.increment.validate \
  --repo /Users/igapyon/Documents/git/miku-md2html \
  --version-file package.json \
  --policy semver --level minor --validate-increment
```

環境が変わった場合はskillのインストール先と対象repo pathを解決し直す。`--format` はworkflow IDより前に置く。SemVerで `--coupled-version-file` は使わず、上記4値の一致をローカルで確認する。preflightをapplyやcommitと誤認しない。

候補と開始状態を確認してから4値を一括更新する。dependency版を変更せず、lockfile全体を無関係に更新しない。READMEの実行例、現行仕様の現在版、report例も予定版へ揃える。過去の日付つき記録の0.3.x/0.4.0を一括置換しない。

版一致は既存 `scripts/build-bundles.mjs` の検査と、CLI --version / runtime.version / report.tool.version / staged asset名の検査を使う。

予定される配布asset:

- `miku-md2html-0.5.0.mjs`
- `miku-md2html-runtime-0.5.0.mjs`
- `miku-md2html-sources-0.5.0.tgz`

stage、commit、tag、push、Release公開はこの実装計画に含めない。版更新だけの先行実行も今回の計画作成では行わない。

## 12. 更新する文書

| 文書・設定 | 更新内容 |
| --- | --- |
| `README.md` | 製品説明、通常モードの元画像依存、コピーなし、両mode実行例、警告継続、移動/配布条件、0.5.0移行案内 |
| `package.json` のdescription | 常にself-contained出力であるという説明を修正 |
| `docs/cli.md` / CLI help | image-mode、asset-root、相対化基準、file warningのexit 0、schema 2、出力衝突error |
| `docs/api.md` | options、resolver/reference/readPrefix契約、旧resolverのembed移行例、統計の定義 |
| `docs/implementation-spec.md` | REQ-001周辺の成果物、REQ-040..052、CSP、API、report schemaと診断、対応するACを改訂 |
| `docs/completion.md` | current版と現在の動作を更新。過去の全埋め込み測定はそのmodeの履歴として残す |
| `docs/development.md` | 決定理由、変更した公開契約、版preflight、実行結果・未確認項目を追記 |
| `TODO.md` / この計画 | 実際の完了状態、Node/browserの残項目 |

製品固有のAgent Skillは別repo `miku-md2formats-skills` が配備先。本repoの実装時に他repoやインストール済みskillを直接書き換えず、`0.5.0` のdefault変更、schema変更、runtime optionを下流更新時の申し送りとして記録する。インストール済みの古いruntimeが新仕様を実装済みとは扱わない。

## 13. 検証の実行順と完了条件

実装時だけ次を実行する。検査で差分や失敗が出た場合は関連する段階だけ繰り返す。

1. `npm run build` の後、以下のfocused testsを実行する。
2. `npm test`（既存buildを含む全unit/CLI検査）。
3. `npm run build:bundle`。
4. `npm run smoke:bundle` と `npm run smoke:runtime`。
5. `npm run release:stage`、続けて `npm run smoke:release-assets`。release:stageはignoredの `release-assets/` を再作成する。既存出力を保持すべき事情がある場合は記録し、独立した作業copyで実施する。生成bundleを手編集しない。
6. 利用可能なNode 22と24で同じ契約を確認する。利用できない版は未確認として残し、Node 26等の結果と混同しない。ツール導入を無断で追加しない。
7. Chromeの通常設定で、異なるdirectoryに出力したHTMLを `file://` から開く。PNG/JPEG/GIF/WebP、SVG、同じ画像の反復、space/日本語/encoded #?、欠落画像を確認する。
8. 同じfileをJavaScript無効で開き、相対画像とSVGが表示されることを確認する。security/CORSを無効にする起動flagは使わない。CSP違反で画像が消えていないか確認する。
9. HTTP(S)等の外向きnetwork requestがないことを記録する。ローカルfile画像の読込みをnetwork通信と取り違えない。ブラウザー名/版と開いた構成を記録する。
10. embedモードのHTMLだけを元画像と異なる場所へ移動して開き、受理した画像が表示されることを確認する。referenceモードは元配置を必要とすることも記録する。
11. `git diff --check`、最終diff、`git status -sb`を確認し、無関係な差分や絶対内部pathのHTML/診断漏れを点検する。

実装完了は、default参照・SVG埋め込み・欠落warning・出力保護・API/CLI整合・版一致を確認し、文書が実際の動作を表していること。実行できなかった必須条件は未確認と明記して引き継ぐ。

focused testsの実行形（インストール済みのVitestを使い、新規downloadをしない）:

```sh
./node_modules/.bin/vitest run \
  tests/uri.test.ts tests/node-assets.test.ts \
  tests/image-embedding.test.ts tests/core.test.ts \
  tests/cli.test.ts tests/cli-failures.test.ts \
  tests/output-files.test.ts tests/refactoring-contract.test.ts
```

### 実装結果（2026-10-24）

- 予定どおり `0.4.0` から `0.5.0` に更新し、`package.json`、`package-lock.json` の2値、runtime versionを一致させた。
- focused testsは8 files / 60 tests、`npm test` は10 files / 124 testsで成功。Nodeは `v26.12.0`。
- `npm run build:bundle`、copied CLI smoke、runtime smokeが成功。別の一時directoryへrepoのbundleとstage/smoke scriptをコピーして3つの0.5.0 release assetを生成し、release-asset smokeも成功した。一時directoryは削除し、既存のignored `release-assets/`（0.3.5）を保持した。
- Chromeで `file://` のreference-mode HTMLを開き、元Markdown directoryから別directoryにあるPNGが表示されることを確認した。embed-mode HTMLを画像のないdirectoryへコピーしてもPNGが表示された。
- 完了していない受入確認: Node 22/24、JavaScript無効、320px、print、外向きnetwork requestの記録、JPEG/GIF/WebP/SVG・日本語等のencoded path・欠落画像を含むChrome一括matrix。20 MiB HTML警告境界もTODOに残す。
- Git indexへのstage、commit、tag、push、GitHub Release/npm公開は行っていない。下流の `miku-md2formats-skills` とインストール済みskillも変更していない。

## 14. 参照と作業境界

- 明示適用中の `igapyon-miku-soft-developer`: architecture / maintenance / Node app / CLI契約。製品変更はこの計画の範囲に限定し、共有skillの改善は行わない。
- `igapyon-repo-conventions` は開発skillのbaselineとして読んだ。本計画は既存 `docs/` とTODOの配置に従い、repo設定の変更は含めない。
- 明示された `igapyon-miku-scm`: `references/version-increment.md` と `references/version-workflow-runner.md`。上記版更新手順の根拠。
- [MDN: img-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/img-src): CSPが画像の許可元を制限する。
- [MDN: crossorigin](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/crossorigin): 通常のimgとCORSを使う取得の区別。
- [MDN: same-origin policy / file origins](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy#file_origins): file originの実装差。

本書で具体化したAPI名、mode名、warning時のsrc、100 MiB検査上限、schema 2は、`0.5.0` の実装・文書・テストで確認した製品契約になった。Node 22/24と第13節に記したブラウザーmatrixは未確認のままであり、計画時の合格条件を満たしたとは扱わない。
