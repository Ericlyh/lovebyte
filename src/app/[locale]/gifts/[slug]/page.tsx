import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Nav } from '@/components/Nav';
import { GIFT_PAGES, getGiftPage, localize, type GiftPage } from '@/content/gifts';
import { BRAND } from '@/lib/brand';
import { buildMetadata, pageOgImage } from '@/lib/seo/metadata';

/**
 * /gifts/[slug] — one gift guide (OOP-6727).
 *
 * The site's answer to the questions people actually type into a search
 * box: "memory card games", "anniversary gift ideas", "personalised gift
 * for her". Until this, the whole crawlable surface was 18 URLs of
 * product and legal pages, so every visitor had to arrive through a paid
 * link.
 *
 * The copy lives in `src/content/gifts/` — one file per guide — so a
 * guide can be written, reviewed and edited on its own. The chrome
 * around it (the FAQ heading, the CTA, the "read these next" label)
 * lives in the message catalogue under `Gifts`, because that copy is
 * shared between guides and belongs in one place.
 *
 * Static: the slug set is closed (`dynamicParams = false`), so the
 * guide is prerendered once per locale at build time and an unknown
 * slug is a 404 rather than a render. The nav runs with `deferAuth` for
 * the same reason the landing page does — reading the session cookie
 * would make the route dynamic and cost the prerender.
 */
type Props = {
  params: Promise<{ locale: string; slug: string }>;
};

export function generateStaticParams() {
  return GIFT_PAGES.map((page) => ({ slug: page.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const page = getGiftPage(slug);
  if (!page) {
    return { title: `Guide not found — ${BRAND.NAME}` };
  }
  return buildMetadata({
    path: `/gifts/${page.slug}`,
    title: localize(page.metaTitle, locale),
    description: localize(page.metaDescription, locale),
    imageUrl: pageOgImage(page.slug),
  });
}

export default async function GiftGuidePage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const page = getGiftPage(slug);
  if (!page) notFound();

  const t = await getTranslations('Gifts');

  const related: GiftPage[] = page.related
    .map((relatedSlug) => getGiftPage(relatedSlug))
    .filter((candidate): candidate is GiftPage => candidate !== null);

  return (
    <main className="min-h-screen flex flex-col">
      <Nav deferAuth />

      <article className="lb-content-page lb-gift-page">
        <p className="lb-gift-page__crumb">
          <Link href="/gifts" className="lb-link">
            ← {t('back')}
          </Link>
        </p>

        <h1>{localize(page.heading, locale)}</h1>
        <p className="lede">{localize(page.lede, locale)}</p>

        {page.sections.map((section) => (
          <section key={section.heading.en}>
            <h2>{localize(section.heading, locale)}</h2>
            <p>{localize(section.body, locale)}</p>
            {section.points ? (
              <ul className="lb-gift-points">
                {section.points.map((point) => (
                  <li key={point.en}>{localize(point, locale)}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}

        <section className="lb-gift-faq">
          <h2>{t('faq')}</h2>
          {page.faq.map((entry) => (
            <details key={entry.q.en}>
              <summary>{localize(entry.q, locale)}</summary>
              <p>{localize(entry.a, locale)}</p>
            </details>
          ))}
        </section>

        <section className="lb-gift-cta">
          <h2>{t('cta.title')}</h2>
          <p>{t('cta.body')}</p>
          <Link href="/create" className="lb-btn lb-btn--primary">
            {t('cta.label')}
          </Link>
        </section>

        {related.length > 0 ? (
          <section className="lb-gift-related">
            <h2>{t('related')}</h2>
            <ul>
              {related.map((candidate) => (
                <li key={candidate.slug}>
                  <Link href={`/gifts/${candidate.slug}`} className="lb-link">
                    {localize(candidate.metaTitle, locale)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </main>
  );
}
