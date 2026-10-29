#!/usr/bin/env node
/**
 * Assert that every `className` token in the TSX has a CSS rule.
 *
 * This is the guard for the whole family of bugs where a class is spelled
 * correctly, is applied N times, and quietly does nothing — e.g.
 * `lb-btn--block`, applied to the checkout Pay button and every auth
 * form, which had no rule at all (OOP-6734). A missing rule is invisible
 * to a page load, to Lighthouse and to axe; only a static check sees it.
 *
 * How it works:
 *   1. Every `src/**\/*.tsx` file is parsed with the TypeScript compiler
 *      API. `className` attributes are resolved through conditionals,
 *      `+=` reassignment, local variables and template literals.
 *   2. Template-literal class fragments are resolved with the type
 *      checker: `lb-memory-card--${cardState}` becomes the three literal
 *      members of the `FlippedState` union. No hand-maintained list.
 *   3. Every CSS file under `src/` is parsed and its selectors are
 *      harvested into the set of classes that actually exist.
 *   4. Whatever is left is either a Tailwind utility (asked of Tailwind
 *      itself, so the answer is exact) or an orphan.
 *
 * Run it directly (`node scripts/check-css-classes.mjs`) for a report, or
 * let `src/styles/css-classes.test.ts` assert on the result.
 */
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

// ── Dynamic class variants the type checker cannot narrow ─────────────
//
// A template fragment whose type is a plain `string`/`number` carries no
// literal members, so the checker cannot enumerate it. The reachable
// variants are declared here instead. A prefix that is neither
// type-resolvable nor listed here is reported as unresolved and fails the
// check — a human has to say what it can be.
export const DYNAMIC_VARIANT_FALLBACK = {
  // `template` is a free-form string on the wire. The builder offers
  // exactly these three (MultimediaCollageBuilderForm.tsx).
  'lb-multimedia__canvas--': ['polaroid-wall', 'timeline', 'magazine'],
};

// ── CSS ───────────────────────────────────────────────────────────────

/** Remove `/* … *\/` comments so a commented-out rule is not counted. */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Pull every selector out of a stylesheet.
 *
 * The parser tracks brace depth: a prelude that starts with `@` is an
 * at-rule, so its contents are parsed as rules in their own right (that
 * is how `@media` blocks are reached). A prelude that does not start with
 * `@` is a selector.
 */
export function parseCssSelectors(css) {
  const src = stripCssComments(css);
  const selectors = [];
  let buf = '';
  let i = 0;

  while (i < src.length) {
    const ch = src[i];
    if (ch !== '{') {
      buf += ch;
      i += 1;
      continue;
    }

    const prelude = buf.trim();
    buf = '';
    const isAtRule = prelude.startsWith('@');

    // Find the matching close brace, keeping the inner text.
    let depth = 1;
    let inner = '';
    let j = i + 1;
    while (j < src.length && depth > 0) {
      const c = src[j];
      if (c === '{') {
        depth += 1;
        inner += c;
      } else if (c === '}') {
        depth -= 1;
        if (depth > 0) inner += c;
      } else {
        inner += c;
      }
      j += 1;
    }

    if (!isAtRule) selectors.push(prelude);
    else selectors.push(...parseCssSelectors(inner));

    i = j;
  }

  return selectors;
}

/** Harvest the class names a selector mentions. */
export function classNamesInSelector(selector) {
  const names = new Set();
  const re = /\.(-?[_a-zA-Z][\w-]*)/g;
  let m;
  while ((m = re.exec(selector)) !== null) names.add(m[1]);
  return names;
}

function walkFiles(dir, predicate) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, predicate));
    else if (predicate(full)) out.push(full);
  }
  return out;
}

/** Every class that a rule in the source CSS actually creates. */
export function collectSourceCssClasses(root = REPO_ROOT) {
  const classes = new Set();
  for (const file of walkFiles(path.join(root, 'src'), (f) => f.endsWith('.css'))) {
    const css = fs.readFileSync(file, 'utf8');
    for (const selector of parseCssSelectors(css)) {
      for (const name of classNamesInSelector(selector)) classes.add(name);
    }
  }
  return classes;
}

// ── TSX ───────────────────────────────────────────────────────────────

const ASSIGNMENT_OPERATORS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** Calls that take a translation key, not a class name. */
const TRANSLATION_CALLEES = new Set(['t', 'tHandle', 'getTranslations', 'useTranslations']);

/**
 * Resolve a `className` expression down to the class tokens it can
 * produce.
 *
 * Returns `{ tokens, unresolved }`. `tokens` are literal class names
 * (already split on whitespace); `unresolved` describes template
 * fragments whose class prefix is known but whose variants are not.
 */
