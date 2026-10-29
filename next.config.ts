import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { MEDIA_HOST } from './src/lib/media';

const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');

const nextConfig: NextConfig = {
  /**
   * The responsive image pipeline (OOP-6723).
   *
   * Before this, every photo on the site was a raw `<img>` pointing at
   * the original upload: a recipient opening a 12-photo collage on
   * mobile data pulled down the full-resolution JPEGs — up to 60 MB for
   * one gift, with no `srcset`, no modern format and no lazy loading.
   *
   * `next/image` fixes all four at once: the browser picks the
   * smallest candidate that fits its viewport, the optimizer re-encodes
   * it to AVIF or WebP, and everything below the fold is lazy.
   */
  images: {
    /**
     * AVIF first, WebP second. The browser takes the first format it
     * understands; `Accept` is part of the `Vary` on the optimizer
     * response, so the two encodings never get mixed up in a cache.
     */
    formats: ['image/avif', 'image/webp'],

    /**
     * The one host `next/image` may fetch from: the Storage host that
     * serves the brand media bucket, which `getPublicUrl()` hands out.
     * Read from the env via `MEDIA_HOST` so a project rename is a
     * variable, not a code edit. Kept as an exact host rather than a
     * wildcard — an open image proxy is not something to hand out.
     */
    remotePatterns: [
      {
        protocol: 'https',
        hostname: MEDIA_HOST ?? '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],

    /**
     * The candidates are the widths the site actually lays out. The
     * defaults reach 3840px, which no image on this site is ever
     * displayed at — the stored originals are 900px — so those two
     * entries only ever produced bytes nobody asked for.
     */
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],

    /**
     * The optimizer URL embeds the source URL, and every media path
     * carries a uuid (or, for the seeded catalogue, a content hash), so
     * the bytes behind a given optimizer URL never change. A year of
     * browser caching is therefore safe — and it is the same year the
     * stored objects themselves are marked immutable with.
     */
    minimumCacheTTL: 31536000,
  },
};

export default withNextIntl(nextConfig);
