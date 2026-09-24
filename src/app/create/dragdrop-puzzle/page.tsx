import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Nav } from '@/components/Nav';
import { createClient } from '@/lib/supabase/server';
import { DragdropPuzzleBuilderForm } from '@/components/dragdrop-puzzle/DragdropPuzzleBuilderForm';

export const metadata: Metadata = {
  title: 'Photo puzzle — LoveByte builder',
};

/**
 * /create/dragdrop-puzzle — Phase 5 builder route (OOP-4221).
 *
 * Sender-facing surface for the dragdrop_puzzle gift type. The form lets
 * the sender upload a single photo, pick a grid size (3 / 4 / 5), and
 * write a reveal message that pops on the recipient's screen when they
 * finish the puzzle. Saving writes the gifts + shares rows in one go.
 *
 * Auth: requires a signed-in user. Anonymous users land on /login with
 * `next` pointing back here.
 *
 * Architecture §6 — feature module at src/features/dragdrop-puzzle/ holds
 * the schemas; this route is the entry-point component only.
 */
export default async function CreateDragdropPuzzlePage() {
  const t = await getTranslations('Builder.dragdropPuzzle');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?next=/create/dragdrop-puzzle');
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

        <DragdropPuzzleBuilderForm />

        <p className="lb-auth-foot">{t('privacyNote')}</p>
      </section>
    </main>
  );
}