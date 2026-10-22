# Initial implementation and verification

Date: 2026-10-22

## Implemented

The initial Node implementation is in `src/ts/`. It provides a filesystem-free conversion core, a Node asset resolver, and a CLI with staged output and optional JSON reports. It renders CommonMark/GFM, front matter, headings and footnotes; sanitizes author HTML; validates SVG and its CSS; embeds local raster images, SVG files, data URLs, and inline SVG in one self-contained HTML document. Editable viewer CSS/JavaScript are embedded during bundle generation. The repository also contains API/CLI/development documentation, a generated license inventory with available full license texts, and CLI/runtime/source bundle builders. The current package and runtime version is `0.3.0`, as requested after the initial `0.1.0` implementation.

Initial product choices in the implementation specification remain defaults, not individually user-confirmed limits. The 5 MiB image warning, 20 MiB output warning, and 100 MiB output cap were not changed after the measurements below; these measurements do not establish browser limits or performance guarantees.

## Automated checks

- `npm test` — passed on Node `v26.12.0`; 3 test files, 16 tests.
- `npm run smoke:all` — passed. This typechecks, rebuilds both standalone ESM bundles and the source archive, and checks copied CLI/runtime bundles from temporary directories outside the repository.
- `npm run licenses` — generated the inventory for 207 locked package/version entries. Available license texts are included and deduplicated; 52 optional platform entries have no license file installed on this host, with their declared identifiers retained in the inventory.
- A trailing-whitespace scan over the repository source/docs found no matches.

The current automated tests cover deterministic HTML/title/heading IDs, GFM tables/task lists/footnotes, basic raw HTML sanitization, data URL images and repeated-asset accounting, SVG/CSS rejection cases, output byte limit behavior, resolver path containment/symlinks, CLI reports/collisions/UTF-8/input caps, and both bundle entrypoints. They do not yet cover every AC in the implementation specification; see the remaining items in `TODO.md`.

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
- Exact large-image/output warning boundaries, maximum-pixel warning, report-commit failure, and concurrent output creation races.
- A fresh dependency audit and license-obligation review immediately before public release.
- Any release workflow, tag, commit, push, GitHub Release, npm publication, or upload.
