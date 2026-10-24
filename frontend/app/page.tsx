import type { Metadata } from "next";
import { AppGate } from "@/components/site/AppGate";
import { MarketingPage } from "@/components/site/MarketingPage";
import { SITE_URL } from "@/lib/site";

const title = "PassGram — Automatic Telegram subscriptions in USDT on TON";
const description =
  "PassGram is an open-source Telegram Mini App for paid channels. Subscribers pay in USDT on TON. Access opens after confirmation and ends when the paid period ends.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: SITE_URL },
  openGraph: {
    title,
    description,
    url: SITE_URL,
    siteName: "PassGram",
    type: "website",
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
  robots: { index: true, follow: true },
};

export default function HomePage() {
  return (
    <>
      <MarketingPage />
      <div className="pg-app-boot" aria-hidden="true">
        <p className="flex min-h-dvh items-center justify-center text-sm text-[var(--pg-hint)]">Loading</p>
      </div>
      <AppGate />
    </>
  );
}
