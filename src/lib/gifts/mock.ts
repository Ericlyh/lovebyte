import type {
  AnimatedLetterPayload,
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
};

/** Token lookup used by the fetcher when Supabase is not configured. */
export function getMockEnvelope(token: string): RecipientEnvelope | null {
  return MOCK_GIFTS[token] ?? null;
}
