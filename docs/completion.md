# Initial implementation and verification

Date: 2026-10-22

## Implemented

The initial Node implementation is in `src/ts/`. It provides a filesystem-free conversion core, a Node asset resolver, and a CLI with staged output and optional JSON reports. It renders CommonMark/GFM, front matter, headings and footnotes; sanitizes author HTML; validates SVG and its CSS; and handles local images. Up to `0.4.0`, the default embedded local rasters into the HTML. Version `0.5.0` changes the default to relative references for local raster images while continuing to validate and embed SVG files, data URLs, and inline SVG. `--image-mode embed` preserves portable single-file output for supported local rasters. Editable viewer CSS/JavaScript are embedded during bundle generation. The repository also contains API/CLI/development documentation, a generated license inventory with available full license texts, and CLI/runtime/source bundle builders. The initial package/runtime implementation was `0.3.0`; a later syntax-highlighting milestone reached `0.3.2`.

Initial product choices in the implementation specification remain defaults, not individually user-confirmed limits. The 5 MiB image warning, 20 MiB output warning, and 100 MiB output cap were not changed after the measurements below; these measurements do not establish browser limits or performance guarantees.

## Automated checks

- `npm test` — passed on Node `v26.12.0`; 3 test files, 16 tests.
- `npm run smoke:all` — passed. This typechecks, rebuilds both standalone ESM bundles and the source archive, and checks copied CLI/runtime bundles from temporary directories outside the repository.
- `npm run licenses` — generated the inventory for 207 locked package/version entries. Available license texts are included and deduplicated; 52 optional platform entries have no license file installed on this host, with their declared identifiers retained in the inventory.
- A trailing-whitespace scan over the repository source/docs found no matches.

The current automated tests cover deterministic HTML/title/heading IDs, GFM tables/task lists/footnotes, basic raw HTML sanitization, data URL images and repeated-asset accounting, SVG/CSS rejection cases, output byte limit behavior, resolver path containment/symlinks, CLI reports/collisions/UTF-8/input caps, and both bundle entrypoints. They do not yet cover every AC in the implementation specification; see the remaining items in `TODO.md`.

## Follow-up boundary verification

On 2026-10-22, the core tests were extended to check the image-dimension warning boundary: an image declaring exactly 40,000,000 pixels has no warning, while one declaring 40,008,000 pixels returns `W_LARGE_IMAGE_DIMENSIONS`. The fixture edits only the dimensions in a tiny PNG header; it avoids allocating a large image. Remaining boundary gaps are tracked in `TODO.md`.

`npm test` passed on Node `v26.12.0` after this update: 3 test files, 17 tests.

The Release asset workflow was added at `.github/workflows/release-cli-runtime-bundles.yml`. It checks out the published release tag, requires an exact `v<package.json version>` match, runs on Node 24, tests and smoke-checks the bundles, stages exactly three non-empty assets, and uploads only that staging directory. It has not yet run against a GitHub Release.

## Browser smoke

Following the user's initial target, Chrome alone was checked. The generated `workplace/qa-browser.html` was opened from its `file://` URL. Chrome's accessibility tree showed the document title, table, all headings and TOC links, the embedded SVG image with its accessible name, and the code copy button/content. This confirms that the local file opens and exposes its content to assistive technology; it was not a pixel-layout, responsive/print, JavaScript-disabled, CSP-console, or network-request audit. Firefox and WebKit are outside the initial target.

The QA Markdown and generated HTML are ignored files under `workplace/` and are not part of the source archive.

## Capacity measurements

Environment: Node `v26.12.0`, npm `11.20.0`, macOS Darwin `25.6.0`, arm64, MacBook Pro with Apple M2 and 16 GB memory. Timings measure the core conversion call; importing the runtime and reading the Markdown happen before the timer. Asset reads occur inside the conversion. Peak RSS is the process maximum including startup/runtime load, not a per-call delta.

| Case | Input | HTML | Conversion time | Process peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Markdown | 1,048,576 bytes | 1,054,566 bytes | 34.84 ms | 84.13 MiB |
| One raster image | 6,289,913 bytes (about 6 MiB) | 8,392,381 bytes | 22.97 ms | 135.77 MiB |
| Same image four times | 6,289,913-byte source, four references; about 32 MiB of HTML | 33,552,205 bytes | 73.27 ms | 338.14 MiB |

