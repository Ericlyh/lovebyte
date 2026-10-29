import type { GiftPage } from './types';

/**
 * /gifts/animated-letter — the animated letter format.
 *
 * The paper and envelope options are the schema's enums
 * (`AnimatedLetterPayloadSchema`): paper is cream / kraft / lined,
 * envelope colour is honey / blush / sky, and the inline media can be a
 * photo, a voice note, music or an animation.
 */
export const animatedLetter: GiftPage = {
  slug: 'animated-letter',
  kind: 'format',
  metaTitle: {
    en: 'An animated letter that opens like an envelope',
    zhHant: '一封像信封一樣打開的動態信件',
  },
  metaDescription: {
    en: 'Write it in plain text, drop in photographs and voice notes, and send it as a link. It unrolls as they read, on the paper and envelope colour you chose.',
    zhHant: '用純文字寫，隨意加入相片和語音訊息，再以連結送出。它會一邊捲開一邊被閱讀，用你選的紙張和信封顏色。',
  },
  heading: {
    en: 'Animated letters',
    zhHant: '動態信件',
  },
  lede: {
    en: 'Some messages are too long for a card and too personal for a text. This one is a letter: you write it, you set it on paper, and when they open the link it unrolls in front of them with your photographs and your voice dropped in where they belong.',
    zhHant: '有些話太長，寫不落一張卡片；又太私人，不適合用短訊。這是一封信：你寫出來，擺在紙上；當他們打開連結，信會在他們眼前一路捲開，你的相片和聲音就放在它們該在的位置。',
  },
  sections: [
    {
      heading: {
        en: 'Write it like a letter',
        zhHant: '當作一封信去寫',
      },
      body: {
        en: 'Plain text, paragraphs, the punctuation you actually use. It is a letter, not a form. If you find yourself typing "Dear…" you are on the right track; if you find yourself typing "Hi," you are writing a text and should send a text. The letter does not need a subject line, because you two already know what it is about.',
        zhHant: '純文字、段落、你自己真正會用的標點。這是一封信，不是一份表格。當你打出「親愛的」，方向就對了；如果你打出的是「Hi,」，那你寫的是短訊，就該用短訊送。信不需要標題，因為你們兩個都知道它是關於甚麼的。',
      },
      points: [
        {
          en: 'No subject line, no signature block — it is a letter, not an email',
          zhHant: '沒有主旨，也沒有署名欄——這是一封信，不是一封電郵',
        },
        {
          en: 'It opens in any browser; there is no app and no account',
          zhHant: '任何瀏覽器都能打開，不用 App，也不用帳戶',
        },
      ],
    },
    {
      heading: {
        en: 'Drop the media in as you write',
        zhHant: '寫的時候，把媒體放進去',
      },
      body: {
        en: 'A photograph, a voice note, a song, an animation — placed inline, where the sentence that mentions it sits. The letter scrolls and the media opens where you put it. Voice notes are the ones that land: twenty seconds of your actual voice in the middle of a sentence about your week.',
        zhHant: '一張相片、一段語音、一首歌、一段動畫——就地放在提到它的那句話中間。信件一路捲開，媒體就在你放下的位置打開。最有力的是語音：一星期裡某句話的中間，忽然是你本人二十秒的聲音。',
      },
      points: [
        {
          en: 'Photographs, voice notes, music and animations, inline',
          zhHant: '相片、語音訊息、音樂和動畫，都能放在正文裡',
        },
        {
          en: 'Three papers: cream, kraft and lined',
          zhHant: '三種紙張：米白、牛紙和橫線',
        },
        {
          en: 'Three envelope colours: honey, blush and sky',
          zhHant: '三種信封顏色：蜜色、腮紅色和天空藍',
        },
      ],
    },
    {
      heading: {
        en: 'The envelope',
        zhHant: '那個信封',
      },
      body: {
        en: 'Before the letter scrolls, there is an envelope: a colour, and a wax seal that breaks when they click it. It is a small piece of theatre, and it is the difference between a document and a gift. Pick the envelope colour before you write, not after — it decides the mood of the whole thing, and cream with kraft and blush with sky do not say the same thing.',
        zhHant: '在信件捲開之前，先有一個信封：一種顏色，和一個點一下就會裂開的蠟封。這是一小段戲劇性演出，也是「一份文件」和「一件禮物」之間的差別。信封顏色請在動筆之前選，不要寫完才改——它決定了整封信的氣氛，而米白配牛紙、腮紅配天空藍，說的並不是同一件事。',
      },
    },
  ],
  faq: [
    {
      q: {
        en: 'Do I need to design anything?',
        zhHant: '需要自己設計嗎？',
      },
      a: {
        en: 'No. The paper, the envelope and the seal are already made for you. You write; that is the whole job.',
        zhHant: '不用。紙張、信封和蠟封都已經幫你準備好。你的工作就是寫，僅此而已。',
      },
    },
    {
      q: {
        en: 'Can I put my own voice in it?',
        zhHant: '可以放自己的聲音嗎？',
      },
      a: {
        en: 'Yes. Upload a voice note and it plays inline, in the place you put it.',
        zhHant: '可以。上傳一段語音訊息，它就會在你放下的位置就地播放。',
      },
    },
    {
      q: {
        en: 'How long should the letter be?',
        zhHant: '信要寫多長？',
      },
      a: {
        en: 'As long as it wants to be. Long letters are the entire reason this format exists.',
        zhHant: '想寫多長就多長。之所以有這種格式，就是為了那些長信。',
      },
    },
  ],
  related: ['anniversary', 'birthday-ideas', 'quiz'],
};
