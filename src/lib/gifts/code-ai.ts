import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

/**
 * AI review for `code` gifts (OOP-5688).
 *
 * The deterministic scanner (`code-scan.ts`) catches the things a regex can
 * catch. This module is for the things it cannot: a gift that references a
 * photo the sender never attached, a script that throws on load, a
 * placeholder like `{{name}}` that needs the sender's answer before the
 * gift can be finished.
 *
 * The model is asked for structured output through a single tool call
 * (`submit_review`), so the reply is machine-readable without regex
 * scraping. The tool's input schema is validated with Zod before it
 * reaches the builder.
 *
 * Configuration (all optional — without a key the feature reports itself
 * as unavailable and the deterministic scanner stands alone):
 *
 *   LOVEBYTE_AI_API_KEY    the API key
 *   LOVEBYTE_AI_BASE_URL   the endpoint (defaults to api.anthropic.com)
 *   LOVEBYTE_AI_MODEL      the model id (defaults to claude-opus-5)
 *
 * The endpoint is provider-agnostic on purpose: the same adapter works
 * against Anthropic's own API and against any Anthropic-compatible gateway.
 */

/**
 * The whole turn has to fit in `max_tokens`, and the provider spends most
 * of that budget reasoning before it writes the tool call (OOP-6740).
 * Asked to review a gift it will happily walk the source line by line and
 * spend thousands of tokens doing it, so on a gift with real code in it
 * there was no room left for the review itself: the call came back
 * `max_tokens` with no tool call in it, and the sender got an error
 * instead of a review. The file upload (OOP-5688) made a big gift easy to
 * write, so it got easier to hit.
 *
 * Three things keep the review inside the cap:
 *
 *   - `output_config.effort` asks the provider for a shallower answer. The
 *     findings come out the same; the wandering does not. On the largest
 *     gift the builder allows — 100KB of HTML, 50KB of CSS, 50KB of JS —
 *     the old cap left no room for the review at all; this way the same
 *     gift comes back in about 1100 tokens.
 *   - the review's own shape is bounded — six suggestions, short fields —
 *     so the tool call is small however big the gift is.
 *   - a turn that still runs out of room is read as far as it got, and
 *     asked for again in a shorter form, rather than thrown away.
 *
 * `max_tokens` stays where it was. It is the deployment's spend ceiling,
 * and the point of the above is to fit the review inside it rather than to
 * buy more room.
 */

export type CodeAiField = 'html' | 'css' | 'js';

export type CodeAiSuggestion = {
  id: string;
  title: string;
  detail: string;
  field: CodeAiField;
  /** Exact snippet to replace — must appear verbatim in the field. */
  original: string;
  /** The snippet that replaces `original`. */
  replacement: string;
};

export type CodeAiReview = {
  summary: string;
  /** Things only the sender can answer (missing names, dates, choices). */
  questions: string[];
  suggestions: CodeAiSuggestion[];
};

export type CodeAiReviewResult =
  | { ok: true; review: CodeAiReview }
  | { ok: false; error: string };

/**
 * The shape of a review, and the shape the model is asked for. The
 * limits are the other half of the output budget: the tool call has to
 * be small as well as the reasoning that precedes it, or a big gift
 * still runs out of room. The descriptions carry the limits too — the
 * model reads those, not this file.
 */
const suggestionSchema = z.object({
  title: z.string().min(1).max(120),
  detail: z.string().max(300),
  field: z.enum(['html', 'css', 'js']),
  original: z.string().min(1).max(240),
  replacement: z.string().max(240),
});

const reviewSchema = z.object({
  summary: z.string().max(600),
  questions: z.array(z.string().max(240)).max(6),
  suggestions: z.array(suggestionSchema).max(6),
});

