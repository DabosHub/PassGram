import { fetchWithTimeout } from "./http.ts";
import { sanitizeError } from "./log.ts";

export type TelegramClient = {
  createChatInviteLink: (chatId: string, expireDateUnix?: number) => Promise<string | null>;
  kickThenUnban: (chatId: string, userId: string) => Promise<boolean>;
  sendDirectMessage: (userId: string, text: string, button?: { text: string; url: string }) => Promise<{ ok: boolean; permanent: boolean }>;
  chatMember: (chatId: string, userId: string) => Promise<{ status?: string; is_member?: boolean } | null>;
};

/** Pauses between unban attempts. The member stays banned until one succeeds. */
export const UNBAN_RETRY_MS = [0, 1_000, 5_000] as const;

export async function unbanAfterKick(
  unban: () => Promise<boolean>,
  chatId: string,
  userId: string,
  delays: readonly number[] = UNBAN_RETRY_MS,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  for (const delay of delays) {
    if (delay > 0) await wait(delay);
    if (await unban()) return;
  }
  throw new Error(`Telegram unban failed for ${userId} in ${chatId}.`);
}

/** Body sent to Telegram createChatInviteLink. No monthly-fee or Stars fields exist on this method. */
export function chatInviteLinkBody(chatId: string, expireDateUnix?: number): Record<string, unknown> {
  return {
    chat_id: chatId,
    name: "PassGram",
    creates_join_request: false,
    member_limit: 1,
    expire_date: expireDateUnix,
  };
}

export function createTelegramClient(botToken: string): TelegramClient {
  const base = `https://api.telegram.org/bot${botToken}`;

  async function call(
    method: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: true; description: string; result: unknown } | { ok: false; description: string; result: null }> {
    let response: Response;
    try {
      response = await fetchWithTimeout(`${base}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      console.error("telegram", method, "did not respond");
      return { ok: false as const, description: "timed out", result: null };
    }
    const json = (await response.json()) as { ok?: boolean; result?: unknown; description?: string };
    if (!json.ok) {
      console.error("telegram", method, sanitizeError(new Error(json.description || "failed")));
      return { ok: false as const, description: json.description || "failed", result: null };
    }
    return { ok: true as const, description: "", result: json.result };
  }

  return {
    async createChatInviteLink(chatId, expireDateUnix) {
      const result = await call("createChatInviteLink", chatInviteLinkBody(chatId, expireDateUnix));
      const link = result.ok ? (result.result as { invite_link?: string } | null) : null;
      return link?.invite_link ?? null;
    },
    async kickThenUnban(chatId, userId) {
      const banned = await call("banChatMember", { chat_id: chatId, user_id: Number(userId) });
      if (!banned.ok) return false;
      await unbanAfterKick(
        async () => {
          const unbanned = await call("unbanChatMember", {
            chat_id: chatId,
            user_id: Number(userId),
            only_if_banned: true,
          });
          return unbanned.ok;
        },
        chatId,
        userId,
      );
      return true;
    },
    async sendDirectMessage(userId, text, button) {
      const result = await call("sendMessage", {
        chat_id: Number(userId),
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: button
          ? { inline_keyboard: [[{ text: button.text, url: button.url }]] }
          : undefined,
      });
      if (result.ok) return { ok: true, permanent: false };
      const description = result.description.toLowerCase();
      const permanent =
        description.includes("blocked") ||
        description.includes("chat not found") ||
        description.includes("user is deactivated") ||
        description.includes("bot can't initiate");
      return { ok: false, permanent };
    },
    async chatMember(chatId, userId) {
      const result = await call("getChatMember", { chat_id: chatId, user_id: Number(userId) });
      if (!result.ok || !result.result || typeof result.result !== "object") return null;
      const member = result.result as { status?: string; is_member?: boolean };
      return { status: member.status, is_member: member.is_member };
    },
  };
}
