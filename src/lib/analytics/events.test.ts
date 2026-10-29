import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_EVENTS,
  CLIENT_EVENTS,
  FUNNEL_STEPS,
  aggregateEvents,
  buildFunnel,
  eventObjectPath,
  isClientEvent,
  parseEventObjectPath,
  parseEventProps,
  redactSearchTerm,
} from './events';

/**
 * Analytics vocabulary tests (OOP-6716).
 *
 * Three things are worth pinning here, and they are the three ways the
 * feature can be worthless or harmful:
 *
 *   1. THE PII RULE. Every event's props are described by a Zod object
 *      schema, and Zod strips unknown keys — so the schema is the
 *      allowlist and a crafted request cannot smuggle an email address
 *      or a share token into the event log. This is the guarantee, and
 *      it is worth a test because it is enforced by a library default
 *      rather than by code someone has to remember to run.
 *
 *   2. THE FUNNEL MATH. "9 people looked at the homepage" is a SESSION
 *      count, not an event count: one visitor who reloaded the page
 *      three times is one person.
 *
 *   3. THE STORAGE LAYOUT. The event name, the date and the session id
 *      are encoded in the object NAME, so the report counts names and
 *      never downloads a body. If the layout and the parser drift apart,
 *      the report silently reports zeros.
 */

