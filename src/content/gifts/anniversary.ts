import type { GiftPage } from './types';

/**
 * /gifts/anniversary — the anniversary occasion page.
 *
 * The angle here is the one that is genuinely different from a birthday:
 * an anniversary is the occasion where the sender already holds all the
 * material — a decade of photographs and a shared history no shop has
 * access to. The copy leans on that rather than on the product.
 */
export const anniversary: GiftPage = {
  slug: 'anniversary',
  kind: 'occasion',
  metaTitle: {
    en: 'Anniversary gift ideas: what to do with the photographs',
    zhHant: '週年紀念禮物：那些相片可以怎麼用',
  },
  metaDescription: {
    en: 'An anniversary is the one occasion where you already have all the material. Turn a decade of photographs into a letter that unrolls, a quiz of a shared life, or a game you can replay.',
    zhHant: '週年紀念是唯一一個你早就握有全部素材的節日。把十年的相片，變成一封會捲開的信、一場關於共同生活的問答，或一個可以再玩一次的遊戲。',
  },
  heading: {
    en: 'Anniversary gift ideas',
    zhHant: '週年紀念禮物',
  },
  lede: {
    en: 'For an anniversary you have something no birthday gets: ten years of photographs, and a shared history no shop has access to. The gift does not have to be expensive. The gift is that it is unmistakably yours.',
    zhHant: '週年紀念的時候，你擁有生日永遠沒有的東西：十年的相片，以及一段任何店舖都接觸不到的共同歷史。這份禮物不必昂貴，它珍貴的地方在於：全天下只有你做得出來。',
  },
  sections: [
    {
      heading: {
        en: 'The year-by-year letter',
        zhHant: '一封逐年寫下去的信',
      },
      body: {
        en: 'An animated letter with one photograph for each year you have been together, and a line about what that year was actually like. It is a long, unglamorous job and it is the single most effective anniversary gift there is, because nobody else has the photographs.',
        zhHant: '一封動態信件，每一年放一張相片，再寫一句那年其實是怎樣過的。這是一份漫長而毫不光鮮的工作，但它是週年紀念禮物裡最有效的一種——因為那些相片，別人根本沒有。',
      },
      points: [
        {
          en: 'Photographs, voice notes, music and animations can all be dropped in',
          zhHant: '相片、語音訊息、音樂和動畫，都可以放進去',
        },
        {
          en: 'Choose the paper and the envelope colour once, and leave it',
          zhHant: '紙張和信封顏色選好就不用再管了',
        },
      ],
    },
    {
      heading: {
        en: 'The quiz of a shared decade',
        zhHant: '關於共同十年的問答',
      },
      body: {
        en: 'Ask the questions only the two of you can answer — which flat you lived in first, what you argued about on the drive back from the coast, which restaurant you went to twice because you could not agree on anything else. The wrong options do the work: they are funny in a way that only the two of you will ever find funny.',
        zhHant: '問只有你們兩個答得出來的問題——第一個住的地方是哪裡、從海岸開車回來那次在爭甚麼、那間你們去了兩次因為甚麼都談不攏的餐廳。錯的選項會替你完成大部分工作：它們的幽默，只有你們兩個才覺得好笑。',
      },
      points: [
        {
          en: 'One to thirty questions, two to six options each',
          zhHant: '一至三十條題目，每題兩至六個選項',
        },
        {
          en: 'A reveal message of up to 500 characters per question',
          zhHant: '每題可附最多 500 個字的揭曉文字',
        },
      ],
    },
    {
      heading: {
        en: 'The game you will still be playing',
        zhHant: '你到現在還在玩的遊戲',
      },
      body: {
        en: 'A memory card game built from the photographs you keep coming back to — the good ones, the disastrous ones, the ones with the dog in them. Because the deck reshuffles every time, it is a gift with a replay button: the tenth anniversary can be the same game with a new set of cards.',
        zhHant: '一個用你們老是回頭看的相片做的記憶卡遊戲——好看的、搞砸的、有那隻狗入鏡的。因為每次都會重新洗牌，這份禮物是附帶「再玩一次」按鈕的：第十個週年，可以用同一款遊戲換一批相片再送一次。',
      },
      points: [
        {
          en: 'Three to twelve pairs, reshuffled on every play',
          zhHant: '三至十二對，每次玩都重新洗牌',
        },
        {
          en: 'A caption of up to 120 characters on every card',
          zhHant: '每張卡最多 120 個字的說明文字',
        },
      ],
    },
  ],
  faq: [
    {
      q: {
        en: 'What if we do not have many photographs?',
        zhHant: '如果我們沒有很多相片？',
      },
      a: {
        en: 'Then use a quiz or a letter. Both work off what you remember rather than what you shot, and the quiz needs only a dozen questions to feel like a real test.',
        zhHant: '那就用問答或信件。兩者靠的是你們的記憶，而不是你們拍過甚麼；而問答只要十二條題目，就已經有模有樣。',
      },
    },
    {
      q: {
        en: 'Should it be a surprise?',
        zhHant: '應該是驚喜嗎？',
      },
      a: {
        en: 'Yes for the letter and the game, because the reveal is the gift. Not for the collage, which is nicer to scroll through together.',
        zhHant: '信件和遊戲應該是驚喜，因為揭曉本身就是禮物。拼貼則不一定是——一起慢慢看反而更好。',
      },
    },
    {
      q: {
        en: 'Can we send the same gift again next year?',
        zhHant: '明年可以再送同一份禮物嗎？',
      },
      a: {
        en: 'Yes. The formats do not expire, and a memory card game is deliberately replayable: same game, new photographs.',
        zhHant: '可以。這些格式不會到期，而記憶卡遊戲本來就是設計來重玩的：同一款遊戲，新的相片。',
      },
    },
  ],
  related: ['birthday-ideas', 'animated-letter', 'memory-cards'],
};
