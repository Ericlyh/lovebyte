import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LanguageToggle } from '@/components/LanguageToggle';

/**
 * /login — M-B step 1 of 4 (OOP-4274).
 *
 * Server Component shell. Magic-link variant is post-MVP per M-B scope.
 * The actual signIn server action + Supabase SSR cookie round-trip is
 * the M-B risk; wired in the next heartbeat.
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

        <form className="lb-form" method="post" action="#">
          <label className="lb-field">
            <span>{t('email')}</span>
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <label className="lb-field">
            <span>{t('password')}</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button type="submit" className="lb-btn lb-btn--primary lb-btn--block">
            {t('submit')}
          </button>
        </form>

        <p className="lb-auth-foot">
          {t('noAccount')}{' '}
          <Link href="/signup">{t('signupLink')}</Link>
        </p>
      </section>
    </main>
  );
}