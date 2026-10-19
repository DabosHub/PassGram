# PassGram backend (SQL)

Schema and migrations for Postgres / Supabase. Runtime indexing and expiration live in [`bot-service/`](../bot-service/). Telegram Mini App APIs live in [`frontend/`](../frontend/).

## Tables

See [schema.sql](schema.sql). Amounts are stored as USDT base units (6 decimals), matching the Jetton.

## Migrations

Apply in order under `migrations/`:

1. `002_channel_verification.sql`
2. `003_referral_attribution.sql`
3. `004_community_public_id.sql`
4. `005_ton_payment_fields.sql` — invite links + TON/Jetton payment metadata

## Identity

On-chain payment proves a TON wallet. Linking that wallet to a Telegram user happens in the Mini App after `initData` validation. Telegram user ids are never trusted from a payment message alone.
