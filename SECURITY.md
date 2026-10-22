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

## Known limitations

The source enforces the checks below. The registry already published on testnet is an older deployment and does not enforce them until it is replaced.

- A first payment settles only when the registry owner signed the community payout, the paying wallet, and an expiry inside the jetton payload. The Mini App asks the server for that signature. The server signs the address stored on the community referral link, or an explicit empty payout when there is none. A payment that omits the signature, changes the address, or arrives after the expiry is returned in full and does not lock a marketer. The published testnet registry does not check this signature until the contract is redeployed.
- `RegisterCommunity` is accepted only when the owner signature covers this registry and every stored field: creator wallet, payout, price, duration, PassGram referrer, referral rate, and access mode. The Mini App sends the price, duration, payout, and referrer saved for that community. The published testnet registry does not check these fields until the contract is redeployed. `UpdateCommunity` can still change the price, duration, and creator payout later without a new owner signature.
- A bounced outgoing USDT share stays recorded and is sent again from the registry reserve. `RetryPayouts`, a later Gram transfer, or the next settled payment can fund that resend. The subscriber is not charged again, and `SubscriptionPaid` is not emitted again. A bounce that the USDT jetton wallet absorbs internally, without a bounced message back to the registry, still needs that jetton wallet to restore the tokens before a resend can succeed. The published testnet registry does not retry bounced shares until the contract is redeployed.
- The published testnet registry is an older deployment. Source changes, including the creator-share referral percent, `UpdateCommunity` payout, and the referral authorization on each payment, apply only after that contract is redeployed.
- If referral settlement cannot be loaded, the Mini App does not open the wallet. Sending that payment anyway would lock the subscriber with no community marketer.
