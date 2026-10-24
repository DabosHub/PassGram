"use client";

import { useEffect, useState } from "react";

export function SiteBackLink() {
  const [href, setHref] = useState("/");

  useEffect(() => {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") setHref("/?site=1");
  }, []);

  return (
    <a href={href} className="inline-flex min-h-11 items-center text-base text-[var(--pg-blue)] no-underline">
      Back
    </a>
  );
}
