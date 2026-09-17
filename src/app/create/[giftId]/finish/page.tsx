import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Nav } from '@/components/Nav';
import {
  PublishToMarketplaceCard,
  type GiftMediaItem,
} from '@/components/publish/PublishToMarketplaceCard';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Publish to marketplace — LoveByte',
};

/**
 * /create/[giftId]/finish — the MVP mount point for
 * PublishToMarketplaceCard (OOP-4893, M-F follow-up).
 *
 * Loads the owner's draft gift + any gift_media rows so the cover
 * picker in the card has something to render. Publish is free by
 * default; paid gifts still go through Stripe onboarding (M-E).
 *
 * RLS protects this page: the `gifts_select_own` policy ensures only
 * the owner can reach their draft.
 */
export default async function CreateFinishPage({
  params,
}: {
  params: Promise<{ giftId: string }>;
}) {
  const t = await getTranslations('Create.finish');
  const { giftId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/create/${giftId}/finish`);
  }

  const { data: gift, error: giftErr } = await supabase
    .from('gifts')
    .select('id, title, is_listed, owner_id')
    .eq('id', giftId)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (giftErr) {
    console.error('[create/finish] gift read failed', giftErr.message);
  }
  if (!gift) {
    notFound();
  }
  if (gift.is_listed) {
    redirect(`/l/${gift.id}`);
  }

  // Load this user's media for the cover picker.
  const { data: mediaRows, error: mediaErr } = await supabase
    .from('gift_media')
    .select('id, storage_path')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(24);

  if (mediaErr) {
    console.error('[create/finish] media read failed', mediaErr.message);
  }

  // Resolve to public URLs via the same anon client the rest of the app uses.
  const mediaItems: GiftMediaItem[] = (mediaRows ?? []).flatMap((row) => {
    const { data: pub } = supabase.storage
      .from('lovebyte-media')
      .getPublicUrl(row.storage_path);
    return pub.publicUrl ? [{ id: row.id, url: pub.publicUrl }] : [];
  });

  return (
    <main className="min-h-screen flex flex-col">
      <Nav />

      <section className="lb-container">
        <header style={{ maxWidth: 720, margin: '0 auto', padding: '32px 16px 16px' }}>
          <h1>{t('heading')}</h1>
          <p className="lede">{t('lede')}</p>
        </header>

        <PublishToMarketplaceCard
          giftId={gift.id}
          defaultTitle={gift.title ?? ''}
          mediaItems={mediaItems}
        />

        <p style={{ textAlign: 'center', marginTop: 16 }}>
          <Link href="/u/me">{t('backToProfile')}</Link>
        </p>
      </section>
    </main>
  );
}
