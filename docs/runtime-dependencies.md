# Runtime and build dependencies

The application declares eleven external npm runtime dependencies in
`package.json`. The source imports these libraries at runtime, so they belong
in `dependencies` even though the released CLI and import runtime embed them
inside self-contained ESM bundles. Type declarations, build tools, and test
helpers remain in `devDependencies`.

## Runtime dependencies

| Package | Runtime role | Why it remains in the bundle |
| --- | --- | --- |
| `@xmldom/xmldom` | Parse and serialize SVG XML. | SVG is accepted as input and must be checked as structured XML before embedding. A hand-written XML parser would expand a security-sensitive format parser. |
| `css-tree` | Parse CSS inside SVG. | CSS escapes and nested values must be parsed before checking for external resources; string matching is not an equivalent safety check. |
| `hast-util-to-html` | Serialize HAST to HTML. | The serializer handles escaping, attributes, raw-text elements, and void-element syntax for generated output. |
| `highlight.js` | Provide the selected language grammars. | Thirteen documented language families use maintained grammar implementations. |
| `rehype-raw` | Parse author-supplied raw HTML into HAST. | The sanitizer needs parsed elements and attributes to apply the repository's allowlist. |
| `rehype-sanitize` | Sanitize author-supplied HTML. | Removing or replacing this parser-backed allowlist would weaken the documented HTML safety boundary. |
| `remark-gfm` | Add GFM tables, task lists, strikethrough, autolinks, and footnotes. | These are part of the documented Markdown contract. |
| `remark-parse` | Parse CommonMark Markdown into mdast. | The converter supports CommonMark structures and source positions used by diagnostics. |
| `remark-rehype` | Convert mdast to HAST. | Markdown nodes and HTML-oriented processing use separate tree models. |
| `unified` | Orchestrate the parser and transform plugins. | It provides the processing pipeline used by the parser, GFM, raw HTML, and sanitizer stages. |
| `yaml` | Parse YAML front matter. | The contract accepts YAML 1.2 and rejects duplicate keys, multiple documents, invalid roots, and excessive aliases. A smaller ad hoc parser would narrow that contract. |

`image-size` was removed. `src/ts/assets/raster-dimensions.ts` now reads the
dimension fields for the four raster formats the product accepts: PNG, JPEG,
GIF, and WebP. It reads metadata only; image bytes remain unchanged. The
field layouts follow the [PNG specification](https://www.w3.org/TR/png-3/),
[ITU-T T.81 JPEG specification](https://www.w3.org/Graphics/JPEG/itu-t81.pdf),
[GIF89a specification](https://giflib.sourceforge.net/gifstandard/GIF89a.html),
and [WebP container and bitstream specifications](https://developers.google.com/speed/webp/docs/riff_container).

The application replaced `lowlight` with a local HAST emitter in
`src/ts/core/highlight-hast-emitter.ts`; `highlight.js` remains the grammar and
tokenization engine. It also replaced its direct `unist-util-visit` imports
with the iterative `visitTree` helper in `src/ts/core/tree.ts`.
`unist-util-visit` remains in the lockfile as a transitive dependency of the
remark/rehype stack, so removing the direct declaration does not remove it
from the full dependency closure.

## Build and test tooling

| Package | Use |
| --- | --- |
| `@types/css-tree`, `@types/mdast`, `@types/node` | Compile-time declarations only. |
| `typescript` | Type checking in `npm run build`. |
| `esbuild` | Create the CLI and importable runtime bundles. |
| `tar` | Create the source archive for release assets. |
| `hast-util-from-html` | Inspect generated HTML in tests. |
| `vitest` | Run the unit and CLI test suites. |

`THIRD_PARTY_NOTICES.md` is generated from `package-lock.json` and covers the
runtime, build, and test dependency tree. Run `npm run licenses` after changing
the lockfile.
