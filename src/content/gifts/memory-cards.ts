import type { GiftPage } from './types';

/**
 * /gifts/memory-cards — the memory card format.
 *
 * The numbers in this copy are the schema's, not marketing's: three to
 * twelve pairs (`MemoryCardsPayloadSchema`), a caption of up to 120
 * characters, photographs up to 5 MB (`MAX_PHOTO_BYTES` in
 * src/app/api/upload/media/route.ts). Copy that overstates the product
 * is a refund waiting to happen.
 */
export const memoryCards: GiftPage = {
  slug: 'memory-cards',
  kind: 'format',
  metaTitle: {
    en: 'Memory card games made from your own photos',
    zhHant: '用你自己的照片做的記憶卡遊戲',
  },
  metaDescription: {
    en: 'Turn your photos into a matching game they play on their phone. Three to twelve pairs, a line of your own text on every card, and nothing to install.',
    zhHant: '把你的照片變成他們在手機上玩的配對遊戲。三至十二對，每張卡都有一句你自己寫的話，不用安裝任何東西。',
  },
  heading: {
    en: 'Memory card games',
    zhHant: '記憶卡遊戲',
  },
  lede: {
    en: 'You pick the photographs. We shuffle them into pairs. They flip two cards at a time, and every match is a memory they can actually look at — the barbecue where the smoke alarm went off, the holiday nobody wanted to leave. The game is the excuse. The photographs are the gift.',
    zhHant: '照片由你來選，我們把它洗成對。他們每次翻兩張，而每一對都真的是一段可以回看的記憶——煙霧報警器響了的燒烤、那個誰也不想離開的假期。遊戲只是藉口，照片才是禮物。',
  },
  sections: [
    {
      heading: {
        en: 'Why a game and not an album',
        zhHant: '為甚麼是遊戲而不是相簿',
      },
      body: {
        en: 'A photo album asks someone to scroll. A memory card game asks someone to sit down and play, and that is the difference between someone looking at your pictures and someone being given something. The pairs are shuffled every time, so the picture of the cat only means something at the moment they find it — and they will find it, because they have to.',
        zhHant: '相簿要求人一路滑下去，記憶卡遊戲要求人坐下來玩。兩者的分別，是「看看你的照片」和「收到一件禮物」的分別。每一對都會重新洗牌，所以那隻貓的照片，要等他們翻到那一刻才有意義——而他們一定會翻到，因為非翻到不可。',
      },
      points: [
        {
          en: 'Three to twelve pairs — a full deck is six to twenty-four cards',
          zhHant: '三至十二對——一整副牌是六至二十四張',
        },
        {
          en: 'Up to 120 characters of your own text on every card',
          zhHant: '每張卡最多可以寫 120 個字',
        },
        {
          en: 'Optional background music that starts on their first flip',
          zhHant: '可以加背景音樂，在他們第一次翻牌時開始播放',
        },
      ],
    },
    {
      heading: {
        en: 'How to build one',
        zhHant: '怎樣做一個',
      },
      body: {
        en: 'You do not need a plan. Open the builder, drop in the photos you already have on your phone, and write one line for each — where it was, who was there, what you were arguing about. Photos of nothing in particular work better than the good ones, because the good ones are obvious and the ordinary ones are the joke.',
        zhHant: '你不需要計劃。打開編輯器，把手機裡現有的照片丟進去，每張寫一句話——那是哪裡、還有誰、當時你們在吵甚麼。平平無奇的照片其實比精選照片更好用：精選的照片一目了然，無聊的日常照片才是笑點。',
      },
      points: [
        {
          en: 'Any photograph up to 5 MB',
          zhHant: '任何一張相片，上限 5 MB',
        },
        {
          en: 'The order you add them in is the order they are dealt in',
          zhHant: '你加入的次序，就是發牌的次序',
        },
        {
          en: 'Your gift arrives as a link — no app, no account on their side',
          zhHant: '禮物以連結送出去——不用 App，對方也不用註冊帳戶',
        },
      ],
    },
    {
      heading: {
        en: 'What happens on the other side',
        zhHant: '另一端會發生甚麼',
      },
      body: {
        en: 'They open the link and the deck is already dealt. Two cards face down, a timer in the corner, and a card back you can change to something that means something to the two of you. When the last pair lands, that is the whole gift — a few minutes of play, and a dozen photographs they would otherwise have had to scroll for.',
        zhHant: '他們打開連結，牌已經發好了。兩張牌背面朝上，角落有計時器，而牌背可以換成只有你們兩個才懂的圖案。最後一對翻開的時候，整份禮物就完成了——幾分鐘的遊戲，加上十幾張本來要慢慢滑才看得完的照片。',
      },
    },
  ],
  faq: [
    {
      q: {
        en: 'How many photos do I need?',
        zhHant: '需要多少張照片？',
      },
      a: {
        en: 'Three pairs is the minimum and twelve is the maximum. Below six the deck runs out before anyone gets into it; above twelve the grid stops fitting comfortably on a phone. Six to eight pairs is the sweet spot for most people.',
        zhHant: '最少三對，最多十二對。少於六對，牌很快就發完了，遊戲還沒熱起來；多於十二對，棋盤在手機上就放得不太舒服。大部分人最適合的是六至八對。',
      },
    },
    {
      q: {
        en: 'Do they need to install anything?',
        zhHant: '需要安裝任何東西嗎？',
      },
      a: {
        en: 'No. The game opens in a browser from a link you send them. There is no app, no account, and nothing for them to sign up for.',
        zhHant: '不用。遊戲從你傳給他的連結直接用瀏覽器打開，沒有 App、沒有帳戶，也不用他註冊任何東西。',
      },
    },
    {
      q: {
        en: 'What if two of my photos look the same?',
        zhHant: '如果我有兩張照片看起來很像？',
      },
      a: {
        en: 'That is exactly what the caption is for. Each pair is two cards showing the same photograph, and only your line of text tells them apart.',
        zhHant: '這正是那句說明文字的用途。每一對是兩張顯示同一張照片的卡，只有你寫的那句話能分辨它們。',
      },
    },
  ],
  related: ['quiz', 'anniversary', 'birthday-ideas'],
};
