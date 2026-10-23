import { AdminConsole } from "@/components/admin/AdminConsole";
import { AdminDataError, loadAdminConsole, loadAdminViewer } from "@/lib/server/adminRepository";
import { currentAdmin } from "@/lib/server/adminSession";
import { parseAdminQuery } from "@/lib/server/adminView";
import { redirect } from "next/navigation";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await currentAdmin();
  if (!session) redirect("/admin/login");
  const raw = await searchParams;
  const query = parseAdminQuery({
    section: first(raw.section),
    period: first(raw.period),
    community: first(raw.community),
    page: first(raw.page),
  });
  const now = Date.now();
  const network = process.env.NEXT_PUBLIC_TON_NETWORK === "testnet" ? "testnet" : "mainnet";
  let viewer = { userId: session.userId, name: "", username: "" };
  try {
    viewer = { userId: session.userId, ...(await loadAdminViewer(session.userId)) };
  } catch {
    viewer = { userId: session.userId, name: "", username: "" };
  }
  let data = null;
  let error: string | null = null;
  try {
    data = await loadAdminConsole(query, now);
  } catch (caught) {
    error = caught instanceof AdminDataError ? caught.message : "The ledger could not be loaded.";
  }
  return <AdminConsole viewer={viewer} query={query} data={data} error={error} now={now} network={network} />;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
