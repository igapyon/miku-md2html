export type SourcePosition = { line: number; column: number };

export type Diagnostic = {
  severity: 'warning' | 'error';
  code: string;
  message: string;
  source?: { label: string; start?: SourcePosition; end?: SourcePosition };
  details?: Record<string, string | number | boolean>;
};

export type AssetInfo = { id: string; label: string; byteLength: number };
export type ImageMode = 'reference' | 'embed';

export type AssetErrorCode =
  | 'E_INPUT_READ'
  | 'E_INPUT_ENCODING'
  | 'E_INPUT_TOO_LARGE'
  | 'E_OUTPUT_EXISTS'
  | 'E_OUTPUT_COLLISION'
  | 'E_OUTPUT_WRITE'
  | 'E_REPORT_WRITE'
  | 'E_OPTIONS'
  | 'E_FRONT_MATTER'
  | 'E_LINK_REMOVED'
  | 'E_INTERNAL'
  | 'E_IMAGE_URI'
  | 'E_REMOTE_IMAGE'
  | 'E_ASSET_RESOLVER_REQUIRED'
  | 'E_IMAGE_NOT_FOUND'
  | 'E_IMAGE_READ'
  | 'E_IMAGE_FORMAT'
  | 'E_IMAGE_INVALID'
  | 'E_SVG_INVALID'
  | 'E_SVG_UNSAFE'
  | 'E_SVG_EXTERNAL_RESOURCE'
  | 'E_SVG_UNSUPPORTED'
  | 'E_ASSET_OUTSIDE_ROOT'
  | 'E_ASSET_CHANGED'
  | 'E_ASSET_REFERENCE_REQUIRED'
  | 'E_IMAGE_REFERENCE'
  | 'E_OUTPUT_TOO_LARGE';

export class AssetAccessError extends Error {
  readonly code: AssetErrorCode;

  constructor(code: AssetErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AssetAccessError';
    this.code = code;
  }
}

export interface AssetResolver {
  describe(decodedRelativePath: string): Promise<AssetInfo>;
  read(id: string, maxBytes: number): Promise<Uint8Array>;
  reference?(decodedRelativePath: string): Promise<string>;
  readPrefix?(id: string, maxBytes: number): Promise<Uint8Array>;
}

export type ConvertOptions = {
  title?: string;
  lang?: string;
  toc?: boolean;
  maxOutputBytes?: number;
  imageMode?: ImageMode;
};

export type ConvertRequest = {
  markdown: string;
  inputName: string;
  options?: ConvertOptions;
  assets?: AssetResolver;
};

export type ConversionStats = {
  headingCount: number;
  imageOccurrences: number;
  uniqueAssets: number;
  uniqueSourceAssetBytes: number;
  embeddedPayloadBytes: number;
  embeddedImageOccurrences: number;
  referencedImageOccurrences: number;
  omittedImageOccurrences: number;
  htmlBytes?: number;
};

export type ConvertResult =
  | {
      success: true;
      html: string;
      metadata: { title: string; lang: string; description?: string };
      diagnostics: Diagnostic[];
      stats: ConversionStats & { htmlBytes: number };
    }
  | {
      success: false;
      metadata: { title: string; lang: string; description?: string };
      diagnostics: Diagnostic[];
      stats: ConversionStats;
    };

export type FrontMatter = {
  title?: string;
  description?: string;
  lang?: string;
  body: string;
  lineOffset: number;
  bodyStartOffset: number;
};

export type AssetRecord = AssetInfo & {
  bytes: Uint8Array;
  mime: string;
  width?: number;
  height?: number;
};
