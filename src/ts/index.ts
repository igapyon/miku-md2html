export { convertMarkdownToHtml } from './core/converter.js';
export { AssetAccessError } from './types.js';
export type {
  AssetErrorCode,
  AssetInfo,
  AssetResolver,
  ConvertOptions,
  ConvertRequest,
  ConvertResult,
  ConversionStats,
  Diagnostic,
  ImageMode,
  SourcePosition,
} from './types.js';

export const productName = 'miku-md2html';
export const version = '0.5.0';
