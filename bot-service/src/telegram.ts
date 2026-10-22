export type TelegramClient = {
  createChatInviteLink: (chatId: string, expireDateUnix?: number) => Promise<string | null>;
  kickThenUnban: (chatId: string, userId: string) => Promise<boolean>;
  sendDirectMessage: (userId: string, text: string, button?: { text: string; url: string }) => Promise<{ ok: boolean; permanent: boolean }>;
  chatMember: (chatId: string, userId: string) => Promise<{ status?: string; is_member?: boolean } | null>;
};

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
    const response = await fetch(`${base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as { ok?: boolean; result?: unknown; description?: string };
    if (!json.ok) {
      console.error("telegram", method, json.description || "failed");
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
      await call("unbanChatMember", { chat_id: chatId, user_id: Number(userId), only_if_banned: true });
      return true;
    },
    async sendDirectMessage(userId, text, button) {
      const result = await call("sendMessage", {
        chat_id: Number(userId),
        text,
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
