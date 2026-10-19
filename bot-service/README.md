# PassGram bot-service

Lightweight Node service for **TON payment indexing** and **subscription expiration**. Telegram channel verify, referrals, webhooks, and Mini App APIs stay in `frontend/`.

## Responsibilities

1. **Indexer** — poll TonCenter for registry transactions / `SubscriptionPaid` hints; upsert `payments` + `subscriptions`; create a one-time Telegram invite link.
2. **Cron** — for expired confirmed subscriptions, `banChatMember` then `unbanChatMember` to remove channel access.

## Environment

```bash
DATABASE_URL=postgresql://...
TELEGRAM_BOT_TOKEN=...
PASSGRAM_REGISTRY_ADDRESS=EQ...
TON_API_URL=https://toncenter.com/api/v2
TONCENTER_API_KEY=          # optional
INDEXER_POLL_MS=15000
CRON_INTERVAL_MS=60000
```

## Run

```bash
cd bot-service
npm install
npm start          # indexer + cron together
npm run indexer    # indexer loop only
npm run cron       # expiration loop only
npm test
```

Apply `backend/migrations/005_ton_payment_fields.sql` before relying on `invite_link` / jetton columns.
