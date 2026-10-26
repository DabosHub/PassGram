import { formatCommunityLink, formatMiniAppHomeLink } from "./domain";
import { cleanLabel, telegramNote, tgBold } from "./telegramText";

const DEFAULT_CHANNEL = "PassGramOfficial";
const DEFAULT_GROUP = "PassGramChat";

export type ProjectChatKind = "channel" | "group";

type ChatLike = { id?: unknown; username?: unknown; type?: unknown };

export function projectChatTargets(env: NodeJS.ProcessEnv = process.env): { channel: string; group: string } {
  const channel = (env.PASSGRAM_CHANNEL_CHAT || DEFAULT_CHANNEL).trim().replace(/^@/, "") || DEFAULT_CHANNEL;
  const group = (env.PASSGRAM_GROUP_CHAT || DEFAULT_GROUP).trim().replace(/^@/, "") || DEFAULT_GROUP;
  return { channel, group };
}

function chatKey(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export function projectChatKind(chat: ChatLike | null | undefined, env: NodeJS.ProcessEnv = process.env): ProjectChatKind | null {
  if (!chat) return null;
  const targets = projectChatTargets(env);
  const username = typeof chat.username === "string" ? chatKey(chat.username) : "";
  const id = chat.id == null ? "" : String(chat.id);
  if (username === chatKey(targets.channel) || id === targets.channel) return "channel";
  if (username === chatKey(targets.group) || id === targets.group) return "group";
  return null;
}

export function projectChatId(kind: ProjectChatKind, env: NodeJS.ProcessEnv = process.env): string {
  const targets = projectChatTargets(env);
  const name = kind === "channel" ? targets.channel : targets.group;
  return /^-?\d+$/.test(name) ? name : `@${name}`;
}

export function miniAppWebUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.PASSGRAM_PUBLIC_URL || "").trim().replace(/\/$/, "");
  if (configured.startsWith("https://")) return configured;
  return "https://passgram.io";
}

export function openPassGramMarkup(url = formatMiniAppHomeLink()): { inline_keyboard: { text: string; url: string }[][] } {
  return { inline_keyboard: [[{ text: "Open PassGram", url }]] };
}

export function projectOpenText(): string {
  return telegramNote("PassGram", [
    "Paid Telegram channels in USDT on TON.",
    "Create a community, or subscribe to one.",
  ]);
}

export function projectWelcomeText(names: string[]): string {
  const people = names.map((name) => cleanLabel(name, "", 40)).filter(Boolean).slice(0, 5);
  const who = people.length > 0 ? people.map((name) => tgBold(name)).join(", ") : "there";
  return telegramNote("Welcome", [
    `${who}, this is the PassGram chat.`,
    "Open the Mini App to create a paid channel or join one.",
  ]);
}

export function publicCreatorLabel(displayName: string, username = ""): string {
  const name = displayName.replace(/\s+/g, " ").trim().slice(0, 80);
  if (name) return name;
  const handle = username.trim().replace(/^@/, "").slice(0, 32);
  if (handle) return `@${handle}`;
  return "A creator";
}

export function communityLaunchText(creator: string, title: string): string {
  const name = tgBold(cleanLabel(creator, "A creator"));
  const community = tgBold(cleanLabel(title, "a community"));
  return telegramNote("New community", [
    `${name} created ${community} on PassGram.`,
    "Subscribe in the Mini App. Access opens after the payment is confirmed.",
  ]);
}

export function referralLaunchText(creator: string, title: string, percentLabel: string): string {
  const name = tgBold(cleanLabel(creator, "A creator"));
  const community = tgBold(cleanLabel(title, "a community"));
  const percent = tgBold(`${cleanLabel(percentLabel, "0", 8)}%`);
  return telegramNote("Referrals are on", [
    `${name} turned on referrals for ${community} at ${percent}.`,
    "That rate comes from the creator's share. The subscriber price does not change.",
  ]);
}

export function joinedMemberNames(message: { new_chat_members?: unknown } | null | undefined): string[] {
  const members = message?.new_chat_members;
  if (!Array.isArray(members)) return [];
  const names: string[] = [];
  for (const member of members) {
    if (!member || typeof member !== "object") continue;
    const user = member as { is_bot?: unknown; first_name?: unknown; last_name?: unknown; username?: unknown };
    if (user.is_bot === true) continue;
    const first = typeof user.first_name === "string" ? user.first_name.trim() : "";
    const last = typeof user.last_name === "string" ? user.last_name.trim() : "";
    const username = typeof user.username === "string" ? user.username.trim().replace(/^@/, "") : "";
    const name = [first, last].filter(Boolean).join(" ") || (username ? `@${username}` : "");
    if (name) names.push(name);
  }
  return names;
}

