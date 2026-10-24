# Development notes

## Initial implementation record

- Date: 2026-10-22
- Target starting revision: `892f1b3d70b8731b53215361788ca83b9c7fa63e` (`devel`); the repository initially contained only `LICENSE`.
- Same-layer reference: `miku-md2docx` at `a25d302c742e6950183d60e0cda88f97bc65a265`.
- Single-file HTML reference: `local-html-tools` at `9e4e8fcb71ddecc055fcc0add6b75c97df70e9d9`.
- Shared skill source: `igapyon-agent-skills` at `5a7376da5db640749e7a9e0a9169221aaeea5cb2`, workflow `10-node-app-workflow`.

The miku-md2docx reference informed the ESM TypeScript package, product core boundary, CLI adapter, Vitest tests, esbuild CLI/runtime bundles, and local smoke scripts. Its DOCX-specific parser/output architecture was not reused. The local-html-tools reference informed keeping the viewer CSS and JavaScript as editable source assets and embedding them during bundle-time conversion. Markdown images need a separate data-URL path; the existing helper does not perform that work.

The detailed product requirements were prepared in the daybook workspace before implementation. The implementation keeps one HTML output, Node-side Markdown rendering, local image handling, an allowlist for raw HTML, parsed SVG/CSS checks, a default 100 MiB output cap, and no automatic image resizing. The exact dependency versions are fixed in `package-lock.json`.

## Build and local workflow

- `npm run build`: TypeScript contract check.
- `npm test`: type check and unit/CLI tests.
- `npm run build:bundle`: produce CLI, import runtime, and source archive under ignored `bundle/`.
- `npm run release:stage`: prepare versioned CLI, runtime, and source assets under ignored `release-assets/`; the version must exactly match `package.json`.
- `npm run smoke:release-assets`: exercise the staged CLI/runtime and inspect the staged source archive.
- `npm run smoke:all`: rebuild bundles, verify both bundle entrypoints, stage release assets, and smoke-test the staged files.

The initial implementation did not include GitHub Actions or Release publication. A Release asset workflow is now documented below; publishing a Release, registry publication, push, and upload remain human-operated GitHub or registry actions.

## Internal module boundaries

`core/converter.ts` owns the conversion stage order and request/result assembly. `core/article-sanitizer.ts` owns article HTML policy, `core/image-embedding.ts` owns per-conversion image state, and `core/document-structure.ts` / `core/html-document.ts` own heading/fragment processing and final document rendering. The CLI entry point remains in `cli/main.ts`; file input, conversion orchestration, output publication, and reporting are split across `markdown-input.ts`, `convert-file.ts`, `output-files.ts`, and `reporting.ts`. These internal modules do not add runtime exports.

This repository does not provide an Agent Skill. Product-specific Agent Skill packaging belongs to `miku-md2formats-skills`.

## 2026-10-23 core and CLI refactoring

- Baseline on Node.js `v26.12.0` / npm `11.20.0`: `npm test` passed with 75 tests and `npm run smoke:all` passed.
- Split heading/document rendering, image embedding state, sanitizer policy, CLI input, output publication, conversion orchestration, and reporting into internal modules. The runtime export surface and version remain unchanged.
- Fixed exact-cap preflight for local images, percent-encoded `#` / `?` image filenames, and CLI/report exit-code classification. Added deterministic tests for output stage/commit failures and no-force destination races.
- Final verification: `npm test` passed (9 files, 97 tests); `npm run smoke:all` passed and staged exactly three release assets for `0.3.3`.
- Node 22/24 and the remaining browser, warning-threshold, and license checks are still unverified; see [TODO](../TODO.md).

## 2026-10-23 version increment

- The miku-scm SemVer patch preflight validated `0.3.3` → `0.3.4` on `devel-tiga1023iab`.
- `package.json`, both package-lock version fields, the runtime version, current CLI examples, and current-version documentation are aligned at `0.3.4`.
- `npm run smoke:all` passed and staged exactly three release assets for `0.3.4`. The changes remain unstaged and uncommitted.

## 2026-10-23 patch increment to 0.3.5

- The miku-scm SemVer patch preflight validated `0.3.4` → `0.3.5` on `devel-tiga1023iab`.
- `package.json`, both package-lock version fields, the runtime version, current CLI examples, and current-version documentation are aligned at `0.3.5`.
- `npm test` passed (9 files, 103 tests); `npm run smoke:all` passed and staged exactly three release assets for `0.3.5`. The changes remain unstaged and uncommitted.

## 2026-10-23 minor increment to 0.4.0

- The miku-scm SemVer minor preflight validated `0.3.5` → `0.4.0` on `devel-tiga1023wdh`.
- `package.json`, both package-lock version fields, the runtime version, current CLI examples, and current-version documentation are aligned at `0.4.0`.
- `npm run build` passed. Release staging derives the CLI, runtime, and source archive filenames from the package version, so their `0.4.0` names are `miku-md2html-0.4.0.mjs`, `miku-md2html-runtime-0.4.0.mjs`, and `miku-md2html-sources-0.4.0.tgz`. Existing local `release-assets/` output was left untouched.

## 2026-10-23–24 runtime dependency reduction (GitHub Issue #5)