function resolveExpression(node, ctx) {
  const tokens = [];
  const unresolved = [];
  const seen = new Set();

  const addText = (text) => {
    for (const token of text.split(/\s+/)) {
      if (token) tokens.push(token);
    }
  };

  /** Literal members of a type, when the type is a union of literals. */
  const literalMembers = (type) => {
    const parts = type.isUnion() ? type.types : [type];
    const values = [];
    for (const part of parts) {
      if (part.isStringLiteral() || part.isNumberLiteral()) values.push(String(part.value));
      else return null;
    }
    return values.length ? values : null;
  };

  const resolve = (expr) => {
    if (!expr) return;

    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      addText(expr.text);
      return;
    }

    if (ts.isTemplateExpression(expr)) {
      // The literal text before a substitution tells us what the
      // substitution completes:
      //
      //   `lb-memory-card--${cardState}`  → prefix "lb-memory-card--",
      //                                     the value is a suffix
      //   `lb-btn lb-btn--sm ${x}`        → prefix "", the value is a
      //                                     complete class (the text
      //                                     before it ends in a space)
      //
      // Getting this wrong concatenates two classes into one token, so
      // the trailing whitespace is the whole distinction.
      let preceding = expr.head.text;
      for (const span of expr.templateSpans) {
        const segment = preceding.split(/\s+/).filter(Boolean);
        const endsWithSpace = /\s$/.test(preceding);
        const prefix = endsWithSpace ? '' : segment[segment.length - 1] ?? '';
        const complete = endsWithSpace ? segment : segment.slice(0, -1);
        complete.forEach(addText);

        const type = ctx.checker.getTypeAtLocation(span.expression);
        const members = literalMembers(type);
        if (members) {
          for (const member of members) addText(prefix + member);
        } else if (prefix && DYNAMIC_VARIANT_FALLBACK[prefix]) {
          for (const variant of DYNAMIC_VARIANT_FALLBACK[prefix]) {
            addText(prefix + variant);
          }
        } else if (prefix) {
          unresolved.push({
            prefix,
            expression: span.expression.getText().slice(0, 60),
            file: ctx.file,
            line: ctx.checker.getLineAndCharacterOfPosition(span.expression.getStart()).line + 1,
          });
        }

        preceding = span.literal.text;
      }
      // The text after the last substitution is a run of complete classes.
      preceding.split(/\s+/).filter(Boolean).forEach(addText);
      return;
    }

    if (ts.isConditionalExpression(expr)) {
      resolve(expr.whenTrue);
      resolve(expr.whenFalse);
      return;
    }

    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      resolve(expr.left);
      resolve(expr.right);
      return;
    }

    if (ts.isParenthesizedExpression(expr)) {
      resolve(expr.expression);
      return;
    }

    if (ts.isIdentifier(expr)) {
      if (seen.has(expr.text)) return;
      seen.add(expr.text);

      const type = ctx.checker.getTypeAtLocation(expr);
      const members = literalMembers(type);
      if (members) {
        members.forEach(addText);
        return;
      }

      // `let cls = 'x'; cls += ' y'` widens to `string`, so the checker
      // cannot help. Collect every write to the name instead.
      for (const rhs of collectWrites(expr.text, ctx.sourceFile)) resolve(rhs);
      return;
    }

    if (ts.isCallExpression(expr)) {
      const callee = expr.expression;
      const name = ts.isIdentifier(callee) ? callee.text : '';
      if (TRANSLATION_CALLEES.has(name)) return;
      for (const arg of expr.arguments) resolve(arg);
      return;
    }

    if (ts.isArrayLiteralExpression(expr)) {
      for (const element of expr.elements) resolve(element);
      return;
    }
  };

  resolve(node);
  return { tokens, unresolved };
}