type Telegram = { call: (method: string, body?: Record<string, unknown>) => Promise<unknown> };

let profileReady = false;

export function resetProjectHomeProfile(): void {
  profileReady = false;
}

async function ensureBotProfile(telegram: Telegram, env: NodeJS.ProcessEnv): Promise<void> {
  if (profileReady) return;
  profileReady = true;
  const url = miniAppWebUrl(env);
  try {
    await telegram.call("setChatMenuButton", {
      menu_button: { type: "web_app", text: "Open PassGram", web_app: { url } },
    });
  } catch {
    profileReady = false;
    return;
  }
  try {
    await telegram.call("setMyCommands", {
      commands: [{ command: "start", description: "Open PassGram" }],
    });
    await telegram.call("setMyShortDescription", {
      short_description: "Paid Telegram channels in USDT on TON.",
    });
    await telegram.call("setMyDescription", {
      description:
        "PassGram opens access after a USDT payment is confirmed and removes it when the paid period ends. The bot does not hold the USDT.",
    });
  } catch {
    /* The menu button is the part people tap. A profile write can fail without removing it. */
  }
}

async function postOpenButton(telegram: Telegram, chatId: string, homeUrl: string): Promise<void> {
  try {
    const chat = (await telegram.call("getChat", { chat_id: chatId })) as { pinned_message?: { text?: unknown; caption?: unknown } };
    const pinned = chat?.pinned_message;
    const pinnedText = typeof pinned?.text === "string" ? pinned.text : typeof pinned?.caption === "string" ? pinned.caption : "";
    if (pinnedText.includes("Paid Telegram channels")) return;
  } catch {
    /* Still try to post. Pinning is skipped when the bot cannot read the chat. */
  }
  try {
    const sent = (await telegram.call("sendMessage", {
      chat_id: chatId,
      text: projectOpenText(),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: openPassGramMarkup(homeUrl),
    })) as { message_id?: unknown };
    if (typeof sent?.message_id === "number") {
      await telegram.call("pinChatMessage", {
        chat_id: chatId,
        message_id: sent.message_id,
        disable_notification: true,
      });
    }
  } catch {
    /* The owner still sees the same button on the bot profile. */
  }
}

/** Welcomes the project group, pins Open PassGram, and answers /start. Other chats are ignored. */
export async function presentProjectHome(telegram: Telegram, update: unknown, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!update || typeof update !== "object") return;
  const homeUrl = formatMiniAppHomeLink();
  const record = update as {
    message?: { chat?: ChatLike; text?: unknown; new_chat_members?: unknown };
    my_chat_member?: { chat?: ChatLike; new_chat_member?: { status?: unknown } };
  };

  const membership = record.my_chat_member;
  const joined = membership?.new_chat_member?.status;
  const home = projectChatKind(membership?.chat, env);
  if (home && (joined === "member" || joined === "administrator")) {
    await ensureBotProfile(telegram, env);
    await postOpenButton(telegram, projectChatId(home, env), homeUrl);
  }

  const message = record.message;
  const messageHome = projectChatKind(message?.chat, env);
  const names = joinedMemberNames(message);
  if (messageHome === "group" && names.length > 0) {
    try {
      await telegram.call("sendMessage", {
        chat_id: projectChatId("group", env),
        text: projectWelcomeText(names),
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: openPassGramMarkup(homeUrl),
      });
    } catch {
      /* A welcome is optional. Joining the group still works. */
    }
  }

  const text = typeof message?.text === "string" ? message.text.trim() : "";
  const privateChat = message?.chat?.type === "private";
  if (privateChat && /^\/start(?:@\w+)?(?:\s|$)/.test(text)) {
    await ensureBotProfile(telegram, env);
    try {
      await telegram.call("sendMessage", {
        chat_id: message?.chat?.id,
        text: projectOpenText(),
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: openPassGramMarkup(homeUrl),
      });
    } catch {
      /* The menu button still opens the Mini App. */
    }
  }
}

export async function announceOnProjectChannel(
  telegram: Telegram,
  text: string,
  buttonText: string,
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  try {
    await telegram.call("sendMessage", {
      chat_id: projectChatId("channel", env),
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: buttonText, url }]] },
    });
  } catch {
    /* Publishing a community does not depend on the project channel. */
  }
}

export function communityJoinUrl(communityId: number): string {
  return formatCommunityLink(communityId);
}
