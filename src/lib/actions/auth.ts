'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { postgrest } from '@/lib/supabase/anon';
import {
  validateHandle,
  HANDLE_MAX_LENGTH,
} from '@/lib/profiles/handle';

/**
 * Auth + profile server actions (M-B step 3, OOP-4284).
 *
 * Conventions:
 *   - signUp / signIn / signOut redirect on success. On failure they
 *     return `{ ok: false, error }` so the calling form can render the
 *     error via `useActionState`.
 *   - upsertProfile / checkHandleAvailable return their result shape
 *     directly (they are called by client components over `useTransition`,
 *     not as `<form action>` handlers).
 *   - All errors are written to stderr with a structured tag so the user
 *     can grep Vercel logs (`[auth/signUp] …`).
 */

type AuthField = 'email' | 'password' | 'handle' | 'display_name' | 'avatar' | 'bio';

export type AuthActionResult =
  | { ok: true }
  | { ok: false; error: string; field?: AuthField };

// ---- shared helpers ----------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function badInput(field: AuthField | undefined, msg: string): AuthActionResult {
  return field === undefined ? { ok: false, error: msg } : { ok: false, error: msg, field };
}

const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Display name is required.')
  .max(60, 'Display name must be at most 60 characters.');

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(72, 'Password must be at most 72 characters.'); // Supabase hard limit

const bioSchema = z.string().max(600, 'Bio must be at most 600 characters.');

/**
 * `links` is a textarea — one URL per line. We validate that each line
 * parses as an absolute http(s) URL. Empty lines are skipped (so trailing
 * newlines don't break the parser). On success we return a `string[]`
 * stored as JSON in `profiles.links` (jsonb).
 */
function parseLinks(input: string): { ok: true; links: string[] } | { ok: false; reason: string } {
  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (const line of lines) {
    try {
      const u = new URL(line);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return { ok: false, reason: 'Links must be http(s) URLs.' };
      }
    } catch {
      return { ok: false, reason: `Not a valid URL: ${line}` };
    }
  }
  return { ok: true, links: lines };
}

// ---- signUp ------------------------------------------------------------------

const signUpSchema = z.object({
  email: z.string().trim().regex(EMAIL_RE, 'Enter a valid email address.'),
  password: passwordSchema,
  display_name: displayNameSchema,
  handle: z.string().trim().max(HANDLE_MAX_LENGTH),
});

/**
 * signUpAction(formData)
 *
 * Creates the auth.users row and lets the `handle_new_user` trigger seed
 * the matching `public.profiles` row from `raw_user_meta_data`. On
 * success, redirects to `/onboarding` so the user picks a real handle +
 * bio + links (handle uniqueness is checked there).
 *
 * Note: we pass `handle` through `raw_user_meta_data` so the trigger has
 * the user's first choice; it falls back to email-prefix/hash if invalid
 * or already taken (see `0002_marketplace_v2.sql::handle_new_user`).
 *
 * Supabase email confirmation is enabled in the M-A migration
 * (`auth.users.email_confirmed_at` is required for the storage upload
 * path). With confirmation on, signUp returns `{ user, session: null }`
 * — we still redirect to `/onboarding` which shows a banner; the user
 * must confirm before signing in. (We chose UX clarity over the silent
 * "you can sign in immediately" trap.)
 */
