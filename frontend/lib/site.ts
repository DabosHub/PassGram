import { formatMiniAppHomeLink } from "./domain";

export const SITE_URL = "https://passgram.io";
export const BOT_URL = "https://t.me/PassGramBot";
export const MINI_APP_URL = formatMiniAppHomeLink();
export const BOT_HANDLE = "@PassGramBot";
export const GITHUB_URL = "https://github.com/DabosHub/PassGram";
export const REGISTRY_ADDRESS = "EQBkUvELQJXV8iiAkSduh7M3IC1x5FxhrLc1WK_9LHgyHDI2";

export function registryAddress(): string {
  return (process.env.NEXT_PUBLIC_PASSGRAM_REGISTRY || REGISTRY_ADDRESS).trim() || REGISTRY_ADDRESS;
}

export function registryUrl(address = registryAddress()): string {
  return `https://tonviewer.com/${address}`;
}

export const SITE_FAQS = [
  {
    question: "What does PassGram do?",
    answer:
      "PassGram is a Telegram Mini App for paid channels. A creator sets a price in USDT and a duration in days. A subscriber pays that price on TON. After the payment is confirmed, PassGramBot opens access. When the paid period ends, the bot removes it.",
  },
  {
    question: "Where does the app open?",
    answer:
      "The app opens inside Telegram, through @PassGramBot. This website explains the product. It does not run the Mini App.",
  },
  {
    question: "What does a subscriber pay?",
    answer:
      "The price the creator lists, in USDT on TON. PassGram does not add a markup. A price is from 1 to 1,000,000 USDT, and a duration is from 1 to 366 days. A wallet action can also require a network fee on TON. That fee is separate from the USDT price.",
  },
  {
    question: "Does PassGram hold the payment?",
    answer:
      "No. A confirmed payment is settled by the on-chain registry. The creator's share goes to the wallet that registered the community. PassGram keeps 2.5%. The bot never receives the USDT, and PassGram never asks for a seed phrase or a private key.",
  },
  {
    question: "What can the bot do in a channel?",
    answer:
      "Before a community can be created, the bot must be an admin with only two rights: Invite users via link, and Ban users. It uses those rights to open and close access. It does not read channel posts, and it does not publish to the channel.",
  },
  {
    question: "When does access start?",
    answer:
      "Access is prepared after the payment is confirmed. Sending the transaction from a wallet is not confirmation. A payment below the listed price is returned and opens no access. A payment above the listed price is settled at the listed price, and the extra is returned. A payment to a deactivated community is returned.",
  },
  {
    question: "What is the platform fee?",
    answer:
      "PassGram keeps 2.5% of each confirmed payment. The creator's share starts at the remaining 97.5%. If the creator turns on a community referral, that marketer is paid from the creator's share. The subscriber price stays the same.",
  },
  {
    question: "Can I review the code and the contract?",
    answer:
      "Yes. The Mini App, the bot service, and the Tolk registry are public on GitHub. The live registry address is published, and you can open it on Tonviewer. PassGram is alpha software: the source is public, and an independent audit has not been completed.",
  },
] as const;
