import type { GiftPage } from './types';

/**
 * /gifts/gift-ideas-for-him — the audience page.
 *
 * The framing is the opposite of the "for her" page: the obstacle is
 * not sentiment, it is that everything on the shelf is a version of him
 * that somebody else chose. So the page argues for composing rather
 * than buying, and it leads with the quiz — the format that needs no
 * declaration of affection to work.
 */
export const giftIdeasForHim: GiftPage = {
  slug: 'gift-ideas-for-him',
  kind: 'audience',
  metaTitle: {
    en: 'Personalised gift ideas for him',
    zhHant: '送給他的私人禮物',
  },
  metaDescription: {
    en: 'The gift he will actually use: a quiz of what he knows about you, a letter with your voice in it, or a photo puzzle that is hard in exactly the right way. Built in twenty minutes.',
    zhHant: '他真的會用的禮物：一場考他有多了解你的問答、一封有著你聲音的信，或一個剛好難得剛好的相片拼圖。二十分鐘就能做好。',
  },
  heading: {
    en: 'Personalised gift ideas for him',
    zhHant: '送給他的私人禮物',
  },
  lede: {
    en: 'He is not hard to buy for because he wants less. He is hard to buy for because the shelves are full of versions of himself that somebody else chose. So do not buy. Give him something only you could have made.',
    zhHant: '他難買禮物，不是因為他想要得少，而是因為架上擺滿了別人替他選的「他」。所以不要買。給他一件只有你做得出來的東西。',
  },
  sections: [
    {
      heading: {
        en: 'For the one who does not do feelings',
        zhHant: '給不談感覺那一種',
      },
      body: {
        en: 'A quiz. It is a competition, the score is a number, and the jokes live in the wrong options — and you can put the whole thing together without saying one sentimental word. The reveal message at the end is where the sentiment goes, and it only appears once he has already committed to finishing.',
        zhHant: '一場問答。它是一場比賽，分數是一個數字，笑話都躲在錯的選項裡——而你可以一句感性的話都不說，就把整份禮物組裝好。感性的部分放在最後的揭曉文字裡，而且只有在他已經打算答完之後才出現。',
      },
      points: [
        {
          en: 'One to thirty questions, two to six options each',
          zhHant: '一至三十條題目，每題兩至六個選項',
        },
        {
          en: 'A reveal message of up to 500 characters per question',
          zhHant: '每題最多 500 個字的揭曉文字',
        },
      ],
    },
    {
      heading: {
        en: 'For the one who is sentimental but will not say so',
        zhHant: '給感性卻不承認那一種',
      },
      body: {
        en: 'An animated letter, unrolled in a browser, with your photographs and one voice note dropped into the sentence that mentions them. He will not tell you it is lovely. He will keep the link.',
        zhHant: '一封在瀏覽器裡一路捲開的動態信件，把你的相片和一段語音，放進提到它們的那句話裡。他不會跟你說它很動人。他會把連結留著。',
      },
      points: [
        {
          en: 'Photographs, voice notes, music and animations, inline',
          zhHant: '相片、語音訊息、音樂和動畫，都能放在正文裡',
        },
        {
          en: 'Three papers, three envelope colours',
          zhHant: '三種紙張，三種信封顏色',
        },
      ],
    },
    {
      heading: {
        en: 'For the one who likes a puzzle',
        zhHant: '給喜歡解謎那一種',
      },
      body: {
        en: 'A drag-and-drop photo puzzle: one picture cut into tiles, with a reveal message underneath when it is solved. It is not hard, which is the point — the frustration of a hard puzzle is what makes people put a phone down and never finish it.',
        zhHant: '一個可以拖曳的相片拼圖：一張相片切成幾塊，砌好之後下面有一句揭曉文字。它並不難，而這正是重點——太難的拼圖帶來的挫敗，會讓人把手機放下，然後再也不打開。',
      },
      points: [
        {
          en: 'A reveal message of up to 500 characters',
          zhHant: '最多 500 個字的揭曉文字',
        },
        {
          en: 'Plays on the phone, no app to install',
          zhHant: '在手機上就能玩，不用安裝 App',
        },
      ],
    },
  ],
  faq: [
    {
      q: {
        en: 'Is a quiz too personal?',
        zhHant: '問答會不會太私密？',
      },
      a: {
        en: 'Only if the questions are about you. Ask about him, or ask about the two of you, and the score becomes a joke you both laugh at instead of an interrogation.',
        zhHant: '只有當題目是關於你的時候才會。改成問他，或者問你們兩個，分數就會變成一個你們都會笑的笑話，而不是一場審問。',
      },
    },
    {
      q: {
        en: 'What if he will not play games?',
        zhHant: '如果他不肯玩遊戲？',
      },
      a: {
        en: 'Then send the letter. It is the same gift with none of the ceremony, and it is the one he is most likely to keep.',
        zhHant: '那就送信。是同一份禮物，只是沒有那些儀式，而且這通常是他最會留住的版本。',
      },
    },
    {
      q: {
        en: 'How long does it take?',
        zhHant: '要做多久？',
      },
      a: {
        en: 'About twenty minutes for a quiz or a memory card game. The letter takes longer, because it is the one you cannot rush.',
        zhHant: '問答或記憶卡遊戲大約二十分鐘。信要久一點，因為那一種是趕不出來的。',
      },
    },
  ],
  related: ['gift-ideas-for-her', 'birthday-ideas', 'quiz'],
};
