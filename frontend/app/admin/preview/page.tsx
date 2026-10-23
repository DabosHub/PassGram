import { AdminConsole } from "@/components/admin/AdminConsole";
import { buildAdminPreview } from "@/lib/server/adminPreview";
import { parseAdminQuery } from "@/lib/server/adminView";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

export default async function AdminPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const host = (await headers()).get("host") || "";
  const name = host.split(":")[0].toLowerCase();
  if (name !== "localhost" && name !== "127.0.0.1") notFound();

  const raw = await searchParams;
  const now = Date.now();
  const query = {
    ...parseAdminQuery({
      section: first(raw.section),
      period: first(raw.period),
      community: first(raw.community),
      page: first(raw.page),
    }),
    pathBase: "/admin/preview" as const,
  };
  return (
    <AdminConsole
      viewer={{ userId: 900001, name: "Demo Creator", username: "democreator" }}
      query={query}
      data={buildAdminPreview(query, now)}
      error={null}
      now={now}
      network="testnet"
    />
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
