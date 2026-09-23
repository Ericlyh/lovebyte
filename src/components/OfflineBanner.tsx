'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Top-of-page banner that surfaces when `navigator.onLine` flips to
 * false (or stays false on mount). Listens for the browser's
 * `online` / `offline` events and re-evaluates on every change.
 *
 * Phase 9 (OOP-4225) — typed error UI for the "network offline" case
 * from the acceptance criteria. Without this the user gets a hung
 * spinner on every form submit / async action when they lose Wi-Fi
 * mid-flow. The banner is a passive alert (role="status", aria-live=
 * "polite") so screen readers announce it without interrupting.
 *
 * Sits in the layout's body — no per-page wiring needed.
 */
export function OfflineBanner() {
  const t = useTranslations('Common.offline');
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div
      className="lb-offline-banner"
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true">📡</span>
      <span>{t('body')}</span>
    </div>
  );
}