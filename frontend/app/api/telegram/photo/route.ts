import { loadChannelPhoto } from "@/lib/server/channelFlow";
import { buildChannelDeps, channelFailure, initDataFrom } from "@/lib/server/channelDeps";

export async function GET(request: Request) {
  try {
    const chatId = new URL(request.url).searchParams.get("chatId") || "";
    if (!/^-?\d+$/.test(chatId)) return new Response(null, { status: 404 });
    const deps = await buildChannelDeps();
    const photo = await loadChannelPhoto(deps, initDataFrom(request), chatId);
    if (!photo) return new Response(null, { status: 404 });
    return new Response(Buffer.from(photo.bytes), {
      status: 200,
      headers: { "content-type": photo.contentType, "cache-control": "private, max-age=600" },
    });
  } catch (error) {
    return channelFailure(error);
  }
}
