import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Nav } from '@/components/Nav';
import { GIFT_PAGES, giftPagesOfKind, localize, type GiftPageKind } from '@/content/gifts';
import { BRAND } from '@/lib/brand';
import { buildMetadata, pageOgImage } from '@/lib/seo/metadata';

/**
 * /gifts — the hub for every gift guide (OOP-6727).
 *
 * A hub-and-spoke shape: this page links to all seven guides, and each
 * guide links back to the hub and sideways to two or three others. That
 * is how a crawler finds a page it would never have guessed — a gift
 * guide for "gift ideas for him" has no incoming link from anywhere
 * else on the site, and without this hub it would be an orphan.
 */
export const metadata: Metadata = buildMetadata({
  path: '/gifts',
  title: 'Gift guides — what to send, and when',
  description:
    'Seven guides to the digital gifts Lovorithm can make: memory card games, personalised quizzes, animated letters, and what to send for a birthday, an anniversary, her, or him.',
  imageUrl: pageOgImage('gifts'),
});

type Props = {
  params: Promise<{ locale: string }>;
};

const GROUPS: GiftPageKind[] = ['format', 'occasion', 'audience'];

export default async function GiftsHubPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Gifts');

  return (
    <main className="min-h-screen flex flex-col">
      <Nav deferAuth />

      <article className="lb-content-page lb-gift-page">
        <h1>{t('hub.title')}</h1>
        <p className="lede">{t('hub.lede')}</p>

        {GROUPS.map((kind) => {
          const pages = giftPagesOfKind(kind);
          if (pages.length === 0) return null;
          return (
            <section key={kind}>
              <h2>{t(`kind.${kind}`)}</h2>
              <ul className="lb-gift-grid">
                {pages.map((page) => (
                  <li key={page.slug} className="lb-gift-card">
                    <h3>
                      <Link href={`/gifts/${page.slug}`} className="lb-link">
                        {localize(page.metaTitle, locale)}
                      </Link>
                    </h3>
                    <p>{localize(page.metaDescription, locale)}</p>
                    <Link href={`/gifts/${page.slug}`} className="lb-link">
                      {t('hub.readMore')}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <section className="lb-gift-cta">
          <h2>{t('cta.title')}</h2>
          <p>{t('cta.body')}</p>
          <Link href="/create" className="lb-btn lb-btn--primary">
            {t('cta.label')}
          </Link>
        </section>
      </article>
    </main>
  );
}
