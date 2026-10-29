import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Nav } from '@/components/Nav';
import { createClient } from '@/lib/supabase/server';
import { AnimatedLetterBuilderForm } from '@/components/letter/AnimatedLetterBuilderForm';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Animated letter — ${BRAND.NAME} builder`,
};

/**
 * /create/animated-letter — sender-side builder for the animated letter
 * gift type (OOP-6720).
 *
 * The recipient renderer for this format shipped in Phase 3, but the
 * SENDER half never did — so `animated_letter`, the create dropdown's
 * default option and one of the six formats the landing page
 * advertises, was the one type a creator could pick but never finish.
 * The draft it produced had an empty payload and the publish action
 * refused it. This route closes that dead end.
 *
 * The sender writes the letter, picks the paper style and the envelope
 * colour. Saving writes the gifts + shares rows and routes to
 * /create/[giftId]/finish?share=<token>, where the share link and the
 * publish card both render.
 *
 * Auth: requires a signed-in user. Anonymous users land on /login with
 * `next` pointing back here.
 */
export default async function CreateAnimatedLetterPage({
  params,
}: PageProps<'/[locale]/create/animated-letter'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Builder.letter');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?next=/create/animated-letter');
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

        <AnimatedLetterBuilderForm />

        <p className="lb-auth-foot">{t('privacyNote')}</p>
      </section>
    </main>
  );
}
