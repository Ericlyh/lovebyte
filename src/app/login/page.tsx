import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LanguageToggle } from '@/components/LanguageToggle';
import { LoginForm } from '@/components/auth/LoginForm';

/**
 * /login — M-B step 3 (OOP-4284).
 *
 * Server Component shell. Form is `LoginForm` (client), wired to
 * `signInAction` via `useActionState`. On success the server action
 * redirects to `/`.
 */
export const metadata: Metadata = {
  title: 'Sign in — LoveByte',
};

export default async function LoginPage() {
  const t = await getTranslations('Auth.login');

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

        <LoginForm />

        <p className="lb-auth-foot">
          {t('noAccount')}{' '}
          <Link href="/signup">{t('signupLink')}</Link>
        </p>
      </section>
    </main>
  );
}