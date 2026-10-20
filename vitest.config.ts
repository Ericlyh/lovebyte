import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Vitest config.
 *
 * Two aliases, both of which mirror what Next.js does at build time:
 *
 *   - `@/*` → `src/*` — the tsconfig `paths` mapping. Vitest does NOT
 *     read tsconfig paths on its own, so without this any test that
 *     touches a module using `@/` imports fails to resolve. The
 *     pre-existing tests all used relative imports and so never hit
 *     this; the incidents route tests do.
 *
 *   - `server-only` / `client-only` → Next's own compiled stubs. Next
 *     aliases these at bundle time (`next/dist/build/webpack-config.js`)
 *     to enforce the server/client boundary. They are not real packages
 *     in node_modules, so Node/Vitest cannot resolve them — point at
 *     the same empty modules Next uses and the boundary check becomes a
 *     build-time concern only, which is where it belongs.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(
        __dirname,
        'node_modules/next/dist/compiled/server-only/empty.js',
      ),
      'client-only': path.resolve(
        __dirname,
        'node_modules/next/dist/compiled/client-only/empty.js',
      ),
    },
  },
});
