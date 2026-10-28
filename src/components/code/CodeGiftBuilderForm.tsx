'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  compileJsxAction,
  saveCodeGiftAction,
  reviewCodeGiftAction,
  type SaveCodeGiftResult,
} from '@/lib/actions/code';
import { scanCodeGift } from '@/lib/gifts/code-scan';
import { composeCodeGiftDocument } from '@/lib/gifts/code-render';
import type { CodeAiReview } from '@/lib/gifts/code-ai';

/**
 * CodeGiftBuilderForm — sender-side builder for the `code` gift type
 * (OOP-5688).
 *
 * Three text areas (HTML, CSS, JS), a live preview, a live safety scan,
 * an AI review, and a save button.
 *
 * The preview uses the same `composeCodeGiftDocument` + sandboxed iframe
 * as the recipient view, so what the sender sees is what the recipient
 * gets — including the sandbox restrictions, which surface as a broken
 * script in the preview rather than as a surprise on the recipient's
 * phone.
 *
 * The scan runs on every keystroke (it is a handful of regexes over a
 * few KB) so the sender sees the consequence of a line before they save.
 * The server re-runs the same scan before it writes anything, so the
 * browser's copy is a convenience, never the control.
 *
 * React mode: the JS field then holds JSX. The compiler is imported
 * dynamically so it only reaches the browser when the sender actually
 * asks for React — it is a big dependency and most code gifts never
 * touch it.
 */

const MAX_TITLE = 100;

type Field = 'html' | 'css' | 'js';

