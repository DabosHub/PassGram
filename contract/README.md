# PassGram TON contracts

Tact contracts for USDT Jetton subscription payments with **on-chain** fee and community-referral splits.

## Contracts

- **PassGramRegistry** — registers communities, stores per-community referral bps, settles payments:
  - **Primary path:** `JettonTransferNotification` from the contract’s USDT jetton wallet (opcode `0x7362d09c`)
  - Parses subscribe forward payload (`SUBS` / `0x53554253`) → community id, optional community payout address, expiry, and a 64-byte owner signature
  - Pays creator / treasury / platform affiliate / community promoter via outbound `JettonTransfer`
  - The community promoter address is the payout named in that payload, and only when the registry owner signed it for this payer. The platform affiliate is the address stored when the community was registered, and it is paid whenever that address exists. The payment cannot turn it off
  - Platform: **2.5%** (treasury **2.0%** + platform affiliate **0.5%** when the community has a platform referrer)
  - Community promoter: **R% of the creator share** after the 2.5% platform fee (creator sets `communityReferralBps`, max 50%)
  - Emits `SubscriptionPaid` for the subscription price. USDT above the price is returned to the payer and emits `ExcessReturned`. An invalid payment emits `PaymentRefunded` and returns the full amount
  - The owner calls `DiscoverUsdtJettonWallet` once after deploy. The USDT master replies with this contract's jetton wallet, and that reply is the only way the address is stored. A pasted address is rejected, and a second discovery is rejected

## Fee constants

| Share | BPS | Notes |
|-------|-----|-------|
| Platform | 250 | 2.5% of gross |
| Treasury (with platform affiliate) | 200 | 2.0% |
| Platform affiliate | 50 | 0.5% = 20% of platform fee |
| Community promoter | 0–5000 | Creator-configured % of the creator share, after the platform fee |
| Creator | remainder | After platform + community cuts |

## On-chain community referrals

1. Creator calls `SetCommunityReferral` (opcode `SCRF` / `0x53435246`) from the wallet that registered the community. A rate from 1 to 5000 bps emits `CommunityReferralActivated` and becomes the only rate a new payment can use. A rate of 0 emits `CommunityReferralStopped`. Subscribers who already locked a rate keep that rate.
2. Creator calls `SetCommunityPaused` (opcode `SCPS` / `0x53435053`) from that same wallet. Pausing emits `CommunityDeactivated` and new payments are returned to the payer. Resuming emits `CommunityReactivated`. Price, duration, and the referral rate stay stored.
3. Subscriber pays USDT Jetton to the **registry address** with forward payload: community id, optional **community payout address**, an expiry, and the registry owner's signature of that payout for this paying wallet. The server builds that signature from the address stored on the community referral link. An explicit empty payout is signed when there is no community marketer. A missing, mismatched, or expired signature returns the whole payment and writes no lock. A signed payout that is the creator or the payer is not paid a commission, and that first payment locks no marketer. Any other signed payout is paid from the creator share at the community's current rate, and the first payment locks that address and rate. A renewal still requires a fresh signature and pays the locked address and the locked rate. That address is recorded once on the community referral link, from a gasless signature by the wallet that will receive it, and is separate from the PassGram referrer payout. The creator share is paid to the wallet that registered the community. `UpdateCommunity` changes the price and duration only. That receiving wallet stays the registering wallet, and payments already settled stay where they were paid.
4. Jetton wallet notifies the registry. A damaged payload, an unknown or paused community, a non-subscription access mode, an amount below the price, or a referral authorization that is missing, expired, or mismatched is returned to the payer in full and emits `PaymentRefunded` (`RFND` / `0x52464e44`, reason 7 for the authorization). No `SubscriptionPaid` event is emitted, so the channel stays closed. Amounts above the price settle the price and return the extra USDT. A signed subscription whose community payout equals the creator or the payer, or whose current community rate is zero, still pays the creator and the treasury and emits `SubscriptionPaid` with no community commission. Each outgoing USDT transfer attaches 0.15 Gram, which covers deployment of a mainnet USDT jetton wallet (state init, send and receive gas, and five years of storage). Unused Gram comes back to the registry as `JettonExcesses`. If the registry balance cannot fund every transfer, the whole payment is returned instead of leaving USDT in the contract. Each outgoing share is stored under its query id. A bounced `JettonTransfer` keeps that share queued. `RetryPayouts` (`RTRY` / `0x52545259`), a later Gram deposit, or a later settled payment sends the queued share again and emits `PayoutRetried`. The subscriber is not charged a second time. The registry must hold Gram for these transfers. The deploy script sends 2 Gram by default.
5. Referral links are stored in the database. Creating one asks the marketer for a gasless wallet signature so the stored receiving wallet is the wallet they control. That signature is not a chain transaction and does not spend Gram. The contract has no link-registration message. A community referral link stores its own receiving wallet, once, for that community. `RegisterCommunity` may include the PassGram referrer's payout address, which is a separate program. The owner's approval covers every field stored by `RegisterCommunity` and includes this contract's address, so the signature cannot be reused on another deployment or with a substituted price, payout, or PassGram referrer. The Mini App and the indexer accept a deployment only when its code hash equals `contract/registry.codehash`.

