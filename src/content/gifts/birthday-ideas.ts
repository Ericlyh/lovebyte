import type { GiftPage } from './types';

/**
 * /gifts/birthday-ideas — the birthday occasion page.
 *
 * This page sells no format of its own. It picks between the formats
 * already documented, so its copy has to be about CHOOSING rather than
 * about a product, and it links to the format pages it recommends.
 */
export const birthdayIdeas: GiftPage = {
  slug: 'birthday-ideas',
  kind: 'occasion',
  metaTitle: {
    en: 'Birthday gift ideas that are not another thing in a box',
    zhHant: '不又是盒裡一件東西的生日禮物',
  },
  metaDescription: {
    en: 'Six gift formats, each built out of your own photographs and voice. How to pick a birthday gift that gets opened twice — once for the surprise, once for the photos.',
    zhHant: '六種禮物格式，每一種都由你自己的相片和聲音組成。教你選一份會被打開兩次的生日禮物——一次是驚喜，一次是那些相片。',
  },
  heading: {
    en: 'Birthday gift ideas',
    zhHant: '生日禮物',
  },
  lede: {
    en: 'The problem with a birthday gift is usually that it is about the object. This one is about the person: a game, a letter, a quiz made of the two of you, assembled in about twenty minutes and opened on their phone.',
    zhHant: '生日禮物的問題，通常在於它講的是「物」。這一份講的是「人」：一個遊戲、一封信、一場由你們兩個組成的問答，大約二十分鐘就能做好，用他們的手機打開。',
  },
  sections: [
    {
      heading: {
        en: 'If they are sentimental',
        zhHant: '如果對方是感性型的',
      },
      body: {
        en: 'Start with the photographs. A memory card game and an animated letter do the same job — they put your shared history in their hands — but in different shapes. The game is playful and takes twenty minutes of their attention. The letter is quiet and takes about half an hour of yours to write.',
        zhHant: '從相片開始。記憶卡遊戲和動態信件做的是同一件事——把你們共有的過去放到他們手上——但形態不同。遊戲是頑皮的，佔用的是他們二十分鐘的注意力；信件是安靜的，佔用的是你大約半小時的書寫時間。',
      },
      points: [
        {
          en: 'Memory card game: three to twelve pairs of your own photographs',
          zhHant: '記憶卡遊戲：三至十二對你自己的相片',
        },
        {
          en: 'Animated letter: your words, with voice notes dropped in',
          zhHant: '動態信件：你的文字，隨處放進語音訊息',
        },
      ],
    },
    {
      heading: {
        en: 'If they are competitive',
        zhHant: '如果他好勝',
      },
      body: {
        en: 'A quiz. Write questions with one right answer and make the wrong options mean something to the two of you. There is a version of this that takes him ten minutes and a version that takes the whole evening, and the second one is the one he will still be talking about a week later.',
        zhHant: '一場問答。每一題只有一個正確答案，而錯的選項要讓你們兩個都有感覺。這個玩法有十分鐘版，也有用上一整晚的版本，而一星期後他還在講的，一定是後者。',
      },
      points: [
        {
          en: 'One to thirty questions, two to six options each',
          zhHant: '一至三十條題目，每題兩至六個選項',
        },
        {
          en: 'A reveal message that only appears once he answers right',
          zhHant: '一句只有答對時才出現的揭曉文字',
        },
      ],
    },
    {
      heading: {
        en: 'If you genuinely do not know what they would like',
        zhHant: '如果你真的不知道他會喜歡甚麼',
      },
      body: {
        en: 'Then build a collage: photographs, a short video, a song, with your captions underneath. It works because it does not need them to have any particular interest — it only needs you to have spent some time with them. Up to twenty pieces of media in one gift, and a caption of up to 200 characters on each.',
        zhHant: '那就做一個拼貼：相片、一段短片、一首歌，下面加上你的說明。它之所以成立，是因為它不需要對方有甚麼特別興趣，只需要你跟他相處過一段時間。一份禮物最多可以放二十件媒體，每件可以配一段最多 200 個字的說明。',
      },
      points: [
        {
          en: 'Photos up to 5 MB, video up to 50 MB, audio up to 25 MB',
          zhHant: '相片最大 5 MB、影片最大 50 MB、聲音最大 25 MB',
        },
        {
          en: 'Three layouts: polaroid wall, timeline and magazine',
          zhHant: '三種版式：拍立得牆、時間線和雜誌',
        },
      ],
    },
  ],
  faq: [
    {
      q: {
        en: 'How far ahead should I send it?',
        zhHant: '要提前多久送？',
      },
      a: {
        en: 'For a birthday, the morning of. The point is the opening, and the opening is better when it is a surprise.',
        zhHant: '生日的話，當天早上就好。重點在打開的那一刻，而那一刻做成驚喜會好得多。',
      },
    },
    {
      q: {
        en: 'Can I send it on the day?',
        zhHant: '可以當天才做嗎？',
      },
      a: {
        en: 'Yes. Building one takes about twenty minutes; sending it takes a link.',
        zhHant: '可以。做一份大約要二十分鐘；送出就只是一個連結。',
      },
    },
    {
      q: {
        en: 'What if they are not on social media?',
        zhHant: '如果他們不上社交媒體？',
      },
      a: {
        en: 'None of this needs an account on their side. It all opens in a browser from the link you send.',
        zhHant: '這些都不需要對方有帳戶，全部都從你送的連結用瀏覽器打開。',
      },
    },
  ],
  related: ['anniversary', 'gift-ideas-for-her', 'gift-ideas-for-him'],
};
