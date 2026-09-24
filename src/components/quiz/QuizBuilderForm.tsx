'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  saveQuizDraftAction,
  type SaveQuizResult,
} from '@/lib/actions/quiz';

/**
 * QuizBuilderForm — sender-side form (Phase 6, OOP-4222).
 *
 * The sender writes multiple-choice questions (≥ 2 options, exactly one
 * correct answer per question + a per-question reveal message). On submit
 * we POST the payload to saveQuizDraftAction which writes gifts + shares
 * rows. On success the action returns the share token; we route to
 * /create/[giftId]/finish?share=<token> where the share link +
 * PublishToMarketplaceCard both render.
 *
 * Quiz is text-only — no photo upload, so this form is simpler than
 * memory-cards and dragdrop-puzzle.
 */

const MAX_TITLE = 100;
const MAX_QUESTION = 280;
const MAX_OPTION = 120;
const MAX_REVEAL = 500;
const MAX_QUESTIONS = 30;

type Question = {
  q: string;
  options: string[];
  correct_idx: number;
  reveal_msg: string;
};

function makeBlankQuestion(): Question {
  return {
    q: '',
    options: ['', ''],
    correct_idx: 0,
    reveal_msg: '',
  };
}

export function QuizBuilderForm() {
  const t = useTranslations('Builder.quiz');
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<Question[]>([
    makeBlankQuestion(),
  ]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();

  function updateQuestion(i: number, patch: Partial<Question>) {
    setQuestions((prev) =>
      prev.map((q, idx) => (idx === i ? { ...q, ...patch } : q)),
    );
  }

  function addQuestion() {
    setQuestions((prev) =>
      prev.length >= MAX_QUESTIONS ? prev : [...prev, makeBlankQuestion()],
    );
  }

  function removeQuestion(i: number) {
    setQuestions((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i),
    );
  }

  function moveQuestion(i: number, delta: -1 | 1) {
    setQuestions((prev) => {
      const next = [...prev];
      const j = i + delta;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function updateOption(qi: number, oi: number, value: string) {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== qi) return q;
        const options = q.options.map((o, oidx) =>
          oidx === oi ? value : o,
        );
        return { ...q, options };
      }),
    );
  }

  function addOption(qi: number) {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== qi) return q;
        if (q.options.length >= 6) return q;
        return { ...q, options: [...q.options, ''] };
      }),
    );
  }

  function removeOption(qi: number, oi: number) {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== qi) return q;
        if (q.options.length <= 2) return q;
        const options = q.options.filter((_, oidx) => oidx !== oi);
        // Adjust correct_idx if the removed option was at or before it.
        let correct_idx = q.correct_idx;
        if (oi === correct_idx) correct_idx = 0;
        else if (oi < correct_idx) correct_idx = correct_idx - 1;
        return { ...q, options, correct_idx };
      }),
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (title.trim().length === 0) {
      setError(t('errors.titleRequired'));
      return;
    }
    if (questions.length === 0) {
      setError(t('errors.noQuestions'));
      return;
    }
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (q.q.trim().length === 0) {
        setError(t('errors.questionRequired', { n: i + 1 }));
        return;
      }
      if (q.options.some((o) => o.trim().length === 0)) {
        setError(t('errors.optionRequired', { n: i + 1 }));
        return;
      }
      if (q.correct_idx < 0 || q.correct_idx >= q.options.length) {
        setError(t('errors.correctRequired', { n: i + 1 }));
        return;
      }
      if (q.reveal_msg.trim().length === 0) {
        setError(t('errors.revealRequired', { n: i + 1 }));
        return;
      }
    }

    const payload = {
      title: title.trim(),
      questions: questions.map((q) => ({
        q: q.q.trim(),
        options: q.options.map((o) => o.trim()),
        correct_idx: q.correct_idx,
        reveal_msg: q.reveal_msg.trim(),
      })),
    };

    startSave(async () => {
      const result: SaveQuizResult = await saveQuizDraftAction(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/create/${result.giftId}/finish?share=${result.shareToken}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="lb-quiz-builder">
      <div className="lb-field">
        <label htmlFor="quiz-title">{t('titleLabel')}</label>
        <input
          id="quiz-title"
          type="text"
          maxLength={MAX_TITLE}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('titlePlaceholder')}
          className="lb-input"
          required
        />
      </div>

      <ol className="lb-quiz-builder__list">
        {questions.map((q, qi) => (
          <li key={qi} className="lb-quiz-builder__q">
            <header className="lb-quiz-builder__q-head">
              <h3>
                {t('questionLegend', { n: qi + 1 })}
              </h3>
              <div className="lb-quiz-builder__q-actions">
                <button
                  type="button"
                  className="lb-btn lb-btn--ghost"
                  onClick={() => moveQuestion(qi, -1)}
                  disabled={qi === 0}
                  aria-label={t('moveUpAria', { n: qi + 1 })}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="lb-btn lb-btn--ghost"
                  onClick={() => moveQuestion(qi, 1)}
                  disabled={qi === questions.length - 1}
                  aria-label={t('moveDownAria', { n: qi + 1 })}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="lb-btn lb-btn--ghost lb-btn--danger"
                  onClick={() => removeQuestion(qi)}
                  disabled={questions.length === 1}
                  aria-label={t('removeQuestionAria', { n: qi + 1 })}
                >
                  ✕
                </button>
              </div>
            </header>

            <div className="lb-field">
              <label htmlFor={`q-${qi}-text`}>{t('questionLabel')}</label>
              <textarea
                id={`q-${qi}-text`}
                value={q.q}
                onChange={(e) => updateQuestion(qi, { q: e.target.value })}
                maxLength={MAX_QUESTION}
                rows={2}
                placeholder={t('questionPlaceholder')}
                className="lb-input lb-textarea"
                required
              />
            </div>

            <fieldset className="lb-quiz-builder__options">
              <legend>{t('optionsLabel')}</legend>
              {q.options.map((opt, oi) => {
                const isCorrect = q.correct_idx === oi;
                return (
                  <div key={oi} className="lb-quiz-builder__opt">
                    <label className="lb-quiz-builder__opt-correct">
                      <input
                        type="radio"
                        name={`correct-${qi}`}
                        checked={isCorrect}
                        onChange={() =>
                          updateQuestion(qi, { correct_idx: oi })
                        }
                        aria-label={t('markCorrectAria', { n: qi + 1, o: oi + 1 })}
                      />
                      <span aria-hidden="true">
                        {String.fromCharCode(65 + oi)}
                      </span>
                    </label>
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => updateOption(qi, oi, e.target.value)}
                      maxLength={MAX_OPTION}
                      placeholder={t('optionPlaceholder', { n: oi + 1 })}
                      className="lb-input"
                      required
                    />
                    <button
                      type="button"
                      className="lb-btn lb-btn--ghost lb-btn--danger"
                      onClick={() => removeOption(qi, oi)}
                      disabled={q.options.length <= 2}
                      aria-label={t('removeOptionAria', { n: qi + 1, o: oi + 1 })}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                className="lb-btn lb-btn--ghost"
                onClick={() => addOption(qi)}
                disabled={q.options.length >= 6}
              >
                + {t('addOption')}
              </button>
            </fieldset>

            <div className="lb-field">
              <label htmlFor={`q-${qi}-reveal`}>{t('revealLabel')}</label>
              <textarea
                id={`q-${qi}-reveal`}
                value={q.reveal_msg}
                onChange={(e) =>
                  updateQuestion(qi, { reveal_msg: e.target.value })
                }
                maxLength={MAX_REVEAL}
                rows={2}
                placeholder={t('revealPlaceholder')}
                className="lb-input lb-textarea"
                required
              />
              <p className="lb-field-hint">
                {t('revealHint', {
                  count: q.reveal_msg.length,
                  max: MAX_REVEAL,
                })}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <button
        type="button"
        className="lb-btn lb-btn--ghost"
        onClick={addQuestion}
        disabled={questions.length >= MAX_QUESTIONS}
      >
        + {t('addQuestion')}
      </button>

      {error && (
        <p className="lb-form-error" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        className="lb-btn lb-btn--primary"
        disabled={isSaving}
      >
        {isSaving ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
