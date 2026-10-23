# Contributing to PassGram

Thanks for helping. PassGram is a Telegram Mini App for paid USDT communities on TON. Please read [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY.md](SECURITY.md) before changing payment, access, or signature code.

## Ground rules

- Open a pull request against `main`. Keep it focused on one change.
- Write for the repository in English. User-facing Mini App copy stays in English.
- Do not commit secrets, wallet keys, `.env.local`, or a real bot token. Use the `*.env.example` files.
- Do not deploy the registry, rotate a production key, or point the app at a new contract address from a pull request. Deployment is a maintainer step.
- A contract change must update `contract/registry.codehash` only when the compiled code actually changes, and the same hash must stay in the app and the indexer. Say that clearly in the pull request.

## Local setup

Use Node.js 24. Each package has its own lockfile.

```bash
cd contract
npm ci
npm run build
npm test

cd ../bot-service
npm ci
npm test

cd ../frontend
npm ci
npm test
npm run dev
```

`contract/build/` is gitignored. Build the contract before its tests. The sandbox tests import that output.

The Mini App reads environment variables from the repository root `.env.local`, not from `frontend/.env.local`. Copy [`.env.example`](.env.example). Tests do not need a database or a Telegram token.

`bot-service` needs `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, and the registry address only when you run the indexer or the expiration cron. See [bot-service/README.md](bot-service/README.md).

## Database

SQL lives in `backend/`. A new database can be created from `backend/schema.sql`. An existing database applies the files in `backend/migrations/` in the order listed in [backend/README.md](backend/README.md). Do not edit a migration that has already been applied. Add a new numbered file.

## Tests

Run the package you touched:

| Package | Command |
| --- | --- |
| `contract/` | `npm run build` then `npm test` |
| `bot-service/` | `npm test` |
| `frontend/` | `npm test` and `npm run build` when the change is user-visible or compiled |

GitHub Actions runs these on every pull request. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Code

Match the file you are editing. Keep payment amounts as integer USDT base units (6 decimals). Do not treat a signed wallet submission as a confirmed subscription. The indexer confirms a payment only after `SubscriptionPaid`, and it changes the listed price only after `CommunityUpdated`.

## Reporting

Use the bug or feature template. Report a vulnerability through a [private security advisory](https://github.com/DabosHub/PassGram/security/advisories/new), not a public issue.
