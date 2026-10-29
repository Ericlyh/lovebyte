import { CommonNotFound } from '@/components/PageState';

/**
 * Typed 404 for /u/[handle]/edit — profile doesn't exist or isn't
 * yours. Phase 9 (OOP-4225).
 */
export default function ProfileEditNotFound() {
  return (
    <main className="lb-profile-edit-page">
      <CommonNotFound />
    </main>
  );
}