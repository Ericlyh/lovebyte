import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LanguageToggle } from '@/components/LanguageToggle';
import { LoginForm } from '@/components/auth/LoginForm';
import { BRAND } from '@/lib/brand';
import { sanitizeNextPath } from '@/lib/forms/next-path';

/**
 * /login — M-B step 3 (OOP-4284).
 *
 * Server Component shell. Form is `LoginForm` (client), wired to
 * `signInAction` via `useActionState`. On success the server action
 * redirects to `next` when one was supplied and to `/` otherwise.
 *
 * The `next` return path (OOP-6718): `ReplyForm` has always linked
 * here with `?next=…` so a visitor comes back to where they were. On
 * the recipient surface that is the difference between writing back to
 * the gift and being dropped on the home page. The value is
 * attacker-controlled, so it goes through `sanitizeNextPath` here and
 * is validated AGAIN in the action — the action is the trust boundary.
 */
export const metadata: Metadata = {
  title: `Sign in — ${BRAND.NAME}`,
};

type Props = PageProps<'/[locale]/login'> & {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const sp = await searchParams;
  const nextPath = sanitizeNextPath(sp.next);

  const t = await getTranslations('Auth.login');

  return (
    <main className="min-h-screen flex flex-col">
      <nav className="lb-nav">
        <Link href="/" className="lb-nav__brand">{BRAND.NAME}</Link>
        <div className="lb-nav__links">
          <LanguageToggle />
        </div>
      </nav>

      <section className="lb-auth-card">
        <h1>{t('heading')}</h1>
        <p className="lede">{t('lede')}</p>

        <LoginForm nextPath={nextPath ?? undefined} />

        <p className="lb-auth-foot">
          {t('noAccount')}{' '}
          <Link href="/signup">{t('signupLink')}</Link>
        </p>
      </section>
    </main>
  );
}