const REVIEW_TOOL: Anthropic.Tool = {
  name: 'submit_review',
  description:
    'Submit the review of the gift code. Call this exactly once, with every finding. Keep it short — at most six suggestions, one short line each.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          'One or two sentences on the state of the gift: does it work as written, and what is the single most important thing to fix? Under 300 characters.',
      },
      questions: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Things only the sender can answer — a missing name, date, photo, or a choice the code leaves as a placeholder. At most six, each one short line. Empty if the gift is self-contained.',
      },
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Short label for the change, e.g. "Fix the click handler".',
            },
            detail: {
              type: 'string',
              description: 'Why this change helps, in one or two sentences.',
            },
            field: {
              type: 'string',
              enum: ['html', 'css', 'js'],
              description: 'Which of the three fields the change applies to.',
            },
            original: {
              type: 'string',
              description:
                'The exact text to replace, copied character-for-character from the source you were given. Keep it to one short line so it matches exactly.',
            },
            replacement: {
              type: 'string',
              description: 'The text that replaces `original`.',
            },
          },
          required: ['title', 'detail', 'field', 'original', 'replacement'],
          additionalProperties: false,
        },
      },
    },
    required: ['summary', 'questions', 'suggestions'],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `You review small web pages that people send to each other as gifts on Lovorithm.

The gift you are given has three parts: an HTML body, one stylesheet, and one script. It will run inside a sandboxed iframe on the recipient's phone or laptop, and the recipient opens it expecting something warm and personal.

What the sandbox does and does not allow:
- Scripts run. Inline scripts and CDN scripts (https) work.
- The frame has an opaque origin: no cookies, no localStorage, no access to the Lovorithm page.
- No network requests: fetch, XMLHttpRequest, WebSocket and sendBeacon are all blocked and will throw.
- No nested frames, no form submission, no <base> tags.
- Images, audio and video may be loaded over https.

Review the gift for three kinds of problem:
1. It will not work in the sandbox — a network call, a storage read, a relative path that will 404, a syntax error.
2. It is broken or unfinished — a typo, a selector that matches nothing, a variable that is never defined, a placeholder like {{name}} that was never filled in.
3. It is missing something only the sender can supply — a name, a date, a photo URL, a choice between two options. Put those in \`questions\`, not in \`suggestions\`.

For each fix, propose the smallest change that makes it work. Copy \`original\` character-for-character from the source you were given — the builder applies your edit only if it finds that exact text, so an inexact copy is silently dropped. Keep \`original\` to one short line. Never propose a change that rewrites the whole file.

If the gift is fine as written, return an empty suggestions array and say so in the summary. Do not invent problems.

Report at most six fixes, ordered by how much they matter. Keep each \`detail\` to a sentence and each \`original\`/\`replacement\` to one short line.

Spend your reasoning on finding the problems, not on describing the source: do not walk the code through line by line, and do not count it.`;

export type CodeAiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export function getCodeAiConfig(): CodeAiConfig | null {
  const apiKey = process.env.LOVEBYTE_AI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: process.env.LOVEBYTE_AI_BASE_URL?.trim() || 'https://api.anthropic.com',
    model: process.env.LOVEBYTE_AI_MODEL?.trim() || 'claude-opus-5',
  };
}

/**
 * The deployment's spend ceiling for one review. It is deliberately not
 * raised (OOP-6740) — the review is made to fit inside it instead.
 */
const MAX_TOKENS = 8000;

/**
 * How hard the provider should think about the gift. The default is
 * deeper than this task needs: left alone the model spends thousands of
 * tokens describing the source instead of reporting what is wrong with
 * it, and the review does not fit in `MAX_TOKENS`. At `low` the same
 * findings come back in a fraction of the room.
 */
const EFFORT = 'low' as const;

/**
 * What to say when the first turn did not fit. The model has already
 * been asked for a bounded review; this asks for a much smaller one —
 * the two findings that matter most, and nothing else.
 */
const BRIEF_INSTRUCTION = `

Your previous answer was too long to fit. This time, be much shorter:
- at most two suggestions;
- \`original\` and \`replacement\` on one short line each;
- \`detail\` in one short sentence;
- \`summary\` under 200 characters;
- at most two questions.`;

function buildUserContent(
  source: { html: string; css: string; js: string },
  answers?: string,
): string {
  return [
    'HTML:',
    '```html',
    source.html,
    '```',
    '',
    'CSS:',
    '```css',
    source.css,
    '```',
    '',
    'JS:',
    '```js',
    source.js,
    '```',
    ...(answers
      ? [
          '',
          'The sender answered your questions — use their answers to finish the gift:',
          '```',
          answers,
          '```',
        ]
      : []),
  ].join('\n');
}

