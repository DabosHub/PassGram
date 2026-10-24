import type { Metadata } from "next";
import { SiteFrame } from "@/components/site/SiteFrame";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: "Privacy · PassGram" },
  description: "How PassGram uses a Telegram identity, a receiving wallet, and channel admin rights.",
  alternates: { canonical: `${SITE_URL}/privacy` },
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <SiteFrame>
      <article className="mx-auto max-w-3xl space-y-8 px-5 pb-14 pt-4">
        <header>
          <h1 className="text-[2.25rem] tracking-[-0.03em]">Privacy</h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--pg-hint)]">
            PassGram uses the information it needs to run a paid Telegram channel. It does not ask for a seed phrase or a private key.
          </p>
        </header>
        <section className="space-y-3">
          <h2 className="text-xl">Telegram identity</h2>
          <p className="text-sm leading-relaxed text-[var(--pg-hint)]">
            The Mini App receives your Telegram identity so the account, the subscription, and the channel invite belong to that person.
          </p>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl">Wallets</h2>
          <p className="text-sm leading-relaxed text-[var(--pg-hint)]">
            A creator’s wallet signs community registration. A subscriber’s wallet signs the USDT payment. A marketer confirms a receiving wallet with a free signature when creating a referral link. PassGram stores that receiving address so settlement can pay it. The signature stays on the wallet. PassGram does not receive the key.
          </p>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl">Channel content</h2>
          <p className="text-sm leading-relaxed text-[var(--pg-hint)]">
            PassGramBot is granted Invite users via link and Ban users. Those rights open and close access. The bot does not read channel posts and does not publish to the channel.
          </p>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl">On this device</h2>
          <p className="text-sm leading-relaxed text-[var(--pg-hint)]">
            Notification choices saved in the Mini App stay on that device.
          </p>
        </section>
      </article>
    </SiteFrame>
  );
}
