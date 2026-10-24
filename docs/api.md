# Runtime API

The importable runtime exports `productName`, `version`, `AssetAccessError`, and `convertMarkdownToHtml`, plus the `AssetResolver`, `ImageMode`, and result types.

```ts
type ImageMode = 'reference' | 'embed';

type ConvertRequest = {
  markdown: string;
  inputName: string; // basename only; no slash, backslash, or NUL
  options?: {
    title?: string;
    lang?: string;
    toc?: boolean;
    maxOutputBytes?: number; // default 104857600; range 1..1073741824
    imageMode?: ImageMode; // default 'reference'
  };
  assets?: AssetResolver;
};

interface AssetResolver {
  describe(decodedRelativePath: string): Promise<{ id: string; label: string; byteLength: number }>;
  read(id: string, maxBytes: number): Promise<Uint8Array>;
  reference?(decodedRelativePath: string): Promise<string>;
  readPrefix?(id: string, maxBytes: number): Promise<Uint8Array>;
}

const result = await convertMarkdownToHtml(request);
```

The function returns a discriminated result. `success: true` includes complete HTML, metadata, diagnostics, and byte counts. `success: false` omits HTML and includes error diagnostics. The core has no filesystem access; local image paths require a resolver.

## Image handling

`reference` is the default. Local PNG, JPEG, GIF, and WebP files are checked and referenced from their original files. The HTML URL must be relative to the location where the caller will save the generated HTML. The caller's `reference` method receives a once-percent-decoded Markdown path and returns an encoded relative image URL beginning with `./` or `../`. The core checks the URL shape before placing it in HTML. It does not copy or write the image.

SVG files are validated and embedded in both modes. A file containing SVG is treated as SVG even if its filename has another extension. Input data URLs and raw inline SVG are embedded in both modes. `imageMode: 'embed'` embeds supported local raster files and does not need `reference`.

For a Node caller, keep the HTML at the path used to calculate the resolver's relative URLs. If the HTML is later saved elsewhere, those URLs may no longer identify the original images. Applications that need portable output should use `imageMode: 'embed'`.

`describe` must return a non-negative safe integer byte length. `read` must honor its byte cap and return `Uint8Array`. Optional `readPrefix` returns exactly `min(maxBytes, describedByteLength)` bytes and is capped by the caller; it enables bounded checks for very large images. If `readPrefix` is absent, the core uses `read` only for files within the reference inspection limit. `reference` and `readPrefix` are optional so existing embed-mode resolvers remain valid.

Expected local-file problems (missing, unreadable, unsupported, invalid, changed, or outside the allowed root) become warnings and do not fail conversion by themselves. A safe relative raster URL is retained when possible; an out-of-root image is omitted, as is a missing or unreadable `.svg`. Malformed URLs, remote images, unsafe SVG, missing resolver, and an absent `reference` implementation for a readable local raster in reference mode remain errors. Unexpected exceptions and invalid resolver metadata/return values remain contract errors.

The resolver receives a once-percent-decoded relative URL path. Expected filesystem failures should be thrown as `AssetAccessError` with a supported code. Contract violations and unexpected internal failures remain exceptions rather than being relabeled as user input errors.

## Result statistics

`imageOccurrences` counts processed image elements. On successful conversions, `embeddedImageOccurrences + referencedImageOccurrences + omittedImageOccurrences` equals it. `embeddedPayloadBytes` counts Base64 payload bytes for every embedded image occurrence. `uniqueAssets` and `uniqueSourceAssetBytes` count known assets once by resolver ID or embedded-content ID. Referenced rasters do not contribute Base64 payload bytes.

Recognized fenced code blocks are highlighted during conversion without an API option. Language labels, aliases, exclusions, and resource limits are listed in the [README](../README.md#code-block-languages). Unknown or unlabeled code remains plain. Highlighting warnings are included in `diagnostics`; they do not make the conversion fail. The generated HTML includes its token CSS and does not load a highlighter in the browser.

Diagnostics use 1-based line and UTF-16 code-unit column positions where available. They do not include asset bytes, Base64 payloads, stack traces, or absolute internal asset paths. Stable diagnostic codes and acceptance requirements are documented in the [implementation specification](implementation-spec.md); the [CLI reference](cli.md) lists user-facing policies.
