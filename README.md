# miku-md2html

`miku-md2html` converts one Markdown file and its local images into one portable HTML file. The generated file contains its CSS, viewer JavaScript, SVG, and images, so it can be moved and opened with `file://` while offline.

## Use

```sh
node miku-md2html-0.3.0.mjs ./guide.md --out ./out/guide.html
```

The versioned CLI bundle is planned as a GitHub Release asset. Until a release is published, install dependencies and run the source-tree CLI:

```sh
npm install
npm run cli -- ./guide.md --out ./out/guide.html
npm run cli -- --help
npm run cli -- --version
```

The CLI creates missing output directories. It refuses existing destinations unless `--force` is set. Even with `--force`, symlinks, directories, special files, and paths that collide with the input or an embedded image are refused.

Use `--asset-root` to allow images outside the Markdown file's directory. Relative image paths are still resolved from the Markdown file's directory:

```sh
node miku-md2html-0.3.0.mjs ./docs/guide.md --out ./out/guide.html --asset-root ./
```

`--report-json result.json` writes a versioned JSON report. Success writes a one-line summary to stdout; warnings and errors go to stderr. Exit codes are 0 for success, 1 for conversion or file failures, 2 for usage errors, and 3 for unexpected internal errors.

## Supported Markdown

The converter supports CommonMark structures and GitHub Flavored Markdown tables, task lists, strikethrough, autolinks, and footnotes. Headings receive stable IDs and a native `details` table of contents. Code blocks are displayed without syntax highlighting and get copy buttons when JavaScript is enabled. Tables and code blocks scroll locally on narrow screens. Print styles keep document content readable.

The first H1 supplies the document title unless `--title` or front matter `title` overrides it. The title H1 remains in the document. Front matter accepts string fields `title`, `description`, and `lang`; `lang` defaults to `ja`.

Safe display-oriented raw HTML is retained. Event handlers, author styles, forms, scripts, embedded objects, and unsupported controls are removed with diagnostics. Unsafe link schemes are removed. Ordinary external links remain clickable and open in the current tab.

## Images and SVG

Local PNG, JPEG, GIF, WebP, and SVG files are embedded as data URLs. PNG, JPEG, GIF, and WebP bytes are kept unchanged; animated GIFs stay animated. Data URLs and inline SVG are also accepted. The tool does not resize, recompress, fetch remote images, copy an asset directory, or create an HTML file that depends on adjacent assets.

Images above 5 MiB produce a warning and remain at their original quality. Raster images above 40 million pixels produce a separate warning. HTML above 20 MiB produces a warning. The default final HTML limit is 100 MiB; `--max-output-mib` accepts 1 through 1024. These values are product limits, not browser performance guarantees.

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

The runtime does not access the filesystem unless the caller supplies an `AssetResolver`. The Node CLI uses the included filesystem adapter. See [API reference](docs/api.md) and [CLI reference](docs/cli.md).

## Development

Requires Node.js 22 or newer. The package declares Node 22 as its minimum; the initial bundle target is Node 22.

```sh
npm install
npm run build
npm test
npm run smoke:all
```

`npm run build:bundle` creates the CLI, import runtime, and source archive under `bundle/`. Those generated files are ignored by Git and can be rebuilt from the tracked sources.

See [development notes](docs/development.md), [TODO](TODO.md), and [miku-soft reference](docs/miku-soft-reference.md).

## Repository operation

`.gitignore` excludes `.DS_Store`, `node_modules/`, generated bundles, and local work under `workplace/`. Keep only `workplace/.gitkeep` in Git. Do not store project-local skill copies in `.codex/skills/`; shared rules and their revisions are linked from `docs/miku-soft-reference.md` and recorded in development notes.

## License

Apache-2.0. Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