## Registering a community

`RegisterCommunity` is accepted only when both of these hold:

1. `sender()` is the creator address in the message.
2. The owner's Ed25519 key has signed the cell `AUTH` (`0x41555448`) + this contract's address + `communityId` + the creator wallet, plus a reference holding the payout, price, duration, PassGram referrer (one bit, then the address when present), referral rate, and access mode. That 64-byte signature travels in the message. Changing any of those fields makes the signature invalid.

A successful registration emits `CommunityRegistered` (`CREG` / `0x43524547`) with the community id, creator wallet, price, duration, PassGram referrer, referral rate, and access mode. A later price or duration change emits `CommunityUpdated` (`CUPD` / `0x43555044`). The public key is stored at deploy (`PassGramRegistry.init`). The owner wallet can replace it with `RotateOwnerKey` (`ROWK` / `0x524f574b`): the current key signs this contract, the new key, and an expiry within one day, and the owner address sends that message. A copied server secret cannot rotate the key by itself. The contract emits `OwnerKeyRotated` (`OKRT` / `0x4f4b5254`). The Mini App asks the server for the signature after the community row exists and the creator wallet is connected. The server signs only for the Telegram user who owns that community id. Set `PASSGRAM_OWNER_SECRET` to the 32-byte seed (64 hex characters) of that same key. It is not a link-registration key and it does not move USDT.

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

## Deploy

The deploy script publishes the contract that was just built, and only if that code hash matches `contract/registry.codehash`. The app rejects any other registry.

Testnet:

```bash
npm run build
npm test
npm run deploy:testnet
```

Mainnet, after this source is the one you intend to publish:

```bash
npm run build
npm test
# PowerShell:
$env:PASSGRAM_DEPLOY_MAINNET = "1"
npm run deploy:mainnet
```

Unset `TON_API_URL` first, or point it at the same network as the deploy. A testnet URL cannot deploy mainnet, and a mainnet URL cannot deploy testnet. Mainnet uses jUSDT `EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs`. Testnet uses USDTTT `kQD0GKBM8ZbryVk2aESmzfU6b9b_8era_IkvBSELujFZPsyy`.

1. Fund the deployer wallet. On testnet, `@testgiver_ton_bot` can supply Gram and `@testgiver_usdt_bot` can mint test USDT.
2. Copy `contract/.env.example` → `contract/.env` and set `DEPLOYER_MNEMONIC`. Set `TREASURY_ADDRESS` in `.env.local`.
3. Paste the printed `NEXT_PUBLIC_*`, `PASSGRAM_REGISTRY_ADDRESS`, and `PASSGRAM_REGISTRY_CODE_HASH` into `.env.local` and the bot host.
4. Keep a Gram reserve on the registry (the script sends `GAS_RESERVE_TON`) so outbound USDT transfers have gas.

## Wire checklist after deploy

| Step | Where |
|------|--------|
| Registry address | `NEXT_PUBLIC_PASSGRAM_REGISTRY` + `PASSGRAM_REGISTRY_ADDRESS` |
| Registry code | `PASSGRAM_REGISTRY_CODE_HASH` printed by the deploy script. It must equal `contract/registry.codehash` |
| Network + jetton | `NEXT_PUBLIC_TON_NETWORK=mainnet` or `testnet`, and the USDT master for that network |
| Indexer | `bot-service` with the TonCenter URL for that network, an API key, and `PASSGRAM_REGISTRY_CODE_HASH` |
| Communities | Creator wallet signs `RegisterCommunity` before first pay. That wallet receives the creator share. Later price and duration changes use `UpdateCommunity` from that same wallet. |

Mainnet is deployed from this source with `npm run deploy:mainnet`. The app does not operate against an older registry.
