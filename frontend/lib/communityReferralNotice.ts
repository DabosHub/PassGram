import { miniAppShortNameFrom } from "./domain";
import { cleanLabel, telegramNote, tgBold } from "./telegramText";

export type CommunityReferralNoticeKind = "activated" | "updated" | "stopped";

export function communityReferralNoticeKind(before: {
  referralEnabled: boolean;
  referralPercentBps: number;
}, after: {
  referralEnabled: boolean;
  referralPercentBps: number;
}): CommunityReferralNoticeKind | null {
  const wasOn = before.referralEnabled && before.referralPercentBps > 0;
  const nowOn = after.referralEnabled && after.referralPercentBps > 0;
  if (!wasOn && nowOn) return "activated";
  if (wasOn && !nowOn) return "stopped";
  if (wasOn && nowOn && before.referralPercentBps !== after.referralPercentBps) return "updated";
  return null;
}

export function communityReferralNoticeText(input: {
  kind: CommunityReferralNoticeKind;
  title: string;
  percentLabel: string;
}): string {
  const name = tgBold(cleanLabel(input.title, "This community"));
  const percent = tgBold(`${cleanLabel(input.percentLabel, "0", 8)}%`);
  if (input.kind === "activated") {
    return telegramNote("Referral program", [
      `${name} started a referral program.`,
      `Share it and earn ${percent} of the creator's share from each person you refer. Their price does not change.`,
    ]);
  }
  if (input.kind === "updated") {
    return telegramNote("Referral rate", [
      `${name} now pays ${percent} on new referrals.`,
      "Links you already registered keep their original rate.",
    ]);
  }
  return telegramNote("Referrals closed", [
    `${name} stopped its referral program.`,
    "New referrals are closed. Links you already registered still earn their original rate.",
  ]);
}

export function communityReferralButtonLabel(kind: CommunityReferralNoticeKind): string {
  return kind === "activated" ? "Create referral link" : "Open community";
}

export function creatorReferralLinkNoticeText(input: { title: string; percentLabel: string; code: string }): string {
  const name = tgBold(cleanLabel(input.title, "your community"));
  const percent = tgBold(`${cleanLabel(input.percentLabel, "0", 8)}%`);
  const code = input.code.replace(/[^a-z0-9_-]/gi, "").slice(0, 32);
  return telegramNote("New referral link", [
    `A marketer created a link for ${name}.`,
    `They earn ${percent} of your share from each subscriber they refer. The subscriber price does not change.${code ? ` Code: ${tgBold(code)}.` : ""}`,
  ]);
}

/** Sent to the referrer, whatever their role, after the referred action is confirmed. */
export function referralConversionNoticeText(input: {
  program: "community" | "passgram";
  title: string;
  actorName: string;
  percentLabel?: string;
}): string {
  const who = tgBold(cleanLabel(input.actorName, "Someone you referred"));
  const name = tgBold(cleanLabel(input.title, "a community"));
  if (input.program === "passgram") {
    return telegramNote("New community", [`${who} created ${name} through your PassGram referral.`]);
  }
  const percent = (input.percentLabel || "").trim();
  const earn = percent ? ` You earn ${tgBold(`${percent}%`)} of the creator's share on that payment.` : "";
  return telegramNote("Referral earned", [`${who} subscribed to ${name} through your link.${earn}`]);
}

/** One chat. Skips the actor and any id that is not a Telegram user id. A failed send does not undo the action. */
export async function deliverReferralConversionNotice(input: {
  telegram: { call: (method: string, body?: Record<string, unknown>) => Promise<unknown> };
  recipientId: string;
  actorId: string;
  text: string;
  url: string;
}): Promise<boolean> {
  if (!/^[1-9]\d{0,18}$/.test(input.recipientId) || input.recipientId === input.actorId) return false;
  try {
    await input.telegram.call("sendMessage", {
      chat_id: Number(input.recipientId),
      text: input.text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: "Open community", url: input.url }]] },
    });
    return true;
  } catch {
    return false;
  }
}

export function communityReferralNoticeUrl(communityId: number, env: NodeJS.ProcessEnv = process.env): string {
  const bot = (env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || env.TELEGRAM_BOT_USERNAME || "PassGramBot").trim().replace(/^@/, "");
  const app = miniAppShortNameFrom(env);
  return `https://t.me/${bot}/${app}?startapp=c_${communityId}`;
}

/** Messages current subscribers only. The community owner is skipped. One failed chat does not stop the rest. */
export async function deliverCommunityReferralNotice(input: {
  telegram: { call: (method: string, body?: Record<string, unknown>) => Promise<unknown> };
  subscriberIds: string[];
  ownerTelegramUserId: string;
  text: string;
  url: string;
  buttonText?: string;
}): Promise<string[]> {
  const sent: string[] = [];
  for (const id of input.subscriberIds) {
    if (!/^[1-9]\d{0,18}$/.test(id) || id === input.ownerTelegramUserId) continue;
    try {
      await input.telegram.call("sendMessage", {
        chat_id: Number(id),
        text: input.text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: input.buttonText || "Open community", url: input.url }]] },
      });
      sent.push(id);
    } catch {
      /* A blocked chat does not undo the referral setting. */
    }
  }
  return sent;
}
