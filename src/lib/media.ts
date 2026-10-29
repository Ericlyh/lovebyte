/**
 * Which media URLs the `next/image` optimizer is allowed to fetch.
 *
 * Every media object the app stores lives in the brand's public Supabase
 * bucket, so in practice this is always true. The check exists because
 * `next/image` THROWS — a 500 on the recipient's page, the one page
 * that must never fail — when it is handed a remote src whose host is
 * not listed in `images.remotePatterns`. A gift payload is user-authored
 * data: a collage media URL is only validated as "a non-empty string",
 * so a URL from somewhere else is not a malformed request, it is a gift
 * that happens to carry an image from another host. That has to render
 * as a plain `<img>`, not take the page down.
 *
 * `next.config.ts` reads `MEDIA_HOST` from here so the runtime check
 * and the optimizer's allow-list cannot drift apart.
 */

/**
 * The Storage host that serves the brand media bucket, derived from
 * `NEXT_PUBLIC_SUPABASE_URL` so a Supabase project change is a variable
 * rather than a code edit (the same reasoning as `src/lib/brand.ts`).
 */
export const MEDIA_HOST: string | null = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
})();

/**
 * True when `next/image` may optimize this URL.
 *
 * Optimizable means: absolute, https, on our own Storage host. Anything
 * else must be rendered unoptimized — the bytes still arrive, they just
 * do not get a srcset or a modern format.
 */
export function isOptimizableMediaUrl(url: string): boolean {
  if (!MEDIA_HOST) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && parsed.hostname === MEDIA_HOST;
}
