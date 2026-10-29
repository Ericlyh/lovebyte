import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reviewCodeGift } from './code-ai';

/**
 * Tests for the AI review's output budget (OOP-6740).
 *
 * The provider reasons before it writes the tool call, and that reasoning
 * is billed against `max_tokens`, so a gift with real code in it used to
 * come back truncated with nothing to show — the sender got an error
 * instead of a review. The fake provider here stands in for the real
 * one so the edges can be exercised without spending anything:
 *
 *   - the request asks for a shallow answer and keeps the cap;
 *   - a turn that ran out of room is asked again in a smaller shape;
 *   - a turn that ran out of room but still carries a review is used;
 *   - a provider that does not know `output_config` is asked again
 *     without it.
 */

type FakeReply =
  | { kind: 'message'; stop_reason: string; content: unknown[] }
  | { kind: 'bad-request' };

const state = vi.hoisted(() => ({
  replies: [] as unknown[],
  calls: [] as {
    effort: string | undefined;
    maxTokens: number | undefined;
    content: string;
  }[],
}));

vi.mock('@anthropic-ai/sdk', () => {
  class BadRequestError extends Error {}
  class FakeAnthropic {
    static BadRequestError = BadRequestError;
    messages = {
      create: async (params: {
        max_tokens: number;
        output_config?: { effort?: string };
        messages: { role: string; content: string }[];
      }) => {
        state.calls.push({
          effort: params.output_config?.effort,
          maxTokens: params.max_tokens,
          content: params.messages[0].content,
        });
        const reply = state.replies.shift() as FakeReply | undefined;
        if (!reply) throw new Error('the fake provider ran out of replies');
        if (reply.kind === 'bad-request') {
          throw new BadRequestError('unsupported parameter');
        }
        return reply;
      },
    };
  }
  return { default: FakeAnthropic, BadRequestError };
});

const REVIEW_INPUT = {
  summary: 'The gift renders, but the photo never loads.',
  questions: ['Which photo should the gift show?'],
  suggestions: [
    {
      title: 'Give the image alt text',
      detail: 'A broken image with no alt text leaves the recipient with nothing.',
      field: 'html',
      original: '<img src="https://example.com/photo.jpg">',
      replacement: '<img src="https://example.com/photo.jpg" alt="Us">',
    },
  ],
};

function reviewReply(overrides: Partial<FakeReply & { kind: 'message' }> = {}) {
  return {
    kind: 'message' as const,
    stop_reason: 'tool_use',
    content: [
      { type: 'tool_use', id: 'toolu_1', name: 'submit_review', input: REVIEW_INPUT },
    ],
    ...overrides,
  };
}

/** A turn that ran out of room before the tool call was written. */
function truncatedReply() {
  return {
    kind: 'message' as const,
    stop_reason: 'max_tokens',
    content: [{ type: 'thinking', thinking: 'Let me look at this…', signature: 'sig' }],
  };
}

const gift = {
  html: '<h1>Happy birthday</h1><img src="https://example.com/photo.jpg">',
  css: 'h1 { color: red; }',
  js: 'document.getElementById("go").onclick = () => {};',
};

const originalKey = process.env.LOVEBYTE_AI_API_KEY;

beforeEach(() => {
  state.replies = [];
  state.calls = [];
  process.env.LOVEBYTE_AI_API_KEY = 'test-key';
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.LOVEBYTE_AI_API_KEY;
  else process.env.LOVEBYTE_AI_API_KEY = originalKey;
});

describe('reviewCodeGift', () => {
  it('reads the review out of the tool call', async () => {
    state.replies.push(reviewReply());

    const result = await reviewCodeGift(gift);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.review.summary).toBe(REVIEW_INPUT.summary);
    expect(result.review.questions).toEqual(REVIEW_INPUT.questions);
    expect(result.review.suggestions).toHaveLength(1);
    expect(result.review.suggestions[0]).toMatchObject({
      id: 's1',
      title: 'Give the image alt text',
      field: 'html',
      original: '<img src="https://example.com/photo.jpg">',
    });
  });

  it('asks for a shallow answer and keeps the spend ceiling', async () => {
    state.replies.push(reviewReply());

    await reviewCodeGift(gift);

    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].effort).toBe('low');
    expect(state.calls[0].maxTokens).toBe(8000);
  });

  it('asks again in a smaller shape when a turn runs out of room', async () => {
    state.replies.push(truncatedReply(), reviewReply());

    const result = await reviewCodeGift(gift);

    expect(result.ok).toBe(true);
    expect(state.calls).toHaveLength(2);
    // The second attempt says what to leave out.
    expect(state.calls[1].content).toContain('at most two suggestions');
  });

  it('uses a review that a truncated turn still carries', async () => {
    state.replies.push(reviewReply({ stop_reason: 'max_tokens' }));

    const result = await reviewCodeGift(gift);

    expect(result.ok).toBe(true);
    // A review is a review — there is nothing to retry.
    expect(state.calls).toHaveLength(1);
  });

  it('gives up with a message when two turns run out of room', async () => {
    state.replies.push(truncatedReply(), truncatedReply());

    const result = await reviewCodeGift(gift);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/ran out of room/i);
  });

  it('asks again without the effort knob when the provider rejects it', async () => {
    state.replies.push({ kind: 'bad-request' }, reviewReply());

    const result = await reviewCodeGift(gift);

    expect(result.ok).toBe(true);
    expect(state.calls).toHaveLength(2);
    expect(state.calls[0].effort).toBe('low');
    expect(state.calls[1].effort).toBeUndefined();
  });

  it('reports a review that came back in the wrong shape', async () => {
    state.replies.push(reviewReply({ content: [{ type: 'tool_use', id: 't', name: 'submit_review', input: { summary: 7 } }] }));

    const result = await reviewCodeGift(gift);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/unexpected shape/i);
  });

  it('reports a refusal as a refusal', async () => {
    state.replies.push({ kind: 'message', stop_reason: 'refusal', content: [] });

    const result = await reviewCodeGift(gift);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/declined/i);
  });

  it('reports an unconfigured deployment', async () => {
    delete process.env.LOVEBYTE_AI_API_KEY;

    const result = await reviewCodeGift(gift);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not configured/i);
    expect(state.calls).toHaveLength(0);
  });
});
