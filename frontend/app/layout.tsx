import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://passgram.io"),
  title: "PassGram",
  description: "Paid Telegram communities in USDT on TON.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icon.png", sizes: "512x512", type: "image/png" }],
  },
  openGraph: {
    siteName: "PassGram",
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
    images: ["/og.png"],
  },
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
          {`(function(){function surface(){var tg=window.Telegram&&window.Telegram.WebApp;var platform=tg&&tg.platform;var launch=/tgWebApp(?:Data|Platform|StartParam|Version)/.test(location.hash+location.search);var inside=launch||!!(tg&&((tg.initData&&String(tg.initData).length>0)||(platform&&platform!=="unknown")));var host=location.hostname;var dev=host==="localhost"||host==="127.0.0.1";var site=/(?:^|[?&])site=1(?:&|$)/.test(location.search);document.documentElement.dataset.surface=!site&&(inside||dev)?"app":"site";return launch;}var launch=surface();if(!launch)return;var n=0;var timer=setInterval(function(){surface();if(++n>20||document.documentElement.dataset.surface==="app")clearInterval(timer);},100);})();`}
        </Script>
        {children}
      </body>
    </html>
  );
}
