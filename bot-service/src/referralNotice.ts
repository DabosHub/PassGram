import type { CommunityReferralConversion } from "./db.ts";
import { miniAppCommunityUrl } from "./miniAppName.ts";
import { cleanLabel, telegramNote, tgBold } from "./telegramText.ts";

export function formatLockedPercent(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "";
  const value = bps / 100;
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

/** Same notice the Mini App sends for a confirmed community-referral payment. */
export function communityReferralPaidNotice(input: { title: string; actorName: string; percentLabel: string }): string {
  const who = tgBold(cleanLabel(input.actorName, "Someone you referred"));
  const name = tgBold(cleanLabel(input.title, "a community"));
  const percent = input.percentLabel.trim();
  const earn = percent ? ` You earn ${tgBold(`${percent}%`)} of the creator's share on that payment.` : "";
  return telegramNote("Referral earned", [`${who} subscribed to ${name} through your link.${earn}`]);
}

export function communityOpenUrl(communityId: number, env: NodeJS.ProcessEnv = process.env): string {
  return miniAppCommunityUrl(communityId, env);
}

/** Messages the referrer after a newly confirmed payment. Skips a missing or self referral. */
export async function notifyCommunityReferralPaid(input: {
  lookup: CommunityReferralConversion | null;
  subscriberTelegramUserId: string;
  communityId: number;
  send: (userId: string, text: string, button: { text: string; url: string }) => Promise<unknown>;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const row = input.lookup;
  if (!row || !/^[1-9]\d{0,18}$/.test(row.referrerTelegramUserId) || row.referrerTelegramUserId === input.subscriberTelegramUserId) {
    return false;
  }
  try {
    await input.send(
      row.referrerTelegramUserId,
      communityReferralPaidNotice({
        title: row.title,
        actorName: row.actorName,
        percentLabel: formatLockedPercent(row.referralPercentBps),
      }),
      { text: "Open community", url: communityOpenUrl(input.communityId, input.env) },
    );
    return true;
  } catch {
    return false;
  }
}