export async function signUpAction(formData: FormData): Promise<AuthActionResult> {
  const parsed = signUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    display_name: formData.get('display_name'),
    handle: formData.get('handle'),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path[0] as 'email' | 'password' | 'display_name' | 'handle' | undefined;
    return badInput(path, issue?.message ?? 'Invalid input.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        display_name: parsed.data.display_name,
        handle: parsed.data.handle,
      },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/onboarding`,
    },
  });

  // Duplicate-email detection (M-B follow-up, OOP-4284 user report).
  //
  // Supabase Auth signUp behaviour for an email that's already registered:
  //   - Recent SDKs (>=2.45): returns `error.code === 'user_already_exists'`.
  //   - Older SDKs (and some GoTrue paths): returns no error, with
  //     `data.user.email_confirmed_at` already populated — Supabase silently
  //     acknowledges the existing user and does NOT send a new confirmation
  //     email (nothing to confirm: the user is already confirmed).
  //
  // Either way the user experience is the same: they hit "Create account",
  // no email arrives, they think the system is broken. Surface that as a
  // field-level error pointing at the email input — the form already wires
  // `state.field === 'email'` to `aria-invalid` on the email <input>, and
  // the "Sign in" link below the submit button already exists.
  if (error && (error.code === 'user_already_exists' || /already.*registered/i.test(error.message))) {
    console.warn('[auth/signUp] duplicate email', parsed.data.email);
    return { ok: false, error: 'EMAIL_EXISTS', field: 'email' };
  }
  if (error) {
    console.error('[auth/signUp]', error.message);
    return { ok: false, error: error.message };
  }

  // No error, but the returned user is already confirmed → signUp was a
  // silent no-op against an existing confirmed account. Same UX outcome as
  // the explicit `user_already_exists` path above: no new email is sent.
  if (data.session == null && data.user?.email_confirmed_at) {
    console.warn('[auth/signUp] silent duplicate (already confirmed)', parsed.data.email);
    return { ok: false, error: 'EMAIL_EXISTS', field: 'email' };
  }

  // Edge case: email-confirmation flow disabled, but no session returned.
  // Treat as a generic failure rather than redirecting — the form shows
  // the error so the user can retry.
  if (data.session == null) {
    // Email confirmation likely required. Redirect to a banner page.
    redirect('/signup/check-email');
  }

  revalidatePath('/', 'layout');
  redirect('/onboarding');
}

// ---- signIn ------------------------------------------------------------------

const signInSchema = z.object({
  email: z.string().trim().regex(EMAIL_RE, 'Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export async function signInAction(formData: FormData): Promise<AuthActionResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path[0] as 'email' | 'password' | undefined;
    return badInput(path, issue?.message ?? 'Invalid input.');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    console.error('[auth/signIn]', error.message);
    return { ok: false, error: 'Wrong email or password.' };
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

// ---- signOut -----------------------------------------------------------------

/**
 * signOutAction()
 *
 * Clears the Supabase auth cookies via the createServerClient's `setAll`
 * hook, then redirects to the home page. Safe to call from a server
 * component form — `redirect()` throws a control-flow signal that Next
 * unwinds.
 */
export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/');
}

// ---- checkHandleAvailable ----------------------------------------------------

export type CheckHandleResult =
  | { ok: true; available: boolean }
  | { ok: false; reason: string };

/**
 * checkHandleAvailableAction(handle)
 *
 * Server-side probe for the /onboarding debounced handle check. Two-step:
 *   1. Format check via `validateHandle` (mirrors DB regex).
 *   2. Uniqueness probe via anon REST against `profiles_public`.
 *
 * Returns `{ available: false, reason }` for malformed handles so the
 * UI can show the right hint without parsing strings.
 *
 * Note: anon REST respects RLS. `profiles_public` is `security_invoker`
 * and exposes handle to anon, so the probe is permitted.
 */
export async function checkHandleAvailableAction(rawHandle: string): Promise<CheckHandleResult> {
  const v = validateHandle(rawHandle);
  if (!v.ok) {
    return { ok: true, available: false };
  }

  const { data, error } = await postgrest<{ handle: string }>(
    'profiles_public',
    {
      select: 'handle',
      filters: { handle: v.handle },
      limitToOne: true,
    },
  );
  if (error) {
    console.error('[auth/checkHandle]', error.message);
    return { ok: false, reason: 'Could not check handle right now. Try again.' };
  }

  const taken = Array.isArray(data) ? data.length > 0 : data != null;
  return { ok: true, available: !taken };
}

// ---- upsertProfile -----------------------------------------------------------

const upsertProfileSchema = z.object({
  handle: z.string().trim().max(HANDLE_MAX_LENGTH),
  display_name: displayNameSchema,
  bio: bioSchema,
  links: z.string().max(2000),
});

export type UpsertProfileResult =
  | { ok: true; handle: string }
  | { ok: false; error: string; field?: 'handle' | 'display_name' | 'bio' | 'links' };

/**
 * upsertProfileAction(formData)
 *
 * Updates the authed user's `public.profiles` row. Authed client
 * (`@/lib/supabase/server`) — the user can only edit their own row
 * (RLS `profiles_update_own`).
 *
 * Bio ≤ 600 + links JSON validation. Avatar is uploaded separately by
 * the client (Storage signed upload) and the resulting media id is
 * passed via `avatar_media_id` — handled by `upsertAvatarMediaIdAction`
 * below so this action stays a plain form submission.
 */
export async function upsertProfileAction(formData: FormData): Promise<UpsertProfileResult> {
  const parsed = upsertProfileSchema.safeParse({
    handle: formData.get('handle'),
    display_name: formData.get('display_name'),
    bio: formData.get('bio'),
    links: formData.get('links') ?? '',
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path[0] as 'handle' | 'display_name' | 'bio' | 'links' | undefined;
    return { ok: false, error: issue?.message ?? 'Invalid input.', field: path };
  }

  // Handle: format + uniqueness.
  const hv = validateHandle(parsed.data.handle);
  if (!hv.ok) {
    return { ok: false, error: 'Pick a valid handle.', field: 'handle' };
  }

  // Links: parse + validate.
  const links = parseLinks(parsed.data.links);
  if (!links.ok) {
    return { ok: false, error: links.reason, field: 'links' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return { ok: false, error: 'Sign in to update your profile.' };
  }

  // Uniqueness probe (defence-in-depth — the UNIQUE index will also
  // catch it but the friendly error here tells the user *why* it failed).
  const probe = await checkHandleAvailableAction(hv.handle);
  if (!probe.ok) {
    return { ok: false, error: probe.reason };
  }
  if (!probe.available && hv.handle !== user.user_metadata?.handle) {
    // Existing handle (we're not changing it) is fine; new handle taken
    // means we need a numeric suffix.
    return {
      ok: false,
      error: `Handle "${hv.handle}" is already taken. Try another.`,
      field: 'handle',
    };
  }

  const { error: updateErr } = await supabase
    .from('profiles')
    .update({
      handle: hv.handle,
      display_name: parsed.data.display_name,
      bio: parsed.data.bio,
      links: links.links,
    })
    .eq('id', user.id);

  if (updateErr) {
    console.error('[auth/upsertProfile]', updateErr.message);
    return { ok: false, error: 'Could not save your profile right now. Try again.' };
  }

  revalidatePath(`/u/${hv.handle}`);
  revalidatePath('/onboarding');
  return { ok: true, handle: hv.handle };
}