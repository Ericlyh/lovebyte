import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Nav } from '@/components/Nav';
import { createClient } from '@/lib/supabase/server';
import { MultimediaCollageBuilderForm } from '@/components/multimedia-collage/MultimediaCollageBuilderForm';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Multimedia collage — ${BRAND.NAME} builder`,
};

/**
 * /create/multimedia-collage — Phase 7 builder route (OOP-4223).
 *
 * Sender-facing surface for the multimedia_collage gift type. The form
 * lets the sender upload photos / videos / audios (≤ 20 items), drag them
 * onto a canvas with positional layout, optionally add background music,
 * then save the draft + share row in one go.
 *
 * Auth: requires a signed-in user. Anonymous users land on /login with
 * `next` pointing back here.
 *
 * Architecture §6 — feature module at src/features/multimedia-collage/
 * holds the schemas + recipient view; this route is the entry-point
 * component only. The canvas + drag-to-place UX lives in the form
 * component below.
 */
export default async function CreateMultimediaCollagePage() {
  const t = await getTranslations('Builder.multimediaCollage');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?next=/create/multimedia-collage');
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

        <MultimediaCollageBuilderForm />

        <p className="lb-auth-foot">{t('privacyNote')}</p>
      </section>
    </main>
  );
}
