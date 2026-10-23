import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Admin · PassGram",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-[var(--pg-bg)] text-[var(--pg-text)]">{children}</div>;
}
