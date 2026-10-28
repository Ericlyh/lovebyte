import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Nav } from '@/components/Nav';
import { CreateDraftForm } from '@/components/create/CreateDraftForm';
import { createClient } from '@/lib/supabase/server';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Create a gift — ${BRAND.NAME}`,
};

/**
 * /create — MVP entry point for the publish-to-marketplace flow
 * (OOP-4893). Captures title + gift type, calls createDraftGiftAction,
 * then routes to /create/[giftId]/finish where PublishToMarketplaceCard
 * takes over.
 *
 * The full per-type builders (OOP-4219..OOP-4224) are still in the
 * backlog. This page is the minimum that closes the "card never renders"
 * gap from M-F (OOP-4278) — a real builder will replace this once one
 * ships.
 */
export default async function CreatePage() {
  const t = await getTranslations('Create');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?next=/create');
  }

  return (
    <main className="min-h-screen flex flex-col">
      <Nav />

      <section className="lb-auth-card">
        <h1>{t('heading')}</h1>
        <p className="lede">{t('lede')}</p>

        {/*
          OOP-5688 — the code gift gets its own section instead of living
          only in the type dropdown. It is the one format with a builder of
          its own (three editors, a live sandbox preview, an AI review), and
          "I cannot see a section for code gifts" was the actual ask — a
          row in a <select> is not visible until you open it.
        */}
        <div className="lb-create-code">
          <h2 className="lb-create-code__title">{t('codeEntry.heading')}</h2>
          <p className="lb-create-code__lede">{t('codeEntry.lede')}</p>
          <Link href="/create/code" className="lb-btn lb-btn--primary">
            {t('codeEntry.cta')}
          </Link>
        </div>

        <div className="lb-divider" />

        <CreateDraftForm />

        <p className="lb-auth-foot">
          <Link href="/browse">{t('browseInstead')}</Link>
        </p>
      </section>
    </main>
  );
}
