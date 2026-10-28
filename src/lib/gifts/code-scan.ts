/**
 * Static safety scanner for user-authored gift code (OOP-5688).
 *
 * The scanner answers a product question — "is this gift something we are
 * willing to host and sell on Lovorithm?" — not a security question. The
 * security boundary is the sandbox the gift renders in (see
 * `code-render.ts`: a `sandbox="allow-scripts"` iframe with an opaque
 * origin and a `connect-src 'none'` CSP). The scanner is the editorial
 * gate that sits in front of it: code that tries to read host state, climb
 * out of the frame, or phone home is refused outright, and code that is
 * merely suspicious is flagged for the sender to look at.
 *
 * Rules are regex/line based, so they are trivially bypassable by a
 * determined author. That is fine and intended — do not treat a `safe`
 * verdict as a proof of safety. The sandbox is what keeps a malicious gift
 * from touching Lovorithm; the scanner is what keeps an obviously
 * unsellable gift off the marketplace.
 *
 * Pure and dependency-free so it can run in three places: the browser
 * (live feedback while the sender types), the server action (the
 * authoritative gate before a gift is stored), and the recipient view.
 */

export type CodeScanSeverity = 'info' | 'warn' | 'block';
export type CodeScanVerdict = 'safe' | 'needs_review' | 'blocked';
export type CodeScanField = 'html' | 'css' | 'js';

export type CodeFinding = {
  /** Stable rule id — also the i18n message key (`Builder.code.scan.<code>`). */
  code: string;
  severity: CodeScanSeverity;
  field: CodeScanField;
  /** 1-based line within the field. */
  line: number;
  /** Trimmed source line, truncated for display. */
  excerpt: string;
};

export type CodeScanResult = {
  verdict: CodeScanVerdict;
  findings: CodeFinding[];
  blocked: number;
  warnings: number;
};

export type CodeScanInput = {
  html: string;
  css: string;
  js: string;
};

/** A rule that matches anywhere in the field. */
type PatternRule = {
  code: string;
  severity: CodeScanSeverity;
  field: CodeScanField;
  pattern: RegExp;
  /** Only report the first match per line (default: report every match). */
  oncePerLine?: boolean;
};

/** A rule that is evaluated line by line. */
type LineRule = {
  code: string;
  severity: CodeScanSeverity;
  field: CodeScanField;
  test: (line: string) => boolean;
};

const MAX_EXCERPT = 160;

/** Anything at or above this length looks like minified / obfuscated source. */
const MINIFIED_LINE_LENGTH = 2000;

// ─── JavaScript ───────────────────────────────────────────────────────────
//
// The sandbox already neutralises the technical impact of these (opaque
// origin, no cookies, `connect-src 'none'`). They are blocked because they
// signal intent, not because they would succeed.

