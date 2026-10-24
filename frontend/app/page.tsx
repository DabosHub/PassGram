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
    title: "Automatic membership management for paid Telegram channels.",
    description: "Members are added when payment is confirmed. Members are removed when the subscription ends.",
    url: SITE_URL,
    siteName: "PassGram",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Automatic membership management for paid Telegram channels.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Automatic membership management for paid Telegram channels.",
    description: "Members are added when payment is confirmed. Members are removed when the subscription ends.",
    images: ["/og.png"],
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
