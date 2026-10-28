import { transform } from 'sucrase';

export {
  REACT_MOUNT_SCRIPT,
  REACT_UMD_URLS,
  REACT_VERSION,
} from './code-react-runtime';

/**
 * JSX compilation for `code` gifts (OOP-5688).
 *
 * The sender can write JSX instead of plain JavaScript. At save time the
 * JSX is transpiled to plain `React.createElement` calls, so the stored
 * gift is ordinary JavaScript and the recipient's browser needs no
 * transpiler — the only thing missing is the React runtime itself, which
 * the renderer loads (see `code-react-runtime.ts`).
 *
 * This module imports the JSX compiler, so it must stay on the server:
 * the gift renderer also runs in the browser for the builder's live
 * preview, and pulling the compiler into that bundle would be wasteful.
 */

export type JsxTranspileResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

/**
 * Transpile sender JSX to plain JavaScript.
 *
 * Sucrase only rewrites JSX syntax and leaves everything else alone, so
 * the output keeps the sender's own code intact — which matters, because
 * the safety scanner reads this file to decide whether the gift may be
 * hosted.
 */
export function transpileJsx(source: string): JsxTranspileResult {
  try {
    const { code } = transform(source, {
      transforms: ['jsx'],
      production: true,
      jsxRuntime: 'classic',
    });
    return { ok: true, code };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: message.split('\n')[0] ?? 'Could not compile the JSX.',
    };
  }
}
