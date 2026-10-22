# TODO

- [ ] Verify tests and generated CLI/runtime bundles on Node.js 22 and 24; the current environment only has Node 26 and Node 20.
- [ ] Finish remaining boundary checks: exact 5 MiB/20 MiB warnings, very large pixel dimensions, report commit failure, concurrent no-force destination creation, and the full output-size preflight cases.
- [ ] Complete Chrome-only checks from `file://` with JavaScript disabled, 320px viewport, print layout, and a recorded network-request check. Firefox and WebKit are outside the initial target.
- [x] Measure elapsed time and process peak RSS for ~1 MiB Markdown, a ~6 MiB image, and four references producing ~32 MiB HTML on the current machine; see [completion record](docs/completion.md).
- [ ] Re-run the license inventory and review dependency license/notice obligations before a public release.
- [ ] Decide whether a `release: published` GitHub Actions workflow should be added as a separate repository change.
