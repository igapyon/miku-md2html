# Runtime API

The importable runtime exports `productName`, `version`, `AssetAccessError`, and `convertMarkdownToHtml`.

```ts
type ConvertRequest = {
  markdown: string;
  inputName: string; // basename only; no slash, backslash, or NUL
  options?: {
    title?: string;
    lang?: string;
    toc?: boolean;
    maxOutputBytes?: number; // default 104857600; range 1..1073741824
  };
  assets?: AssetResolver;
};

interface AssetResolver {
  describe(decodedRelativePath: string): Promise<{ id: string; label: string; byteLength: number }>;
  read(id: string, maxBytes: number): Promise<Uint8Array>;
}

const result = await convertMarkdownToHtml(request);
```

The function returns a discriminated result. `success: true` includes complete HTML, metadata, diagnostics, and byte counts. `success: false` omits HTML and includes error diagnostics. The core has no filesystem access; local image paths require a resolver.

Recognized fenced code blocks are highlighted during conversion without an API option. Language labels, aliases, exclusions, and resource limits are listed in the [README](../README.md#code-block-languages). Unknown or unlabeled code remains plain. Highlighting warnings are included in `diagnostics`; they do not make the conversion fail. The generated HTML includes its token CSS and does not load a highlighter in the browser.

The resolver receives a once-percent-decoded relative URL path. `describe` must return a non-negative safe integer byte length. `read` must honor its byte cap and return `Uint8Array`. Expected filesystem failures should be thrown as `AssetAccessError` with a supported code. Contract violations and unexpected internal failures remain exceptions rather than being relabeled as user input errors.

Diagnostics use 1-based line and UTF-16 code-unit column positions where available. They do not include asset bytes, Base64 payloads, stack traces, or absolute internal asset paths. Stable diagnostic codes and acceptance requirements are documented in the [implementation specification](implementation-spec.md); the [CLI reference](cli.md) lists user-facing policies.
