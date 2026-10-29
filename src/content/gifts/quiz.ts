import type { GiftPage } from './types';

/**
 * /gifts/quiz — the personalised quiz format.
 *
 * The limits quoted here are the schema's: one to thirty questions, two
 * to six options each (`QuizPayloadSchema`), a question up to 280
 * characters, an option up to 120, and a reveal message up to 500.
 */
export const quiz: GiftPage = {
  slug: 'quiz',
  kind: 'format',
  metaTitle: {
    en: 'A quiz only the two of you could pass',
    zhHant: '一場只有你們兩個才可能及格的問答',
  },
  metaDescription: {
    en: 'Multiple-choice questions built from the things only you two know. Up to thirty questions, wrong answers included, and a reveal message that appears when they get it right.',
    zhHant: '用只有你們兩個才知道的事，寫成多項選擇題。最多三十條，選項故意放錯，還有一句答對時才出現的話。',
  },
  heading: {
    en: 'Personalised quizzes',
    zhHant: '私人問答',
  },
  lede: {
    en: 'The best quiz is not a general-knowledge quiz with your name on it. It is a set of questions whose only correct answer is a memory, and the fun is in watching someone work out what you meant.',
    zhHant: '最好的問答，不是把你名字印在上面的常識測驗，而是一堆正確答案本身就是一段記憶的題目。最好玩的地方，在於看著對方猜你想說甚麼。',
  },
  sections: [
    {
      heading: {
        en: 'One right answer, and the wrong ones matter more',
        zhHant: '只有一個正確答案，而錯的選項更重要',
      },
      body: {
        en: 'Every question has between two and six options, and exactly one of them is correct. The wrong answers are the good ones: the plausible one you can see, the one that is almost true, the one that is a joke only the two of you understand. Put the real answer somewhere other than the first position and the quiz stops being a formality.',
        zhHant: '每一題有兩至六個選項，而且只有一個是對的。真正好玩的是錯的選項：看起來合理的、你一時之間分辨不出的、只有你們兩個才懂的玩笑。把正確答案放在第一個以外的位置，這場問答才不會變成一場走過場。',
      },
      points: [
        {
          en: 'One to thirty questions',
          zhHant: '一至三十條題目',
        },
        {
          en: 'Two to six options per question',
          zhHant: '每題兩至六個選項',
        },
        {
          en: 'A reveal message on every question, up to 500 characters',
          zhHant: '每題都可以附一句揭曉文字，最多 500 個字',
        },
      ],
    },
    {
      heading: {
        en: 'What a good question looks like',
        zhHant: '一條好題目長甚麼樣',
      },
      body: {
        en: 'Start from a fact only they would have: where you first met, the name of the dog, what you did the time the flight was cancelled. Then write it so the answer is not a word they can guess. "Which one of these is the song we played in the car?" beats "What was our song" every time — one is a search, the other is a test. Questions run up to 280 characters, so there is room for a little story.',
        zhHant: '從只有對方才知道的事開始：你們在哪裡認識、那隻狗叫甚麼名字、班機取消那次你們做了甚麼。然後把題目寫成「答案不是一個可以直接猜出來的詞」。「以下哪一首是我們在車上放的歌？」永遠比「我們的共同曲目是甚麼」好——一個是查找，一個是考試。題目最多 280 個字，足夠塞一點故事進去。',
      },
      points: [
        {
          en: 'Questions up to 280 characters, options up to 120',
          zhHant: '題目最多 280 個字，選項最多 120 個字',
        },
        {
          en: 'Wrong options should be funny to them specifically',
          zhHant: '錯的選項，要只對他們兩個而言好笑',
        },
      ],
    },
    {
      heading: {
        en: 'The reveal',
        zhHant: '揭曉那一刻',
      },
      body: {
        en: 'When they pick the right answer, the reveal line appears. That is where the actual gift usually is: the sentence you would have said out loud if you had been brave enough. Up to 500 characters, which is more than a text message and less than an email.',
        zhHant: '當他們揀中正確答案，揭曉的那句話就出現。真正的禮物通常就在那裡：一句你如果夠勇敢，本來會大聲講出來的話。最多 500 個字，比一則短訊長，比一封電郵短。',
      },
    },
  ],
  faq: [
    {
      q: {
        en: 'How many questions should I write?',
        zhHant: '應該寫多少題？',
      },
      a: {
        en: 'Ten is enough to feel like a test and short enough to finish in one sitting. Under five it feels like a questionnaire; over twenty it feels like homework.',
        zhHant: '十題已經有考試的感覺，又短到可以一口氣答完。少於五題像是問卷，多於二十題像是功課。',
      },
    },
    {
      q: {
        en: 'Can the wrong answers be jokes?',
        zhHant: '錯的選項可以搞笑嗎？',
      },
      a: {
        en: 'Yes — that is the whole technique. The wrong options should be funny to them specifically, not funny in general. A joke anyone would find funny is worth less here than a joke only they would.',
        zhHant: '可以，而且這正是整個技巧。錯的選項要對「他們」而言好笑，而不是普遍性地好笑。人人都覺得好笑的玩笑，在這裡比只有他們才懂的玩笑便宜得多。',
      },
    },
    {
      q: {
        en: 'What does the person taking the quiz get at the end?',
        zhHant: '答題的人最後會得到甚麼？',
      },
      a: {
        en: 'A score, and the reveal message attached to every question they got right. Most people screenshot that and send it straight back to you.',
        zhHant: '一個分數，以及每一條答對的題目所附的揭曉文字。大部分人會截圖，然後直接傳回給你。',
      },
    },
  ],
  related: ['memory-cards', 'gift-ideas-for-him', 'gift-ideas-for-her'],
};
