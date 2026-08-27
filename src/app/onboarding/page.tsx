import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { LanguageToggle } from '@/components/LanguageToggle';
import { OnboardingForm } from '@/components/auth/OnboardingForm';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Set up your creator profile — LoveByte',
};

/**
 * /onboarding — M-B step 3 (OOP-4284).
 *
 * Server Component shell that:
 *   1. Verifies the user is authed (`supabase.auth.getUser()`).
 *      Unauthed visitors get redirected to /login.
 *   2. Reads the current `public.profiles` row to pre-fill the form
 *      (so an existing user returning to complete their profile
 *      doesn't have to re-type everything).
 *   3. Hands off to `OnboardingForm` (client component) which manages
 *      the debounced handle check + the upsert submission.
 *
 * No data writes happen here — all mutations go through the server
 * actions (`upsertProfileAction` / `checkHandleAvailableAction`).
 */
export default async function OnboardingPage() {
  const t = await getTranslations('Onboarding');

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    redirect('/login');
  }
  const user = userData.user;

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('handle, display_name, bio, links')
    .eq('id', user.id)
    .maybeSingle();

  if (profileErr) {
    // RLS / connection problem — surface as an error page rather than
    // silently rendering an empty form. The user can refresh.
    console.error('[onboarding] profile read failed', profileErr.message);
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
          <p role="alert" className="lb-form__error">
            Could not load your profile right now. Refresh the page to try again.
          </p>
        </section>
      </main>
    );
  }

  const initialHandle = (profile?.handle as string | null) ?? '';
  const initialDisplayName =
    (profile?.display_name as string | null) ??
    (user.user_metadata?.display_name as string | null) ??
    '';
  const initialBio = (profile?.bio as string | null) ?? '';
  const initialLinks = Array.isArray(profile?.links)
    ? (profile!.links as unknown[]).map(String)
    : [];

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

        <OnboardingForm
          initialHandle={initialHandle}
          initialDisplayName={initialDisplayName}
          initialBio={initialBio}
          initialLinks={initialLinks}
        />
      </section>
    </main>
  );
}