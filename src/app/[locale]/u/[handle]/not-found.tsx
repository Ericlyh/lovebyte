import { CommonNotFound } from '@/components/PageState';

/**
 * Typed 404 for /u/[handle] — handle doesn't exist.
 * Phase 9 (OOP-4225).
 */
export default function ProfileNotFound() {
  return (
    <main className="lb-profile-page">
      <CommonNotFound />
    </main>
  );
}