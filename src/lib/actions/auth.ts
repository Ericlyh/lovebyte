'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { postgrest } from '@/lib/supabase/anon';
import { lookupEmail } from '@/lib/supabase/admin';
import {
  validateHandle,
  handleReasonText,
  HANDLE_MIN_LENGTH,
  HANDLE_MAX_LENGTH,
  HANDLE_REGEX,
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
  handle: z
    .string()
    .trim()
    .min(HANDLE_MIN_LENGTH, `Handle must be at least ${HANDLE_MIN_LENGTH} characters.`)
    .max(HANDLE_MAX_LENGTH, `Handle must be at most ${HANDLE_MAX_LENGTH} characters.`)
    .regex(HANDLE_REGEX, 'Lowercase letters, digits, and dashes only.'),
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

  // Defence-in-depth: re-run the format check via `validateHandle` even
  // though the zod regex should catch it. The lib is the canonical source
  // of truth (also used by the handle-history RPC) — keep both paths in
  // sync by routing through it. (Part B of the OOP-4284 reviewed flow.)
  const hv = validateHandle(parsed.data.handle);
  if (!hv.ok) {
    return { ok: false, error: handleReasonText(hv.reason), field: 'handle' };
  }

  // Pre-check: is this email already registered? (OOP-4284 user report.)
  //
  // Supabase signUp behaviour for an existing email is split by state:
  //   - Verified account: returns `error.code === 'user_already_exists'`
  //     (recent SDKs) OR silently succeeds with the existing user echoed
  //     back. Either way no new email is sent.
  //   - Pending account (signed up but didn't click the link): recent
  //     SDKs ALSO return `user_already_exists` and do NOT resend — the
  //     user is stuck wondering why their inbox is empty.
  //
  // Distinguish the two with a GoTrue admin lookup before calling signUp
  // so we can route each case to the right UX:
  //   - verified  → tell the user to sign in instead (EMAIL_VERIFIED).
  //   - pending   → call resend() to fire a fresh confirmation email,
  //                  then redirect to the check-email banner.
  //   - not_found → normal signUp.
  const lookup = await lookupEmail(parsed.data.email);
  const supabase = await createClient();
  if (lookup.error) {
    // Admin lookup failed — log and fall through to normal signUp. The
    // post-signUp detection below still catches the verified case.
    console.warn('[auth/signUp] admin lookup failed, falling through', lookup.error.message);
  } else if (lookup.data.state === 'verified') {
    console.warn('[auth/signUp] email already verified', parsed.data.email);
    return { ok: false, error: 'EMAIL_VERIFIED', field: 'email' };
  } else if (lookup.data.state === 'pending') {
    // Resend the confirmation email. This calls GoTrue's /auth/v1/resend
    // endpoint under the hood, which generates a fresh token and emails
    // it. Works without an active session.
    const { error: resendErr } = await supabase.auth.resend({
      type: 'signup',
      email: parsed.data.email,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/onboarding`,
      },
    });
    if (resendErr) {
      console.error('[auth/signUp] resend failed', resendErr.message);
      // Fall through to signUp anyway — worst case the user gets the
      // original confirmation link (if it's still valid) or the standard
      // signUp error.
    } else {
      const q = new URLSearchParams({ email: parsed.data.email });
      redirect(`/signup/check-email?${q.toString()}`);
    }
  }

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

  // Post-signUp duplicate detection — defence in depth in case the
  // pre-check above was unavailable (admin lookup failed) or raced a
  // concurrent signUp. Both shapes mean the same thing to the user: no
  // new email will arrive.
  if (error && (error.code === 'user_already_exists' || /already.*registered/i.test(error.message))) {
    console.warn('[auth/signUp] duplicate email (post-check)', parsed.data.email);
    return { ok: false, error: 'EMAIL_EXISTS', field: 'email' };
  }
  if (error) {
    console.error('[auth/signUp]', error.message);
    return { ok: false, error: error.message };
  }

  if (data.session == null && data.user?.email_confirmed_at) {
    // Silent no-op against an already-confirmed account. The pre-check
    // should have caught this; if we got here, treat the same way.
    console.warn('[auth/signUp] silent duplicate (already confirmed)', parsed.data.email);
    return { ok: false, error: 'EMAIL_VERIFIED', field: 'email' };
  }

  // Edge case: email-confirmation flow disabled, but no session returned.
  // Treat as a generic failure rather than redirecting — the form shows
  // the error so the user can retry.
  if (data.session == null) {
    // Email confirmation likely required. Redirect to a banner page.
    const q = new URLSearchParams({ email: parsed.data.email });
    redirect(`/signup/check-email?${q.toString()}`);
  }

  revalidatePath('/', 'layout');
  redirect('/onboarding');
}

// ---- checkEmail --------------------------------------------------------------

export type CheckEmailResult =
  | { ok: true; state: 'verified' | 'pending' | 'not_found' }
  | { ok: false; error: string };

/**
 * checkEmailAction(rawEmail)
 *
 * Pre-submit probe for the /signup form's email field (OOP-4274 follow-up
 * to comment 5291bacf). The post-submit `signUpAction` already detects
 * an already-verified email and shows the EMAIL_VERIFIED card, but the
 * user has to fill in name + handle + password before they hit "Create
 * account" — they don't know their email is verified until then. This
 * probe lets the form show the same "already registered, sign in instead"
 * message inline as soon as the email field looks well-formed.
 *
 * Three states, mirroring the post-submit branches in `signUpAction`:
 *   - verified  → user is confirmed; CTA → /login.
 *   - pending   → user signed up but didn't click the link; fire a fresh
 *                 resend (so the user's inbox isn't empty) and hint them
 *                 to /signup/check-email.
 *   - not_found → normal signup, no visible state.
 *
 * Privacy note: this endpoint discloses whether an email is registered.
 * That disclosure already happens on submit (`signUpAction` returns
 * `EMAIL_VERIFIED` vs `EMAIL_EXISTS`), so moving it earlier does not
 * increase the disclosure surface — it just makes the form friendlier.
 * If we ever want to lock enumeration down, the right move is to gate
 * this on the same OTP rate-limit bucket the project already applies to
 * `/auth/v1/resend` (30/hr), not to remove the check.
 */
export async function checkEmailAction(rawEmail: string): Promise<CheckEmailResult> {
  const email = (rawEmail ?? '').trim();
  if (!email) {
    return { ok: false, error: 'empty' };
  }
  if (!EMAIL_RE.test(email)) {
    // Don't waste a GoTrue admin roundtrip on a malformed input — the
    // email field's own aria-invalid is enough feedback.
    return { ok: false, error: 'invalid_format' };
  }

  const lookup = await lookupEmail(email);
  if (lookup.error) {
    // Mirror `signUpAction`: log the failure, fall through to not_found
    // so the form can submit. The post-submit duplicate detection will
    // still catch the verified case if the user actually has an account.
    console.warn('[auth/checkEmail] admin lookup failed', lookup.error.message);
    return { ok: false, error: lookup.error.message };
  }

  if (lookup.data.state === 'pending') {
    // Fire-and-forget resend so the user's inbox isn't empty while they
    // sit on the "already pending" hint. Errors are logged but never
    // surfaced — this is a UX nicety, not a hard requirement.
    const supabase = await createClient();
    const { error: resendErr } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/onboarding`,
      },
    });
    if (resendErr) {
      console.warn('[auth/checkEmail] resend failed', resendErr.message);
    }
  }

  return { ok: true, state: lookup.data.state };
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
  // Avatar upload is staged separately (see /api/upload/avatar + OOP-4310):
  // the client uploads the bytes, gets a `gift_media.id`, then passes it
  // here. Optional — omitted form fields collapse to `undefined`.
  avatar_media_id: z
    .string()
    .uuid('avatar_media_id must be a UUID.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export type UpsertProfileResult =
  | { ok: true; handle: string }
  | { ok: false; error: string; field?: 'handle' | 'display_name' | 'bio' | 'links' | 'avatar_media_id' };

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
    avatar_media_id: formData.get('avatar_media_id') ?? undefined,
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

  // Build the update payload. We only set `avatar_media_id` when the
  // caller passed one — an empty field means "leave the existing avatar
  // alone", which matters because /onboarding re-submits the whole form
  // every time (the user might tweak bio without intending to drop the
  // avatar).
  const updatePayload: Record<string, unknown> = {
    handle: hv.handle,
    display_name: parsed.data.display_name,
    bio: parsed.data.bio,
    links: links.links,
  };
  if (parsed.data.avatar_media_id) {
    updatePayload.avatar_media_id = parsed.data.avatar_media_id;
  }

  const { error: updateErr } = await supabase
    .from('profiles')
    .update(updatePayload)
    .eq('id', user.id);

  if (updateErr) {
    console.error('[auth/upsertProfile]', updateErr.message);
    return { ok: false, error: 'Could not save your profile right now. Try again.' };
  }

  revalidatePath(`/u/${hv.handle}`);
  revalidatePath('/onboarding');
  return { ok: true, handle: hv.handle };
}

