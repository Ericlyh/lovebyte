import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Nav } from '@/components/Nav';
import { createClient } from '@/lib/supabase/server';
import { QuizBuilderForm } from '@/components/quiz/QuizBuilderForm';

export const metadata: Metadata = {
  title: 'Quiz — LoveByte builder',
};

/**
 * /create/quiz — Phase 6 builder route (OOP-4222).
 *
 * Sender-facing surface for the quiz gift type. The form lets the sender
 * author 1–30 multiple-choice questions with exactly one correct answer
 * and a per-question reveal message. Saving writes the gifts + shares
 * rows in one go.
 *
 * Auth: requires a signed-in user. Anonymous users land on /login with
 * `next` pointing back here.
 *
 * Architecture §6 — feature module at src/features/quiz/ holds the
 * schemas; this route is the entry-point component only.
 */
export default async function CreateQuizPage() {
  const t = await getTranslations('Builder.quiz');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?next=/create/quiz');
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

        <QuizBuilderForm />

        <p className="lb-auth-foot">{t('privacyNote')}</p>
      </section>
    </main>
  );
}
