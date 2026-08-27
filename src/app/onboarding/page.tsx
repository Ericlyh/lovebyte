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
 *   1. Surfaces a friendly banner if the user landed here with a stale
 *      email-confirmation link (`?error_code=otp_expired` from Supabase
 *      auth's verify-OTP endpoint) — instead of silently redirecting
 *      them to /login and dropping the context.
 *   2. Verifies the user is authed (`supabase.auth.getUser()`).
 *      Unauthed visitors get redirected to /login.
 *   3. Reads the current `public.profiles` row to pre-fill the form
 *      (so an existing user returning to complete their profile
 *      doesn't have to re-type everything).
 *   4. Hands off to `OnboardingForm` (client component) which manages
 *      the debounced handle check + the upsert submission.
 *
 * No data writes happen here — all mutations go through the server
 * actions (`upsertProfileAction` / `checkHandleAvailableAction`).
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    error_code?: string;
    error_description?: string;
  }>;
}) {
  const t = await getTranslations('Onboarding');
  const params = await searchParams;

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    // The Supabase email-confirmation flow lands here with an error in
    // the query string when the OTP has expired or already been used.
    // Show an inline explanation instead of dropping them on /login
    // with no idea why their link didn't work.
    if (params.error_code === 'otp_expired') {
      return (
        <main className="min-h-screen flex flex-col">
          <nav className="lb-nav">
            <Link href="/" className="lb-nav__brand">LoveByte</Link>
            <div className="lb-nav__links">
              <LanguageToggle />
            </div>
          </nav>

          <section className="lb-onboarding-card">
            <h1>{t('expiredLink.title')}</h1>
            <p className="lede">{t('expiredLink.body')}</p>
            <p className="lb-auth-foot">
              <Link href="/login">{t('expiredLink.resendCta')}</Link>
            </p>
          </section>
        </main>
      );
    }
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