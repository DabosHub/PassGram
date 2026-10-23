export const runtime = "nodejs";

import { limitedResponse } from "@/lib/server/rateLimit";
import { getPublicCommunityListing } from "@/lib/server/channelFlow";
import { buildChannelDeps, channelFailure } from "@/lib/server/channelDeps";
import { getMembershipRepository } from "@/lib/server/membershipRepository";

export async function GET(_request: Request, context: { params: Promise<{ communityId: string }> }) {
  const limited = limitedResponse(_request, "read");
  if (limited) return limited;
  try {
    const { communityId: raw } = await context.params;
    if (!/^[1-9]\d{0,11}$/.test(raw)) {
      return Response.json({ ok: false, message: "This community link is invalid." }, { status: 400 });
    }
    const deps = await buildChannelDeps();
    const result = await getPublicCommunityListing(deps, Number(raw));
    if (!result.ok) return Response.json(result, { status: 404 });
    const ownerId = Number(result.community.ownerTelegramUserId);
    if (Number.isSafeInteger(ownerId) && ownerId > 0) {
      try {
        const profile = await (await getMembershipRepository()).getProfile(ownerId);
        if (profile) {
          result.community.ownerDisplayName = profile.displayName;
          result.community.ownerUsername = profile.username.replace(/^@/, "");
          result.community.ownerAvatarUrl = profile.photoUrl;
        }
      } catch {
        /* The listing stays available when the profile table cannot be read. */
      }
    }
    return Response.json(result);
  } catch (error) {
    return channelFailure(error);
  }
}
