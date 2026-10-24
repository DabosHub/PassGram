import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { SiteBackLink } from "@/components/site/SiteBackLink";
import { BOT_HANDLE, BOT_URL, GITHUB_URL, MINI_APP_URL } from "@/lib/site";

const primaryLink =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--pg-blue)] px-4 py-2 text-base font-normal text-white no-underline active:bg-[var(--pg-blue-press)]";
const textLink = "text-sm text-[var(--pg-hint)] no-underline hover:text-[var(--pg-text)]";

export function SiteFrame({
  children,
  sections = false,
  gate = false,
}: {
  children: ReactNode;
  sections?: boolean;
  /** Home page only. Hidden when the Mini App is the active surface. */
  gate?: boolean;
}) {
  return (
    <div className={`${gate ? "pg-site" : ""} min-h-dvh bg-[var(--pg-bg)] text-[var(--pg-text)]`}>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-[var(--pg-card)] focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-[var(--pg-line)] bg-[var(--pg-card)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <a href="/" className="flex min-w-0 items-center gap-2 no-underline text-[var(--pg-text)]">
            <Logo className="h-9 w-9 shrink-0" />
            <span className="truncate text-[20px] tracking-[-0.02em]">PassGram</span>
          </a>
          {sections ? (
            <nav aria-label="Page" className="hidden items-center gap-5 md:flex">
              <a className={textLink} href="#features">
                Features
              </a>
              <a className={textLink} href="#how">
                How it works
              </a>
              <a className={textLink} href="#security">
                Security
              </a>
              <a className={textLink} href="#faq">
                FAQ
              </a>
            </nav>
          ) : null}
          <a className={primaryLink} href={MINI_APP_URL} rel="noopener noreferrer">
            Start in Telegram
          </a>
        </div>
        {sections ? (
          <nav aria-label="Page" className="mx-auto flex max-w-6xl gap-4 overflow-x-auto px-5 pb-3 md:hidden">
            <a className={`${textLink} shrink-0`} href="#features">
              Features
            </a>
            <a className={`${textLink} shrink-0`} href="#how">
              How it works
            </a>
            <a className={`${textLink} shrink-0`} href="#security">
              Security
            </a>
            <a className={`${textLink} shrink-0`} href="#faq">
              FAQ
            </a>
          </nav>
        ) : null}
      </header>
      <main id="content">
        {gate ? null : (
          <div className="mx-auto max-w-3xl px-5 pt-8">
            <SiteBackLink />
          </div>
        )}
        {children}
      </main>
      <footer className="border-t border-[var(--pg-line)] bg-[var(--pg-card)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Logo className="h-8 w-8" />
              <p className="text-[18px] tracking-[-0.02em]">PassGram</p>
            </div>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-[var(--pg-hint)]">
              Paid Telegram communities in USDT on TON.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm">
            <a className={textLink} href={BOT_URL} rel="noopener noreferrer">
              {BOT_HANDLE}
            </a>
            <a className={textLink} href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <a className={textLink} href="/privacy">
              Privacy
            </a>
            <a className={textLink} href="/terms">
              Terms of use
            </a>
          </div>
        </div>
        <div className="border-t border-[var(--pg-line)]">
          <p className="mx-auto max-w-6xl px-5 py-4 text-xs text-[var(--pg-hint)]">© 2026 PassGram</p>
        </div>
      </footer>
    </div>
  );
}
