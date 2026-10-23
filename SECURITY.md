# Security

PassGram is intended to be open source. Treat production credentials as private even when the code is public.

## Never commit

- `.env.local`, `contract/.env`, or any file with real tokens
- Wallet mnemonics / private keys
- `TELEGRAM_BOT_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, database passwords
- TonCenter or other API keys

Use [`.env.example`](.env.example) and [`contract/.env.example`](contract/.env.example) as templates only.

## Before going public or rotating after a leak

1. Revoke and recreate the Telegram bot token via [@BotFather](https://t.me/BotFather) if it was ever committed or shared.
2. Rotate Supabase service role key and database password.
3. Move funds off any wallet whose mnemonic may have been exposed; use a fresh wallet for deploy/owner.
4. Set secrets in Vercel / host env vars — not in the git tree.

## On-chain notes

- Only trust Jetton `transfer_notification` messages from the registry’s bound USDT jetton wallet.
- Keep a TON gas reserve on the registry for outbound Jetton transfers. Each outgoing USDT transfer attaches 0.15 Gram.

## Owner console

`/admin` is for the Telegram user ids in `PASSGRAM_ADMIN_TELEGRAM_IDS`. The sign-in check uses the bot token, and the session cookie is HttpOnly. Leave the allowlist empty to keep the console closed. Do not put invite links, the bot token, or the database URL in that page.

## Known limitations

The Mini App signs a community registration or a payment only when the configured registry's on-chain code hash equals this source (`contract/registry.codehash`). The indexer records a subscription only on that same check. The registry previously published on testnet is an older contract, so it does not match and cannot be used. Mainnet goes live by deploying this source with `npm run deploy:mainnet` and setting the printed address. Do not point production at an older deployment.

- A first payment settles only when the registry owner signed the community payout, the paying wallet, and an expiry inside the jetton payload. The Mini App asks the server for that signature. The server signs the address stored on the community referral link, or an explicit empty payout when there is none. A payment that omits the signature, changes the address, or arrives after the expiry is returned in full and does not lock a marketer.
- `RegisterCommunity` is accepted only when the owner signature covers this registry and every stored field: creator wallet, payout, price, duration, PassGram referrer, referral rate, and access mode. The payout is that same creator wallet. The contract rejects a registration whose payout is a different address. The Mini App sends the price, duration, and referrer saved for that community, and the connected wallet as both creator and payout. `UpdateCommunity` can still change the price and duration later without a new owner signature. It does not change the creator's receiving wallet.
- A bounced outgoing USDT share stays recorded and is sent again from the registry reserve. `RetryPayouts`, a later Gram transfer, or the next settled payment can fund that resend. The subscriber is not charged again, and `SubscriptionPaid` is not emitted again. A bounce that the USDT jetton wallet absorbs internally, without a bounced message back to the registry, still needs that jetton wallet to restore the tokens before a resend can succeed.
- `RegisterCommunity` emits `CommunityRegistered`, and `UpdateCommunity` emits `CommunityUpdated`. An indexer can read the community id, creator wallet, price, and duration from the chain.
- The USDT jetton wallet is stored only from the configured USDT master's reply for this contract. The owner cannot paste an address, a reply about another owner is rejected, and the stored address cannot be replaced. The contract emits `UsdtJettonWalletSet` when it is stored.
- The owner wallet can replace the server signing key with `RotateOwnerKey`. The current key signs this registry, the new key, and an expiry of at most one day, and the owner address must send the message. A leaked `PASSGRAM_OWNER_SECRET` by itself cannot install a new key. After the replacement, signatures from the old key are rejected.
- A Telegram account is linked to a wallet only after that wallet signs a gasless account confirmation for that Telegram user. A typed address is not accepted. If the connected wallet is already the saved one, a later payment does not ask again.
- A PassGram or community referral link stores the wallet that signed a gasless confirmation for that link. A typed address is not accepted. The signature proves control of the wallet and does not send a chain transaction.
- If referral settlement cannot be loaded, the Mini App does not open the wallet. Sending that payment anyway would lock the subscriber with no community marketer.
- There is no owner withdrawal. USDT leaves the registry only as the creator, treasury, and affiliate shares of a settled payment, or as a retry of one of those shares. This is intentional: the owner cannot take a subscriber's USDT.
- A payment whose community is not in `creator_communities` is logged with its transaction hash and skipped. The indexer cursor still advances, so one early payment cannot stop later payments. That skipped payment is not replayed when the community row appears later.
- `payments.referrer_account_id` is the subscriber's saved PassGram referrer when the event says a platform referrer was paid. It is not the `platformMarketer` stored on the community at registration. Those wallets can differ, so affiliate analytics can disagree with the address the contract paid.
- API rate limits are counted in memory on each server instance. Several instances do not share one counter.
- Gasless wallet proofs are accepted for `passgram.app` as well as the hosts in `PASSGRAM_PUBLIC_URL` and `PASSGRAM_APP_DOMAINS`. `passgram.app` stays accepted if the public URL later changes.
- `GET /health` on bot-service returns 200 while the process is starting and after an indexer pass finishes, including a pass that finds nothing. It returns 503 when the latest indexer pass threw.

## Vulnerability disclosure

Report a vulnerability through a [private security advisory](https://github.com/DabosHub/PassGram/security/advisories/new). Do not open a public issue, and do not include tokens, mnemonics, or a live database URL.

PassGram will acknowledge a report within 48 hours and aim to ship a fix, or a documented decision not to change the behavior, within 90 days. Give the project that window before discussing the report in public. There is no published PGP key; the private advisory is the disclosure channel.
