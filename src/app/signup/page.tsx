import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LanguageToggle } from '@/components/LanguageToggle';

/**
 * /signup — M-B step 1 of 4 (OOP-4274).
 *
 * Server Component shell. The form posts to a server action (next
 * heartbeat — wiring Supabase Auth signUp + the cookie round-trip
 * is the M-B risk). Stub renders the form structure + i18n so the
 * layout is locked before we wire the action.
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
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <button type="submit" className="lb-btn lb-btn--primary lb-btn--block">
            {t('submit')}
          </button>
        </form>

        <p className="lb-auth-foot">
          {t('haveAccount')}{' '}
          <Link href="/login">{t('signinLink')}</Link>
        </p>
      </section>
    </main>
  );
}