describe('the PII rule (OOP-6716)', () => {
  it('strips a field the schema does not declare', () => {
    const parsed = parseEventProps('landing_view', {
      email: 'someone@example.com',
      token: '3f9a1c4e8b2d7f6a5e0c1b9d8a7f6e5d',
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.props).toEqual({});
    expect(JSON.stringify(parsed.props)).not.toContain('example.com');
  });

  it('strips a share token from a listing event', () => {
    const parsed = parseEventProps('listing_view', {
      gift_type: 'quiz',
      gift_id: 'aaaa1111-0000-0000-0000-000000000001',
      share_token: '3f9a1c4e8b2d7f6a5e0c1b9d8a7f6e5d',
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.props).toEqual({
      gift_type: 'quiz',
      gift_id: 'aaaa1111-0000-0000-0000-000000000001',
    });
  });

  it('keeps the fields the schema does declare', () => {
    const parsed = parseEventProps('filter_used', {
      filter: 'category',
      value: 'quiz',
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.props).toEqual({ filter: 'category', value: 'quiz' });
  });

  it('has no field for a share token on the gift-open event', () => {
    const parsed = parseEventProps('gift_opened', {
      gift_type: 'animated_letter',
      token: '3f9a1c4e8b2d7f6a5e0c1b9d8a7f6e5d',
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.props)).toEqual(['gift_type']);
  });

  it('redacts an email address out of a search term', () => {
    const parsed = parseEventProps('search', { term: 'gift for me@example.com' });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.props.term).toBe('gift for [redacted-email]');
  });

  it('redacts a long opaque token out of a search term', () => {
    const redacted = redactSearchTerm('3f9a1c4e8b2d7f6a5e0c1b9d8a7f6e5d');

    expect(redacted).toBe('[redacted-token]');
  });

  it('keeps an ordinary search term', () => {
    expect(redactSearchTerm('quiz')).toBe('quiz');
    expect(redactSearchTerm('memory cards for her')).toBe('memory cards for her');
  });

  it('caps a search term at 64 characters', () => {
    // Words, not one long token-shaped run — a run of 24+ word
    // characters is redacted as a token instead (see below).
    expect(redactSearchTerm('word '.repeat(40)).length).toBe(64);
  });

  it('redacts a long run of characters as a token', () => {
    expect(redactSearchTerm('a'.repeat(200))).toBe('[redacted-token]');
  });
});

describe('the client / server split (OOP-6716)', () => {
  it('does not let the browser report a server-only event', () => {
    // `purchase` is recorded by the Stripe webhook. If the browser could
    // post it, the funnel could be faked from a console.
    expect(isClientEvent('purchase')).toBe(false);
    expect(isClientEvent('checkout_start')).toBe(false);
    expect(isClientEvent('waitlist_signup')).toBe(false);
    expect(isClientEvent('gift_opened')).toBe(false);
  });

  it('lets the browser report the page views and the clicks', () => {
    expect(isClientEvent('landing_view')).toBe(true);
    expect(isClientEvent('browse_view')).toBe(true);
    expect(isClientEvent('listing_view')).toBe(true);
    expect(isClientEvent('cta_click')).toBe(true);
    expect(isClientEvent('listing_cta_click')).toBe(true);
    expect(isClientEvent('filter_used')).toBe(true);
    expect(isClientEvent('search')).toBe(true);
  });

  it('keeps the client events a strict subset of the vocabulary', () => {
    for (const event of CLIENT_EVENTS) {
      expect(ANALYTICS_EVENTS).toContain(event);
    }
  });
});

describe('the funnel (OOP-6716)', () => {
  it('is the five steps the business cares about, in order', () => {
    expect(FUNNEL_STEPS).toEqual([
      'landing_view',
      'browse_view',
      'listing_view',
      'checkout_start',
      'purchase',
    ]);
  });

  it('reports the drop between consecutive steps', () => {
    const funnel = buildFunnel([
      { step: 'landing_view', counts: { events: 10, sessions: 10 } },
      { step: 'browse_view', counts: { events: 8, sessions: 6 } },
      { step: 'listing_view', counts: { events: 4, sessions: 3 } },
      { step: 'checkout_start', counts: { events: 2, sessions: 2 } },
      { step: 'purchase', counts: { events: 1, sessions: 1 } },
    ]);

    expect(funnel[0]).toMatchObject({ step: 'landing_view', stepRate: null, overallRate: 1 });
    expect(funnel[1]).toMatchObject({ step: 'browse_view', stepRate: 0.6, overallRate: 0.6 });
    expect(funnel[2]).toMatchObject({ step: 'listing_view', stepRate: 0.5, overallRate: 0.3 });
    expect(funnel[3]).toMatchObject({ step: 'checkout_start', stepRate: 2 / 3, overallRate: 0.2 });
    expect(funnel[4]).toMatchObject({ step: 'purchase', stepRate: 0.5, overallRate: 0.1 });
  });

  it('does not divide by zero when a step has no sessions', () => {
    const funnel = buildFunnel([
      { step: 'landing_view', counts: { events: 0, sessions: 0 } },
      { step: 'browse_view', counts: { events: 0, sessions: 0 } },
    ]);

    expect(funnel[0].overallRate).toBe(0);
    expect(funnel[1].stepRate).toBe(0);
    expect(Number.isFinite(funnel[1].overallRate)).toBe(true);
  });
});

describe('the session counts (OOP-6716)', () => {
  it('counts a repeat visit by the same person once', () => {
    const agg = aggregateEvents([
      { date: '2026-10-29', sessionId: 'a' },
      { date: '2026-10-29', sessionId: 'a' },
      { date: '2026-10-29', sessionId: 'a' },
      { date: '2026-10-29', sessionId: 'b' },
    ]);

    expect(agg.total.events).toBe(4);
    expect(agg.total.sessions).toBe(2);
  });

  it('breaks the counts down by day', () => {
    const agg = aggregateEvents([
      { date: '2026-10-28', sessionId: 'a' },
      { date: '2026-10-29', sessionId: 'a' },
      { date: '2026-10-29', sessionId: 'b' },
    ]);

    expect(agg.byDate.get('2026-10-28')).toEqual({ events: 1, sessions: 1 });
    expect(agg.byDate.get('2026-10-29')).toEqual({ events: 2, sessions: 2 });
  });
});

describe('the storage layout (OOP-6716)', () => {
  it('round-trips an object name', () => {
    const path = eventObjectPath(
      'listing_view',
      '2026-10-29',
      '11111111-2222-4333-8444-555555555555',
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    );

    expect(path).toBe(
      'events/listing_view/2026-10-29__11111111-2222-4333-8444-555555555555__aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.json',
    );

    const parsed = parseEventObjectPath(path.split('/').slice(1).join('/'));
    expect(parsed).toEqual({
      date: '2026-10-29',
      sessionId: '11111111-2222-4333-8444-555555555555',
      eventId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    });
  });

  it('rejects a name that is not one of ours', () => {
    expect(parseEventObjectPath('something-else.json')).toBeNull();
    expect(parseEventObjectPath('2026-10-29__abc.json')).toBeNull();
    expect(parseEventObjectPath('not-a-date__abc__def.json')).toBeNull();
  });
});
