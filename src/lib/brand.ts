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
 * centralised so a future rename is one diff. Status as of 2026-10-28
 * (OOP-6162):
 *
 *   - `PRODUCTION_URL` → `lovorithm.vercel.app`. The Vercel project
 *     `lovebyte` was renamed to `lovorithm` and `lovorithm.vercel.app`
 *     was claimed as a domain on it, in the same deploy that moved
 *     `NEXT_PUBLIC_SITE_URL`. The old `lovebyte-five.vercel.app` stays
 *     attached to the same project, so links already in circulation keep
 *     resolving — it is now the secondary alias, not the canonical one.
 *
 *   - `STORAGE_BUCKET` → `lovorithm-media`. The bucket was renamed on
 *     the Supabase project `xsfbfqzmvjfxppvoxbze`. Two things matter
 *     here, and the second is not obvious:
 *       1. `storage.buckets` carries both an `id` and a `name`, and the
 *          Storage API resolves a bucket by **`id` only**. The old row
 *          had `id = <uuid>` / `name = 'lovebyte-media'`, so
 *          `supabase.storage.from('lovebyte-media')` never resolved and
 *          every upload failed with "Bucket not found". The new row has
 *          `id = name = 'lovorithm-media'`, which does resolve.
 *       2. The `storage.objects` RLS policies cannot be created over
 *          the Storage REST API (there is no policy endpoint) — they
 *          live in `supabase/migrations/0010_storage_bucket_rename.sql`
 *          and need SQL. Until that file is applied, uploads are denied
 *          by RLS rather than by a missing bucket.
 *
 *   - `DOMAIN` → `lovorithm.app`. The previous value, `lovebyte.app`,
 *     is a parked domain-for-sale lander, not this product — it was
 *     actively pointing users at a squatter. The new domain is not
 *     acquired yet (tracked in OOP-6163); no code reads this constant
 *     yet, so flipping it changes no user-visible surface today.
 */
export const BRAND = {
  /** Display name shown in titles, nav, emails, Stripe dashboard. */
  NAME: 'Lovorithm',
  /** Lowercase form used for URLs, handles, package / npm identifiers. */
  HANDLE: 'lovorithm',
  /** One-line marketing hook. */
  TAGLINE: 'Send a feeling, not just a gift',
  /** Domain surfaced in handle hints (e.g. "Your URL will be {DOMAIN}/u/{handle}"). */
  DOMAIN: 'lovorithm.app',
  /** Supabase Storage bucket. */
  STORAGE_BUCKET: 'lovorithm-media',
  /** Canonical production URL — used by lh-prod audit script + share-link emails. */
  PRODUCTION_URL: 'https://lovorithm.vercel.app',
} as const;
