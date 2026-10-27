/**
 * Single source of truth for the company / product brand.
 *
 * Renamed from LoveByte → Lovorithm on 2026-09-24 (OOP-5091). To rename
 * again, change the values below — display strings, page metadata, Stripe
 * sender, transactional email copy, Lighthouse base URL, etc. all read
 * from this module.
 *
 * Two layers:
 *
 *   1. **Code-side constants** — `BRAND.NAME`, `BRAND.PRODUCTION_URL`, etc.
 *      Used by `src/lib/stripe.ts`, `scripts/lh-prod.mjs`, and any
 *      `.tsx` that builds metadata titles / nav strings at render time.
 *
 *   2. **i18n literals** — the human copy in `src/messages/{en,zh-Hant}.json`
 *      remains per-locale so we can localize the brand differently across
 *      languages later. Run a grep for the current brand name in those
 *      files to do a cross-locale find/replace; this file does not own
 *      that copy.
 *
 * Infra tokens (`STORAGE_BUCKET`, `PRODUCTION_URL`, `DOMAIN`) are kept
 * centralised so a future rename is one diff. They currently still point
 * at the LoveByte-era resources because renaming them requires external
 * coordination:
 *
 *   - `STORAGE_BUCKET` requires a Supabase bucket migration (create new,
 *     copy or re-upload, update RLS, delete old). Blocked on OOP-6154 —
 *     the Supabase project host does not resolve.
 *   - `PRODUCTION_URL` was renamed to `lovorithm.vercel.app` on
 *     2026-10-28 (OOP-6162): the Vercel project `lovebyte` was renamed
 *     to `lovorithm` and `lovorithm.vercel.app` was claimed as a domain
 *     on it. The old `lovebyte-five.vercel.app` stays attached to the
 *     same project, so links already in circulation keep resolving.
 *   - `DOMAIN` is the literal that powers handle-URL hints like
 *     "Your URL will be {domain}/u/{handle}". Today it shows the .app
 *     domain the team has not yet acquired; once that exists, flip it.
 */
export const BRAND = {
  /** Display name shown in titles, nav, emails, Stripe dashboard. */
  NAME: 'Lovorithm',
  /** Lowercase form used for URLs, handles, package / npm identifiers. */
  HANDLE: 'lovorithm',
  /** One-line marketing hook. */
  TAGLINE: 'Send a feeling, not just a gift',
  /** Domain surfaced in handle hints (e.g. "Your URL will be {DOMAIN}/u/{handle}"). */
  DOMAIN: 'lovebyte.app',
  /** Supabase Storage bucket. */
  STORAGE_BUCKET: 'lovebyte-media',
  /** Canonical production URL — used by lh-prod audit script + share-link emails. */
  PRODUCTION_URL: 'https://lovorithm.vercel.app',
} as const;
