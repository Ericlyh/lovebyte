import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LanguageToggle } from '@/components/LanguageToggle';

export const metadata: Metadata = {
  title: 'Check your inbox — LoveByte',
};

/**
 * /signup/check-email — landing page after a signup that requires email
 * confirmation (the default Supabase config). Renders the email address
 * the user just signed up with so they can sanity-check their inbox.
 *
 * Reads `?email=` from the query string. Missing → generic message.
 */
export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;
  const email = typeof params.email === 'string' ? params.email : '';
  const t = await getTranslations('Auth.checkEmail');

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
        <p className="lede">
          {t('body', { email: email || 'your inbox' })}
        </p>
        <p className="lb-auth-foot">
          <Link href="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}