import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

/**
 * The listed gift behind /checkout/[giftId].
 *
 * Split out of the page (OOP-6729) so the `generateMetadata` pass and
 * the page pass can share ONE read, and so both can agree on what
 * "this gift can be checked out" means: it is listed, and it is not
 * soft-deleted. Anything else is a 404.
 */
export type CheckoutGift = {
  id: string;
  title: string;
  description: string | null;
  price_cents: number | null;
  currency: string | null;
  owner_id: string;
  owner: {
    handle: string | null;
    display_name: string | null;
  } | null;
};

/**
 * Resolve the gift a checkout is for, or null when there is nothing to
 * check out (missing, unlisted, or soft-deleted).
 *
 * Memoised with React `cache()` for the same reason
 * `getListingDetail` is (OOP-6722): the metadata pass and the page pass
 * are one request, and this read is not cheap.
 */
async function getCheckoutGiftUncached(
  giftId: string,
): Promise<CheckoutGift | null> {
  if (!giftId) return null;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('gifts')
    .select(
      'id, title, description, price_cents, currency, owner_id, owner:profiles!owner_id(handle, display_name)',
    )
    .eq('id', giftId)
    .eq('is_listed', true)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !data) return null;

  const owner = Array.isArray(data.owner) ? data.owner[0] : data.owner;

  return {
    id: data.id,
    title: data.title,
    description: data.description,
    price_cents: data.price_cents,
    currency: data.currency,
    owner_id: data.owner_id,
    owner: owner
      ? {
          handle: owner.handle ?? null,
          display_name: owner.display_name ?? null,
        }
      : null,
  };
}

export const getCheckoutGift = cache(getCheckoutGiftUncached);
