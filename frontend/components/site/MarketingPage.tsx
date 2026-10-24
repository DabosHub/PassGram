import { Logo } from "@/components/Logo";
import { SiteFrame } from "@/components/site/SiteFrame";
import { BOT_HANDLE, GITHUB_URL, MINI_APP_URL, SITE_FAQS, SITE_URL, registryAddress, registryUrl } from "@/lib/site";

const primaryLink =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--pg-blue)] px-5 py-2 text-base font-normal text-white no-underline active:bg-[var(--pg-blue-press)]";
const secondaryLink =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--pg-blue)] bg-[var(--pg-card)] px-5 py-2 text-base font-normal text-[var(--pg-blue)] no-underline";

export function MarketingPage() {
  const address = registryAddress();
  const explorer = registryUrl(address);
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: SITE_FAQS.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
  const appLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "PassGram",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Telegram",
    url: SITE_URL,
    description:
      "Telegram Mini App for paid channel subscriptions in USDT on TON. Access opens after a confirmed payment and ends with the paid period.",
  };

  return (
    <SiteFrame sections gate>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd).replace(/</g, "\\u003c") }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appLd).replace(/</g, "\\u003c") }} />

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)] lg:py-24">
        <div>
          <p className="text-sm text-[var(--pg-blue)]">Telegram Mini App · USDT on TON</p>
          <h1 className="mt-3 max-w-xl text-[2.5rem] leading-[1.12] tracking-[-0.03em] sm:text-5xl">
            Automatic Telegram subscriptions, settled on TON.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--pg-hint)]">
            An open-source way to run a paid channel. Subscribers pay the price you set, in USDT, from a TON wallet.
            Access opens after the payment is confirmed, and closes when the period ends.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a className={primaryLink} href={MINI_APP_URL} rel="noopener noreferrer">
              Start in Telegram
            </a>
            <a className={secondaryLink} href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              View the source
            </a>
          </div>
        </div>
        <div className="mx-auto w-full max-w-[340px]" aria-hidden="true">
          <div className="rounded-[28px] border border-[var(--pg-line)] bg-[var(--pg-card)] p-3 shadow-[var(--pg-shadow-float)]">
            <div className="flex items-center gap-2 border-b border-[var(--pg-line)] px-2 py-3">
              <Logo className="h-8 w-8" />
              <div>
                <p className="text-[15px]">PassGram</p>
                <p className="text-xs text-[var(--pg-hint)]">Inside Telegram</p>
              </div>
            </div>
            <div className="space-y-3 px-2 py-4">
              <p className="text-xs text-[var(--pg-hint)]">Channel subscription</p>
              <p className="text-[28px] leading-none tracking-[-0.03em]">USDT on TON</p>
              <dl className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-[var(--pg-bg)] px-3 py-3">
                  <dt className="text-xs text-[var(--pg-hint)]">Price</dt>
                  <dd className="mt-1 text-sm">Set by the creator</dd>
                </div>
                <div className="rounded-2xl bg-[var(--pg-bg)] px-3 py-3">
                  <dt className="text-xs text-[var(--pg-hint)]">Access</dt>
                  <dd className="mt-1 text-sm">1–366 days</dd>
                </div>
              </dl>
              <div className="flex min-h-11 items-center justify-center rounded-full bg-[var(--pg-blue)] px-4 text-base text-white">
                Pay from a TON wallet
              </div>
              <p className="text-center text-xs leading-relaxed text-[var(--pg-hint)]">Access opens after the payment is confirmed.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-5 py-8">
        <h2 className="text-[2rem] tracking-[-0.03em]">What the product does</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <article className="rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-5">
            <h3 className="text-lg">Access follows the payment</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--pg-hint)]">
              After a payment is confirmed, {BOT_HANDLE} opens the channel for that subscriber. When the paid period ends, access is removed.
            </p>
          </article>
          <article className="rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-5">
            <h3 className="text-lg">Settlement stays on TON</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--pg-hint)]">
              The registry splits a confirmed USDT payment on-chain. The creator share goes to the registering wallet. The bot does not hold the funds.
            </p>
          </article>
          <article className="rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-5">
            <h3 className="text-lg">The source is public</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--pg-hint)]">
              The Mini App, the indexer, and the Tolk registry are in a public repository, so the rules can be read rather than taken on trust.
            </p>
          </article>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-[2rem] tracking-[-0.03em]">How a channel starts</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            {
              step: "1",
              title: "Add the bot",
              body: `Add ${BOT_HANDLE} to the channel as an admin with two rights only: Invite users via link, and Ban users.`,
            },
            {
              step: "2",
              title: "Set the subscription",
              body: "In the Mini App, choose the USDT price and the number of days. The wallet you connect is the wallet that receives the creator share.",
            },
            {
              step: "3",
              title: "Subscribers pay",
              body: "A subscriber pays the listed price from a TON wallet. After confirmation, the bot creates a private invite. Access ends with that paid period.",
            },
          ].map((item) => (
            <li key={item.step} className="rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-5">
              <p className="text-sm text-[var(--pg-blue)]">{item.step}</p>
              <h3 className="mt-2 text-lg">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--pg-hint)]">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="security" className="bg-[#0d253d] text-[#f6f9fc]">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-[2rem] tracking-[-0.03em]">What you can check</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#a8c3de]">
            PassGram is alpha software. The source is public, and an independent audit has not been completed. These are the pieces you can open yourself.
          </p>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-3xl border border-white/15 bg-white/5 p-5 no-underline text-inherit"
            >
              <h3 className="text-lg text-white">Source repository</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#a8c3de]">
                Read the Mini App, the payment indexer, and the Tolk 1.5.0 registry.
              </p>
              <p className="mt-4 text-sm text-[#2aabee]">github.com/DabosHub/PassGram</p>
            </a>
            <a
              href={explorer}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-3xl border border-white/15 bg-white/5 p-5 no-underline text-inherit"
            >
              <h3 className="text-lg text-white">Live registry</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#a8c3de]">
                Confirmed payments settle in this contract. Open the address on Tonviewer.
              </p>
              <p className="mt-4 break-all text-sm text-[#2aabee]">{address}</p>
            </a>
            <div className="rounded-3xl border border-white/15 bg-white/5 p-5">
              <h3 className="text-lg text-white">Bot rights</h3>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[#a8c3de]">
                <li>Invite users via link</li>
                <li>Ban users when a period ends</li>
                <li>Does not read channel posts</li>
                <li>Does not publish to the channel</li>
                <li>Does not hold USDT</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-3xl px-5 py-16">
        <h2 className="text-[2rem] tracking-[-0.03em]">Questions</h2>
        <div className="pg-faq mt-6 space-y-3">
          {SITE_FAQS.map((item) => (
            <details key={item.question} className="rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] px-5 py-1">
              <summary className="flex cursor-pointer items-center justify-between gap-4 py-4 text-base">
                <span>{item.question}</span>
                <span className="pg-faq-chevron mt-1 h-2 w-2 shrink-0 border-b-2 border-r-2 border-[var(--pg-blue)]" aria-hidden="true" />
              </summary>
              <p className="pb-4 text-sm leading-relaxed text-[var(--pg-hint)]">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="flex flex-col items-start justify-between gap-6 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-6 sm:flex-row sm:items-center sm:p-8">
          <div>
            <h2 className="text-[1.75rem] tracking-[-0.03em]">Open the Mini App</h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-[var(--pg-hint)]">
              {BOT_HANDLE} is where a creator sets a subscription and a subscriber pays.
            </p>
          </div>
          <a className={primaryLink} href={MINI_APP_URL} rel="noopener noreferrer">
            Start in Telegram
          </a>
        </div>
      </section>
    </SiteFrame>
  );
}
