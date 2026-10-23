export const runtime = "nodejs";

import { limitedResponse } from "@/lib/server/rateLimit";
import { loadCommunityPhotoById } from "@/lib/server/channelFlow";
import { buildChannelDeps, channelFailure } from "@/lib/server/channelDeps";

export async function GET(_request: Request, context: { params: Promise<{ communityId: string }> }) {
  const limited = limitedResponse(_request, "read");
  if (limited) return limited;
  try {
    const { communityId: raw } = await context.params;
    if (!/^[1-9]\d{0,11}$/.test(raw)) {
      return Response.json({ ok: false, message: "This community link is invalid." }, { status: 400 });
    }
    const deps = await buildChannelDeps();
    const photo = await loadCommunityPhotoById(deps, Number(raw));
    if (!photo) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(photo.bytes), {
      status: 200,
      headers: {
        "content-type": photo.contentType,
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    return channelFailure(error);
  }
}
