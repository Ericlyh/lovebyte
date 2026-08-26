import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { LanguageToggle } from '@/components/LanguageToggle';

/**
 * /u/[handle] — M-B step 1 of 4 (OOP-4274).
 *
 * Public creator profile (anon-readable via `profiles_public` view from
 * M-A). Stub: greps the handle param and renders a placeholder hero +
 * tabs. The actual data fetch + RLS-scoped read goes through
 * `getProfileByHandle()` (to be added) which queries the
 * `profiles_public` view — server-side, anon-safe.
 *
 * Edge-runtime safe: no Supabase server client (that needs cookies());
 * the public view is readable from the edge with the anon key alone.
 */
type Props = {
  params: Promise<{ handle: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  return {
    title: `@${handle} — LoveByte`,
    description: `Creator profile @${handle} on LoveByte.`,
  };
}

export default async function CreatorProfilePage({ params }: Props) {
  const { handle } = await params;
  const t = await getTranslations('Profile');

  // M-B spec — kebab-case handle, 3–20 chars. Reject anything else with
  // a 404 rather than 500. The hard validation lives server-side in the
  // upsert; this guard exists so we don't echo garbage back to the user.
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(handle) || handle.length < 3 || handle.length > 20) {
    notFound();
  }

  return (
    <main className="min-h-screen flex flex-col">
      <nav className="lb-nav">
        <Link href="/" className="lb-nav__brand">LoveByte</Link>
        <div className="lb-nav__links">
          <LanguageToggle />
          <Link href="/signup" className="lb-btn lb-btn--primary lb-btn--sm">
            {t('joinCta')}
          </Link>
        </div>
      </nav>

      <section className="lb-profile-hero">
        <h1>@{handle}</h1>
        <p className="lede">{t('placeholderBio', { handle })}</p>
      </section>

      <section className="lb-profile-tabs" aria-label={t('tabsAria')}>
        <button type="button" className="lb-tab lb-tab--active">
          {t('collection')}
        </button>
        <button type="button" className="lb-tab">
          {t('about')}
        </button>
      </section>

      <section className="lb-profile-collection">
        <p className="lb-empty">{t('emptyCollection')}</p>
      </section>
    </main>
  );
}