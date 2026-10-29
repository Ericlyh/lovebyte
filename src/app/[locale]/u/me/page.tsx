import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * /u/me — "my own profile" vanity URL used by the create-finish page's
 * "back to your profile" link (OOP-4893 follow-up polish).
 *
 * Resolves to /u/<handle> for the authenticated user. Falls back to
 * /onboarding if the profile row has no handle yet, and to /login if
 * the visitor is anonymous. There is no real profile with handle "me"
 * (the DB CHECK constraint forbids it — handle regex starts with
 * `[a-z0-9]` and `me` does match, but we never seed such a row), so
 * this route exists only as a redirect shim.
 */
export const dynamic = 'force-dynamic';

export default async function MeProfileRedirectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?next=/u/me');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('handle')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.handle) {
    redirect('/onboarding');
  }

  redirect(`/u/${profile.handle}`);
}