// ---- changeHandle ------------------------------------------------------------

export type ChangeHandleResult =
  | { ok: true; handle: string }
  | { ok: false; error: string; reason?: 'format' | 'taken' | 'cooldown' | 'unauthenticated'; field?: 'handle'; retryAt?: string };

/**
 * changeHandleAction(formData)
 *
 * Authenticated handle change with a 30-day cooldown (Part C of the
 * OOP-4284 reviewed flow). The RPC `public.change_handle` is the
 * canonical enforcement point — it checks the cooldown, normalises
 * the handle, appends a numeric suffix on collision, and the trigger
 * writes the history row + bumps `handle_changed_at`.
 *
 * The cooldown is also checked client-side so the form can show a
 * "you can change again in N days" countdown before the user even
 * tries to save.
 */
export async function changeHandleAction(formData: FormData): Promise<ChangeHandleResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return { ok: false, error: 'Sign in to change your handle.', reason: 'unauthenticated' };
  }

  const rawHandle = formData.get('handle');
  if (typeof rawHandle !== 'string') {
    return { ok: false, error: 'Pick a handle.', reason: 'format', field: 'handle' };
  }
  const hv = validateHandle(rawHandle);
  if (!hv.ok) {
    return { ok: false, error: handleReasonText(hv.reason), reason: 'format', field: 'handle' };
  }

  // Cooldown pre-check (mirrors the RPC, which is the canonical check).
  // Reads profiles via the authed client; RLS lets the user see their
  // own row.
  const { data: row, error: rowErr } = await supabase
    .from('profiles')
    .select('handle, handle_changed_at')
    .eq('id', user.id)
    .maybeSingle();
  if (rowErr) {
    console.error('[auth/changeHandle] profile read failed', rowErr.message);
    return { ok: false, error: 'Could not check your cooldown right now. Try again.' };
  }
  if (row && row.handle === hv.handle) {
    return { ok: true, handle: hv.handle };
  }
  if (row?.handle_changed_at) {
    const changedAt = new Date(row.handle_changed_at);
    const cooldownEnd = new Date(changedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (cooldownEnd > new Date()) {
      return {
        ok: false,
        error: 'You changed your handle recently. Try again later.',
        reason: 'cooldown',
        retryAt: cooldownEnd.toISOString(),
      };
    }
  }

  // Uniqueness probe (defence-in-depth — the RPC's collision-append
  // loop is the canonical enforcement, but failing fast here gives a
  // friendlier error message).
  const probe = await checkHandleAvailableAction(hv.handle);
  if (!probe.ok) {
    return { ok: false, error: probe.reason };
  }
  if (!probe.available) {
    return {
      ok: false,
      error: `Handle "${hv.handle}" is already taken. Try another.`,
      reason: 'taken',
      field: 'handle',
    };
  }

  // Apply via RPC. `rpc` runs as the authenticated user (their JWT);
  // the function is `security definer` so it can write to handle_history
  // and bypass the RLS-free insert.
  const { data: rpcHandle, error: rpcErr } = await supabase.rpc('change_handle', {
    p_id: user.id,
    p_new_handle: hv.handle,
  });
  if (rpcErr) {
    console.error('[auth/changeHandle] rpc failed', rpcErr.message);
    // Map Postgres error codes back to friendly reasons. The RPC
    // raises 'cooldown_active' (P0001) and 'invalid_handle' (22023).
    if (/cooldown/i.test(rpcErr.message)) {
      return {
        ok: false,
        error: 'You changed your handle recently. Try again later.',
        reason: 'cooldown',
        retryAt: row?.handle_changed_at
          ? new Date(new Date(row.handle_changed_at).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
          : undefined,
      };
    }
    if (/invalid_handle/i.test(rpcErr.message)) {
      return { ok: false, error: handleReasonText('format'), reason: 'format', field: 'handle' };
    }
    return { ok: false, error: 'Could not change your handle right now. Try again.' };
  }

  const newHandle = (rpcHandle as string | null) ?? hv.handle;
  revalidatePath(`/u/${newHandle}`);
  if (row?.handle) revalidatePath(`/u/${row.handle}`);
  revalidatePath('/onboarding');
  return { ok: true, handle: newHandle };
}