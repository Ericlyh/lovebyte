import type {
  AnimatedLetterPayload,
  CodeGiftPayload,
  RecipientEnvelope,
} from './schemas';

/**
 * Mock gift data — seeded so the landing page's "See an example" CTA
 * (`/g/demo`) renders a real envelope without requiring Supabase.
 *
 * Kept in this file (not the page) so the same envelope shape is
 * exercised by the live Supabase fetcher when env vars are set —
 * see src/lib/gifts/fetch.ts for the dispatch logic.
 *
 * Replace with `supabase.from('shares').select(...)` once the
 * Supabase Cloud project is provisioned (OOP-4211 blocker #2).
 */
export const MOCK_GIFTS: Record<string, RecipientEnvelope> = {
  demo: {
    shareToken: 'demo',
    giftType: 'animated_letter',
    senderName: 'Eric',
    sentAtIso: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 min ago
    coverText:
      'Because you make an ordinary Tuesday feel like a holiday. 想你 · miss you.',
    payload: {
      markdown: [
        'Dear Jamie,',
        '',
        'Remember the night we got caught in the rain at Tai Mo Shan? You laughed so hard the noodles fell out of your bowl. MAMA noodles. Best noodles of my life.',
        '',
        '想你知道, every single time you smile, it’s my favorite moment of the day.',
        '',
        'Yours, always,',
        'Eric',
      ].join('\n'),
      paper: 'cream',
      envelope_color: 'honey',
      inline_media: [],
    } satisfies AnimatedLetterPayload,
  },

  /**
   * A code gift (OOP-5688) — the demo for the new gift type. It also
   * means the recipient experience can be seen at /g/demo-code without a
   * saved gift, which is the one part of this type that cannot be
   * exercised until the `code` value exists on the gift_type enum.
   */
  'demo-code': {
    shareToken: 'demo-code',
    giftType: 'code',
    senderName: 'Eric',
    sentAtIso: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 min ago
    coverText: 'A tiny page, written by hand.',
    payload: {
      html: `<main>
  <p class="kicker">a little something</p>
  <h1>Happy birthday, Jamie</h1>
  <p class="lede">This whole page is code — HTML for the words, CSS for the look, JavaScript for the moment you press the button.</p>
  <button id="go">Press it</button>
  <p id="out" hidden>See you at the noodles place. 7pm. Don't be late.</p>
</main>`,
      css: `body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #fbf7f7;
  color: #3d2e3a;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
main { text-align: center; padding: 32px; max-width: 420px; }
.kicker { letter-spacing: 0.2em; text-transform: uppercase; font-size: 11px; color: #6e5868; }
h1 { font-family: Georgia, "Times New Roman", serif; font-size: 34px; margin: 12px 0; }
.lede { color: #6e5868; line-height: 1.6; }
button {
  margin-top: 16px;
  padding: 12px 26px;
  border: 0;
  border-radius: 999px;
  background: #a83e3e;
  color: #fff;
  font-size: 16px;
  cursor: pointer;
}`,
      js: `document.getElementById('go').addEventListener('click', () => {
  document.getElementById('out').hidden = false;
  document.getElementById('go').hidden = true;
  document.body.style.background = '#fff3d6';
});`,
      react: false,
    } satisfies CodeGiftPayload,
  },
};

/** Token lookup used by the fetcher when Supabase is not configured. */
export function getMockEnvelope(token: string): RecipientEnvelope | null {
  return MOCK_GIFTS[token] ?? null;
}
