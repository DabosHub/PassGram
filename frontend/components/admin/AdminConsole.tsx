import { AdminFrame, periodLede } from "@/components/admin/AdminFrame";
import { AdminSections } from "@/components/admin/AdminSections";
import type { AdminData } from "@/lib/server/adminRepository";
import { adminPath, communityStatus, periodLabel, type AdminQuery } from "@/lib/server/adminView";

const TITLES: Record<AdminQuery["section"], string> = {
  overview: "Overview",
  communities: "Communities",
  payments: "Payments",
  referrals: "Referrals",
  operations: "Operations",
};

export function AdminConsole({
  viewer,
  query,
  data,
  error,
  now,
  network,
}: {
  viewer: { userId: number; name: string; username: string };
  query: AdminQuery;
  data: AdminData | null;
  error: string | null;
  now: number;
  network: "mainnet" | "testnet";
}) {
  const detail = data?.section === "communities" ? data.detail : null;
  const title = detail?.title || (query.section === "communities" && query.communityId ? "Community" : TITLES[query.section]);
  const lede = query.section === "operations" ? "Indexing, access removal, and channel setup." : periodLede(query);
  const backHref = query.section === "communities" && query.communityId ? adminPath({ ...query, communityId: null, page: 1 }) : null;
  return (
    <AdminFrame
      viewer={viewer}
      query={query}
      title={title}
      lede={detail ? `${communityStatus(detail)} · ${periodLabel(query.period)}` : lede}
      backHref={backHref}
      backLabel="All communities"
      showPeriod={query.section !== "operations"}
    >
      {error ? <p className="rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] px-4 py-6 text-[14px]">{error}</p> : null}
      {!error && data ? <AdminSections data={data} query={query} now={now} network={network} /> : null}
    </AdminFrame>
  );
}

