export type TelegramClient = {
  createChatInviteLink: (chatId: string, expireDateUnix?: number) => Promise<string | null>;
  kickThenUnban: (chatId: string, userId: string) => Promise<boolean>;
};

export function createTelegramClient(botToken: string): TelegramClient {
  const base = `https://api.telegram.org/bot${botToken}`;

  async function call(method: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as { ok?: boolean; result?: unknown; description?: string };
    if (!json.ok) {
      console.error("telegram", method, json.description || "failed");
      return null;
    }
    return json.result;
  }

  return {
    async createChatInviteLink(chatId, expireDateUnix) {
      const result = (await call("createChatInviteLink", {
        chat_id: chatId,
        name: "PassGram",
        creates_join_request: false,
        member_limit: 1,
        expire_date: expireDateUnix,
      })) as { invite_link?: string } | null;
      return result?.invite_link ?? null;
    },
    async kickThenUnban(chatId, userId) {
      const banned = await call("banChatMember", { chat_id: chatId, user_id: Number(userId) });
      if (!banned) return false;
      await call("unbanChatMember", { chat_id: chatId, user_id: Number(userId), only_if_banned: true });
      return true;
    },
  };
}
