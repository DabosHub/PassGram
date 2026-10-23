# PassGram

[![CI](https://github.com/DabosHub/PassGram/actions/workflows/ci.yml/badge.svg)](https://github.com/DabosHub/PassGram/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-alpha-orange)

Telegram Mini App for paid communities. Subscribers pay creators in **USDT Jetton on TON**. The PassGram registry splits each payment on-chain; `bot-service` indexes confirmations and manages Telegram access.

> **Alpha software.** The smart contract has not been audited by an independent third party. Do not deploy on mainnet without commissioning an independent audit. Known findings and their status are documented in [SECURITY.md](SECURITY.md).

## Fee split

The subscriber pays the listed USDT price. PassGram does not add a markup.

| Case | Creator | PassGram treasury | PassGram affiliate | Community marketer |
| --- | ---: | ---: | ---: | ---: |
| No referrer | 97.5% | 2.5% | — | — |
| PassGram referrer | 97.5% | 2.0% | 0.5% | — |
| Community referral at R% | 97.5% minus R% of that 97.5% | 2.5% or 2.0% | 0.5% when a PassGram referrer exists | R% of the creator share |

The PassGram affiliate earns 20% of the platform fee (0.5% of the subscription price). That referral locks the first time someone opens PassGram from the link.

A community marketer earns the creator's configured percent of the creator share, after the 2.5% platform fee. The subscriber price does not change. The percent locks on that subscriber's first confirmed payment and is paid again on every renewal. That first payment carries a short-lived signature from the registry owner over the receiving wallet confirmed for the referral link. A payment that changes the address is returned and does not lock a marketer. The server signs that payment only when the configured registry is this source.

## Repository layout

```text
contract/      Tact PassGramRegistry
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

Uses **TON Connect** (`@tonconnect/ui-react`) for wallet connect and USDT Jetton checkout. The manifest is served by `frontend/app/tonconnect-manifest.json/route.ts`.

Channel verify, referrals, webhooks, and community APIs remain under `frontend/app/api` and `frontend/lib/server`.

## Contracts (Tact)

```bash
cd contract
npm install
npm run build     # required before tests; writes contract/build
npm test          # split math and sandbox payments
```

See [contract/README.md](contract/README.md) for jetton masters and deploy notes.

## bot-service

```bash
cd bot-service
npm install
npm start
```

Indexes registry payments, creates invite links, and kicks expired members. See [bot-service/README.md](bot-service/README.md).

Apply every file in `backend/migrations/` in numeric order against your Postgres / Supabase database. The latest migration stores each community referral payout on that community's link.

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

- Moving Mini App Telegram APIs into bot-service
- Native TON (non-Jetton) as the primary checkout path
- A maintainer deploying or rotating the live registry from inside a pull request

## Community

- [Contributing](CONTRIBUTING.md)
- [Architecture](ARCHITECTURE.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Security](SECURITY.md)
- [Changelog](CHANGELOG.md)

## License

MIT. See [LICENSE](LICENSE).
