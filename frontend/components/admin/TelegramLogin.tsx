"use client";

import { useEffect, useRef } from "react";

export function TelegramLogin({ username }: { username: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", username);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-auth-url", "/api/admin/session");
    node.appendChild(script);
    return () => {
      node.replaceChildren();
    };
  }, [username]);

  return <div ref={host} className="flex min-h-12 justify-center" />;
}
