# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The packages say `0.1.0` as the working version. No Git tag has been cut.

## [Unreleased]

### Added

- `RotateOwnerKey` lets the owner wallet replace the server signing key. The current key signs this registry, the new key, and an expiry of at most one day.
- `CommunityRegistered`, `CommunityUpdated`, and `UsdtJettonWalletSet` events. The USDT jetton wallet is taken from the jetton master, not pasted by the owner.
- Gasless wallet-ownership proof via TON Connect `signData` before a payout address is stored.
- A durable indexer cursor, with resume across a restart.
- Rate limits on Mini App API routes, counted separately on each server instance.
- Content-Security-Policy and related response headers.
- `GET /health` reports whether the latest indexer pass finished.
- Owner console at `/admin`, read-only, behind Telegram Login.

### Fixed

- `JettonExcesses` is accepted only from this contract's USDT jetton wallet.
- `UpdateCommunity` can no longer change the creator's receiving wallet.
- The app and the indexer refuse a registry whose code hash is not `contract/registry.codehash`.
- Expiration checks the Telegram user id stored on the membership.
- A chain transaction can be stored once (`payments.tx_hash` is unique), and a repeated expiry cannot shorten a subscription.
- A payment for a community that is not listed yet is logged and skipped, so the indexer cursor still advances.
- Production indexing does not treat a JSON body as a payment. That fixture remains available in tests.

### Security

- Database access from the anon and authenticated API roles is revoked, and row level security is enabled without per-row policies.
- Logged errors redact bot tokens and API keys.
