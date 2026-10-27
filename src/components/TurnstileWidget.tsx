'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

/**
 * Cloudflare Turnstile widget for the waitlist form (OOP-6161).
 *
 * Dormant by default. The gate is off until `TURNSTILE_SECRET_KEY` is
 * set, and the form only renders this component when the SERVER says
 * the gate is on — see `WaitlistForm`'s `turnstileEnabled` prop, which
 * comes from the server component. A browser that somehow saw the site
 * key without the server having the secret would render nothing, and
 * the server would not verify anything: the two halves always agree
 * because the server is the only one that decides.
 *
 * The token comes back through a callback rather than a hidden input,
 * so the value never sits in the DOM and the parent holds it in React
 * state until the form is submitted.
 *
 * Why `next/script` and not a static <script> tag? The Turnstile
 * script is third-party and we do not want it in the critical path.
 * `afterInteractive` loads it after hydration, and only when the
 * component is actually rendered — which, with the gate off, is never.
 */

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
      theme?: 'auto' | 'light' | 'dark';
    },
  ) => string | undefined;
  reset: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export function TurnstileWidget(props: {
  siteKey: string;
  /** Called with the token on success, and with '' when it expires or errors. */
  onToken: (token: string) => void;
}) {
  const { siteKey, onToken } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);

  // Render the widget once the Turnstile script has loaded. The script
  // is loaded with `render=explicit`, so nothing appears until we call
  // `turnstile.render()` ourselves.
  useEffect(() => {
    if (!scriptReady) return;
    const el = containerRef.current;
    if (!el || !window.turnstile) return;

    const widgetId = window.turnstile.render(el, {
      sitekey: siteKey,
      callback: (token: string) => onToken(token),
      'expired-callback': () => onToken(''),
      'error-callback': () => onToken(''),
      theme: 'auto',
    });

    return () => {
      // The widget lives inside a div we own; removing the node is
      // enough, but resetting first releases Cloudflare's iframe.
      if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
    };
    // `onToken` is intentionally not a dependency: the parent passes a
    // fresh closure each render, and re-rendering the widget on every
    // parent render would reset the solved CAPTCHA.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptReady, siteKey]);

  return (
    <>
      <div ref={containerRef} className="lb-turnstile" />
      <Script
        src={TURNSTILE_SRC}
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
    </>
  );
}