const JS_PATTERN_RULES: PatternRule[] = [
  {
    code: 'host-state-access',
    severity: 'block',
    field: 'js',
    pattern:
      /\b(?:document\s*\.\s*cookie|localStorage|sessionStorage|indexedDB|caches)\b/gi,
  },
  {
    code: 'sandbox-escape',
    severity: 'block',
    field: 'js',
    pattern:
      /\b(?:window\s*\.\s*(?:parent|top|opener)|(?:parent|top)\s*\.\s*document)\b/gi,
  },
  {
    code: 'outbound-beacon',
    severity: 'block',
    field: 'js',
    pattern: /navigator\s*\.\s*sendBeacon/gi,
  },
  {
    code: 'outbound-socket',
    severity: 'block',
    field: 'js',
    pattern: /new\s+(?:WebSocket|EventSource)\s*\(/gi,
  },
  {
    code: 'crypto-miner',
    severity: 'block',
    field: 'js',
    pattern: /\b(?:cryptonight|coinhive|cryptoloot|minero|stratum\+tcp)\b/gi,
  },
  {
    code: 'dynamic-eval',
    severity: 'warn',
    field: 'js',
    pattern: /\b(?:eval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*['"`])/g,
  },
  {
    code: 'obfuscation',
    severity: 'warn',
    field: 'js',
    pattern: /\b(?:atob\s*\(|btoa\s*\(|unescape\s*\(|decodeURIComponent\s*\(|String\s*\.\s*fromCharCode)/g,
  },
  {
    code: 'popup',
    severity: 'warn',
    field: 'js',
    pattern: /\bwindow\s*\.\s*open\s*\(/g,
  },
  {
    code: 'document-write',
    severity: 'warn',
    field: 'js',
    pattern: /\bdocument\s*\.\s*write(?:ln)?\s*\(/g,
  },
  {
    code: 'keystroke-capture',
    severity: 'warn',
    field: 'js',
    pattern:
      /addEventListener\s*\(\s*['"`](?:keypress|keydown|keyup)['"`]/gi,
  },
];

const JS_LINE_RULES: LineRule[] = [
  {
    code: 'outbound-request',
    severity: 'block',
    field: 'js',
    test: (line) =>
      /\b(?:fetch|XMLHttpRequest)\b/.test(line) && /(?:https?:)?\/\//.test(line),
  },
  {
    code: 'outbound-url',
    severity: 'warn',
    field: 'js',
    test: (line) =>
      !/\b(?:fetch|XMLHttpRequest)\b/.test(line) && /['"`]\s*(?:https?:)?\/\//.test(line),
  },
  {
    code: 'minified-line',
    severity: 'warn',
    field: 'js',
    test: (line) => line.length >= MINIFIED_LINE_LENGTH,
  },
];

// ─── HTML ─────────────────────────────────────────────────────────────────

const HTML_PATTERN_RULES: PatternRule[] = [
  {
    code: 'external-script',
    severity: 'warn',
    field: 'html',
    pattern: /<script\b[^>]*\bsrc\s*=\s*['"](?:https?:)?\/\//gi,
  },
  {
    code: 'external-stylesheet',
    severity: 'warn',
    field: 'html',
    pattern: /<link\b[^>]*\bhref\s*=\s*['"](?:https?:)?\/\//gi,
  },
  {
    code: 'nested-iframe',
    severity: 'warn',
    field: 'html',
    pattern: /<iframe\b/gi,
  },
  {
    code: 'embed',
    severity: 'warn',
    field: 'html',
    pattern: /<(?:object|embed|applet)\b/gi,
  },
  {
    code: 'form',
    severity: 'warn',
    field: 'html',
    pattern: /<form\b/gi,
  },
  {
    code: 'base-tag',
    severity: 'warn',
    field: 'html',
    pattern: /<base\b/gi,
  },
  {
    code: 'meta-refresh',
    severity: 'warn',
    field: 'html',
    pattern: /<meta\b[^>]*http-equiv\s*=\s*['"]?refresh/gi,
  },
  {
    code: 'inline-handler',
    severity: 'warn',
    field: 'html',
    pattern: /\son[a-z]+\s*=\s*['"]/gi,
  },
];

const HTML_LINE_RULES: LineRule[] = [
  {
    code: 'external-image',
    severity: 'warn',
    field: 'html',
    test: (line) =>
      /<(?:img|source|video|audio)\b[^>]*\bsrc\s*=\s*['"](?:https?:)?\/\//i.test(
        line,
      ),
  },
];

// ─── CSS ──────────────────────────────────────────────────────────────────

const CSS_PATTERN_RULES: PatternRule[] = [
  {
    code: 'css-import',
    severity: 'warn',
    field: 'css',
    pattern: /@import\b/gi,
  },
];

const CSS_LINE_RULES: LineRule[] = [
  {
    code: 'css-external-url',
    severity: 'warn',
    field: 'css',
    test: (line) => /url\(\s*['"]?(?:https?:)?\/\//i.test(line),
  },
];

// ─── Scanner ──────────────────────────────────────────────────────────────

function excerptOf(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > MAX_EXCERPT
    ? `${trimmed.slice(0, MAX_EXCERPT)}…`
    : trimmed;
}

function scanPatternRules(
  field: CodeScanField,
  text: string,
  rules: PatternRule[],
): CodeFinding[] {
  const findings: CodeFinding[] = [];
  if (!text) return findings;

  const lines = text.split('\n');

  for (const rule of rules) {
    const flags = rule.pattern.flags.includes('g')
      ? rule.pattern.flags
      : `${rule.pattern.flags}g`;
    const re = new RegExp(rule.pattern.source, flags);
    const hitLines = new Set<number>();

    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const line = text.slice(0, match.index).split('\n').length;
      if (rule.oncePerLine && hitLines.has(line)) continue;
      hitLines.add(line);
      findings.push({
        code: rule.code,
        severity: rule.severity,
        field,
        line,
        excerpt: excerptOf(lines[line - 1] ?? ''),
      });
      if (match.index === re.lastIndex) re.lastIndex++;
    }
  }

  return findings;
}

function scanLineRules(
  field: CodeScanField,
  text: string,
  rules: LineRule[],
): CodeFinding[] {
  const findings: CodeFinding[] = [];
  if (!text) return findings;

  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const rule of rules) {
      if (!rule.test(line)) continue;
      findings.push({
        code: rule.code,
        severity: rule.severity,
        field,
        line: index + 1,
        excerpt: excerptOf(line),
      });
    }
  });

  return findings;
}

/**
 * Scan a code gift. Pure and deterministic — the same input always yields
 * the same findings, which is what lets the browser preview and the server
 * gate agree.
 */
export function scanCodeGift(input: CodeScanInput): CodeScanResult {
  const findings: CodeFinding[] = [
    ...scanPatternRules('js', input.js, JS_PATTERN_RULES),
    ...scanLineRules('js', input.js, JS_LINE_RULES),
    ...scanPatternRules('html', input.html, HTML_PATTERN_RULES),
    ...scanLineRules('html', input.html, HTML_LINE_RULES),
    ...scanPatternRules('css', input.css, CSS_PATTERN_RULES),
    ...scanLineRules('css', input.css, CSS_LINE_RULES),
  ];

  // Same rule on the same line is one finding, not two.
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const key = `${f.code}:${f.field}:${f.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  unique.sort((a, b) => {
    if (a.severity !== b.severity) {
      const rank: Record<CodeScanSeverity, number> = {
        block: 0,
        warn: 1,
        info: 2,
      };
      return rank[a.severity] - rank[b.severity];
    }
    if (a.field !== b.field) return a.field.localeCompare(b.field);
    return a.line - b.line;
  });

  const blocked = unique.filter((f) => f.severity === 'block').length;
  const warnings = unique.filter((f) => f.severity === 'warn').length;

  const verdict: CodeScanVerdict =
    blocked > 0 ? 'blocked' : warnings > 0 ? 'needs_review' : 'safe';

  return { verdict, findings: unique, blocked, warnings };
}

/**
 * True when the gift may be stored. `needs_review` is allowed through: the
 * sender sees the warnings and takes responsibility, which is the whole
 * point of surfacing them in the builder.
 */
export function isCodeGiftStorable(result: CodeScanResult): boolean {
  return result.verdict !== 'blocked';
}
