/* Account Domino Mapper - MIT (c) 2026 ipusiron. */
// 架空の3人のデータ。実在の人物・サービス・会社とは関係なく、パスワードの文字列は持たない（パスワードA・B・Cの記号だけ。
// family は図の内部の区別に使う名前で、画面には出さない）。
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DominoData = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return {
    schema: "account-domino-mapper/sample@1",
    personas: [
      {
        id: "worker",
        label: { ja: "会社員 ハルト（仮）", en: "Haruto, office worker (provisional)" },
        story: {
          ja: "多くのアカウントで、パスワードの再設定のメールがメインのメールに届く。パスワードAを5つのアカウントで使い回し、銀行はパスワードB、古いメールはパスワードC。",
          en: "Many accounts send their password reset emails to the main email. Password A is reused on five accounts; "
            + "the bank uses Password B and the old email Password C.",
        },
        credentials: [
          { id: "pw:red", type: "pw", family: "red", symbol: "A", label: { ja: "パスワードA", en: "Password A" } },
          { id: "pw:blue", type: "pw", family: "blue", symbol: "B", label: { ja: "パスワードB", en: "Password B" } },
          { id: "pw:gray", type: "pw", family: "gray", symbol: "C", label: { ja: "パスワードC", en: "Password C" } },
          { id: "device", type: "device", label: { ja: "スマホ（認証アプリ・パスキー）", en: "Phone (authenticator app, passkey)" } },
          { id: "phone", type: "phone", label: { ja: "電話番号（SMS）", en: "Phone number (SMS)" } },
          { id: "info", type: "info", label: { ja: "個人情報（電話の窓口で答える）", en: "Personal details (phone help desk)" } },
          {
            id: "idcheck",
            type: "idcheck",
            label: { ja: "書類での本人確認（身分証・郵送）", en: "Document check (photo ID, postal mail)" },
          },
        ],
        services: [
          {
            id: "mailMain",
            mail: true,
            important: true,
            offers: ["mfa", "paper"],
            label: { ja: "メインのメール", en: "Main email" },
            methods: [
              { id: "login", role: "login", requires: ["pw:red"], label: { ja: "パスワード", en: "Password" } },
              { id: "recSms", role: "recovery", requires: ["phone"], label: { ja: "SMSで再設定", en: "Reset by SMS" } },
              {
                id: "recMail",
                role: "recovery",
                requires: ["mailOld"],
                label: { ja: "予備のメールで再設定", en: "Reset via backup email" },
              },
            ],
          },
          {
            id: "mailOld",
            mail: true,
            offers: ["idcheck"],
            label: { ja: "古いメール（前のプロバイダー）", en: "Old email (former ISP)" },
            methods: [
              { id: "login", role: "login", requires: ["pw:gray"], label: { ja: "パスワード", en: "Password" } },
              {
                id: "recDesk",
                role: "recovery",
                requires: ["info"],
                label: { ja: "電話の窓口で再設定", en: "Reset via phone help desk" },
              },
            ],
          },
          {
            id: "points",
            offers: ["mfa"],
            label: { ja: "ポイントアプリ", en: "Points app" },
            methods: [
              { id: "login", role: "login", requires: ["pw:red"], label: { ja: "パスワード", en: "Password" } },
              {
                id: "recMail",
                role: "recovery",
                requires: ["mailMain"],
                label: { ja: "登録メールで再設定", en: "Reset via registered email" },
              },
            ],
          },
          {
            id: "shop",
            offers: ["mfa", "paper"],
            label: { ja: "通販（クレジットカード登録あり）", en: "Online shop (credit card saved)" },
            methods: [
              { id: "login", role: "login", requires: ["pw:red"], label: { ja: "パスワード", en: "Password" } },
              {
                id: "recMail",
                role: "recovery",
                requires: ["mailMain"],
                label: { ja: "登録メールで再設定", en: "Reset via registered email" },
              },
            ],
          },
          {
            id: "sns",
            offers: ["mfa", "paper"],
            label: { ja: "SNS", en: "Social media" },
            methods: [
              {
                id: "login",
                role: "login",
                requires: ["pw:red", "phone"],
                label: { ja: "パスワード＋SMSのコード", en: "Password + SMS code" },
              },
              {
                id: "recMail",
                role: "recovery",
                requires: ["mailMain"],
                label: { ja: "登録メールで再設定", en: "Reset via registered email" },
              },
            ],
          },
          {
            id: "flea",
            offers: ["mfa"],
            label: { ja: "フリマアプリ（売上金）", en: "Flea-market app (sales balance)" },
            methods: [
              { id: "login", role: "login", requires: ["phone"], label: { ja: "SMSのコードだけ", en: "SMS code only" } },
              {
                id: "recMail",
                role: "recovery",
                requires: ["mailMain"],
                label: { ja: "登録メールで再設定", en: "Reset via registered email" },
              },
            ],
          },
          {
            id: "cloud",
            offers: ["mfa", "paper"],
            label: { ja: "写真のクラウド", en: "Photo cloud" },
            methods: [
              {
                id: "login",
                role: "login",
                requires: ["pw:red", "device"],
                label: { ja: "パスワード＋認証アプリ", en: "Password + authenticator app" },
              },
              {
                id: "recMail",
                role: "recovery",
                requires: ["mailMain"],
                label: { ja: "登録メールで再設定", en: "Reset via registered email" },
              },
            ],
          },
          {
            id: "bank",
            important: true,
            offers: ["mfa", "paper", "idcheck"],
            label: { ja: "ネット銀行", en: "Online bank" },
            methods: [
              {
                id: "login",
                role: "login",
                requires: ["pw:blue", "device"],
                label: { ja: "パスワード＋認証アプリ", en: "Password + authenticator app" },
              },
              {
                id: "recSmsDesk",
                role: "recovery",
                requires: ["phone", "info"],
                label: { ja: "SMS＋個人情報で再設定", en: "Reset by SMS + personal details" },
              },
            ],
          },
          {
            id: "sec",
            important: true,
            offers: ["paper", "idcheck"],
            label: { ja: "ネット証券", en: "Online brokerage" },
            methods: [
              { id: "login", role: "login", requires: ["device"], label: { ja: "パスキー", en: "Passkey" } },
              {
                id: "recMailSms",
                role: "recovery",
                requires: ["mailMain", "phone"],
                label: { ja: "メール＋SMSでパスキーを再登録", en: "Re-register passkey by email + SMS" },
              },
            ],
          },
        ],
        cards: [
          {
            id: "leak",
            leaks: "points",
            label: { ja: "ポイントアプリの漏えい（IDとパスワードが漏れた）", en: "Points-app breach (ID and password leaked)" },
          },
          { id: "simswap", gives: ["phone"], label: { ja: "SIMスワップ（電話番号を乗っ取られた）", en: "SIM swap (phone number hijacked)" } },
          { id: "mail", gives: ["mailOld"], label: { ja: "古いメールの乗っ取り", en: "Old email taken over" } },
          {
            id: "desk",
            gives: ["info"],
            label: {
              ja: "ソーシャルエンジニアリング（漏れた個人情報を使い、電話の窓口で本人になりすます）",
              en: "Social engineering (posing as the owner at a phone help desk with leaked personal details)",
            },
          },
        ],
        losses: [
          { id: "device", lost: ["device"], label: { ja: "スマホをなくした", en: "Lost the phone" } },
          { id: "number", lost: ["phone"], label: { ja: "電話番号を手放した", en: "Gave up the phone number" } },
          {
            id: "mail",
            lost: ["mailOld"],
            label: { ja: "古いメールが消えた（プロバイダーの解約）", en: "Old email gone (ISP canceled)" },
          },
          {
            id: "paper",
            lostTypes: ["paper"],
            optional: true,
            label: { ja: "紙の回復コードをなくした", en: "Lost the paper recovery codes" },
          },
        ],
      },
      {
        id: "parent",
        label: { ja: "高齢の親 シズエ（仮）", en: "Shizue, older parent (provisional)" },
        story: {
          ja: "パスワードを使うアカウントは、すべて同じパスワードA。銀行は、ログインのワンタイムパスワードも再設定もSMSで、電話番号1本に頼っている。",
          en: "Every account that uses a password uses the same Password A. The bank relies on one phone number for both its SMS "
            + "one-time password at log-in and its SMS reset.",
        },
        credentials: [
          {
            id: "pw:yellow",
            type: "pw",
            family: "yellow",
            symbol: "A",
            label: { ja: "パスワードA", en: "Password A" },
          },
          { id: "device", type: "device", label: { ja: "スマホ（認証アプリ・パスキー）", en: "Phone (authenticator app, passkey)" } },
          { id: "phone", type: "phone", label: { ja: "電話番号（SMS）", en: "Phone number (SMS)" } },
          { id: "info", type: "info", label: { ja: "個人情報（電話の窓口で答える）", en: "Personal details (phone help desk)" } },
          {
            id: "idcheck",
            type: "idcheck",
            label: { ja: "書類での本人確認（身分証・郵送）", en: "Document check (photo ID, postal mail)" },
          },
        ],
        services: [
          {
            id: "mailIsp",
            mail: true,
            important: true,
            offers: ["idcheck"],
            label: { ja: "プロバイダーのメール", en: "ISP email" },
            methods: [
              { id: "login", role: "login", requires: ["pw:yellow"], label: { ja: "パスワード", en: "Password" } },
              {
                id: "recDesk",
                role: "recovery",
                requires: ["info"],
                label: { ja: "電話の窓口で再設定", en: "Reset via phone help desk" },
              },
            ],
          },
          {
            id: "bank",
            important: true,
            offers: ["mfa", "idcheck"],
            label: { ja: "銀行のネットバンキング", en: "Online banking" },
            methods: [
              {
                id: "login",
                role: "login",
                requires: ["pw:yellow", "phone"],
                label: { ja: "パスワード＋SMSのワンタイムパスワード", en: "Password + SMS one-time password" },
              },
              { id: "recSms", role: "recovery", requires: ["phone"], label: { ja: "SMSで再設定", en: "Reset by SMS" } },
            ],
          },
          {
            id: "points",
            offers: [],
            label: { ja: "ポイントアプリ", en: "Points app" },
            methods: [
              { id: "login", role: "login", requires: ["pw:yellow"], label: { ja: "パスワード", en: "Password" } },
              {
                id: "recMail",
                role: "recovery",
                requires: ["mailIsp"],
                label: { ja: "登録メールで再設定", en: "Reset via registered email" },
              },
            ],
          },
          {
            id: "shop",
            offers: ["mfa", "paper"],
            label: { ja: "通販", en: "Online shop" },
            methods: [
              { id: "login", role: "login", requires: ["pw:yellow"], label: { ja: "パスワード", en: "Password" } },
              {
                id: "recMail",
                role: "recovery",
                requires: ["mailIsp"],
                label: { ja: "登録メールで再設定", en: "Reset via registered email" },
              },
            ],
          },
          {
            id: "msg",
            offers: [],
            label: { ja: "メッセージアプリ（家族との連絡）", en: "Messaging app (family chats)" },
            methods: [
              { id: "login", role: "login", requires: ["device"], label: { ja: "いつものスマホ", en: "The usual phone" } },
              {
                id: "recMove",
                role: "recovery",
                requires: ["phone", "pw:yellow"],
                label: { ja: "SMS＋パスワードで新しいスマホへ引き継ぎ", en: "Move to a new phone by SMS + password" },
              },
            ],
          },
          {
            id: "photo",
            offers: ["mfa", "paper"],
            label: { ja: "写真のクラウド", en: "Photo cloud" },
            methods: [
              { id: "login", role: "login", requires: ["pw:yellow"], label: { ja: "パスワード", en: "Password" } },
              {
                id: "recMail",
                role: "recovery",
                requires: ["mailIsp"],
                label: { ja: "登録メールで再設定", en: "Reset via registered email" },
              },
            ],
          },
          {
            id: "sec",
            important: true,
            offers: ["paper", "idcheck"],
            label: { ja: "ネット証券（NISA）", en: "Online brokerage (NISA)" },
            methods: [
              { id: "login", role: "login", requires: ["device"], label: { ja: "パスキー", en: "Passkey" } },
              {
                id: "recMailSms",
                role: "recovery",
                requires: ["mailIsp", "phone"],
                label: { ja: "メール＋SMSでパスキーを再登録", en: "Re-register passkey by email + SMS" },
              },
            ],
          },
        ],
        cards: [
          {
            id: "leak",
            leaks: "points",
            label: { ja: "ポイントアプリの漏えい（IDとパスワードが漏れた）", en: "Points-app breach (ID and password leaked)" },
          },
          { id: "simswap", gives: ["phone"], label: { ja: "SIMスワップ（電話番号を乗っ取られた）", en: "SIM swap (phone number hijacked)" } },
          { id: "mail", gives: ["mailIsp"], label: { ja: "プロバイダーのメールの乗っ取り", en: "ISP email taken over" } },
          {
            id: "desk",
            gives: ["info"],
            label: {
              ja: "ソーシャルエンジニアリング（漏れた個人情報を使い、電話の窓口で本人になりすます）",
              en: "Social engineering (posing as the owner at a phone help desk with leaked personal details)",
            },
          },
        ],
        losses: [
          { id: "device", lost: ["device"], label: { ja: "スマホをなくした", en: "Lost the phone" } },
          { id: "number", lost: ["phone"], label: { ja: "電話番号を手放した", en: "Gave up the phone number" } },
          { id: "mail", lost: ["mailIsp"], label: { ja: "プロバイダーを替えてメールが消えた", en: "Changed ISP, email gone" } },
          {
            id: "paper",
            lostTypes: ["paper"],
            optional: true,
            label: { ja: "紙の回復コードをなくした", en: "Lost the paper recovery codes" },
          },
        ],
      },
      {
        id: "student",
        label: { ja: "学生 ミオ（仮）", en: "Mio, student (provisional)" },
        story: {
          ja: "大学のメールを、ほかのアカウントの予備のメールや登録先に使っている。大学のメールは卒業すると消える。パスワードAを、フリーメール・SNS・ゲームで使い回している。",
          en: "The university email serves as the backup and sign-up address of other accounts, and disappears at graduation. "
            + "Password A is reused on the free email, social media and a game.",
        },
        credentials: [
          {
            id: "pw:green",
            type: "pw",
            family: "green",
            symbol: "A",
            label: { ja: "パスワードA", en: "Password A" },
          },
          {
            id: "pw:purple",
            type: "pw",
            family: "purple",
            symbol: "B",
            label: { ja: "パスワードB（大学）", en: "Password B (university)" },
          },
          { id: "device", type: "device", label: { ja: "スマホ（認証アプリ・パスキー）", en: "Phone (authenticator app, passkey)" } },
          { id: "phone", type: "phone", label: { ja: "電話番号（SMS）", en: "Phone number (SMS)" } },
          { id: "info", type: "info", label: { ja: "個人情報（電話の窓口で答える）", en: "Personal details (phone help desk)" } },
          {
            id: "idcheck",
            type: "idcheck",
            label: { ja: "書類での本人確認（学生証・身分証）", en: "Document check (student card, photo ID)" },
          },
        ],
        services: [
          {
            id: "mailUni",
            mail: true,
            offers: ["idcheck"],
            label: { ja: "大学のメール", en: "University email" },
            methods: [
              {
                id: "login",
                role: "login",
                requires: ["pw:purple", "device"],
                label: { ja: "パスワード＋認証アプリ", en: "Password + authenticator app" },
              },
              {
                id: "recDesk",
                role: "recovery",
                requires: ["idcheck"],
                label: { ja: "学生証を大学の窓口へ", en: "Student card at the university office" },
              },
            ],
          },
          {
            id: "mailFree",
            mail: true,
            important: true,
            offers: ["mfa", "paper"],
            label: { ja: "フリーメール", en: "Free email" },
            methods: [
              { id: "login", role: "login", requires: ["pw:green"], label: { ja: "パスワード", en: "Password" } },
              {
                id: "recMail",
                role: "recovery",
                requires: ["mailUni"],
                label: { ja: "予備のメール（大学）で再設定", en: "Reset via backup email (university)" },
              },
              { id: "recSms", role: "recovery", requires: ["phone"], label: { ja: "SMSで再設定", en: "Reset by SMS" } },
            ],
          },
          {
            id: "sns",
            important: true,
            offers: ["mfa", "paper"],
            label: { ja: "SNS", en: "Social media" },
            methods: [
              { id: "login", role: "login", requires: ["pw:green"], label: { ja: "パスワード", en: "Password" } },
              {
                id: "recMail",
                role: "recovery",
                requires: ["mailUni"],
                label: { ja: "登録メール（大学）で再設定", en: "Reset via registered email (university)" },
              },
            ],
          },
          {
            id: "game",
            offers: ["mfa"],
            label: { ja: "ゲーム（課金・アイテム）", en: "Game (purchases, items)" },
            methods: [
              { id: "login", role: "login", requires: ["pw:green"], label: { ja: "パスワード", en: "Password" } },
              {
                id: "recMail",
                role: "recovery",
                requires: ["mailFree"],
                label: { ja: "登録メールで再設定", en: "Reset via registered email" },
              },
            ],
          },
          {
            id: "flea",
            offers: ["mfa"],
            label: { ja: "フリマアプリ", en: "Flea-market app" },
            methods: [
              { id: "login", role: "login", requires: ["phone"], label: { ja: "SMSのコードだけ", en: "SMS code only" } },
              {
                id: "recMail",
                role: "recovery",
                requires: ["mailFree"],
                label: { ja: "登録メールで再設定", en: "Reset via registered email" },
              },
            ],
          },
          {
            id: "sub",
            offers: ["paper"],
            label: { ja: "動画のサブスク（学割）", en: "Video subscription (student plan)" },
            methods: [
              {
                id: "login",
                role: "login",
                requires: ["mailUni"],
                label: { ja: "大学のメールに届くコード", en: "Code sent to the university email" },
              },
            ],
          },
          {
            id: "sec",
            important: true,
            offers: ["paper", "idcheck"],
            label: { ja: "ネット証券（つみたて）", en: "Online brokerage (monthly investing)" },
            methods: [
              { id: "login", role: "login", requires: ["device"], label: { ja: "パスキー", en: "Passkey" } },
              {
                id: "recMail",
                role: "recovery",
                requires: ["mailFree"],
                label: { ja: "登録メールでパスキーを再登録", en: "Re-register passkey via registered email" },
              },
            ],
          },
        ],
        cards: [
          {
            id: "leak",
            leaks: "game",
            label: { ja: "ゲームの漏えい（IDとパスワードが漏れた）", en: "Game breach (ID and password leaked)" },
          },
          { id: "simswap", gives: ["phone"], label: { ja: "SIMスワップ（電話番号を乗っ取られた）", en: "SIM swap (phone number hijacked)" } },
          { id: "mail", gives: ["mailUni"], label: { ja: "大学のメールの乗っ取り", en: "University email taken over" } },
          {
            id: "desk",
            gives: ["info"],
            label: {
              ja: "ソーシャルエンジニアリング（漏れた個人情報を使い、電話の窓口で本人になりすます）",
              en: "Social engineering (posing as the owner at a phone help desk with leaked personal details)",
            },
          },
        ],
        losses: [
          { id: "device", lost: ["device"], label: { ja: "スマホをなくした", en: "Lost the phone" } },
          { id: "number", lost: ["phone"], label: { ja: "電話番号を手放した", en: "Gave up the phone number" } },
          { id: "mail", lost: ["mailUni"], label: { ja: "卒業で大学のメールが消えた", en: "Graduated, university email gone" } },
          {
            id: "paper",
            lostTypes: ["paper"],
            optional: true,
            label: { ja: "紙の回復コードをなくした", en: "Lost the paper recovery codes" },
          },
        ],
      },
    ],
  };
}));
