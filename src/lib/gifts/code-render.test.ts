import { describe, it, expect } from 'vitest';
import {
  composeCodeGiftDocument,
  escapeCssForStyleElement,
  escapeJsForScriptElement,
  CODE_GIFT_CSP,
} from './code-render';

describe('composeCodeGiftDocument', () => {
  it('embeds the html, css and js', () => {
    const doc = composeCodeGiftDocument({
      html: '<h1>Hi</h1>',
      css: 'h1 { color: red; }',
      js: 'document.body.dataset.ok = "1";',
    });
    expect(doc).toContain('<h1>Hi</h1>');
    expect(doc).toContain('h1 { color: red; }');
    expect(doc).toContain('document.body.dataset.ok');
    expect(doc).toContain(CODE_GIFT_CSP);
  });

  it('locks the gift out of the network and out of forms', () => {
    const doc = composeCodeGiftDocument({ html: '', css: '', js: '' });
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain("frame-src 'none'");
    expect(doc).toContain("form-action 'none'");
    expect(doc).toContain("base-uri 'none'");
  });

  it('does not let a css payload close the style element', () => {
    const doc = composeCodeGiftDocument({
      html: '',
      css: '</style><script>alert(1)</script>',
      js: '',
    });
    // The only </style> in the document must be the one we emit.
    expect(doc.match(/<\/style>/g)).toHaveLength(1);
    expect(doc).not.toContain('<script>alert(1)</script>');
  });

  it('does not let a js payload close the script element', () => {
    const doc = composeCodeGiftDocument({
      html: '',
      css: '',
      js: 'var s = "</script><img src=x onerror=alert(1)>";',
    });
    expect(doc.match(/<\/script>/g)).toHaveLength(1);
  });

  it('leaves the sender own script tags in the html alone', () => {
    const doc = composeCodeGiftDocument({
      html: '<script>console.log("mine")</script>',
      css: '',
      js: '',
    });
    expect(doc).toContain('<script>console.log("mine")</script>');
  });
});

describe('escape helpers', () => {
  it('escapes </ in css but keeps it renderable', () => {
    expect(escapeCssForStyleElement('content: "</"')).toBe('content: "\\3c /"');
  });

  it('escapes </script in js', () => {
    expect(escapeJsForScriptElement('a = "</script>"')).toBe('a = "<\\/script>"');
  });

  it('is case-insensitive about the script end tag', () => {
    expect(escapeJsForScriptElement('a = "</SCRIPT>"')).toBe('a = "<\\/SCRIPT>"');
  });
});
