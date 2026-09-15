import { getTranslations } from 'next-intl/server';
import type { CatalogListingComment } from '@/lib/catalog';

/**
 * Comments preview for /l/[giftId] (M-C, OOP-4275).
 *
 * M-C ships a read-only preview: count + first 3 comments + a "view all"
 * affordance. The full thread + write form lands in M-D (OOP-4276) so
 * this is the minimum needed for the acceptance test.
 *
 * Server component. Comments are pre-formatted server-side; we don't
 * ship a date library to the browser just for this preview.
 */
type Props = {
  totalCount: number;
  comments: CatalogListingComment[];
};

export async function ListingComments({ totalCount, comments }: Props) {
  const t = await getTranslations('Catalog.comments');

  return (
    <section className="lb-listing-comments" aria-labelledby="lb-listing-comments-heading">
      <h2 id="lb-listing-comments-heading" className="lb-listing-comments__heading">
        {t('heading', { count: totalCount })}
      </h2>

      {comments.length === 0 ? (
        <p className="lb-empty">{t('empty')}</p>
      ) : (
        <ul className="lb-listing-comments__list">
          {comments.map((c) => (
            <li key={c.id} className="lb-listing-comments__item">
              <p className="lb-listing-comments__author">
                {c.author.display_name ?? `@${c.author.handle}`}
              </p>
              <p className="lb-listing-comments__body">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      {totalCount > comments.length ? (
        <p className="lb-listing-comments__more">{t('moreComing')}</p>
      ) : null}
    </section>
  );
}