These are single-run local measurements, not a benchmark series. The repeated-image result confirms the documented per-occurrence payload behavior and also shows substantial memory use for large output. No resizing or external-asset fallback was added.

## Not verified yet

- Node.js 22 and 24: neither is installed in the current environment. Node 26 passing does not establish compatibility with those versions.
- Chrome with JavaScript disabled, at 320px, in print mode, or with network requests instrumented.
- The exact 20 MiB output warning boundary and broader Chrome image/path matrix. Report-commit failure and concurrent output creation are covered by automated tests.
- A fresh dependency audit and license-obligation review immediately before public release.
- The Release asset workflow has not yet run against a GitHub Release. No tag, GitHub Release, npm publication, or upload was created as part of this local change.

## 2026-10-24 image reference mode

Version `0.5.0` defaults to keeping local PNG/JPEG/GIF/WebP images at their original paths and writes output-relative `src` URLs. The CLI does not copy image files. SVG files remain validated and embedded in both modes; data URLs and inline SVG remain embedded. `--image-mode embed` embeds local raster images as before. Expected local-file issues now produce warnings and do not fail an otherwise valid conversion; remote and malformed image URLs, unsafe SVG, resolver contract violations, and output collisions remain errors. JSON report schema 2 records the mode and image occurrence categories.

The implementation plan and acceptance matrix are in [image-reference-plan.md](image-reference-plan.md). On Node.js `v26.12.0`, `npm test` passed with 10 files and 124 tests. The copied CLI/runtime bundles and a temporary 0.5.0 release-asset staging area passed their smoke checks. Chrome opened the default relative-image HTML from `file://`; it also displayed an embed-mode HTML copied away from its original image directory. JavaScript-disabled, 320px, print, and instrumented-network checks remain unverified, as do Node 22/24.

## Syntax highlighting implementation

Date: 2026-10-23. The feature plan and acceptance matrix are in [syntax-highlighting-plan.md](syntax-highlighting-plan.md). The implementation adds conversion-time highlighting for 13 language families using 12 explicit grammars, a fixed language alias map, safe token span reconstruction after sanitization, and embedded light/dark/print CSS. Unknown or unsupported languages remain plain. Per-block and per-document highlighter input caps are 256 KiB and 1 MiB.

The original runtime implementation exact-pinned `lowlight@3.3.0` and `highlight.js@11.11.1`; a later dependency-reduction follow-up replaced lowlight with a local HAST emitter. Dev dependencies include `@types/mdast@4.0.4` and `hast-util-from-html@2.0.3`. `npm audit` found 0 vulnerabilities at initial addition. `npm run build:bundle` regenerated third-party notices for 210 locked package/version entries. Commit `34141b4` records the original implementation and version increment from `0.3.1` to `0.3.2` together.

## Syntax highlighting verification

On Node `v26.12.0`, macOS Darwin `25.6.0` arm64 / Apple M2:

- `npm test` — passed, 4 files and 75 tests.
- `npm run smoke:all` — passed, including CLI/runtime copied outside the repository, release staging, and release-asset smoke checks.
- `npm audit` — 0 vulnerabilities.
- `node22` and `node24` executables were not on `PATH`; those runtimes remain unverified.
- The browser control layer reported both Chrome and in-app browser unavailable, so light/dark, JavaScript-disabled, 320px, print, and network-request checks remain unverified.

The same 1,513-byte Markdown benchmark was converted before and after the change. On this machine, the conversion median excluding the first run changed from 2.316 ms to 4.240 ms; output grew from 12,287 to 19,547 bytes. The CLI bundle grew from 1,606,629 to 1,771,358 bytes and the runtime bundle from 1,583,325 to 1,748,054 bytes. At the configured caps, a 256 KiB code block took 178.272 ms median, a block-limit fallback took 7.911 ms, and four blocks totaling a 1 MiB document budget took 699.735 ms. The process peak RSS across those repeated cap measurements was 265.44 MiB. These are measurements on one host and representative inputs, not performance guarantees. Before/after HTML and measurement data are ignored files under `workplace/`.

Contrast ratios were calculated against the actual code and diff backgrounds. The normal token palette minimum is 4.77:1 in light mode and 7.04:1 in dark mode; diff text minimums are 5.42:1 and 7.16:1 respectively. Browser visual review remains pending.
