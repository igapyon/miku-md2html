# TODO

- [ ] Verify tests and generated CLI/runtime bundles on Node.js 22 and 24; the current environment only has Node 26 and Node 20.
- [x] Cover the 40-million-pixel warning boundary (exact limit and above) in the core tests.
- [ ] Verify exact 5 MiB image and 20 MiB output warning boundaries.
- [x] Cover exact local-image output caps, repeated-image preflight, report stage/commit failure, and concurrent no-force destination creation.
- [ ] Complete Chrome-only checks from `file://` with JavaScript disabled, 320px viewport, print layout, and a recorded network-request check. Firefox and WebKit are outside the initial target.
- [x] Measure elapsed time and process peak RSS for ~1 MiB Markdown, a ~6 MiB image, and four references producing ~32 MiB HTML on the current machine; see [completion record](docs/completion.md).
- [ ] Re-run the license inventory and review dependency license/notice obligations before a public release.
- [x] Add a `release: published` workflow that builds, smoke-tests, stages, and attaches the versioned CLI, import runtime, and source archive.
