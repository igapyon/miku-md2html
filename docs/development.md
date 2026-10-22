# Development notes

## Initial implementation record

- Date: 2026-10-22
- Target starting revision: `892f1b3d70b8731b53215361788ca83b9c7fa63e` (`devel`); the repository initially contained only `LICENSE`.
- Same-layer reference: `miku-md2docx` at `a25d302c742e6950183d60e0cda88f97bc65a265`.
- Single-file HTML reference: `local-html-tools` at `9e4e8fcb71ddecc055fcc0add6b75c97df70e9d9`.
- Shared skill source: `igapyon-agent-skills` at `5a7376da5db640749e7a9e0a9169221aaeea5cb2`, workflow `10-node-app-workflow`.

The miku-md2docx reference informed the ESM TypeScript package, product core boundary, CLI adapter, Vitest tests, esbuild CLI/runtime bundles, and local smoke scripts. Its DOCX-specific parser/output architecture was not reused. The local-html-tools reference informed keeping the viewer CSS and JavaScript as editable source assets and embedding them during bundle-time conversion. Markdown images need a separate data-URL path; the existing helper does not perform that work.

The detailed product requirements were prepared in the daybook workspace before implementation. The implementation keeps one HTML output, Node-side Markdown rendering, local image embedding, an allowlist for raw HTML, parsed SVG/CSS checks, a default 100 MiB output cap, and no automatic image resizing. The exact dependency versions are fixed in `package-lock.json`.

## Build and local workflow

- `npm run build`: TypeScript contract check.
- `npm test`: type check and unit/CLI tests.
- `npm run build:bundle`: produce CLI, import runtime, and source archive under ignored `bundle/`.
- `npm run smoke:all`: rebuild bundles and verify both bundle entrypoints.

No GitHub Actions, Release publication, registry publication, push, or upload is part of this initial implementation.

## Verification record

Implementation and initial verification are recorded in [completion.md](completion.md). The user's initial browser target is Chrome. Node 22/24 compatibility remains pending because neither version is installed in the current environment; a Node 26 run does not establish those compatibility claims.
