# CLI reference

```text
node miku-md2html-<version>.mjs <input.md> --out <output.html> [options]
```

The input must be one regular `.md` or `.markdown` file encoded as UTF-8. A UTF-8 BOM is accepted. Invalid UTF-8 fails. Input size may not exceed the configured HTML size cap.

| Option | Description |
| --- | --- |
| `--out <file>` | Required destination ending in `.html`. |
| `--title <text>` | Overrides front matter and the first H1. |
| `--lang <tag>` | Sets the HTML language. The accepted form is an ASCII language tag such as `ja`, `en`, or `zh-Hans`. |
| `--asset-root <directory>` | Allows images under this root. Relative image paths remain relative to the Markdown file. |
| `--no-toc` | Omits the table of contents. Heading IDs are still generated. |
| `--max-output-mib <integer>` | Final HTML cap, 1–1024 MiB. Default: 100 MiB. |
| `--report-json <file>` | Writes a JSON schema version 1 report. |
| `--force` | Replaces existing regular HTML/report files after conversion succeeds. |
| `--help`, `--version` | Standalone commands that do not read or write conversion files. |

Value options accept `--key value` and `--key=value`. Values beginning with a hyphen must use the equals form. Boolean flags do not accept values. `--` ends option parsing. Duplicate or unknown options fail with exit code 2.

The CLI never writes HTML or JSON to stdout. Success writes one summary line; diagnostics use stable `severity code source:line:column message` text on stderr. Exit codes are 0 success, 1 expected input/conversion/I/O failure, 2 usage error, and 3 unexpected internal error.

Remote images are not downloaded. Missing or unsafe image references fail the conversion. Existing destinations are protected by default. `--force` only permits replacing an existing regular file; it does not permit symlink, directory, special-file, input, report, or referenced-image collisions.

The `--report-json` file contains `schemaVersion`, `tool`, `success`, `exitCode`, `input`, `output`, `metadata`, `stats`, and `diagnostics`. The report is optional and is not required to open the HTML. When HTML is committed and report commit later fails, the valid HTML is kept and the CLI exits 1 with `E_REPORT_WRITE`.
