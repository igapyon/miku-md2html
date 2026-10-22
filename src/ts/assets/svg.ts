import { DOMParser, XMLSerializer, type Document as XmlDocument, type Element as XmlElement } from '@xmldom/xmldom';
import * as cssTree from 'css-tree';
import { AssetAccessError } from '../types.js';
import { decodeImageDataUrl } from './uri.js';
import { inspectRaster } from './image.js';

const svgNamespace = 'http://www.w3.org/2000/svg';
const xlinkNamespace = 'http://www.w3.org/1999/xlink';
const allowedElements = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath', 'use', 'symbol', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask',
  'marker', 'pattern', 'filter', 'feGaussianBlur', 'feColorMatrix', 'feOffset', 'feBlend', 'feComposite',
  'feFlood', 'feMerge', 'feMergeNode', 'feMorphology', 'feTurbulence', 'feDisplacementMap', 'feConvolveMatrix',
  'feComponentTransfer', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA', 'feDiffuseLighting', 'feSpecularLighting', 'style',
  'feDistantLight', 'fePointLight', 'feSpotLight', 'feTile', 'feImage', 'image',
]);
const unsafeElements = new Set(['script', 'foreignobject', 'animate', 'animatemotion', 'animatetransform', 'set', 'discard']);
const allowedAttributes = new Set([
  'xmlns', 'xmlns:xlink', 'id', 'class', 'role', 'aria-label', 'aria-hidden', 'viewBox', 'preserveAspectRatio',
  'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'pathLength',
  'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity', 'transform', 'vector-effect', 'clip-path',
  'clip-rule', 'mask', 'filter', 'marker-start', 'marker-mid', 'marker-end', 'markerWidth', 'markerHeight', 'refX', 'refY',
  'orient', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'offset', 'stop-color', 'stop-opacity', 'patternUnits',
  'patternContentUnits', 'patternTransform', 'font-family', 'font-size', 'font-style', 'font-weight', 'text-anchor',
  'dominant-baseline', 'alignment-baseline', 'letter-spacing', 'word-spacing', 'dx', 'dy', 'rotate', 'textLength',
  'lengthAdjust', 'startOffset', 'method', 'spacing', 'in', 'in2', 'result', 'type', 'values', 'stdDeviation', 'scale',
  'xChannelSelector', 'yChannelSelector', 'operator', 'k1', 'k2', 'k3', 'k4', 'mode', 'color-interpolation-filters',
  'flood-color', 'flood-opacity', 'targetX', 'targetY', 'baseFrequency', 'numOctaves', 'seed', 'stitchTiles',
  'surfaceScale', 'diffuseConstant', 'specularConstant', 'specularExponent', 'limitingConeAngle', 'azimuth', 'elevation',
  'amplitude', 'exponent', 'offset', 'class', 'style', 'href', 'xlink:href', 'xmlns:xlink', 'xml:space',
]);
const cssUrlPattern = /^url\(\s*(['"]?)(#[^)\s'"]+)\1\s*\)$/i;
const resourceCssAttributes = new Set(['fill', 'stroke', 'filter', 'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end']);

function unsupported(message: string, code: 'E_SVG_INVALID' | 'E_SVG_UNSAFE' | 'E_SVG_EXTERNAL_RESOURCE' | 'E_SVG_UNSUPPORTED' = 'E_SVG_UNSUPPORTED'): never {
  throw new AssetAccessError(code, message);
}

function validateCss(css: string, context: 'stylesheet' | 'declarationList'): void {
  let ast: cssTree.CssNode;
  try {
    ast = cssTree.parse(css, { context, positions: true });
  } catch {
    unsupported('SVG contains invalid CSS.');
  }
  cssTree.walk(ast!, (node) => {
    if (node.type === 'Raw') unsupported('SVG contains CSS that cannot be parsed safely.');
    if (node.type === 'Atrule') {
      const name = node.name.toLowerCase();
      if (name === 'import' || name === 'font-face' || name.includes('keyframes')) {
        unsupported('SVG CSS imports, font loading, and animation are not supported.', 'E_SVG_EXTERNAL_RESOURCE');
      }
    }
    if (node.type === 'Declaration' && /^animation(?:-|$)/i.test(node.property)) {
      unsupported('SVG CSS animation is not supported.');
    }
    if (node.type === 'Url' && !/^#[^\s'"()]+$/.test(node.value)) {
      unsupported('SVG CSS may only reference local fragment identifiers.', 'E_SVG_EXTERNAL_RESOURCE');
    }
  });
}

function assertNestedRaster(value: string): void {
  try {
    const data = decodeImageDataUrl(value);
    if (data.mime === 'image/svg+xml') unsupported('Nested SVG data URLs are not supported.');
    const raster = inspectRaster(data.bytes, data.mime);
    void raster;
  } catch (error) {
    if (error instanceof AssetAccessError) throw error;
    unsupported('SVG contains an invalid embedded raster image.');
  }
}

function walkElement(element: XmlElement): void {
  const localName = element.localName ?? element.nodeName.split(':').at(-1)!;
  const normalizedName = localName.toLowerCase();
  if (element.namespaceURI !== svgNamespace) unsupported('SVG nodes must use the SVG namespace.', 'E_SVG_UNSAFE');
  if (unsafeElements.has(normalizedName)) unsupported(`SVG element ${localName} is unsafe.`, 'E_SVG_UNSAFE');
  if (!allowedElements.has(localName)) unsupported(`SVG element ${localName} is not supported.`);
  if (normalizedName === 'style') validateCss(element.textContent ?? '', 'stylesheet');

  for (let i = 0; i < element.attributes.length; i += 1) {
    const attribute = element.attributes.item(i)!;
    const name = attribute.name;
    const lowerName = name.toLowerCase();
    if (lowerName.startsWith('on')) unsupported('SVG event handler attributes are unsafe.', 'E_SVG_UNSAFE');
    if (lowerName === 'xml:base') unsupported('SVG xml:base is not supported.', 'E_SVG_UNSAFE');
    if (!allowedAttributes.has(name) && !allowedAttributes.has(lowerName)) unsupported(`SVG attribute ${name} is not supported.`);
    if (lowerName === 'style') validateCss(attribute.value, 'declarationList');
    if (resourceCssAttributes.has(lowerName)) validateCss(`${lowerName}: ${attribute.value};`, 'declarationList');
    if (lowerName === 'href' || lowerName === 'xlink:href') {
      const value = attribute.value.trim();
      if (value.startsWith('#')) continue;
      if (normalizedName === 'image' || normalizedName === 'feimage') {
        if (!/^data:image\//i.test(value)) unsupported('SVG image references must be embedded raster data URLs.', 'E_SVG_EXTERNAL_RESOURCE');
        assertNestedRaster(value);
      } else {
        unsupported('SVG external references are not supported.', 'E_SVG_EXTERNAL_RESOURCE');
      }
    }
    if (lowerName === 'filter' || lowerName === 'clip-path' || lowerName === 'mask' || lowerName.startsWith('marker-')) {
      const value = attribute.value.trim();
      if (value && !cssUrlPattern.test(value)) unsupported('SVG paint resources must use local fragment references.', 'E_SVG_EXTERNAL_RESOURCE');
    }
  }

  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === child.ELEMENT_NODE) walkElement(child as XmlElement);
  }
}

export type SvgInfo = { width?: number; height?: number };

export function inspectSvg(bytes: Uint8Array): SvgInfo {
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    unsupported('SVG is not valid UTF-8.', 'E_SVG_INVALID');
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(source!)) unsupported('SVG DTDs and entities are not supported.', 'E_SVG_UNSAFE');
  const errors: string[] = [];
  let document: XmlDocument;
  try {
    document = new DOMParser({
      onError(level, message) {
        errors.push(message);
      },
    }).parseFromString(source!, 'image/svg+xml');
  } catch {
    unsupported('SVG XML is not well-formed.', 'E_SVG_INVALID');
  }
  if (errors.length) unsupported('SVG XML is not well-formed.', 'E_SVG_INVALID');
  const root = document!.documentElement;
  if (!root || root.localName !== 'svg' || root.namespaceURI !== svgNamespace) {
    unsupported('SVG must have an SVG namespace root element.', 'E_SVG_INVALID');
  }
  if (document!.doctype) unsupported('SVG DTDs are not supported.', 'E_SVG_UNSAFE');
  for (let child = document!.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === child.PROCESSING_INSTRUCTION_NODE) unsupported('SVG processing instructions are not supported.', 'E_SVG_UNSAFE');
  }
  walkElement(root!);
  const width = svgDimension(root!.getAttribute('width'));
  const height = svgDimension(root!.getAttribute('height'));
  return { ...(width ? { width } : {}), ...(height ? { height } : {}) };
}

