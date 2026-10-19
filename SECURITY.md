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
- Keep a TON gas reserve on the registry for outbound Jetton transfers.