/** Every expression assigned to `name` inside a source file. */
function collectWrites(name, sourceFile) {
  const writes = [];
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      writes.push(node.initializer);
    } else if (
      ts.isBinaryExpression(node) &&
      ASSIGNMENT_OPERATORS.has(node.operatorToken.kind) &&
      ts.isIdentifier(node.left) &&
      node.left.text === name
    ) {
      writes.push(node.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return writes;
}

/**
 * Extract every class token from every TSX file in the program.
 *
 * `classes` maps a class name to the places it is applied;
 * `unresolved` lists dynamic prefixes the checker could not narrow.
 */
export function collectTsxClasses(program, root = REPO_ROOT) {
  const checker = program.getTypeChecker();
  const classes = new Map();
  const unresolved = [];

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const file = path.relative(root, sourceFile.fileName);
    if (!file.startsWith('src/') || !file.endsWith('.tsx')) continue;

    const ctx = { checker, sourceFile, file };

    const lineOf = (node) =>
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

    const record = (token, node) => {
      if (!classes.has(token)) classes.set(token, new Set());
      classes.get(token).add(`${file}:${lineOf(node)}`);
    };

    const visit = (node) => {
      // <div className="…"> and <div className={…}>
      if (ts.isJsxAttribute(node) && node.name.text === 'className') {
        const initializer = node.initializer;
        if (initializer && ts.isStringLiteral(initializer)) {
          for (const token of initializer.text.split(/\s+/)) {
            if (token) record(token, initializer);
          }
        } else if (initializer && ts.isJsxExpression(initializer)) {
          const { tokens, unresolved: pending } = resolveExpression(initializer.expression, ctx);
          tokens.forEach((token) => record(token, initializer));
          unresolved.push(...pending);
        }
      }

      // style={{ className: '…' }} / { className: '…' }
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'className') {
        const { tokens, unresolved: pending } = resolveExpression(node.initializer, ctx);
        tokens.forEach((token) => record(token, node));
        unresolved.push(...pending);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return { classes, unresolved };
}

// ── Tailwind ──────────────────────────────────────────────────────────

/**
 * Ask Tailwind which of `candidates` are utilities it generates.
 *
 * Tailwind is the authority here: the app uses a handful of utility
 * classes (`flex`, `min-h-screen`, …) that never appear in a hand-written
 * rule, and guessing which are utilities is exactly the kind of thing
 * that lets a real orphan slip through.
 */
export async function collectTailwindUtilities(candidates, root = REPO_ROOT) {
  if (candidates.length === 0) return new Set();

  const { compile } = await import('tailwindcss');
  const globalsPath = path.join(root, 'src/app/globals.css');

  const compiler = await compile(fs.readFileSync(globalsPath, 'utf8'), {
    base: path.dirname(globalsPath),
    loadStylesheet: async (id, base) => {
      let filePath;
      if (id === 'tailwindcss') {
        filePath = path.join(root, 'node_modules/tailwindcss/index.css');
      } else if (id.startsWith('.')) {
        filePath = path.resolve(base, id);
      } else {
        filePath = path.join(root, 'node_modules', id);
      }
      return {
        path: filePath,
        base: path.dirname(filePath),
        content: fs.readFileSync(filePath, 'utf8'),
      };
    },
  });

  const css = compiler.build(candidates);
  const utilities = new Set();
  for (const selector of parseCssSelectors(css)) {
    for (const name of classNamesInSelector(selector)) utilities.add(name);
  }
  return utilities;
}

// ── Entry point ───────────────────────────────────────────────────────

/**
 * Run the whole check.
 *
 * Returns `{ orphans, tailwindOnly, unresolved }` where `orphans` maps a
 * class name to the files that apply it.
 */
export async function findOrphanClasses({ root = REPO_ROOT } = {}) {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) throw new Error('tsconfig.json not found');
  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, ts.sys.readFile).config,
    ts.sys,
    root,
  );
  const program = ts.createProgram(config.fileNames, config.options);

  const { classes, unresolved } = collectTsxClasses(program, root);
  const defined = collectSourceCssClasses(root);

  const candidates = [...classes.keys()].filter((name) => !defined.has(name));
  const utilities = await collectTailwindUtilities(candidates, root);

  const orphans = new Map();
  const tailwindOnly = new Map();
  for (const [name, files] of classes) {
    if (defined.has(name)) continue;
    if (utilities.has(name)) tailwindOnly.set(name, files);
    else orphans.set(name, files);
  }

  return { orphans, tailwindOnly, unresolved, total: classes.size, defined };
}

// ── CLI ───────────────────────────────────────────────────────────────

async function main() {
  const { orphans, tailwindOnly, unresolved, total } = await findOrphanClasses();

  console.log(`TSX class tokens: ${total}`);
  console.log(`Tailwind utilities (not hand-written): ${tailwindOnly.size}`);
  console.log(`Orphan classes: ${orphans.size}`);
  console.log(`Unresolved dynamic prefixes: ${unresolved.length}`);

  if (orphans.size) {
    console.log('\nClasses with no CSS rule:\n');
    for (const [name, files] of [...orphans].sort()) {
      console.log(`  ${name}`);
      for (const file of [...files].sort()) console.log(`      ${file}`);
    }
  }

  if (unresolved.length) {
    console.log('\nDynamic class prefixes that could not be resolved:\n');
    for (const item of unresolved) {
      console.log(`  ${item.prefix}  (${item.expression})  ${item.file}:${item.line}`);
    }
  }

  process.exit(orphans.size || unresolved.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(2);
  });
}
