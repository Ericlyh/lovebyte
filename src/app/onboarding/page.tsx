import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LanguageToggle } from '@/components/LanguageToggle';

/**
 * /onboarding — M-B step 1 of 4 (OOP-4274).
 *
 * First-login flow: pick handle, upload avatar, write bio + links,
 * preview /u/[handle]. Stub renders the structure + i18n; the
 * server action + Storage upload + profiles.upsert come next
 * heartbeat. Handle UNIQUE check is server-side (the regex +
 * format lives in src/lib/profiles/handle.ts — to be added).
 */
export const metadata: Metadata = {
  title: 'Set up your creator profile — LoveByte',
};

export default async function OnboardingPage() {
  const t = await getTranslations('Onboarding');

  return (
    <main className="min-h-screen flex flex-col">
      <nav className="lb-nav">
        <Link href="/" className="lb-nav__brand">LoveByte</Link>
        <div className="lb-nav__links">
          <LanguageToggle />
        </div>
      </nav>

      <section className="lb-onboarding-card">
        <h1>{t('heading')}</h1>
        <p className="lede">{t('lede')}</p>

        <form className="lb-form" method="post" action="#">
          <label className="lb-field">
            <span>{t('handle.label')}</span>
            <input
              type="text"
              name="handle"
              pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
              minLength={3}
              maxLength={20}
              autoComplete="username"
              required
            />
            <small>{t('handle.hint')}</small>
          </label>

          <label className="lb-field">
            <span>{t('avatar.label')}</span>
            <input type="file" name="avatar" accept="image/*" />
          </label>

          <label className="lb-field">
            <span>{t('bio.label')}</span>
            <textarea name="bio" maxLength={600} rows={4} />
          </label>

          <label className="lb-field">
            <span>{t('links.label')}</span>
            <textarea
              name="links"
              rows={3}
              placeholder={t('links.placeholder')}
            />
          </label>

          <button type="submit" className="lb-btn lb-btn--primary lb-btn--block">
            {t('submit')}
          </button>
        </form>
      </section>
    </main>
  );
}