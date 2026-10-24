import type { PaymentRecord, SubscriptionRecord } from "./store";

export type SubscriberSnapshot = {
  subscriptions: SubscriptionRecord[];
  payments: PaymentRecord[];
};

/**
 * Apply a confirmed membership snapshot onto the signed-in subscriber.
 * Returns null when the card dates, payment hash, and payment rows are unchanged.
 */
export function mergeSubscriberSnapshot(
  current: SubscriberSnapshot & { userId: string },
  incoming: SubscriberSnapshot,
): SubscriberSnapshot | null {
  const subscriptions = current.subscriptions.slice();
  const payments = current.payments.slice();
  let changed = false;

  for (const next of incoming.subscriptions) {
    if (next.confirmation !== "confirmed" || next.subscriberUserId !== current.userId) continue;
    const index = subscriptions.findIndex(
      (item) => item.communityId === next.communityId && item.subscriberUserId === current.userId,
    );
    if (index < 0) {
      subscriptions.push(next);
      changed = true;
      continue;
    }
    const previous = subscriptions[index];
    if (
      previous.startedAt === next.startedAt &&
      previous.expiresAt === next.expiresAt &&
      previous.paymentAmount === next.paymentAmount &&
      previous.confirmation === next.confirmation &&
      previous.transactionReference === next.transactionReference &&
      previous.renewalPending === next.renewalPending
    ) {
      continue;
    }
    subscriptions[index] = {
      ...previous,
      confirmation: next.confirmation,
      startedAt: next.startedAt,
      expiresAt: next.expiresAt,
      paymentAmount: next.paymentAmount,
      transactionReference: next.transactionReference,
      renewalPending: next.renewalPending,
    };
    changed = true;
  }

  for (const payment of incoming.payments) {
    if (payment.status !== "confirmed" || payment.subscriberUserId !== current.userId) continue;
    const known = payments.some(
      (item) =>
        item.subscriberUserId === current.userId &&
        item.communityId === payment.communityId &&
        item.transactionReference != null &&
        item.transactionReference === payment.transactionReference,
    );
    if (known) continue;
    payments.push(payment);
    changed = true;
  }

  return changed ? { subscriptions, payments } : null;
}

function subscriptionSignature(row: SubscriptionRecord): string {
  return [
    row.id,
    row.subscriberUserId,
    row.communityId,
    row.confirmation,
    row.startedAt ?? "",
    row.expiresAt ?? "",
    row.paymentAmount,
    row.transactionReference ?? "",
    row.renewalPending,
    row.subscriberDisplayName ?? "",
    row.subscriberUsername ?? "",
    row.subscriberAvatarUrl ?? "",
  ].join("\u001f");
}

function paymentSignature(row: PaymentRecord): string {
  return [
    row.id,
    row.subscriberUserId,
    row.communityId,
    row.status,
    row.gross,
    row.creatorAmount,
    row.platformFee,
    row.affiliateAmount,
    row.communityAffiliateAmount,
    row.transactionReference ?? "",
    row.at,
  ].join("\u001f");
}

function sameSignatures(current: string[], next: string[]): boolean {
  if (current.length !== next.length) return false;
  const left = current.slice().sort();
  const right = next.slice().sort();
  return left.every((value, index) => value === right[index]);
}

/**
 * Replace the signed-in subscriber's rows with the database snapshot.
 * Communities in `retainCommunityIds` keep their local card until rejoin is verified.
 * Returns null when the visible rows are unchanged.
 */
export function replaceSubscriberSnapshot(
  current: SubscriberSnapshot & { userId: string },
  incoming: SubscriberSnapshot,
  retainCommunityIds: readonly number[] = [],
): SubscriberSnapshot | null {
  const retain = new Set(retainCommunityIds);
  const incomingSubscriptions = incoming.subscriptions.filter(
    (item) => item.subscriberUserId === current.userId && !retain.has(item.communityId),
  );
  const byCommunity = new Map(incomingSubscriptions.map((item) => [item.communityId, item]));
  const subscriptions: SubscriptionRecord[] = [];
  const seen = new Set<number>();

  for (const previous of current.subscriptions) {
    if (previous.subscriberUserId !== current.userId || retain.has(previous.communityId)) {
      subscriptions.push(previous);
      if (previous.subscriberUserId === current.userId) seen.add(previous.communityId);
      continue;
    }
    const next = byCommunity.get(previous.communityId);
    if (!next) continue;
    seen.add(previous.communityId);
    subscriptions.push({
      ...previous,
      confirmation: next.confirmation,
      startedAt: next.startedAt,
      expiresAt: next.expiresAt,
      paymentAmount: next.paymentAmount,
      transactionReference: next.transactionReference,
      renewalPending: next.renewalPending,
      subscriberDisplayName: next.subscriberDisplayName || previous.subscriberDisplayName,
      subscriberUsername: next.subscriberUsername || previous.subscriberUsername,
      subscriberAvatarUrl: next.subscriberAvatarUrl || previous.subscriberAvatarUrl,
    });
  }

  for (const next of incomingSubscriptions) {
    if (seen.has(next.communityId)) continue;
    subscriptions.push(next);
  }

  const payments = current.payments.filter(
    (item) => item.subscriberUserId !== current.userId || retain.has(item.communityId),
  );
  for (const payment of incoming.payments) {
    if (payment.subscriberUserId !== current.userId || retain.has(payment.communityId)) continue;
    payments.push(payment);
  }

  if (
    sameSignatures(current.subscriptions.map(subscriptionSignature), subscriptions.map(subscriptionSignature)) &&
    sameSignatures(current.payments.map(paymentSignature), payments.map(paymentSignature))
  ) {
    return null;
  }
  return { subscriptions, payments };
}
