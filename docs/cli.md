# CLI reference

```text
node miku-md2html-<version>.mjs <input.md> --out <output.html> [options]
```

The input must be one regular `.md` or `.markdown` file encoded as UTF-8. A UTF-8 BOM is accepted. Invalid UTF-8 fails. Input size may not exceed the configured HTML size cap.

| Option | Description |
| --- | --- |
| `--out <file>` | Required destination ending in `.html`. Local image URLs are calculated relative to this path. |
| `--title <text>` | Overrides front matter and the first H1. |
| `--lang <tag>` | Sets the HTML language. The accepted form is an ASCII language tag such as `ja`, `en`, or `zh-Hans`. |
| `--asset-root <directory>` | Allows local image files under this root. Image paths still resolve from the Markdown file's directory. |
| `--image-mode <mode>` | `reference` (default) points to original local raster files. `embed` embeds supported local raster files. SVG is always embedded. |
| `--no-toc` | Omits the table of contents. Heading IDs are still generated. |
| `--max-output-mib <integer>` | Final HTML cap, 1–1024 MiB. Default: 100 MiB. |
| `--report-json <file>` | Writes a JSON schema version 2 report. |
| `--force` | Replaces existing regular HTML/report files after conversion succeeds. |
| `--help`, `--version` | Standalone commands that do not read or write conversion files. |

Value options accept `--key value` and `--key=value`. Values beginning with a hyphen must use the equals form. Boolean flags do not accept values. `--` ends option parsing. Duplicate or unknown options fail with exit code 2.

The converter never copies or rewrites local images. In reference mode, a local raster `src` is a URL relative to the HTML output file, so keep the original image files at the same relative paths when moving or sharing the HTML. SVG files, input data URLs, and inline SVG are embedded. `--image-mode embed` embeds supported local rasters too.

Local image file checks that find a missing, unreadable, unsupported, invalid, changed, or out-of-root image produce warnings. A safe raster URL is retained when possible; a missing/unreadable `.svg` and an out-of-root image are omitted. Warnings alone still produce HTML and exit 0. Remote images, malformed image URLs, unsafe SVG content, output collisions, and output/report I/O failures remain errors.

The CLI never writes HTML or JSON to stdout. Success writes one summary line; diagnostics use stable `severity code source:line:column message` text on stderr. Exit codes are 0 success, 1 expected input/conversion/I/O failure, 2 usage error, and 3 unexpected internal error.

Recognized fenced code blocks are highlighted while converting. See the [supported language names](../README.md#code-block-languages). Unknown or unlabeled blocks remain plain, and blocks skipped because of the highlighting byte limits produce a warning while the conversion can still succeed. Warnings appear on stderr and in `--report-json` diagnostics.

Existing destinations are protected by default. `--force` only permits replacing an existing regular file; it does not permit symlink, directory, special-file, input, report, or referenced-image collisions. Collision checks include missing image paths, so an output is never created where Markdown declares an image.

The report contains `schemaVersion: "2"`, `tool`, `success`, `exitCode`, `input`, `output`, `metadata`, `stats`, and `diagnostics`. `output.imageMode` records the selected mode. Stats include embedded, referenced, and omitted image occurrence counts. The report is optional and is not required to open the HTML. When HTML is committed and report commit later fails, the valid HTML is kept and the CLI exits 1 with `E_REPORT_WRITE`.
