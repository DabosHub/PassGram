export const runtime = "nodejs";

function publicOrigin(request: Request): string {
  const configured = (process.env.PASSGRAM_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}

/** Wallet apps load this from the same origin that opened the Mini App. */
export function GET(request: Request) {
  const origin = publicOrigin(request);
  return Response.json(
    {
      url: origin,
      name: "PassGram",
      iconUrl: `${origin}/icon.png`,
      termsOfUseUrl: origin,
      privacyPolicyUrl: origin,
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
