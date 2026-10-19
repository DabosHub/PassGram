# PassGram Referral Attribution Design

Status: locked  
Scope: how invite links attribute a PassGram user to a marketer, and how that attribution feeds future community revenue share

## 1. Product model

PassGram uses **one account per Telegram user**.

- The same account can later subscribe, create communities, or earn affiliate commissions.
- A user becomes a **creator** only after they create their **first community** in the app.
- Wallet signing is required **only when paying for a subscription**. Creating a community does not require a payment signature.
- Referral attribution is **not** established by `register_creator` or any creator wallet transaction.

## 2. When attribution happens

Attribution is established when a user opens a marketer’s invite and presses **Start** on the bot.

Example link:

```text
https://t.me/PassGramBot?start=ref_mira
```

Trusted identity comes from:

1. the bot `message` / `start` update (webhook), and/or
2. validated Mini App `initData` when the app opens with the same start payload.

The frontend must not be trusted to invent a Telegram user id.

## 3. First-touch lock

```text
telegram_user_id → referrer_code / referrer_telegram_user_id
```

Rules:

- The first successful attribution wins.
- Later invite links do not replace an existing lock.
- A user cannot attribute to their own affiliate code.
- The code must belong to a registered affiliate with a payout account.
- Attribution is stored server-side before the user creates a community.

Local Mini App storage may mirror the lock for UI, but the server record is authoritative.

## 4. Affiliate registration

Marketers register without choosing a vanity code:

1. Enter a required NEAR payout account (`name.near` or implicit address).
2. PassGram generates a short referral code and invite link.
3. Server stores `{ code, telegram_user_id, payout_account }`.

The payout account is where affiliate commissions are sent when settlement runs. Registration does not move funds.

## 5. Relationship to communities and payments

```text
Start(ref_A)
  → lock invitee → A
  → invitee later creates first community
  → community inherits referrer A
  → each eligible paid subscription in that community
     allocates 0.5% of payment (20% of the 2.5% PassGram fee) to A’s payout account
```

- Community creation reads the locked attribution for the creator’s Telegram user id.
- Payment settlement uses the community’s inherited referrer (or the creator’s locked attribution at create time), not a code typed at payment time.
- If the creator has no attribution, the full 2.5% fee stays with the platform treasury path.

## 6. Explicit non-goals

- Do not require wallet signature to lock a referral.
- Do not treat opening the Mini App without a start payload as attribution.
- Do not re-bind attribution when the user creates additional communities; they keep the same first-touch referrer.
- Do not credit commissions from unconfirmed or simulated payments.

## 7. Server surfaces

| Endpoint / path | Purpose |
| --- | --- |
| `POST /api/telegram/referrals/register` | Register affiliate payout + generated code |
| `POST /api/telegram/referrals/attribute` | Lock attribution from Mini App `initData` + code |
| `GET /api/telegram/referrals/me` | Return affiliate profile and/or locked attribution |
| Telegram webhook `/start ref_<code>` | Lock attribution from bot Start |

All Bot API and `initData` validation stay on the server. The bot token never reaches the Mini App.

## 8. Contract note

The current on-chain `register_creator(referral_code)` path assumes a NEAR-account creator registration. Product attribution is Telegram-first.

Until the payment contract is revised to consume server-attested referrer settlement (or an equivalent indexer bridge), the server stores:

- affiliate payout accounts,
- first-touch attribution,
- referrer snapshot on each created community,

so commission routing can be applied at settlement time without asking creators to sign a referral registration transaction.