- The miku-scm Issue body asks to eliminate runtime dependencies where practical while preserving the conversion and safety contracts. The installed `igapyon-miku-soft-developer` reference was checked on 2026-10-23; source checkout commit `eb05527`; workflow: existing Node application maintenance.
- Removed `image-size` by adding bounded dimension readers for the four supported raster formats, including Apple CgBI PNGs. Replaced `lowlight` with a local HAST emitter over the existing `highlight.js` engine, and replaced direct `unist-util-visit` use with an iterative in-tree visitor. The 11 imported application libraries remain correctly declared as runtime dependencies and are embedded in the released bundles. The installed dependency graph loses `image-size` and `lowlight`, while `unist-util-visit` remains transitive through the Markdown/HTML pipeline. The lockfile notice inventory has 208 package/version entries.
- The local HAST emitter uses Highlight.js's emitter hook, so `highlight.js` remains exact-pinned at `11.11.1`; the syntax-highlighting tests must be run when updating that version. The original lowlight-based design and dependency research remain in [syntax-highlighting-plan.md](syntax-highlighting-plan.md), with the follow-up recorded there.
- The reasons for keeping the runtime dependencies and the build/test tooling inventory are recorded in [runtime-dependencies.md](runtime-dependencies.md).
- The approved Node 22/24 CI alignment remains a separate follow-up in `TODO.md`; it was deferred because this change is limited to the Issue #5 dependency and behavior scope.
- `npm run build`, `npm run licenses`, `npm run build:bundle`, `npm run smoke:bundle`, and `npm run smoke:runtime` passed. Focused core, raster, highlighting, image-embedding, and refactoring-contract verification passed (81 tests).
- After the review fixes, `npm test` passed all 110 tests, including the Apple CgBI PNG regression test. The CLI failure test doubles now complete the normal reference scan before injecting a converter exception, matching the report safety precondition without changing production behavior.
- Existing `release-assets/` output was left untouched because `npm run release:stage` deletes and recreates that directory; the Issue's CLI/runtime bundle checks were run directly instead.

## Verification record

Implementation and initial verification are recorded in [completion.md](completion.md). The user's initial browser target is Chrome. Node 22/24 compatibility remains pending because neither version is installed in the current environment; a Node 26 run does not establish those compatibility claims.

## 2026-10-24 image reference mode and minor increment

- The miku-scm SemVer minor preflight validated `0.4.0` → `0.5.0` on branch `devel-tiga1024aed` before implementation. The four version fields are aligned: `package.json`, both package-lock version values, and `src/ts/index.ts`.
- The default `reference` mode validates local raster headers and contents, then emits a relative URL from the HTML location to the original file. `embed` retains the previous raster embedding behavior. SVG files and input data/inline SVG remain embedded in both modes.
- Added bounded 256-byte prefix reads for files over the fixed 100 MiB reference inspection cap, segment-encoded relative URLs, mode-specific CSP, warning-only handling for expected local image file failures, image occurrence statistics, and report schema 2.
- The CLI checks output collisions against existing and missing referenced image paths. Missing raster references remain in the HTML when a safe relative URL can be made; missing SVG and out-of-root references are omitted.
- Focused tests passed (8 files, 60 tests), then `npm test` passed (10 files, 124 tests) on Node `v26.12.0`. `npm run build:bundle`, copied CLI/runtime bundle smoke checks, and a temporary 0.5.0 release-stage plus release-asset smoke check passed. Existing ignored `release-assets/` for 0.3.5 was preserved. Chrome displayed the reference-mode local PNG from `file://`, and displayed embed-mode HTML after it was copied away from the image. JavaScript-disabled, 320px, print, instrumented-network, and Node 22/24 checks remain unverified.
- The companion `miku-md2formats-skills` repository and installed skill copies were not modified. Their miku-md2html guidance should be updated downstream for the new default, API option, warning behavior, and report schema.
- The worktree remains unstaged and uncommitted; no tag, push, publication, or final release staging has been performed. The smoke-tested release staging was created under a temporary directory and removed.

## 2026-10-22 maintenance check

- Shared reference date/commit: 2026-10-22, using the `igapyon-miku-soft-developer` reference recorded above (`5a7376da5db640749e7a9e0a9169221aaeea5cb2`); workflow: existing Node application maintenance.
- Applied the locally verifiable 40-million-pixel warning boundary test. Exact-threshold and above-threshold outcomes are recorded in [completion](completion.md).
- Deferred the remaining boundary checks in `TODO.md`. No Node CI workflow was added because the shared CI baseline remains a pending policy decision.
- Added the Release asset workflow after the user's follow-up request. It uses `release: published`, exact `v<package version>` validation, Node 24, local test/build/smoke commands, and an exact three-file staging check. Current action majors were checked on 2026-10-22: checkout v7, setup-node v7, and softprops/action-gh-release v3. GitHub execution remains unverified until a Release is published.

## 2026-10-23 syntax highlighting

- Added build-time tokenization for the 13 documented language families using explicit grammar imports. Input classes remain filtered by the existing sanitizer; safe token spans are rebuilt after sanitization and checked against the original code text.
- Embedded the syntax palette in `src/viewer/theme.css`, scoped to generated highlighted code. Output remains self-contained and copy content remains `code.textContent`.
- Added fixed runtime and test dependency versions, alias/fallback/budget/security tests, CLI warning behavior tests, and the representative fixture. See [implementation specification](implementation-spec.md#5-markdown-見出し-リンク), [API reference](api.md), [CLI reference](cli.md), [plan and execution record](syntax-highlighting-plan.md), and [completion record](completion.md).
- `npm test` passed with 75 tests and `npm run smoke:all` passed on Node 26.12.0. Node 22/24 and browser-specific visual checks remain unverified; see the completion record.
