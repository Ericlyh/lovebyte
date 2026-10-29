import type { GiftPage } from './types';

/**
 * /gifts/gift-ideas-for-her — the audience page.
 *
 * The framing here is deliberately not "romantic". A lot of the people
 * who will read this page are buying for a sister or a friend, and the
 * FAQ says so — the copy has to hold both readings.
 */
export const giftIdeasForHer: GiftPage = {
  slug: 'gift-ideas-for-her',
  kind: 'audience',
  metaTitle: {
    en: 'Personalised gift ideas for her',
    zhHant: '送給她的私人禮物',
  },
  metaDescription: {
    en: 'Not flowers, not a necklace — a memory card game, a letter that opens like an envelope, or a quiz made of the two of you. Built in twenty minutes from photographs you already have.',
    zhHant: '不是花，不是項鍊——而是一個記憶卡遊戲、一封像信封般打開的信，或一場由你們兩個組成的問答。用你手上現有的相片，二十分鐘就能做好。',
  },
  heading: {
    en: 'Personalised gift ideas for her',
    zhHant: '送給她的私人禮物',
  },
  lede: {
    en: 'The trouble with buying for her is that you either buy flowers, which are over in a week, or you buy a thing, which is a thing. A gift made of your own photographs is neither — and it cannot be returned.',
    zhHant: '送禮物給她之所以麻煩，是因為你要麼買花（一星期就謝了），要麼買一件東西（那就是一件東西）。用你自己的相片做成的禮物兩者都不是——而且退不了。',
  },
  sections: [
    {
      heading: {
        en: 'For the sentimental one',
        zhHant: '給感性那一種',
      },
      body: {
        en: 'A memory card game from the photographs she keeps on her phone: the holiday, the dog, the dinner that went badly. Each card carries a line of your own handwriting about why that photograph matters. She will play it twice — once to win, and once to read the captions again.',
        zhHant: '用她手機裡一直留著的那些相片做一個記憶卡遊戲：旅行、那隻狗、那頓不太成功的飯。每一張卡都帶著你親手寫的一句話，說明那張相片為甚麼重要。她會玩兩次——一次是為了贏，一次是為了再讀一遍那些說明。',
      },
      points: [
        {
          en: 'Three to twelve pairs of your own photographs',
          zhHant: '三至十二對你自己的相片',
        },
        {
          en: 'Your own text, up to 120 characters on each card',
          zhHant: '你自己的文字，每張卡最多 120 個字',
        },
      ],
    },
    {
      heading: {
        en: 'For the one who is hard to buy for',
        zhHant: '給很難買到禮物的那一種',
      },
      body: {
        en: 'Do not buy. Compose. A letter with her photographs and your voice notes in it is more personal than anything with a price tag, because it costs an evening of writing and no money at all. It also cannot be duplicated, which is the entire point.',
        zhHant: '不要買，要寫。一封放進她的相片和你語音的信，比任何有標價的東西都更私人，因為它的成本是一個晚上的時間，卻是零錢。而且它無法被複製——這正是重點所在。',
      },
      points: [
        {
          en: 'Three papers, three envelope colours',
          zhHant: '三種紙張，三種信封顏色',
        },
        {
          en: 'Voice notes play inline, where you put them',
          zhHant: '語音訊息會在你放下的位置就地播放',
        },
      ],
    },
    {
      heading: {
        en: 'For the competitive one',
        zhHant: '給好勝那一種',
      },
      body: {
        en: 'A quiz with one right answer, in which the wrong answers are jokes only she would get. The reveal message is where you say the thing you have been not saying. She will send you the score, and then she will send you the screenshot of the reveal.',
        zhHant: '一場只有一個正確答案的問答，錯的選項是只有她才懂的玩笑。那句你一直沒有說出口的話，就放在揭曉文字裡。她會先把分數傳給你，然後再把揭曉的截圖傳給你。',
      },
      points: [
        {
          en: 'One to thirty questions, two to six options each',
          zhHant: '一至三十條題目，每題兩至六個選項',
        },
        {
          en: 'A reveal message on every question',
          zhHant: '每一題都可以有揭曉文字',
        },
      ],
    },
  ],
  faq: [
    {
      q: {
        en: 'What if she opens it in front of me?',
        zhHant: '如果她當著我的面打開？',
      },
      a: {
        en: 'Good. That is a gift to be opened alone, and she will get the joke a beat before you do.',
        zhHant: '很好。這是一份要獨自打開的禮物，而且她會比你早半拍笑出來。',
      },
    },
    {
      q: {
        en: 'Is this only for couples?',
        zhHant: '這只適合情侶嗎？',
      },
      a: {
        en: 'No. The same three shapes work for a sister, a mother or a friend. Change the questions and it becomes a friendship quiz instead.',
        zhHant: '不是。同樣這三種形態，送給姊妹、媽媽或朋友都可以。換掉題目，它就變成一場友誼問答。',
      },
    },
    {
      q: {
        en: 'Is there a cheaper version?',
        zhHant: '有便宜一點的做法嗎？',
      },
      a: {
        en: 'There is no charge for making a gift. The only thing you spend is the evening you spend writing it.',
        zhHant: '製作禮物本身不收費。你唯一付出的，是寫它的那個晚上。',
      },
    },
  ],
  related: ['gift-ideas-for-him', 'anniversary', 'quiz'],
};
