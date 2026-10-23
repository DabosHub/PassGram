import { Logo } from "@/components/Logo";
import {
  adminPath,
  periodLabel,
  type AdminQuery,
  type AdminSection,
} from "@/lib/server/adminView";
import type { ReactNode } from "react";

const NAV: { id: AdminSection; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "communities", label: "Communities" },
  { id: "payments", label: "Payments" },
  { id: "referrals", label: "Referrals" },
  { id: "operations", label: "Operations" },
];

const PERIODS: { id: AdminQuery["period"]; label: string }[] = [
  { id: "24h", label: "24 hours" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All" },
];

export function AdminFrame({
  viewer,
  query,
  title,
  lede,
  backHref,
  backLabel,
  showPeriod,
  children,
}: {
  viewer: { userId: number; name: string; username: string };
  query: AdminQuery;
  title: string;
  lede: string;
  backHref?: string | null;
  backLabel?: string;
  showPeriod: boolean;
  children: ReactNode;
}) {
  const preview = query.pathBase === "/admin/preview";
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1180px] flex-col md:flex-row">
      <aside className="border-b border-[var(--pg-line)] bg-[var(--pg-card)] md:sticky md:top-0 md:flex md:h-dvh md:w-56 md:shrink-0 md:flex-col md:border-b-0 md:border-r">
        <a href={adminPath({ ...query, section: "overview", communityId: null, page: 1 })} className="flex items-center gap-3 px-5 py-5">
          <Logo className="h-9 w-9" />
          <span>
            <span className="block text-[16px] text-[var(--pg-text)]">PassGram</span>
            <span className="block text-[13px] text-[var(--pg-hint)]">Admin</span>
          </span>
        </a>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible md:px-3" aria-label="Admin">
          {NAV.map((item) => {
            const active = query.section === item.id;
            return (
              <a
                key={item.id}
                href={adminPath({ ...query, section: item.id, communityId: null, page: 1 })}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3 py-2 text-[14px] whitespace-nowrap md:rounded-[8px] ${
                  active ? "bg-[var(--pg-tag)] text-[var(--pg-blue)]" : "text-[var(--pg-text)]"
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
        <div className="hidden border-t border-[var(--pg-line)] px-5 py-4 md:block">
          <Viewer viewer={viewer} />
          {preview ? <LabExit /> : <SignOut />}
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        {preview ? (
          <p className="mb-4 rounded-[8px] bg-[var(--pg-tag)] px-3 py-2 text-[13px] text-[var(--pg-blue)]">
            UI Lab preview. These numbers are a sample, not the live ledger.
          </p>
        ) : null}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {backHref ? (
              <a href={backHref} className="text-[13px] text-[var(--pg-blue)]">
                {backLabel || "Back"}
              </a>
            ) : null}
            <h1 className="mt-1 text-[28px] leading-tight text-[var(--pg-text)]">{title}</h1>
            <p className="mt-1 text-[14px] text-[var(--pg-hint)]">{lede}</p>
          </div>
          {showPeriod ? (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Period">
              {PERIODS.map((item) => {
                const active = query.period === item.id;
                return (
                  <a
                    key={item.id}
                    href={adminPath({ ...query, period: item.id, page: 1 })}
                    aria-current={active ? "true" : undefined}
                    className={`rounded-full px-3 py-2 text-[13px] ${
                      active ? "bg-[var(--pg-blue)] text-white" : "text-[var(--pg-hint)]"
                    }`}
                  >
                    {item.label}
                  </a>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="mb-6 md:hidden">
          <Viewer viewer={viewer} />
          {preview ? <LabExit /> : <SignOut />}
        </div>
        {children}
      </main>
    </div>
  );
}

function Viewer({ viewer }: { viewer: { userId: number; name: string; username: string } }) {
  const handle = viewer.username ? `@${viewer.username.replace(/^@/, "")}` : "";
  const name = viewer.name.trim();
  return (
    <p className="text-[13px] text-[var(--pg-hint)]">
      <span className="block text-[var(--pg-text)]">{name || handle || `Telegram ${viewer.userId}`}</span>
      {name && handle ? <span className="block">{handle}</span> : null}
      <span className="block">{viewer.userId}</span>
    </p>
  );
}

function LabExit() {
  return (
    <a
      href="/"
      className="mt-3 inline-flex min-h-10 items-center justify-center rounded-full border border-[var(--pg-line)] bg-[var(--pg-card)] px-4 text-[14px] text-[var(--pg-text)]"
    >
      Mini App
    </a>
  );
}

function SignOut() {
  return (
    <form action="/api/admin/logout" method="post" className="mt-3">
      <button
        type="submit"
        className="inline-flex min-h-10 items-center justify-center rounded-full border border-[var(--pg-line)] bg-[var(--pg-card)] px-4 text-[14px] text-[var(--pg-text)]"
      >
        Sign out
      </button>
    </form>
  );
}

export function periodLede(query: AdminQuery): string {
  return `Confirmed payments only. ${periodLabel(query.period)}.`;
}
