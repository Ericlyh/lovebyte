import { describe, it, expect } from 'vitest';
import {
  appendCodeFiles,
  classifyCodeFile,
  isJsxFile,
  mergeCodeFiles,
  planCodeFileImport,
  CODE_FILE_MAX_BYTES,
  CODE_FILE_MAX_COUNT,
} from './code-files';

describe('classifyCodeFile', () => {
  it('routes HTML files to the HTML box', () => {
    expect(classifyCodeFile('index.html')).toBe('html');
    expect(classifyCodeFile('page.HTM')).toBe('html');
  });

  it('routes CSS files to the CSS box', () => {
    expect(classifyCodeFile('style.css')).toBe('css');
  });

  it('routes JavaScript files to the JavaScript box', () => {
    expect(classifyCodeFile('app.js')).toBe('js');
    expect(classifyCodeFile('app.mjs')).toBe('js');
    expect(classifyCodeFile('app.cjs')).toBe('js');
    expect(classifyCodeFile('App.jsx')).toBe('js');
  });

  it('refuses anything else', () => {
    expect(classifyCodeFile('photo.png')).toBeNull();
    expect(classifyCodeFile('notes.txt')).toBeNull();
    expect(classifyCodeFile('README')).toBeNull();
    expect(classifyCodeFile('data.ts')).toBeNull();
  });
});

describe('isJsxFile', () => {
  it('only matches .jsx', () => {
    expect(isJsxFile('App.jsx')).toBe(true);
    expect(isJsxFile('App.js')).toBe(false);
  });
});

describe('planCodeFileImport', () => {
  it('accepts a page split across three files', () => {
    const plan = planCodeFileImport([
      { name: 'index.html', size: 100 },
      { name: 'style.css', size: 100 },
      { name: 'app.js', size: 100 },
    ]);
    expect(plan.accepted.map((f) => f.field)).toEqual(['html', 'css', 'js']);
    expect(plan.accepted.map((f) => f.index)).toEqual([0, 1, 2]);
    expect(plan.rejected).toHaveLength(0);
  });

  it('refuses an unsupported file without dropping the rest', () => {
    const plan = planCodeFileImport([
      { name: 'photo.png', size: 100 },
      { name: 'index.html', size: 100 },
    ]);
    expect(plan.accepted.map((f) => f.name)).toEqual(['index.html']);
    expect(plan.rejected).toEqual([
      { name: 'photo.png', reason: 'unsupported' },
    ]);
  });

  it('refuses a file over the size cap for its editor', () => {
    const plan = planCodeFileImport([
      { name: 'big.html', size: CODE_FILE_MAX_BYTES.html + 1 },
    ]);
    expect(plan.accepted).toHaveLength(0);
    expect(plan.rejected[0].reason).toBe('too-large');
  });

  it('caps CSS and JavaScript more tightly than HTML', () => {
    expect(CODE_FILE_MAX_BYTES.css).toBeLessThan(CODE_FILE_MAX_BYTES.html);
    const plan = planCodeFileImport([
      { name: 'style.css', size: CODE_FILE_MAX_BYTES.css + 1 },
    ]);
    expect(plan.rejected[0].reason).toBe('too-large');
  });

  it('accepts a file exactly at the size cap', () => {
    const plan = planCodeFileImport([
      { name: 'big.html', size: CODE_FILE_MAX_BYTES.html },
    ]);
    expect(plan.accepted).toHaveLength(1);
  });

  it('refuses files past the count cap but keeps the first ones', () => {
    const many = Array.from({ length: CODE_FILE_MAX_COUNT + 3 }, (_, i) => ({
      name: `f${i}.js`,
      size: 10,
    }));
    const plan = planCodeFileImport(many);
    expect(plan.accepted).toHaveLength(CODE_FILE_MAX_COUNT);
    expect(plan.rejected).toHaveLength(3);
    expect(plan.rejected[0].reason).toBe('too-many');
  });

  it('asks for React mode when the JavaScript is JSX', () => {
    const plan = planCodeFileImport([{ name: 'App.jsx', size: 10 }]);
    expect(plan.react).toBe(true);
  });

  it('leaves React mode off for plain JavaScript', () => {
    const plan = planCodeFileImport([{ name: 'app.js', size: 10 }]);
    expect(plan.react).toBe(false);
  });

  it('leaves React mode off when HTML and CSS are uploaded alone', () => {
    const plan = planCodeFileImport([
      { name: 'index.html', size: 10 },
      { name: 'style.css', size: 10 },
    ]);
    expect(plan.react).toBe(false);
  });
});

describe('mergeCodeFiles', () => {
  it('joins files with a header comment naming each one', () => {
    const merged = mergeCodeFiles('js', [
      { name: 'a.js', content: 'const a = 1;' },
      { name: 'b.js', content: 'const b = 2;' },
    ]);
    expect(merged).toBe('/* a.js */\nconst a = 1;\n\n/* b.js */\nconst b = 2;');
  });

  it('uses an HTML comment for the HTML box', () => {
    const merged = mergeCodeFiles('html', [
      { name: 'index.html', content: '<h1>Hi</h1>' },
    ]);
    expect(merged).toBe('<!-- index.html -->\n<h1>Hi</h1>');
  });
});

describe('appendCodeFiles', () => {
  it('keeps what the sender had already typed', () => {
    expect(appendCodeFiles('<h1>Mine</h1>', '<!-- a.html -->\n<p>Theirs</p>')).toBe(
      '<h1>Mine</h1>\n\n<!-- a.html -->\n<p>Theirs</p>',
    );
  });

  it('does not leave a blank line when the box was empty', () => {
    expect(appendCodeFiles('', '<!-- a.html -->\n<p>Theirs</p>')).toBe(
      '<!-- a.html -->\n<p>Theirs</p>',
    );
  });

  it('leaves the box alone when there is nothing to add', () => {
    expect(appendCodeFiles('<h1>Mine</h1>', '')).toBe('<h1>Mine</h1>');
  });
});
