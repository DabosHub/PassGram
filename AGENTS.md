# Agents

PassGram is a Telegram Mini App for paid USDT communities on TON. Read [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY.md](SECURITY.md) before changing payments, access, or signatures.

## Layout

- `contract/` — Tact registry. Build before tests. Change `contract/registry.codehash` only when the compiled code changes, and keep that hash in the app and the indexer.
- `frontend/` — Next.js Mini App and its APIs.
- `bot-service/` — payment indexer and expiration cron.
- `backend/` — `schema.sql` and ordered SQL migrations. Do not edit a migration that has already been applied.

## Never commit

`.env.local`, `contract/.env`, bot tokens, API keys, database URLs, or wallet seeds. Use the `*.env.example` files.

## Changes

One fix per pull request, against `main`. User-facing copy stays in English. Do not deploy a registry, rotate a production key, or point the app at a new contract address from a pull request.

Audit notes use ids such as `CONTRACT-01`, `FE-01`, `BS-01`, and `DB-01`. Put that id in the pull request when the change answers one. The current status of open notes is [SECURITY.md](SECURITY.md), not a separate findings file.

## Checks

Run the package you touched: `npm test` in `contract/` (after `npm run build`), `bot-service/`, or `frontend/`. Report a vulnerability through a [private security advisory](https://github.com/DabosHub/PassGram/security/advisories/new).
