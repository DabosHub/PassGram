# PassGram

Telegram Mini App for paid communities. Subscribers pay creators in **USDT Jetton on TON**. The PassGram registry splits each payment on-chain; `bot-service` indexes confirmations and manages Telegram access.

## Fee split

The subscriber pays the listed USDT price. PassGram does not add a markup.

| Case | Creator | PassGram treasury | Affiliate |
| --- | ---: | ---: | ---: |
| No referrer | 97.5% | 2.5% | — |
| With first-touch referrer | 97.5% | 2.0% | 0.5% |

Affiliate commission is 20% of the platform fee (0.5% of gross). Attribution locks on the first Start / invite touch.

## Repository layout

```text
contract/      Tact PassGramRegistry + PassNft stub
frontend/      Telegram Mini App (Next.js) + channel/referral APIs
bot-service/   TON indexer + subscription expiration cron
backend/       SQL schema + migrations only
```

## Frontend (Mini App)

```bash
cd frontend
npm install
npm run dev
npm test
```

Uses **TON Connect** (`@tonconnect/ui-react`) for wallet connect and USDT Jetton checkout. Manifest: `frontend/public/tonconnect-manifest.json`.

Channel verify, referrals, webhooks, and community APIs remain under `frontend/app/api` and `frontend/lib/server`.

## Contracts (Tact)

```bash
cd contract
npm install
npm test          # split math
npm run build     # requires @tact-lang/compiler
```

See [contract/README.md](contract/README.md) for jetton masters and deploy notes.

## bot-service

```bash
cd bot-service
npm install
npm start
```

Indexes registry payments, creates invite links, and kicks expired members. See [bot-service/README.md](bot-service/README.md).

Apply migrations under `backend/migrations/` (including `005_ton_payment_fields.sql`) against your Postgres / Supabase database.

## Environment

Copy [`.env.example`](.env.example) to `.env.local` at the repo root (**never commit** `.env.local`). See [SECURITY.md](SECURITY.md).

Required public TON keys:

- `NEXT_PUBLIC_TON_NETWORK`
- `NEXT_PUBLIC_USDT_JETTON`
- `NEXT_PUBLIC_PASSGRAM_REGISTRY`
- `NEXT_PUBLIC_TONCONNECT_MANIFEST_URL`

## Deploy (Vercel)

1. Import this GitHub repo into Vercel with **Root Directory** = `frontend`.
2. Add the same secrets from `.env.example` in the Vercel project env (Production).
3. Set `PASSGRAM_PUBLIC_URL` to your Vercel HTTPS URL, then point the Telegram bot webhook / Mini App URL at that origin.

## Smoke checklist (testnet)

1. Connect TON wallet (Telegram Wallet / Tonkeeper)
2. Open a community share link (`c_<id>`)
3. Pay USDT Jetton via TON Connect
4. Confirm `bot-service` indexer records the payment and invite link

## Out of scope (v1)

- Full Token-Gating / NFT hold verification
- Moving Mini App Telegram APIs into bot-service
- Native TON (non-Jetton) as the primary checkout path
- Mainnet contract deploy / live secret rotation

## License

MIT. See [LICENSE](LICENSE).
