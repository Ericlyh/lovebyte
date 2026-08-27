import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LanguageToggle } from '@/components/LanguageToggle';
import { SignupForm } from '@/components/auth/SignupForm';

/**
 * /signup — M-B step 3 (OOP-4284).
 *
 * Server Component shell. The form is a Client Component (`SignupForm`)
 * wired to `signUpAction` via `useActionState`. On success the server
 * action redirects to `/onboarding` (no session) or `/signup/check-email`
 * (email-confirmation flow).
 */
export const metadata: Metadata = {
  title: 'Sign up — LoveByte',
};

export default async function SignupPage() {
  const t = await getTranslations('Auth.signup');

  return (
    <main className="min-h-screen flex flex-col">
      <nav className="lb-nav">
        <Link href="/" className="lb-nav__brand">LoveByte</Link>
        <div className="lb-nav__links">
          <LanguageToggle />
        </div>
      </nav>

      <section className="lb-auth-card">
        <h1>{t('heading')}</h1>
        <p className="lede">{t('lede')}</p>

        <SignupForm />

        <p className="lb-auth-foot">
          {t('haveAccount')}{' '}
          <Link href="/login">{t('signinLink')}</Link>
        </p>
      </section>
    </main>
  );
}