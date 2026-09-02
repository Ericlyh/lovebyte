'use client';

import { useEffect, useRef, useState } from 'react';
import { checkEmailAction } from '@/lib/actions/auth';

export type EmailState =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'checking' }
  | { kind: 'verified' }
  | { kind: 'pending' }
  | { kind: 'not_found' }
  | { kind: 'error' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Live email-state probe for the /signup form (OOP-4274 follow-up to
 * comment 5291bacf). Mirrors `useHandleAvailability` exactly so the
 * two live-check hooks share the same UX shape:
 *
 *   - empty       → `empty` (don't probe; nothing typed yet)
 *   - bad format  → `invalid` (skip the roundtrip — the server will say
 *     the same thing)
 *   - good format → server probe → `verified` / `pending` / `not_found`
 *
 * Why these states matter at /signup:
 *   - `verified`  → render the inline card "This email is already
 *     registered. Sign in instead." with a primary CTA to /login, and
 *     disable the submit button. This is the user's reported pain: they
 *     filled the form and only learned at submit time.
 *   - `pending`   → render the inline card "We just resent a confirmation
 *     email. Check your inbox." with a CTA to /signup/check-email, and
 *     disable the submit button (resubmitting won't help — the link is
 *     in their inbox).
 *   - `not_found` → no visible state; the user can submit normally.
 *
 * Throw-safe + 8 s timeout + abortRef: same rationale as
 * `useHandleAvailability` — without these the UI gets stuck on
 * "Checking…" forever if the probe hangs or rejects (the HTTP 500 case
 * we hit on the deployed edge when env vars went missing).
 */
export function useEmailAvailability(rawEmail: string): EmailState {
  const [state, setState] = useState<EmailState>({ kind: 'empty' });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheckedRef = useRef<string>('');
  const abortRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current += 1;
    const trimmed = rawEmail.trim().toLowerCase();
    const abortAt = abortRef.current;

    if (trimmed.length === 0) {
      setState({ kind: 'empty' });
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      setState({ kind: 'invalid' });
      return;
    }

    // Cached-value guard: a value we already probed flips straight to
    // its last result (not `checking`).
    if (trimmed === lastCheckedRef.current) {
      return;
    }

    setState({ kind: 'checking' });

    debounceRef.current = setTimeout(async () => {
      let res;
      try {
        res = await Promise.race([
          checkEmailAction(trimmed),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('checkEmailAction timed out (8s)')),
              8000,
            ),
          ),
        ]);
      } catch (e) {
        console.error('[auth/useEmailAvailability] probe threw', (e as Error)?.message ?? e);
        if (abortAt !== abortRef.current) return;
        setState({ kind: 'error' });
        return;
      }
      if (abortAt !== abortRef.current) return; // stale probe, drop
      if (res.ok) {
        lastCheckedRef.current = trimmed;
        setState({ kind: res.state });
      } else {
        setState({ kind: 'error' });
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [rawEmail]);

  return state;
}