export function CodeGiftBuilderForm() {
  const t = useTranslations('Builder.code');
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [html, setHtml] = useState('');
  const [css, setCss] = useState('');
  const [js, setJs] = useState('');
  const [useReact, setUseReact] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();

  const [review, setReview] = useState<CodeAiReview | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [answers, setAnswers] = useState('');
  const [isReviewing, startReviewing] = useTransition();
  const [applied, setApplied] = useState<string[]>([]);

  // The compiled JSX, once the server has compiled it.
  const [compiledJs, setCompiledJs] = useState('');
  const [jsxError, setJsxError] = useState<string | null>(null);

  useEffect(() => {
    if (!useReact) {
      setCompiledJs('');
      setJsxError(null);
      return;
    }
    let cancelled = false;
    // Debounced: the compiler lives on the server (it is far too big to
    // ship to the browser), so every keystroke would be a round trip.
    const timer = setTimeout(() => {
      void (async () => {
        const result = await compileJsxAction(js);
        if (cancelled) return;
        if (result.ok) {
          setCompiledJs(result.code);
          setJsxError(null);
        } else {
          setCompiledJs('');
          setJsxError(result.error);
        }
      })();
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [js, useReact]);

  const effectiveJs = useReact ? compiledJs : js;

  const scan = useMemo(() => scanCodeGift({ html, css, js }), [html, css, js]);
  const preview = useMemo(
    () => composeCodeGiftDocument({ html, css, js: effectiveJs, react: useReact }),
    [html, css, effectiveJs, useReact],
  );

  const fieldValue: Record<Field, string> = { html, css, js };

  function setField(field: Field, value: string) {
    if (field === 'html') setHtml(value);
    else if (field === 'css') setCss(value);
    else setJs(value);
  }

  function applySuggestion(suggestionId: string, original: string, replacement: string, field: Field) {
    const current = fieldValue[field];
    // The model copies `original` verbatim; if it did not, we drop the
    // suggestion rather than guess where it was meant to go.
    if (!current.includes(original)) {
      setError(t('errors.applyFailed'));
      return;
    }
    setField(field, current.replace(original, replacement));
    setApplied((prev) => [...prev, suggestionId]);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (title.trim().length === 0) {
      setError(t('errors.titleRequired'));
      return;
    }
    if (html.trim().length === 0 && css.trim().length === 0 && js.trim().length === 0) {
      setError(t('errors.emptyGift'));
      return;
    }
    if (scan.verdict === 'blocked') {
      setError(t('errors.blocked'));
      return;
    }
    if (useReact && jsxError) {
      setError(t('errors.jsxFailed'));
      return;
    }

    startSave(async () => {
      const result: SaveCodeGiftResult = await saveCodeGiftAction({
        title: title.trim(),
        html,
        css,
        js,
        react: useReact,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/create/${result.giftId}/finish?share=${result.shareToken}`);
    });
  }

  function runReview() {
    setReviewError(null);
    startReviewing(async () => {
      const result = await reviewCodeGiftAction({
        title: title.trim() || 'Untitled gift',
        html,
        css,
        js,
        react: useReact,
        answers: answers.trim() || undefined,
      });
      if (!result.ok) {
        setReview(null);
        setReviewError(result.error);
        return;
      }
      setReview(result.review);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="lb-code-builder">
      <div className="lb-field">
        <label htmlFor="code-title">{t('titleLabel')}</label>
        <input
          id="code-title"
          type="text"
          maxLength={MAX_TITLE}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('titlePlaceholder')}
          className="lb-input"
          required
        />
      </div>

      <div className="lb-code-builder__grid">
        <div className="lb-code-builder__editors">
          <div className="lb-field lb-code-builder__react">
            <label htmlFor="code-react">
              <input
                id="code-react"
                type="checkbox"
                checked={useReact}
                onChange={(e) => setUseReact(e.target.checked)}
              />
              {t('reactLabel')}
            </label>
            <p className="lb-field-hint">{t('reactHint')}</p>
          </div>

          <div className="lb-field">
            <label htmlFor="code-html">{t('htmlLabel')}</label>
            <textarea
              id="code-html"
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              rows={8}
              placeholder={t('htmlPlaceholder')}
              className="lb-input lb-textarea lb-code-editor"
              spellCheck={false}
            />
          </div>

          <div className="lb-field">
            <label htmlFor="code-css">{t('cssLabel')}</label>
            <textarea
              id="code-css"
              value={css}
              onChange={(e) => setCss(e.target.value)}
              rows={6}
              placeholder={t('cssPlaceholder')}
              className="lb-input lb-textarea lb-code-editor"
              spellCheck={false}
            />
          </div>

          <div className="lb-field">
            <label htmlFor="code-js">
              {useReact ? t('jsxLabel') : t('jsLabel')}
            </label>
            <textarea
              id="code-js"
              value={js}
              onChange={(e) => setJs(e.target.value)}
              rows={6}
              placeholder={useReact ? t('jsxPlaceholder') : t('jsPlaceholder')}
              className="lb-input lb-textarea lb-code-editor"
              spellCheck={false}
            />
            {useReact && (
              <p className="lb-field-hint">{t('jsxHint')}</p>
            )}
            {jsxError && (
              <p className="lb-form-error" role="alert">
                {t('jsxError', { error: jsxError })}
              </p>
            )}
          </div>
        </div>

        <div className="lb-code-builder__preview">
          <h3 className="lb-code-builder__preview-title">{t('previewLabel')}</h3>
          <iframe
            className="lb-code-gift__frame lb-code-gift__frame--preview"
            title={t('previewLabel')}
            sandbox="allow-scripts"
            srcDoc={preview}
          />
          <p className="lb-field-hint">{t('previewHint')}</p>
        </div>
      </div>

      <section className="lb-code-builder__scan" aria-live="polite">
        <h3>{t('scanHeading')}</h3>
        <p className={`lb-code-verdict lb-code-verdict--${scan.verdict}`}>
          {scan.verdict === 'safe' && t('scanSafe')}
          {scan.verdict === 'needs_review' && t('scanNeedsReview')}
          {scan.verdict === 'blocked' && t('scanBlocked')}
        </p>

        {scan.findings.length === 0 ? (
          <p className="lb-field-hint">{t('scanClean')}</p>
        ) : (
          <ul className="lb-code-findings">
            {scan.findings.map((finding, index) => (
              <li
                key={`${finding.code}-${finding.field}-${finding.line}-${index}`}
                className={`lb-code-finding lb-code-finding--${finding.severity}`}
              >
                <span className="lb-code-finding__severity">
                  {t(`severity.${finding.severity}`)}
                </span>
                <span className="lb-code-finding__title">
                  {t(`scan.${finding.code}`)}
                </span>
                <span className="lb-code-finding__where">
                  {t('scanLocation', {
                    field: t(`field.${finding.field}`),
                    line: finding.line,
                  })}
                </span>
                {finding.excerpt && (
                  <code className="lb-code-finding__excerpt">{finding.excerpt}</code>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="lb-code-builder__ai">
        <h3>{t('aiHeading')}</h3>
        <p className="lb-field-hint">{t('aiLede')}</p>

        <button
          type="button"
          className="lb-btn lb-btn--ghost"
          onClick={runReview}
          disabled={isReviewing}
        >
          {isReviewing ? t('aiPending') : t('aiButton')}
        </button>

        {reviewError && (
          <p className="lb-form-error" role="alert">
            {reviewError}
          </p>
        )}

        {review && (
          <div className="lb-code-review">
            <p className="lb-code-review__summary">{review.summary}</p>

            {review.questions.length > 0 && (
              <div className="lb-code-review__questions">
                <h4>{t('aiQuestionsHeading')}</h4>
                <ul>
                  {review.questions.map((question, index) => (
                    <li key={index}>{question}</li>
                  ))}
                </ul>
                <div className="lb-field">
                  <label htmlFor="code-answers">{t('aiAnswersLabel')}</label>
                  <textarea
                    id="code-answers"
                    value={answers}
                    onChange={(e) => setAnswers(e.target.value)}
                    rows={3}
                    placeholder={t('aiAnswersPlaceholder')}
                    className="lb-input lb-textarea"
                  />
                </div>
                <button
                  type="button"
                  className="lb-btn lb-btn--ghost"
                  onClick={runReview}
                  disabled={isReviewing}
                >
                  {t('aiReReview')}
                </button>
              </div>
            )}

            {review.suggestions.length > 0 && (
              <div className="lb-code-review__suggestions">
                <h4>{t('aiSuggestionsHeading')}</h4>
                <ul>
                  {review.suggestions.map((suggestion) => {
                    const isApplied = applied.includes(suggestion.id);
                    return (
                      <li key={suggestion.id} className="lb-code-suggestion">
                        <strong>{suggestion.title}</strong>
                        <p>{suggestion.detail}</p>
                        <p className="lb-field-hint">
                          {t('aiSuggestionField', {
                            field: t(`field.${suggestion.field}`),
                          })}
                        </p>
                        <button
                          type="button"
                          className="lb-btn lb-btn--ghost"
                          onClick={() =>
                            applySuggestion(
                              suggestion.id,
                              suggestion.original,
                              suggestion.replacement,
                              suggestion.field,
                            )
                          }
                          disabled={isApplied}
                        >
                          {isApplied ? t('aiApplied') : t('aiApply')}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {error && (
        <p className="lb-form-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="lb-btn lb-btn--primary" disabled={isSaving}>
        {isSaving ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
