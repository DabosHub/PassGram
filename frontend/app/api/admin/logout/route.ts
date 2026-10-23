import { ADMIN_COOKIE, adminCookieOptions, requestFromThisSite } from "@/lib/server/adminAuth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!requestFromThisSite(request)) {
    return Response.json(
      { ok: false, message: "Sign-out has to start on this site." },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, "", adminCookieOptions(0));
  redirect("/admin/login");
}
