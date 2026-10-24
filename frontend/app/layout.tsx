import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://passgram.io"),
  title: "PassGram",
  description: "Paid Telegram communities in USDT on TON.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#2AABEE",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <Script id="pg-surface" strategy="beforeInteractive">
          {`(function(){function surface(){var tg=window.Telegram&&window.Telegram.WebApp;var platform=tg&&tg.platform;var inside=!!(tg&&((tg.initData&&String(tg.initData).length>0)||(platform&&platform!=="unknown")));var host=location.hostname;var dev=host==="localhost"||host==="127.0.0.1";var site=/(?:^|[?&])site=1(?:&|$)/.test(location.search);document.documentElement.dataset.surface=!site&&(inside||dev)?"app":"site";}surface();})();`}
        </Script>
        {children}
      </body>
    </html>
  );
}
