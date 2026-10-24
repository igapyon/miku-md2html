# miku-md2html

`miku-md2html` converts one Markdown file into an HTML document with embedded CSS, viewer JavaScript, and SVG. Local raster images are referenced from their original paths by default. Use `--image-mode embed` when the HTML must contain raster images too.

## Use

```sh
node miku-md2html-0.5.0.mjs ./guide.md --out ./out/guide.html
```

When a GitHub Release for the exact `v<package version>` tag is published, the [release workflow](.github/workflows/release-cli-runtime-bundles.yml) builds and attaches the versioned CLI, import runtime, and source archive. Until a release is published, install dependencies and run the source-tree CLI:

```sh
npm install
npm run cli -- ./guide.md --out ./out/guide.html
npm run cli -- --help
npm run cli -- --version
```

The released CLI and import runtime are self-contained Node.js bundles. Their external JavaScript libraries are embedded, so running a release bundle does not require an npm installation.

The CLI creates missing output directories. It refuses existing destinations unless `--force` is set. Even with `--force`, symlinks, directories, special files, and paths that collide with the input or a referenced image are refused.

Use `--asset-root` to allow images outside the Markdown file's directory. Relative image paths are still resolved from the Markdown file's directory:

```sh
node miku-md2html-0.5.0.mjs ./docs/guide.md --out ./out/guide.html --asset-root ./
```

Image URLs in the HTML are relative to the output file and point to the original image files. Keep those files at the same relative paths when moving or sharing the HTML. The converter does not copy or rewrite image files.

`--report-json result.json` writes a versioned JSON report. Success writes a one-line summary to stdout; warnings and errors go to stderr. Exit codes are 0 for success, 1 for conversion or file failures, 2 for usage errors, and 3 for unexpected internal errors.

## Supported Markdown

The converter supports CommonMark structures and GitHub Flavored Markdown tables, task lists, strikethrough, autolinks, and footnotes. Headings receive stable IDs and a native `details` table of contents. Recognized fenced code blocks receive syntax highlighting during conversion and get copy buttons when JavaScript is enabled. The generated CSS and token markup are embedded in the HTML, so highlighting works offline and with JavaScript disabled. Tables and code blocks scroll locally on narrow screens. Print styles keep document content readable.

### Code block languages

The first whitespace-delimited token after a fence is matched case-insensitively. Additional fence metadata is ignored. The accepted names are fixed:

| Language | Accepted names |
| --- | --- |
| Markdown | `markdown`, `md` |
| Java | `java` |
| JavaScript / ECMAScript / Node.js | `javascript`, `js`, `ecmascript`, `node`, `nodejs` |
| TypeScript | `typescript`, `ts` |
| Python | `python`, `py`, `python3` |
| CSS | `css` |
| HTML | `html`, `htm` |
| XML / SVG source | `xml`, `svg` |
| JSON | `json` |
| Shell / Bash | `shell`, `sh`, `bash` |
| YAML | `yaml`, `yml` |
| Diff / Patch | `diff`, `patch` |
| PowerShell | `powershell`, `pwsh`, `ps1` |

Unlabeled, plain-text, and unrecognized fenced blocks remain ordinary code without automatic language detection. Inline code, indented code, and code inside author-supplied raw HTML are not highlighted. Highlighting preserves `code.textContent`, which remains the copy-button content. Code exceeding 256 KiB or a document's remaining 1 MiB highlighting budget is shown as plain code with a warning; these limits bound input bytes passed to the highlighter, not its execution time.

The first H1 supplies the document title unless `--title` or front matter `title` overrides it. The title H1 remains in the document. Front matter accepts string fields `title`, `description`, and `lang`; `lang` defaults to `ja`.

Safe display-oriented raw HTML is retained. Event handlers, author styles, forms, scripts, embedded objects, and unsupported controls are removed with diagnostics. Unsafe link schemes are removed. Ordinary external links remain clickable and open in the current tab.

## Images and SVG

Local SVG files are validated and embedded as data URLs. Local PNG, JPEG, GIF, and WebP files are checked and referenced from their original paths by default; `--image-mode embed` embeds their original bytes as data URLs. PNG, JPEG, GIF, and WebP bytes are not recompressed, and animated GIFs stay animated. Input data URLs and inline SVG are embedded in either mode. Remote images are rejected.

Missing, unreadable, unsupported, or invalid local image files produce warnings. A safe relative URL is kept for raster image references, including a missing raster that may be supplied later. A missing or unreadable `.svg`, or a path outside `--asset-root`, is omitted from the HTML. These warnings do not fail conversion. Unsafe SVG content, remote URLs, malformed image URLs, and output collisions remain errors.

Default reference mode keeps the HTML smaller but depends on the referenced raster files being available beside it. Embed mode creates a portable HTML file for supported local raster images too. The HTML does not copy or create an asset directory.

Images above 5 MiB produce a warning in either mode. Raster images above 40 million pixels produce a separate warning when dimensions can be checked. In reference mode, non-SVG images over 100 MiB are checked by a bounded header read; supported formats can remain referenced with an inspection warning. HTML above 20 MiB produces a warning. The default final HTML limit is 100 MiB; `--max-output-mib` accepts 1 through 1024. These values are product limits, not browser performance guarantees.

SVG is parsed as XML and its CSS is parsed before embedding. DTDs/entities, scripts, event attributes, `foreignObject`, animation, external references, CSS imports, and nested SVG data URLs are rejected. SVG style elements are supported when their CSS passes the local-reference policy. Unsupported SVG elements or attributes are rejected so the converter does not silently remove drawing content. Some SVG diagrams will therefore need to be simplified or converted to a supported image format first.

## Runtime API

After `npm run build:bundle`, import `bundle/miku-md2html-runtime.mjs`:

```js
import { convertMarkdownToHtml } from './bundle/miku-md2html-runtime.mjs';

const result = await convertMarkdownToHtml({
  markdown: '# Guide',
  inputName: 'guide.md',
});

if (result.success) {
  await writeFile('guide.html', result.html, 'utf8');
}
```

The runtime does not access the filesystem unless the caller supplies an `AssetResolver`. In the default reference mode, the resolver also provides a URL relative to the intended output file; use `imageMode: 'embed'` to embed local raster images. See [API reference](docs/api.md) and [CLI reference](docs/cli.md).

## Development

Requires Node.js 22 or newer. The package declares Node 22 as its minimum; the initial bundle target is Node 22.

This repository does not provide its own Agent Skill. Product-specific Agent Skill packaging belongs to the companion project `miku-md2formats-skills`.

```sh
npm install
npm run build
npm test
npm run smoke:all
```

`npm run build:bundle` creates the CLI, import runtime, and source archive under `bundle/`. `npm run release:stage` prepares versioned assets under `release-assets/`, and `npm run smoke:release-assets` checks the staged files. Both generated directories are ignored by Git and can be rebuilt from the tracked sources. `npm run smoke:all` includes both commands.

See [development notes](docs/development.md), [TODO](TODO.md), and [miku-soft reference](docs/miku-soft-reference.md).

## Repository operation

`.gitignore` excludes `.DS_Store`, `node_modules/`, generated bundles, and local work under `workplace/`. Keep only `workplace/.gitkeep` in Git. Do not store project-local skill copies in `.codex/skills/`; shared rules and their revisions are linked from `docs/miku-soft-reference.md` and recorded in development notes.

## License

Apache-2.0. Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
