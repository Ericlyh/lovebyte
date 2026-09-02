'use client';

import { useEffect, useRef, useState } from 'react';
import { checkHandleAvailableAction } from '@/lib/actions/auth';
import {
  isValidHandle,
  normalizeHandle,
} from '@/lib/profiles/handle';

export type HandleState =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken' }
  | { kind: 'error' };

/**
 * Live handle availability probe, shared by /signup (SignupForm) and
 * /u/[handle]/edit (ProfileEditForm). Originally lived inline in
 * SignupForm; lifted to a shared hook in OOP-4340 (M-B step 3c) so the
 * edit page doesn't carry a second copy that can drift.
 *
 *   - empty       → `empty`
 *   - bad format  → `invalid` (skip the roundtrip — the server will say
 *     the same thing)
 *   - good format → server probe → `available` / `taken` / `error`
 *
 * **Frozen-on-checking fix (OOP-4284 follow-up, comment 339c9a62):**
 * the cached-value guard runs FIRST so a value we already probed flips
 * straight back to `available` (not stuck at `checking` from the
 * previous keystroke). `abortRef` discards stale probe responses that
 * resolve after the user has already moved on.
 *
 * **Throw-safe probe (OOP-4274 follow-up, comment 8c67ba51):**
 * the server action can return an HTTP 500 (Vercel runtime errors —
 * module-load throws if env vars go missing). Without try/catch the
 * `await` would reject, the abort check would never run, and the state
 * would stick on `checking` forever (UI shows "Checking…" indefinitely).
 * The catch routes any throw to `{kind:'error'}` so the UI moves on and
 * the form can still submit (the server re-checks on submit anyway).
 *
 * `initialHandle` is the starting value of the input (e.g. the user's
 * current handle on the edit page). When it is non-empty and
 * well-formed, we short-circuit to `available` immediately and cache
 * it so the first edit keystroke doesn't flash "checking" before the
 * probe fires.
 */
export function useHandleAvailability(
  rawHandle: string,
  options?: { initialHandle?: string },
): HandleState {
  const initialValid = options?.initialHandle && isValidHandle(options.initialHandle)
    ? options.initialHandle
    : '';
  const [state, setState] = useState<HandleState>(
    initialValid ? { kind: 'available' } : { kind: 'empty' },
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheckedRef = useRef<string>(initialValid);
  const abortRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current += 1;
    const trimmed = normalizeHandle(rawHandle);

    // Cached-value guard runs FIRST so a value we already probed flips
    // straight back to `available` (not stuck at `checking` from the
    // previous keystroke).
    if (trimmed.length > 0 && trimmed === lastCheckedRef.current) {
      setState({ kind: 'available' });
      return;
    }

    if (trimmed.length === 0) {
      setState({ kind: 'empty' });
      return;
    }
    if (!isValidHandle(trimmed)) {
      setState({ kind: 'invalid' });
      return;
    }
    setState({ kind: 'checking' });

    const abortAt = abortRef.current;
    debounceRef.current = setTimeout(async () => {
      let res;
      try {
        res = await checkHandleAvailableAction(trimmed);
      } catch (e) {
        // The action can reject (HTTP 500 on the deployed edge if env vars
        // are missing, network blip, etc.). Without this catch the abort
        // check below never runs and the UI gets stuck on "Checking…".
        // Log for Vercel grep but always transition out of `checking`.
        console.error('[auth/useHandleAvailability] probe threw', (e as Error)?.message ?? e);
        if (abortAt !== abortRef.current) return;
        setState({ kind: 'error' });
        return;
      }
      if (abortAt !== abortRef.current) return; // stale probe, drop
      if (res.ok) {
        lastCheckedRef.current = trimmed;
        setState(res.available ? { kind: 'available' } : { kind: 'taken' });
      } else {
        setState({ kind: 'error' });
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [rawHandle]);

  return state;
}