function svgDimension(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = /^([0-9]+(?:\.[0-9]+)?)(?:px)?$/i.exec(value.trim());
  if (!match) return undefined;
  const result = Number(match[1]);
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

export function assertSvgMime(bytes: Uint8Array, declaredMime: string): SvgInfo {
  if (declaredMime !== 'image/svg+xml') unsupported('SVG data URL MIME does not match its image type.');
  return inspectSvg(bytes);
}

export function serializeInlineSvg(source: string): { bytes: Uint8Array; info: SvgInfo } {
  let normalized = source.trim();
  if (!/^<svg\b/i.test(normalized)) unsupported('Inline SVG must begin with an svg root element.', 'E_SVG_INVALID');
  if (!/^<svg\b[^>]*\bxmlns\s*=/i.test(normalized)) {
    normalized = normalized.replace(/^<svg\b/i, `<svg xmlns="${svgNamespace}"`);
  }
  const bytes = new TextEncoder().encode(normalized);
  const info = inspectSvg(bytes);
  const errors: string[] = [];
  const document = new DOMParser({ onError: (_level, message) => errors.push(message) })
    .parseFromString(normalized, 'image/svg+xml');
  if (errors.length || !document.documentElement) unsupported('Inline SVG XML is not well-formed.', 'E_SVG_INVALID');
  const serialized = new XMLSerializer().serializeToString(document.documentElement);
  return { bytes: new TextEncoder().encode(serialized), info };
}

export function isSvgNamespace(namespace: string | null): boolean {
  return namespace === svgNamespace || namespace === xlinkNamespace;
}
