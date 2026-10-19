# PassGram TON contracts

Tact contracts for USDT Jetton subscription payments with **on-chain** fee and community-referral splits.

## Contracts

- **PassGramRegistry** — registers communities, stores per-community referral bps, settles payments:
  - **Primary path:** `JettonTransferNotification` from the contract’s USDT jetton wallet (opcode `0x7362d09c`)
  - Parses subscribe forward payload (`SUBS` / `0x53554253`) → community id + platform flag + optional community referrer
  - Pays creator / treasury / platform affiliate / community promoter via outbound `JettonTransfer`
  - Platform: **2.5%** (treasury **2.0%** + platform affiliate **0.5%** when the community has a platform referrer)
  - Community promoter: **R% of gross from the creator share** (creator sets `communityReferralBps`, max 50%)
  - Emits `SubscriptionPaid` with all split amounts
  - Owner must call `SetUsdtJettonWallet` after deploy (deploy script does this)
- **PassNft** — v2 placeholder for token-gating / SBT. Not wired to payments.

## Fee constants

| Share | BPS | Notes |
|-------|-----|-------|
| Platform | 250 | 2.5% of gross |
| Treasury (with platform affiliate) | 200 | 2.0% |
| Platform affiliate | 50 | 0.5% = 20% of platform fee |
| Community promoter | 0–5000 | Creator-configured % of gross, taken from creator share |
| Creator | remainder | After platform + community cuts |

## On-chain community referrals

1. Creator calls `SetCommunityReferral` (opcode `SCRF` / `0x53435246`).
2. Subscriber pays USDT Jetton to the **registry address** with forward payload: community id + platform-referrer flag + optional **community referrer address**.
3. Jetton wallet notifies the registry → splits and Jetton payouts happen on-chain.

Mini App / bot-service still handle Telegram attribution (`c_<id>_cref_<code>`) and resolve the promoter payout address into the payment payload.

## USDT Jetton masters

- **Mainnet jUSDT:** `EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs`
- **Testnet USDTTT:** `kQD0GKBM8ZbryVk2aESmzfU6b9b_8era_IkvBSELujFZPsyy`

## Build

```bash
cd contract
npm install
npm run build
npm test
```

## Deploy (testnet)

1. Fund a testnet wallet (`@testgiver_ton_bot`) and optionally mint test USDT (`@testgiver_usdt_bot` / demo giver).
2. Copy `contract/.env.example` → `contract/.env` and set `DEPLOYER_MNEMONIC`.
3. Run:

```bash
npm run build
npm run deploy:testnet
```

4. Paste the printed `NEXT_PUBLIC_*` / `PASSGRAM_REGISTRY_ADDRESS` into repo `.env.local`.
5. Keep a small TON balance on the registry (script funds `GAS_RESERVE_TON`) so outbound Jetton transfers have gas.

## Wire checklist after deploy

| Step | Where |
|------|--------|
| Registry address | `NEXT_PUBLIC_PASSGRAM_REGISTRY` + `PASSGRAM_REGISTRY_ADDRESS` |
| Network + jetton | `NEXT_PUBLIC_TON_NETWORK=testnet`, `NEXT_PUBLIC_USDT_JETTON=…` |
| Indexer | `bot-service` with TonCenter testnet URL + API key |
| Communities | Owner `RegisterCommunity` (or your admin path) before first pay |

Mainnet deploy and secret rotation remain a separate ops step.
