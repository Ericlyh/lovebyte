import 'server-only';

import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { lookupUserEmailById } from '@/lib/supabase/admin';
import { sendCreatorReplyEmail } from '@/lib/email';

/**
 * Tell a gift's creator that somebody replied to them (OOP-6718).
 *
 * Before this existed the reply loop was open at one end: a buyer — or
 * the person who received the gift — could ask the creator a question,
 * the question landed in `gift_replies`, and the creator never learned it
 * existed. The notification is what closes that loop.
 *
 * "One" notification means exactly one: this function is called once per
 * successful reply insert, and it refuses to notify the creator about
 * their OWN reply (a creator answering a buyer's question must not email
 * themselves).
 *
 * Why the service-role client: `gifts` is only readable by its owner
 * under RLS (`gifts_select_public_listed` covers *listed* gifts,
 * `gifts_select_own` covers the owner). The replier is neither, so the
 * owner's id and the gift title cannot be read with the caller's
 * session. We read exactly two columns (`owner_id`, `title`) and the
 * creator's display name — nothing else.
 *
 * Why the GoTrue admin endpoint: the creator's email address lives in
 * `auth.users`. `public.profiles` has no email column by design, so
 * PostgREST cannot serve it. See `lookupUserEmailById`.
 *
 * Failures are logged and swallowed. The reply is already committed by
 * the time we get here; a bounced email must not undo it, and the
 * action's own return value must not depend on an ESP being configured.
 */

export async function notifyGiftCreatorOfReply(params: {
  /** The gift the reply is on. */
  giftId: string;
  /** The user who wrote the reply. */
  replyerId: string;
  /** Display name of the reply author — shown in the email. */
  replyerName: string;
  /** The reply body. */
  replyBody: string;
}): Promise<void> {
  const { giftId, replyerId, replyerName, replyBody } = params;

  try {
    const supabase = await createServiceRoleClient();

    const { data: giftData, error: giftErr } = await supabase
      .from('gifts')
      .select('id, title, owner_id')
      .eq('id', giftId)
      .maybeSingle();

    // The Supabase client is untyped (`supabase gen types typescript` has
    // not run against the live project), so the row comes back as
    // `never` and is cast here — the same shape the rest of the app
    // casts to.
    const gift = giftData as unknown as {
      id: string;
      title: string | null;
      owner_id: string;
    } | null;

    if (giftErr || !gift) {
      console.error(
        '[notify-creator] gift lookup failed',
        giftErr?.message ?? `no gift row for ${giftId}`,
      );
      return;
    }

    // The creator replying to themselves is not news. No email.
    if (gift.owner_id === replyerId) return;

    const { data: profileData, error: profileErr } = await supabase
      .from('profiles')
      .select('display_name, preferred_language')
      .eq('id', gift.owner_id)
      .maybeSingle();

    if (profileErr) {
      console.error('[notify-creator] profile lookup failed', profileErr.message);
    }

    const profile = profileData as unknown as {
      display_name: string | null;
      preferred_language: string | null;
    } | null;

    const { data: owner, error: ownerErr } = await lookupUserEmailById(gift.owner_id);
    if (ownerErr) {
      console.error('[notify-creator] owner email lookup failed', ownerErr.message);
    }
    if (owner.state !== 'found') {
      console.error(
        '[notify-creator] creator has no reachable email address',
        gift.owner_id,
      );
      return;
    }

    const locale = profile?.preferred_language === 'zh-Hant' ? 'zh-Hant' : 'en';

    const result = await sendCreatorReplyEmail({
      to: owner.email,
      creatorName: profile?.display_name ?? null,
      giftTitle: gift.title ?? null,
      listingPath: `/l/${gift.id}`,
      replyerName,
      replyBody,
      locale,
    });

    if (!result.ok) {
      console.error('[notify-creator] email not sent', result.error);
    }
  } catch (e) {
    // Never let a notification problem take down the reply that triggered it.
    console.error('[notify-creator] failed', e);
  }
}
