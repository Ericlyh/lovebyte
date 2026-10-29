/**
 * File import for the `code` gift builder (OOP-5688).
 *
 * The issue asked for "a section that allows the user to *upload* code
 * as the gift". The builder started life as three text boxes, which
 * means the sender had to paste their page in by hand. This module is
 * the upload half: it decides what a dropped file is and which editor
 * it belongs in.
 *
 * Pure on purpose. The interesting part — the extension mapping, the
 * size caps, the count cap, the React-mode decision — is exactly the
 * part worth unit-testing, and it is the part that decides whether a
 * file lands in the HTML, CSS or JavaScript box. Reading the bytes is
 * the browser's job and happens in the form.
 */

import {
  CODE_GIFT_MAX_CSS,
  CODE_GIFT_MAX_HTML,
  CODE_GIFT_MAX_JS,
} from './schemas';

export type CodeFileField = 'html' | 'css' | 'js';

/**
 * Per-file cap. A file may not be bigger than the editor it is going
 * into, so the sender finds out here rather than at save time.
 */
export const CODE_FILE_MAX_BYTES: Record<CodeFileField, number> = {
  html: CODE_GIFT_MAX_HTML,
  css: CODE_GIFT_MAX_CSS,
  js: CODE_GIFT_MAX_JS,
};

/** How many files one drop may bring in. */
export const CODE_FILE_MAX_COUNT = 6;

/**
 * Extension → editor. `.jsx` is JavaScript with JSX syntax, so it
 * belongs in the JavaScript box; `.tsx` is deliberately absent because
 * the compiler only rewrites JSX, not TypeScript.
 */
const EXTENSION_FIELDS: Record<string, CodeFileField> = {
  html: 'html',
  htm: 'html',
  css: 'css',
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  jsx: 'js',
};

/** The `accept` attribute for the file picker. */
export const CODE_FILE_ACCEPT = '.html,.htm,.css,.js,.mjs,.cjs,.jsx';

/**
 * Which editor a filename belongs in, or null when we do not take that
 * kind of file.
 */
export function classifyCodeFile(name: string): CodeFileField | null {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  if (!match) return null;
  return EXTENSION_FIELDS[match[1].toLowerCase()] ?? null;
}

/** True for a `.jsx` file, which only compiles while React mode is on. */
export function isJsxFile(name: string): boolean {
  return /\.jsx$/i.test(name.trim());
}

export type CodeFileRejectionReason = 'unsupported' | 'too-large' | 'too-many';

export type CodeFileRejection = {
  name: string;
  reason: CodeFileRejectionReason;
};

export type CodeFilePlan = {
  /** Files we will import, in the order they were given. */
  accepted: { index: number; name: string; field: CodeFileField }[];
  /** Files we refused, and why. */
  rejected: CodeFileRejection[];
  /**
   * True when the JavaScript box will hold JSX, so React mode has to be
   * on for the code to compile. False when the box holds plain
   * JavaScript, in which case React mode must be off.
   */
  react: boolean;
};

/**
 * Decide what to do with a batch of dropped files.
 *
 * Files that are too big or of an unknown kind are refused individually
 * rather than failing the whole drop — a sender who drags a folder of
 * assets onto the builder still wants their `.html` and `.js` to land.
 */
export function planCodeFileImport(
  files: { name: string; size: number }[],
): CodeFilePlan {
  const accepted: CodeFilePlan['accepted'] = [];
  const rejected: CodeFileRejection[] = [];
  const jsFiles: string[] = [];

  files.forEach((file, index) => {
    if (accepted.length >= CODE_FILE_MAX_COUNT) {
      rejected.push({ name: file.name, reason: 'too-many' });
      return;
    }

    const field = classifyCodeFile(file.name);
    if (!field) {
      rejected.push({ name: file.name, reason: 'unsupported' });
      return;
    }

    if (file.size > CODE_FILE_MAX_BYTES[field]) {
      rejected.push({ name: file.name, reason: 'too-large' });
      return;
    }

    accepted.push({ index, name: file.name, field });
    if (field === 'js') jsFiles.push(file.name);
  });

  // React mode follows the JavaScript files: all-JSX means React on,
  // any plain JavaScript means React off. A mixed drop cannot compile
  // either way, and the form's compiler error says so.
  const react = jsFiles.length > 0 && jsFiles.every(isJsxFile);

  return { accepted, rejected, react };
}

/**
 * Join the contents of several files into one editor's worth of text,
 * each with a header comment so the sender can still tell where one
 * file ended and the next began.
 */
export function mergeCodeFiles(
  field: CodeFileField,
  parts: { name: string; content: string }[],
): string {
  return parts
    .map((part) => {
      const header =
        field === 'html' ? `<!-- ${part.name} -->` : `/* ${part.name} */`;
      return `${header}\n${part.content.trim()}`;
    })
    .join('\n\n');
}

/**
 * Append imported files to whatever the sender had already typed, so
 * an upload never silently discards their work.
 */
export function appendCodeFiles(current: string, addition: string): string {
  if (!addition) return current;
  const trimmed = current.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\n${addition}` : addition;
}