/** The review in the reply, if the reply carries one. */
type ReviewInReply =
  | { kind: 'review'; review: CodeAiReview }
  | { kind: 'no-tool-call' }
  | { kind: 'bad-payload' };

function readReview(message: Anthropic.Message): ReviewInReply {
  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  );
  if (!toolUse) return { kind: 'no-tool-call' };

  const parsed = reviewSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    console.error('[code-ai] malformed review payload', parsed.error.issues);
    return { kind: 'bad-payload' };
  }

  return {
    kind: 'review',
    review: {
      summary: parsed.data.summary,
      questions: parsed.data.questions,
      suggestions: parsed.data.suggestions.map((s, index) => ({
        id: `s${index + 1}`,
        title: s.title,
        detail: s.detail,
        field: s.field,
        original: s.original,
        replacement: s.replacement,
      })),
    },
  };
}

async function ask(
  client: Anthropic,
  config: CodeAiConfig,
  userContent: string,
  withEffort: boolean,
): Promise<Anthropic.Message> {
  return client.messages.create({
    model: config.model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [REVIEW_TOOL],
    tool_choice: { type: 'tool', name: REVIEW_TOOL.name },
    messages: [{ role: 'user', content: userContent }],
    ...(withEffort ? { output_config: { effort: EFFORT } } : {}),
  });
}

/** What one turn of the model came back with. */
type Turn =
  | { kind: 'review'; review: CodeAiReview }
  /** The turn ran out of room, so there is no review to read. */
  | { kind: 'truncated' }
  | { kind: 'failed'; error: string };

async function runTurn(
  client: Anthropic,
  config: CodeAiConfig,
  userContent: string,
): Promise<Turn> {
  let message: Anthropic.Message;
  try {
    message = await ask(client, config, userContent, true);
  } catch (err) {
    if (!(err instanceof Anthropic.BadRequestError)) {
      console.error('[code-ai] review request failed', err);
      return {
        kind: 'failed',
        error: 'The AI review could not be reached. Try again in a moment.',
      };
    }
    // `output_config.effort` needs a model that supports it (Claude 4.6
    // and newer). An older model or a different gateway rejects the
    // request outright. Without the knob the provider simply reasons
    // deeper, so ask again without it rather than give up.
    try {
      message = await ask(client, config, userContent, false);
    } catch (retryErr) {
      console.error('[code-ai] review request failed', retryErr);
      return {
        kind: 'failed',
        error: 'The AI review could not be reached. Try again in a moment.',
      };
    }
  }

  if (message.stop_reason === 'refusal') {
    return { kind: 'failed', error: 'The AI review declined to look at this gift.' };
  }

  // A turn that ran out of room can still carry a review, if the
  // provider got as far as writing the tool call before it stopped.
  // Read it before deciding the turn was wasted.
  const found = readReview(message);
  if (found.kind === 'review') return found;

  if (message.stop_reason === 'max_tokens') return { kind: 'truncated' };

  return {
    kind: 'failed',
    error:
      found.kind === 'bad-payload'
        ? 'The AI review came back in an unexpected shape. Try again.'
        : 'The AI review did not return a result. Try again.',
  };
}

/**
 * Ask the model to review the gift. Returns a discriminated result rather
 * than throwing, so the server action can turn every failure into a
 * message the sender can act on.
 */
export async function reviewCodeGift(
  source: { html: string; css: string; js: string },
  answers?: string,
): Promise<CodeAiReviewResult> {
  const config = getCodeAiConfig();
  if (!config) {
    return { ok: false, error: 'AI review is not configured on this deployment.' };
  }

  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl });
  const userContent = buildUserContent(source, answers);

  const first = await runTurn(client, config, userContent);
  if (first.kind === 'review') return { ok: true, review: first.review };
  if (first.kind === 'failed') return { ok: false, error: first.error };

  // The turn ran out of room and there is no review to read, so ask for
  // one that fits: the same review, in a much smaller shape.
  const brief = await runTurn(
    client,
    config,
    `${userContent}${BRIEF_INSTRUCTION}`,
  );
  if (brief.kind === 'review') return { ok: true, review: brief.review };
  if (brief.kind === 'failed') return { ok: false, error: brief.error };

  return {
    ok: false,
    error: 'The AI review ran out of room before it finished. Try again.',
  };
}
