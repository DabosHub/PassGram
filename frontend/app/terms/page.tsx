import type { Metadata } from "next";
import { SiteFrame } from "@/components/site/SiteFrame";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: "Terms of use · PassGram" },
  description: "The rules for PassGram payments, access, fees, and creator responsibility.",
  alternates: { canonical: `${SITE_URL}/terms` },
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <SiteFrame>
      <article className="mx-auto max-w-3xl space-y-8 px-5 pb-14 pt-4">
        <header>
          <h1 className="text-[2.25rem] tracking-[-0.03em]">Terms of use</h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--pg-hint)]">
            PassGram is alpha software. The source is public, and an independent audit has not been completed.
          </p>
        </header>
        <section className="space-y-3">
          <h2 className="text-xl">Payments</h2>
          <p className="text-sm leading-relaxed text-[var(--pg-hint)]">
            A subscriber pays the listed price in USDT on TON. PassGram does not add a markup. A price is from 1 to 1,000,000 USDT. A duration is a whole number of days from 1 to 366. A subscription becomes active only after the payment is confirmed. Sending the transaction from a wallet leaves payment and access unconfirmed.
          </p>
          <p className="text-sm leading-relaxed text-[var(--pg-hint)]">
            A payment below the listed price is returned and opens no access. A payment above the listed price is settled at that price, and the extra is returned. A payment to a deactivated community is returned. A wallet action can require a network fee on TON, separate from the USDT price.
          </p>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl">Fees and wallets</h2>
          <p className="text-sm leading-relaxed text-[var(--pg-hint)]">
            PassGram keeps 2.5% of each confirmed payment. The creator’s share starts at 97.5% and is paid to the wallet that registered the community. A community referral, when one applies, is paid from that creator share. The subscriber price does not change.
          </p>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl">Access</h2>
          <p className="text-sm leading-relaxed text-[var(--pg-hint)]">
            PassGramBot opens channel access after a USDT payment is confirmed and removes it when that subscriber’s paid period ends. The bot must be a channel admin with only Invite users via link and Ban users.
          </p>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl">Responsibility</h2>
          <p className="text-sm leading-relaxed text-[var(--pg-hint)]">
            Creators are responsible for their channel content and for following Telegram’s rules. Abuse, fraud, or an attempt to take access or funds without a confirmed payment can remove an account from PassGram.
          </p>
        </section>
      </article>
    </SiteFrame>
  );
}
