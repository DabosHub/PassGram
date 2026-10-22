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
