import { describe, it, expect } from 'vitest';
import { transpileJsx, REACT_UMD_URLS, REACT_MOUNT_SCRIPT } from './code-react';
import { composeCodeGiftDocument } from './code-render';

describe('transpileJsx', () => {
  it('compiles JSX to plain JavaScript', () => {
    const result = transpileJsx('function App() { return <h1>Hi</h1>; }');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toContain('React.createElement');
    expect(result.code).not.toContain('<h1>');
  });

  it('leaves ordinary JavaScript alone', () => {
    const result = transpileJsx('const x = 1 + 1;');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toContain('const x = 1 + 1');
  });

  it('reports a compile error instead of throwing', () => {
    const result = transpileJsx('const x = <div>');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThan(0);
  });

  it('keeps the sender code intact for the safety scanner', () => {
    const result = transpileJsx(
      'function App() { localStorage.setItem("x", "1"); return <div>hi</div>; }',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toContain('localStorage');
  });
});

describe('React gift document', () => {
  it('loads React before the gift script and mounts afterwards', () => {
    const doc = composeCodeGiftDocument({
      html: '<div id="root"></div>',
      css: '',
      js: 'function App(){ return null; }',
      react: true,
    });
    const reactAt = doc.indexOf(REACT_UMD_URLS.react);
    const reactDomAt = doc.indexOf(REACT_UMD_URLS.reactDom);
    const giftAt = doc.indexOf('function App()');
    const mountAt = doc.indexOf('createRoot');
    expect(reactAt).toBeGreaterThan(-1);
    expect(reactDomAt).toBeGreaterThan(reactAt);
    expect(giftAt).toBeGreaterThan(reactDomAt);
    expect(mountAt).toBeGreaterThan(giftAt);
    // The mount has to be a script element — as bare body text it would
    // render as text instead of running.
    expect(doc).toContain(`<script>${REACT_MOUNT_SCRIPT.split('\n')[0]}`);
  });

  it('leaves a plain code gift alone', () => {
    const doc = composeCodeGiftDocument({ html: '<p>hi</p>', css: '', js: 'var a = 1;' });
    expect(doc).not.toContain(REACT_UMD_URLS.react);
    expect(doc).not.toContain('createRoot');
  });
});
