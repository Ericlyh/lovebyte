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
 * That is also why no provider-specific parameters (thinking, effort) are
 * sent — the provider's own defaults apply.
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

const suggestionSchema = z.object({
  title: z.string().min(1).max(120),
  detail: z.string().max(600),
  field: z.enum(['html', 'css', 'js']),
  original: z.string().min(1).max(400),
  replacement: z.string().max(400),
});

const reviewSchema = z.object({
  summary: z.string().max(1000),
  questions: z.array(z.string().max(300)).max(10),
  suggestions: z.array(suggestionSchema).max(12),
});

const REVIEW_TOOL: Anthropic.Tool = {
  name: 'submit_review',
  description:
    'Submit the review of the gift code. Call this exactly once, with every finding.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          'One or two sentences on the state of the gift: does it work as written, and what is the single most important thing to fix?',
      },
      questions: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Things only the sender can answer — a missing name, date, photo, or a choice the code leaves as a placeholder. Empty if the gift is self-contained.',
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

If the gift is fine as written, return an empty suggestions array and say so in the summary. Do not invent problems.`;

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

  const userContent = [
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

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: config.model,
      // Generous: the provider's default reasoning runs before the tool
      // call and is billed against max_tokens, so a tight cap truncates
      // the review before it starts.
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      tools: [REVIEW_TOOL],
      tool_choice: { type: 'tool', name: REVIEW_TOOL.name },
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (err) {
    console.error('[code-ai] review request failed', err);
    return {
      ok: false,
      error: 'The AI review could not be reached. Try again in a moment.',
    };
  }

  if (message.stop_reason === 'refusal') {
    return {
      ok: false,
      error: 'The AI review declined to look at this gift.',
    };
  }

  if (message.stop_reason === 'max_tokens') {
    return {
      ok: false,
      error: 'The AI review ran out of room before it finished. Try again.',
    };
  }

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  );
  if (!toolUse) {
    return {
      ok: false,
      error: 'The AI review did not return a result. Try again.',
    };
  }

  const parsed = reviewSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    console.error('[code-ai] malformed review payload', parsed.error.issues);
    return {
      ok: false,
      error: 'The AI review came back in an unexpected shape. Try again.',
    };
  }

  return {
    ok: true,
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
