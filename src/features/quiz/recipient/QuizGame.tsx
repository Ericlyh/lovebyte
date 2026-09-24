'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { QuizPayload } from '@/features/quiz/schemas';

/**
 * QuizGame — recipient view (Phase 6, OOP-4222).
 *
 * Renders under /g/[token]/open when gifts.type === 'quiz'. The envelope
 * page is generic; this component owns the recipient experience for the
 * type.
 *
 * Architecture §6 — feature module layout:
 *   src/features/quiz/
 *     schemas.ts              ← shared Zod schema (already ships)
 *     recipient/              ← this file (entry)
 *
 * Game model:
 *   - Linear flow: question 1 → 2 → … → N → final score panel.
 *   - On each question the recipient picks an option. Wrong vs right is
 *     NOT revealed until they pick — the gift is about the journey, not
 *     the score. The reveal_msg for the question shows either way.
 *   - The recipient can go back to a previous question (revisit, change
 *     answer) but the score only counts the final answer per question.
 *   - At the end, the score panel shows correct/total + a celebratory
 *     heading. Reveal messages are NOT replayed in bulk — the recipient
 *     saw each one as they went.
 */

export function QuizGame({
  payload,
  senderName,
}: {
  payload: QuizPayload;
  senderName: string;
}) {
  const t = useTranslations('Open.quiz');

  // -1 = not started; 0..N-1 = current question; N = done screen.
  const [step, setStep] = useState<number>(-1);
  // Per-question recipient answer: index into options, or null = skipped.
  const [answers, setAnswers] = useState<(number | null)[]>(() =>
    payload.questions.map(() => null),
  );

  // Reset state when the payload changes (different share token).
  useEffect(() => {
    setStep(-1);
    setAnswers(payload.questions.map(() => null));
  }, [payload]);

  const total = payload.questions.length;
  const current = step >= 0 && step < total ? payload.questions[step] : null;
  const revealed = step > 0 && step <= total;

  const score = useMemo(() => {
    let correct = 0;
    for (let i = 0; i < total; i++) {
      if (answers[i] === payload.questions[i].correct_idx) correct++;
    }
    return correct;
  }, [answers, payload.questions, total]);

  function handleStart() {
    setStep(0);
  }

  function handlePick(optionIdx: number) {
    if (!current) return;
    setAnswers((prev) => {
      const next = [...prev];
      next[step] = optionIdx;
      return next;
    });
    // Auto-advance after a short pause so the reveal_msg reads first.
    window.setTimeout(() => {
      setStep((s) => (s + 1 <= total ? s + 1 : s));
    }, 1400);
  }

  function handleBack() {
    setStep((s) => Math.max(0, s - 1));
  }

  function handleNext() {
    setStep((s) => Math.min(total, s + 1));
  }

  // ─── Intro screen ────────────────────────────────────────────────────────
  if (step === -1) {
    return (
      <main className="lb-quiz-page">
        <article className="lb-quiz lb-quiz--intro">
          <header className="lb-quiz__head">
            <span className="lb-tag">{t('tag')}</span>
            <p className="lb-quiz__from">{t('fromLine', { name: senderName })}</p>
          </header>
          <h1 className="lb-quiz__heading">{t('introHeading')}</h1>
          <p className="lb-quiz__lede">
            {t('introLede', { count: total })}
          </p>
          <button
            type="button"
            className="lb-quiz__start"
            onClick={handleStart}
          >
            {t('start')}
          </button>
        </article>
      </main>
    );
  }

  // ─── Done screen ─────────────────────────────────────────────────────────
  if (step === total) {
    return (
      <main className="lb-quiz-page">
        <article className="lb-quiz lb-quiz--done">
          <header className="lb-quiz__head">
            <span className="lb-tag">{t('tag')}</span>
            <p className="lb-quiz__from">{t('fromLine', { name: senderName })}</p>
          </header>
          <h1 className="lb-quiz__heading">{t('winHeading')}</h1>
          <p className="lb-quiz__score">
            {t('scoreLine', { correct: score, total })}
          </p>
          <button
            type="button"
            className="lb-quiz__restart"
            onClick={() => {
              setAnswers(payload.questions.map(() => null));
              setStep(0);
            }}
          >
            {t('playAgain')}
          </button>
        </article>
      </main>
    );
  }

  // ─── Question screen ─────────────────────────────────────────────────────
  if (!current) return null;
  const picked = answers[step];

  return (
    <main className="lb-quiz-page">
      <article className="lb-quiz">
        <header className="lb-quiz__head">
          <span className="lb-tag">{t('tag')}</span>
          <p className="lb-quiz__from">{t('fromLine', { name: senderName })}</p>
        </header>

        <p className="lb-quiz__progress" aria-live="polite">
          {t('progress', { current: step + 1, total })}
        </p>

        <h2 className="lb-quiz__q">{current.q}</h2>

        <ul className="lb-quiz__options" role="list">
          {current.options.map((opt, idx) => {
            const isPicked = picked === idx;
            const isCorrect = idx === current.correct_idx;
            const showReveal = picked !== null;
            let cls = 'lb-quiz__option';
            if (showReveal && isCorrect) cls += ' lb-quiz__option--correct';
            else if (showReveal && isPicked && !isCorrect) {
              cls += ' lb-quiz__option--wrong';
            } else if (isPicked) {
              cls += ' lb-quiz__option--picked';
            }
            return (
              <li key={idx}>
                <button
                  type="button"
                  className={cls}
                  disabled={picked !== null}
                  onClick={() => handlePick(idx)}
                >
                  <span className="lb-quiz__option-letter">
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span className="lb-quiz__option-text">{opt}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {revealed && picked !== null && (
          <p className="lb-quiz__reveal" aria-live="polite">
            {current.reveal_msg}
          </p>
        )}

        <nav className="lb-quiz__nav" aria-label={t('navAria')}>
          <button
            type="button"
            className="lb-quiz__nav-btn"
            onClick={handleBack}
            disabled={step === 0}
          >
            ← {t('back')}
          </button>
          {picked !== null ? (
            <button
              type="button"
              className="lb-quiz__nav-btn lb-quiz__nav-btn--primary"
              onClick={handleNext}
            >
              {step + 1 === total ? t('seeResults') : t('next')} →
            </button>
          ) : (
            <span className="lb-quiz__nav-hint">{t('pickOne')}</span>
          )}
        </nav>
      </article>
    </main>
  );
}
