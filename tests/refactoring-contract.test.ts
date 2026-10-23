import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { convertMarkdownToHtml } from '../src/ts/core/converter.js';
import type { AssetResolver } from '../src/ts/types.js';

const tinyPng = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2q0AAAAASUVORK5CYII=', 'base64'));

async function contract(request: Parameters<typeof convertMarkdownToHtml>[0]) {
  const result = await convertMarkdownToHtml(request);
  expect(result.success).toBe(true);
  if (!result.success) return;
  return {
    htmlSha256: createHash('sha256').update(result.html).digest('hex'),
    metadata: result.metadata,
    diagnostics: result.diagnostics,
    stats: result.stats,
  };
}

describe('refactoring compatibility contract', () => {
  it('keeps metadata, heading IDs, TOC, fragments, and output bytes stable', async () => {
    const result = await contract({
      markdown: `---\ntitle: 設計メモ\ndescription: 日本語の説明\nlang: ja-JP\n---\n# 見出し\n## 重複\n## 重複\n[移動](#見出し)\n`,
      inputName: 'guide.md',
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "diagnostics": [],
        "htmlSha256": "82f09feadd77dca828356a7ca7ee1022fb6dad2b485f26045a8e30e1f14b102c",
        "metadata": {
          "description": "日本語の説明",
          "lang": "ja-JP",
          "title": "設計メモ",
        },
        "stats": {
          "embeddedPayloadBytes": 0,
          "headingCount": 3,
          "htmlBytes": 12010,
          "imageOccurrences": 0,
          "uniqueAssets": 0,
          "uniqueSourceAssetBytes": 0,
        },
      }
    `);
  });

  it('keeps GFM, footnote, and raw HTML sanitization output stable', async () => {
    const result = await contract({
      markdown: `# 安全\n\n- [x] 完了\n\n| 左 | 中央 |\n| :--- | :---: |\n| a | b |\n\n脚注[^a]。\n\n[^a]: 説明\n\n<div id="unsafe" onclick="bad()">残す</div>\n<script>bad()</script>\n<a href="javascript:bad()">危険リンク</a>\n`,
      inputName: 'safe.md',
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "diagnostics": [
          {
            "code": "W_HTML_SANITIZED",
            "details": {
              "count": 2,
            },
            "message": "Unsupported HTML attributes were removed: id, onClick.",
            "severity": "warning",
            "source": {
              "end": {
                "column": 42,
                "line": 13,
              },
              "label": "markdown",
              "start": {
                "column": 1,
                "line": 13,
              },
            },
          },
          {
            "code": "W_HTML_SANITIZED",
            "message": "An active HTML element and its contents were removed: script.",
            "severity": "warning",
            "source": {
              "end": {
                "column": 23,
                "line": 14,
              },
              "label": "markdown",
              "start": {
                "column": 1,
                "line": 14,
              },
            },
          },
          {
            "code": "W_LINK_REMOVED",
            "message": "A link with an unsafe or unsupported URL was removed.",
            "severity": "warning",
            "source": {
              "end": {
                "column": 37,
                "line": 15,
              },
              "label": "markdown",
              "start": {
                "column": 1,
                "line": 15,
              },
            },
          },
          {
            "code": "W_HTML_SANITIZED",
            "message": "An unsupported HTML tag was unwrapped: section.",
            "severity": "warning",
            "source": {
              "label": "markdown",
            },
          },
        ],
        "htmlSha256": "f0e2f2d6c04ff27ee0497c862ab5299657fa89b098b4c09f2b36a0ff9daf6c5b",
        "metadata": {
          "lang": "ja",
          "title": "安全",
        },
        "stats": {
          "embeddedPayloadBytes": 0,
          "headingCount": 2,
          "htmlBytes": 12359,
          "imageOccurrences": 0,
          "uniqueAssets": 0,
          "uniqueSourceAssetBytes": 0,
        },
      }
    `);
  });

  it('keeps repeated local image resolution and per-occurrence payload accounting stable', async () => {
    const describe = vi.fn(async (decodedRelativePath: string) => ({ id: `shared:${decodedRelativePath}`, label: decodedRelativePath, byteLength: tinyPng.byteLength }));
    const read = vi.fn(async () => tinyPng);
    const assets: AssetResolver = { describe, read };
    const result = await contract({ markdown: '![one](images/tiny.png)\n\n![two](images/tiny.png)', inputName: 'images.md', assets });
    expect(describe).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(result).toMatchInlineSnapshot(`
      {
        "diagnostics": [],
        "htmlSha256": "a15210402c1d65046b118fdc5938e09abfaf432210a1f90c084dcbef1108c0ba",
        "metadata": {
          "lang": "ja",
          "title": "images",
        },
        "stats": {
          "embeddedPayloadBytes": 184,
          "headingCount": 0,
          "htmlBytes": 11802,
          "imageOccurrences": 2,
          "uniqueAssets": 1,
          "uniqueSourceAssetBytes": 68,
        },
      }
    `);
  });

  it('keeps highlighted code and source-position diagnostics stable', async () => {
    const result = await contract({
      markdown: `---\ntitle: Code\n---\n> \`\`\`javascript\n> const answer = 42;\n> \`\`\`\n\n\`\`\`unknown-language\nplain\n\`\`\`\n`,
      inputName: 'code.md',
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "diagnostics": [],
        "htmlSha256": "623234da48f4830c16011cf00be56426107491de1df8a9fb5207d5b5c0bb1b80",
        "metadata": {
          "lang": "ja",
          "title": "Code",
        },
        "stats": {
          "embeddedPayloadBytes": 0,
          "headingCount": 0,
          "htmlBytes": 11732,
          "imageOccurrences": 0,
          "uniqueAssets": 0,
          "uniqueSourceAssetBytes": 0,
        },
      }
    `);
  });
});
