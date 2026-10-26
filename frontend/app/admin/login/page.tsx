import { Logo } from "@/components/Logo";
import { TelegramLogin } from "@/components/admin/TelegramLogin";
import { adminTelegramIds } from "@/lib/server/adminAuth";
import { currentAdmin } from "@/lib/server/adminSession";
import { redirect } from "next/navigation";

const SIGN_IN_ERRORS: Record<string, string> = {
  closed: "Admin sign-in is not configured.",
  denied: "This Telegram account cannot open the admin console.",
  invalid: "Telegram could not confirm this sign-in.",
  limited: "Too many sign-in attempts. Wait a minute and try again.",
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await currentAdmin();
  if (session) redirect("/admin");
  const raw = await searchParams;
  const errorCode = Array.isArray(raw.error) ? raw.error[0] : raw.error;
  const error = errorCode ? SIGN_IN_ERRORS[errorCode] : undefined;
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
        {error ? <p className="mt-6 text-[14px] text-[var(--pg-ruby)]">{error}</p> : null}
      </section>
    </main>
  );
}
