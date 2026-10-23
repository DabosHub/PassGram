# PassGram backend (SQL)

Schema and migrations for Postgres / Supabase. Runtime indexing and expiration live in [`bot-service/`](../bot-service/). Telegram Mini App APIs live in [`frontend/`](../frontend/).

## Tables

See [schema.sql](schema.sql). Amounts are stored as USDT base units (6 decimals), matching the Jetton.

## Migrations

A new database only needs [schema.sql](schema.sql). It already includes every table, check, foreign key, and the expiry index.

An existing database applies each new file once, in this order:

1. `002_channel_verification.sql`
2. `003_referral_attribution.sql`
3. `004_community_public_id.sql`
4. `005_ton_payment_fields.sql`
5. `006_community_referrals.sql`
6. `007_community_memberships.sql`
7. `008_renewal_reminder.sql`
8. `009_membership_invite.sql`
9. `009_access_removed.sql`
10. `010_attribution_referral_rate.sql`
11. `010_indexer_state.sql`
12. `011_community_paused.sql`
13. `011_payments_dedup.sql`
14. `012_community_referral_links.sql`
15. `013_affiliate_signer.sql`
16. `014_community_referral_payout.sql`
17. `015_schema_hardening.sql`

`015` removes `telegram_wallets.near_account_id` and `affiliates.signer_address`, adds the membership expiry index, amount checks, community foreign keys, and turns on row security. Apply it with the app version that no longer writes those two columns. The database owner used by the app still bypasses row security. Supabase `anon` and `authenticated` lose table access.

## Identity

On-chain payment proves a TON wallet. Linking that wallet to a Telegram user happens in the Mini App after `initData` validation. Telegram user ids are never trusted from a payment message alone.
