# PassGram bot-service

Lightweight Node service for **TON payment indexing** and **subscription expiration**. Telegram channel verify, referrals, webhooks, and Mini App APIs stay in `frontend/`.

## Responsibilities

1. **Indexer** — poll TonCenter from the saved logical-time cursor, walking older pages until that cursor; upsert `payments` + `subscriptions`; create a one-time Telegram invite link. A payment whose community is not listed yet is logged and skipped so the cursor can move. Any other failure keeps the cursor where it is.
2. **Cron** — for expired confirmed subscriptions, `banChatMember` then `unbanChatMember` to remove channel access.

## Environment

```bash
DATABASE_URL=postgresql://...
TELEGRAM_BOT_TOKEN=...
PASSGRAM_REGISTRY_ADDRESS=EQ...
PASSGRAM_REGISTRY_CODE_HASH=
TON_API_URL=https://toncenter.com/api/v2
TONCENTER_API_KEY=          # optional
INDEXER_POLL_MS=15000
CRON_INTERVAL_MS=60000
PASSGRAM_HEALTH_PORT=8080       # GET /health is 503 after a failed indexer pass, 200 otherwise
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
Apply `backend/migrations/010_indexer_state.sql` before starting the indexer. Without that table it cannot remember payments across a restart.
Apply `backend/migrations/011_payments_dedup.sql` so each chain transaction can be stored only once.
