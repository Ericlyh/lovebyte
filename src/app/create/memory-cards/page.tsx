import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Nav } from '@/components/Nav';
import { createClient } from '@/lib/supabase/server';
import { MemoryCardsBuilderForm } from '@/components/memory-cards/MemoryCardsBuilderForm';

export const metadata: Metadata = {
  title: 'Memory cards — LoveByte builder',
};

/**
 * /create/memory-cards — Phase 4 builder route (OOP-4219).
 *
 * Sender-facing surface for the memory_cards gift type. The form lets
 * the sender upload photo pairs (3–12), tag each pair with a caption,
 * pick a difficulty, optionally set a card-back image and music URL,
 * then save the draft + share row in one go.
 *
 * Auth: requires a signed-in user. Anonymous users land on /login with
 * `next` pointing back here.
 *
 * Architecture §6 — feature module at src/features/memory-cards/ holds
 * the schemas; this route is the entry-point component only.
 */
export default async function CreateMemoryCardsPage() {
  const t = await getTranslations('Builder.memoryCards');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?next=/create/memory-cards');
  }

  return (
    <main className="min-h-screen flex flex-col">
      <Nav />

      <section className="lb-auth-card">
        <p className="lb-auth-foot" style={{ marginBottom: 8 }}>
          <Link href="/create">← {t('backToPicker')}</Link>
        </p>
        <h1>{t('heading')}</h1>
        <p className="lede">{t('lede')}</p>

        <MemoryCardsBuilderForm />

        <p className="lb-auth-foot">{t('privacyNote')}</p>
      </section>
    </main>
  );
}
