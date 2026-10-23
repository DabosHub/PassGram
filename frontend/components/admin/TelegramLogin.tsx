"use client";

import { useEffect, useRef, useState } from "react";

type TelegramWidgetUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramWidgetUser) => void;
  }
}

export function TelegramLogin({ username }: { username: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    window.onTelegramAuth = (user) => {
      void signIn(user, setMessage, setBusy);
    };
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", username);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    node.appendChild(script);
    return () => {
      delete window.onTelegramAuth;
      node.replaceChildren();
    };
  }, [username]);

  return (
    <div>
      <div ref={host} className="flex min-h-12 justify-center" />
      {busy ? <p className="mt-4 text-center text-[14px] text-[var(--pg-hint)]">Checking Telegram…</p> : null}
      {message ? <p className="mt-4 text-center text-[14px] text-[var(--pg-ruby)]">{message}</p> : null}
    </div>
  );
}

async function signIn(
  user: TelegramWidgetUser,
  setMessage: (value: string | null) => void,
  setBusy: (value: boolean) => void,
): Promise<void> {
  setMessage(null);
  setBusy(true);
  try {
    const response = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(user),
    });
    const result = (await response.json()) as { ok?: boolean; message?: string };
    if (!response.ok || !result.ok) {
      setMessage(result.message || "Telegram could not confirm this sign-in.");
      setBusy(false);
      return;
    }
    window.location.assign("/admin");
  } catch {
    setMessage("Telegram could not confirm this sign-in.");
    setBusy(false);
  }
}
