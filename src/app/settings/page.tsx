import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { LanguageToggle } from '@/components/LanguageToggle';
import { signOutAction } from '@/lib/actions/auth';
import { createClient } from '@/lib/supabase/server';
import { type Locale } from '@/lib/i18n/routing';

export const metadata: Metadata = {
  title: 'Settings — LoveByte',
};

/**
 * /settings — M-B step 3d (OOP-4341).
 *
 * Authed-only settings hub. Mirrors the /login + /onboarding visual shell
 * (nav + card) so the user lands on something familiar. Sections:
 *
 *   1. Account      — email, read-only.
 *   2. Language     — current locale + the shared `LanguageToggle`.
 *                     The persisted preference lives in
 *                     `profiles.preferred_language`; we fall back to the
 *                     `lb-locale` cookie resolved by next-intl if the
 *                     profile read fails.
 *   3. Notifications — stub. Wiring is deferred until the notification
 *                      centre ships.
 *   4. Session      — Sign out (server action, clears cookies + redirects).
 *   5. Danger zone  — Delete account CTA, intentionally disabled while we
 *                     wait on a retention policy.
 */
export default async function SettingsPage() {
  const t = await getTranslations('Settings');
  const cookieLocale = (await getLocale()) as Locale;

  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    redirect('/login');
  }

  // Preferred locale: DB first (the user's saved preference), then the
  // cookie. We only need this to *display* the current language; the
  // toggle itself writes both the cookie and (eventually) the DB row.
  let preferredLocale: Locale = cookieLocale;
  const { data: profileRow, error: profileErr } = await supabase
    .from('profiles')
    .select('preferred_language')
    .eq('id', user.id)
    .maybeSingle();
  if (profileErr) {
    console.warn('[settings] profile read failed, using cookie locale', profileErr.message);
  } else if (
    profileRow?.preferred_language === 'en' ||
    profileRow?.preferred_language === 'zh-Hant'
  ) {
    preferredLocale = profileRow.preferred_language;
  }

  const email = user.email ?? '';

  return (
    <main className="min-h-screen flex flex-col">
      <nav className="lb-nav">
        <Link href="/" className="lb-nav__brand">LoveByte</Link>
        <div className="lb-nav__links">
          <LanguageToggle />
        </div>
      </nav>

      <section className="lb-settings-card">
        <h1>{t('heading')}</h1>
        <p className="lede">{t('lede')}</p>

        <div className="lb-settings-section">
          <h2>{t('account.title')}</h2>
          <div className="lb-field">
            <span>{t('account.emailLabel')}</span>
            <input type="email" value={email} readOnly aria-readonly="true" />
            <small>{t('account.emailHint')}</small>
          </div>
        </div>

        <div className="lb-settings-section">
          <h2>{t('language.title')}</h2>
          <p className="lb-settings-current">
            {t('language.current', { locale: preferredLocale === 'en' ? 'English' : '繁體中文' })}
          </p>
          <LanguageToggle />
          <p className="lb-settings-hint">{t('language.hint')}</p>
        </div>

        <div className="lb-settings-section">
          <h2>{t('notifications.title')}</h2>
          <p className="lb-settings-stub">{t('notifications.stub')}</p>
        </div>

        <div className="lb-settings-section">
          <h2>{t('session.title')}</h2>
          <form action={signOutAction}>
            <button type="submit" className="lb-btn lb-btn--ghost">
              {t('session.signOut')}
            </button>
          </form>
        </div>

        <div className="lb-settings-section lb-settings-section--danger">
          <h2>{t('danger.title')}</h2>
          <p className="lb-settings-stub">{t('danger.stub')}</p>
          <button type="button" className="lb-btn" disabled>
            {t('danger.cta')}
          </button>
          <small className="lb-settings-hint">{t('danger.comingSoon')}</small>
        </div>
      </section>
    </main>
  );
}
