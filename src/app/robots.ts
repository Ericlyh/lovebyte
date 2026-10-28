import type { MetadataRoute } from 'next';
import { BRAND } from '@/lib/brand';

/**
 * GET /robots.txt — what crawlers may index.
 *
 * OOP-5816: the site had no robots.txt at all (404), so crawlers had no
 * signal about the private surfaces and no pointer to the sitemap.
 *
 * Everything under /g/ is a private gift envelope behind a share token.
 * The token is the access control, but a crawler that follows a link can
 * both leak the token into an index and spend crawl budget on a page
 * that is not meant for the public web — so the whole prefix is
 * disallowed, together with the other authenticated surfaces.
 */
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/g/',
          '/checkout/',
          '/purchases',
          '/settings',
          '/u/me',
          '/u/*/edit',
          '/onboarding',
          '/signup',
          '/login',
        ],
      },
    ],
    sitemap: `${BRAND.PRODUCTION_URL}/sitemap.xml`,
    host: BRAND.PRODUCTION_URL,
  };
}
