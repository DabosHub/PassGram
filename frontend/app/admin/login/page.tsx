import { Logo } from "@/components/Logo";
import { TelegramLogin } from "@/components/admin/TelegramLogin";
import { adminTelegramIds } from "@/lib/server/adminAuth";
import { currentAdmin } from "@/lib/server/adminSession";
import { redirect } from "next/navigation";

export default async function AdminLoginPage() {
  const session = await currentAdmin();
  if (session) redirect("/admin");
  const username = (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "").replace(/^@/, "").trim();
  const ready = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && username && adminTelegramIds().size > 0);
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] px-6 py-8 text-center">
        <Logo className="mx-auto h-12 w-12" />
        <h1 className="mt-4 text-[28px]">Admin</h1>
        <p className="mt-2 text-[14px] text-[var(--pg-hint)]">Only the PassGram owner can open this console.</p>
        <div className="mt-6">
          {ready ? (
            <TelegramLogin username={username} />
          ) : (
            <p className="text-[14px] text-[var(--pg-text)]">
              Admin sign-in is not configured yet. Set the bot token, the public bot username, and PASSGRAM_ADMIN_TELEGRAM_IDS.
            </p>
          )}
        </div>
        {ready ? (
          <p className="mt-6 text-[13px] text-[var(--pg-hint)]">
            Link this site&apos;s domain to the bot in BotFather before Telegram Login will open.
          </p>
        ) : null}
      </section>
    </main>
  );
}
