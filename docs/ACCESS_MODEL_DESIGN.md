# PassGram Access Model Design

Status: locked product decisions for the next contract revision  
Scope: on-chain community access, membership, payments, and future token gates  
MVP UI: paid subscriptions in native NEAR only  
Language of product surfaces remains English  

Referral attribution (Telegram Start, first-touch, no creator wallet signature) is specified in `docs/REFERRAL_ATTRIBUTION_DESIGN.md`.

## 1. Goal

Design the smart contract so the first release can ship **Paid Subscriptions** while the state model already supports **Token-Gated** and **Hybrid** access without a later rewrite of membership or fee logic.

The contract must separate three concerns:

1. **Community** — the PassGram record for a private Telegram channel or group.
2. **Access policy** — how a user may earn the right to enter.
3. **Membership / entitlement** — whether a specific account currently has access, why, and until when.

Payment is one source of entitlement. It must not be the only representation of access.

## 2. Locked decisions

These decisions are fixed for the contract specification.

### 2.1 Asset classes for Token-Gated

The schema and verification adapters support **both FT (NEP-141) and NFT (NEP-171 / related)** from day one, with **independent verification logic** per asset class.

Cross-chain assets are not implemented in the first token-gate release. `AssetRef` is designed so other networks can be added later without binding membership logic to a single chain.

### 2.2 Eligibility timing (token membership)

Eligibility is checked **only when the user subscribes or renews**.

Once eligibility is proven and an entitlement period is granted:

- the user keeps access for the full membership period defined by policy;
- selling, transferring, or otherwise losing the asset **during** that period does **not** revoke access;
- there is **no** continuous ownership monitoring;
- there is **no** grace period tied to balance changes;
- there is **no** automatic revoke because the balance changed mid-period.

Membership ends at its scheduled `expires_at_ms`. Re-verification happens only on the next user-initiated renew.

### 2.3 Renewal is user-initiated

When the period ends, the user requests renewal. The system checks **current** eligibility at that moment, then:

- if eligible → grant a new access period;
- if not eligible → reject renewal (do not invent access);
- if verification fails for a **technical** reason (timeout, missing callback, asset contract error) → expose retry; do **not** treat the user as ineligible.

### 2.4 NEAR-native assets first

Token verification is implemented first for native NEAR assets. Foreign chains are reserved through `AssetRef` adapters and are out of scope until a later release.

### 2.5 Launch product surface

The first UI supports **paid access priced and settled in native NEAR only**.

The policy model remains able to represent Paid, Token-Gated, and Hybrid later. Token-Gated and Hybrid are not exposed in the launch UI.

> Note: the current experimental contract settles in USDT. The locked MVP target for the next revision is native NEAR. Fee math, storage, and payment methods must be redesigned for NEAR transfers rather than `ft_on_transfer` of USDT.

### 2.6 Three mandatory contract rules

1. **Access duration is independent of continued asset ownership.** After membership is granted, it is not cancelled because the token or NFT is sold or transferred. It expires on schedule; eligibility is checked again only at renew.
2. **A successful verification step is not the same as a finished grant.** If verification calls another NEAR contract, the flow must be a safe asynchronous promise/callback pipeline. Entitlement is recorded only after the trusted callback. Retries must be idempotent: no double membership period and no double fee charge.
3. **On-chain entitlement expiry is separate from Telegram channel removal.** When entitlement ends and no other valid source remains, the off-chain indexer/bot removes the Telegram member. The smart contract cannot act inside Telegram.

### 2.7 Hybrid evaluation

`has_access` evaluates **all currently valid entitlement sources**.

Example: if the user still has an active paid subscription and a token-based membership period ends, access continues while the paid source is valid. Access is never tied to a single source when other valid sources remain.

## 3. Non-goals for the first contract release

- Building the Token-Gated or Hybrid creator UI.
- Continuous token-balance watchers or mid-period auto-revoke.
- Calling foreign-chain RPCs from the PassGram contract.
- Treating a frontend-supplied balance, NFT id list, or screenshot as proof of ownership.
- Having the contract ban/unban Telegram members directly.

## 4. Current contract gap

The existing contract stores price and period on `Community` and stores only `Subscription { expires_at_ms, last_payment_id }`.

That model:

- assumes paid time-boxed access only;
- has no access policy object;
- has no entitlement source other than payment;
- has no place for FT/NFT rules, hybrid rules, or future cross-chain asset references;
- settles in USDT, which the locked MVP replaces with native NEAR.

A single `access_type` enum on `Community` is not enough.

## 5. Core objects

### 5.1 Community

Stable identity and Telegram binding. Ownership is the creator NEAR account.

```text
Community {
  id
  owner
  name
  telegram_chat_id?          // verified off-chain; stored for indexer/bot correlation
  active
  created_at_ms
  current_policy_id          // points at AccessPolicy
}
```

Community does **not** own the payment amount, token rule, or membership expiry.

### 5.2 AccessPolicy

Versioned policy attached to a community. Policies are versioned so historical entitlements remain interpretable.

```text
AccessPolicy {
  id
  community_id
  version
  mode                       // Paid | TokenGated | Hybrid
  paid?: PaidRule
  token?: TokenRule
  hybrid?: HybridRule
  membership_period_seconds  // duration granted after a successful subscribe/renew
  created_at_ms
  created_by
}
```

#### PaidRule

```text
PaidRule {
  asset                      // native NEAR for MVP
  price_yocto                // integer yoctoNEAR; never floating point
  fee_schedule_id            // platform/referrer split used for this policy
}
```

MVP activates communities with `mode = Paid` only.

#### TokenRule

```text
TokenRule {
  assets: [AssetRef]         // FT and/or NFT refs; each verified by its own adapter
  ft_requirement?            // MinBalance + min_amount
  nft_requirement?           // OwnAnyFromCollection | OwnSpecificSet
}
```

There is no `revoke_policy` for mid-period balance loss. Mid-period ownership changes do not affect an already granted period.

Eligibility check points are only:

- initial subscribe;
- user-initiated renew after expiry.

#### HybridRule

```text
HybridRule {
  operator                   // AnyOf | AllOf
  require_paid               // bool
  require_token              // bool
}
```

- `AnyOf`: payment **or** token eligibility can create a source.
- `AllOf`: both conditions required to create/renew under that path.

After sources exist, `has_access` still unions **all valid sources** (see §2.7). Hybrid is reserved in schema; launch UI does not expose it.

### 5.3 Entitlement (Membership)

The only on-chain answer to “may this account access this community right now?”

```text
Entitlement {
  community_id
  account_id
  status                     // Active | Expired | PendingVerification
  sources: [EntitlementSource]
  valid_until_ms             // max expiry among currently active sources; used by has_access
  last_evaluated_at_ms
}
```

```text
EntitlementSource {
  kind                       // Payment | TokenFt | TokenNft
  payment_id?
  asset_ref?
  verification_request_id?   // correlates async callback; idempotency key
  evidence_ref?
  granted_at_ms
  expires_at_ms              // fixed end of this granted period
}
```

Rules:

- Access is derived from sources, never from “there was a payment somewhere.”
- Multiple sources may coexist. Access continues while **any** source is still within its `expires_at_ms`.
- Paid and token periods both expire relative to the **grant confirmation time** (payment settled or token verification callback succeeded), not community creation.
- Token sources are **time-boxed**. They are not open-ended “while you hold the asset” memberships.
- Selling the asset mid-period does not remove or shorten an existing `EntitlementSource`.

### 5.4 PaymentRecord

Independent commercial ledger. Payments create or extend payment sources; they are not entitlements themselves.

```text
PaymentRecord {
  payment_id
  community_id
  policy_id
  payer
  asset                      // native NEAR for MVP
  gross_amount               // yoctoNEAR
  creator_amount
  treasury_amount
  referrer?
  referrer_amount
  paid_at_ms
  entitlement_until_ms
  tx_correlation
}
```

Fee distribution stays on payment settlement: subscriber pays the listed price; platform fee comes from the creator share.

### 5.5 VerificationRequest (async safety)

Required for token (and any future) cross-contract checks.

```text
VerificationRequest {
  id                         // unique idempotency key
  community_id
  account_id
  purpose                    // Subscribe | Renew
  status                     // Pending | Succeeded | FailedTechnical | RejectedIneligible
  created_at_ms
  completed_at_ms?
  result_entitlement_source_id?
}
```

Rules:

- Entitlement is written only on `Succeeded`.
- Replaying the same `id` or the same in-flight request must not grant a second period or charge twice.
- `FailedTechnical` allows user retry with a new or resumed request; it is not stored as ineligibility.
- `RejectedIneligible` is a definitive failed eligibility check at subscribe/renew time only.

## 6. Public contract surface

### MVP methods (Paid / native NEAR)

- `register_creator`
- `set_payout_account`
- `create_community_with_policy(paid_policy)`
- `update_paid_policy` — owner only; does not rewrite past entitlements
- payable subscribe / renew path for native NEAR (exact listed price)
- `get_entitlement(community_id, account_id)`
- `has_access(community_id, account_id) -> bool`
- quote / claim / referral / admin as needed for the NEAR fee model

### Reserved methods (schema present; logic gated until Token-Gated ships)

- `set_token_policy` — accepts FT and/or NFT rules
- `set_hybrid_policy`
- `request_token_access(community_id)` — subscribe or renew; starts async verification
- `on_ft_eligibility_result(...)` / `on_nft_eligibility_result(...)` — trusted callbacks only
- future cross-chain attestation entrypoints behind `AssetRef` adapters

`has_access` is the single read path for the indexer and bot.

## 7. Paid Subscription MVP

Currency for launch: **native NEAR**, integer yoctoNEAR only.

Flow:

1. Creator sets paid policy: NEAR price, membership period, payout account.
2. Subscriber pays the listed NEAR amount through the contract’s payable path.
3. Contract records `PaymentRecord` and creates/extends a Payment `EntitlementSource` to `paid_at + period` (or `max(now, current_source_expiry) + period` when stacking is allowed by policy).
4. Indexer reads entitlement events and instructs the bot to invite or keep Telegram access.
5. When all sources expire, `has_access` becomes false. The **backend/bot** removes the Telegram member. The contract does not talk to Telegram.

No Token-Gated UI is required for this path.

## 8. Token-Gated verification on NEAR

NEAR cross-contract calls are asynchronous. The PassGram contract never trusts a user-submitted balance or NFT list.

### 8.1 Native NEAR assets

Supported in the token-gate design:

- NEP-141 fungible tokens — independent FT adapter
- NEP-171 NFTs — independent NFT adapter

Subscribe / renew flow:

1. User calls `request_token_access` (subscribe or renew).
2. Contract creates `VerificationRequest` in `Pending` and issues the correct promise for FT or NFT.
3. Callback receives the asset-contract result.
4. If eligible → mark request `Succeeded`, write time-boxed `EntitlementSource`, emit grant/extend event.
5. If ineligible → mark `RejectedIneligible`; no entitlement change.
6. If technical failure → mark `FailedTechnical`; UI offers retry; user is not marked ineligible.

After a successful grant, mid-period transfers do not trigger revoke.

### 8.2 Cross-chain later

The contract does not call foreign RPCs. Future networks plug in through `AssetRef` without changing entitlement semantics.

```text
AssetRef {
  kind                       // Nep141 | Nep171 | FutureCrossChainAdapter
  chain_hint?                // metadata only until an adapter exists
  near_contract?             // required for native NEAR FT/NFT
  foreign_asset_id?
  adapter_id?                // reserved for later Omni / Intents / attestation adapters
}
```

First implementation uses `Nep141` and `Nep171` only.

## 9. Hybrid access

Hybrid composes how new sources may be earned (`AnyOf` / `AllOf`).

Independently, **access while sources exist** always unions valid sources:

- active paid source + expired token source → still has access;
- expired paid source + active token source → still has access;
- no valid source → no access; bot removes Telegram membership.

## 10. Roles and authority

| Actor | May do |
| --- | --- |
| Community owner | Create/update policies for own community |
| Subscriber | Pay NEAR; request token subscribe/renew for self |
| Platform admin | Pause, treasury, global fee schedule |
| Asset-contract callbacks | Complete verification only for requests this contract created |
| Telegram bot / indexer | Read events and `has_access`; grant/revoke Telegram members; never write entitlements |

## 11. Events for indexer and bot

Emit NEP-297-compatible events for:

- `community_created`
- `policy_updated`
- `payment_settled`
- `verification_pending`
- `verification_succeeded`
- `verification_rejected_ineligible`
- `verification_failed_technical`
- `entitlement_granted`
- `entitlement_extended`
- `entitlement_expired` (optional helper; bot may also poll `has_access`)

Bot behavior:

- grant/keep Telegram access when `has_access == true`;
- remove Telegram access when `has_access == false` and no other valid source exists;
- never infer revocation from a mid-period token transfer event alone.

Telegram member count and PassGram paid subscriber count stay separate off-chain metrics.

## 12. Entitlement vs Telegram access

```text
On-chain:   Verification → EntitlementSource → has_access(time)
Off-chain:  Indexer/bot reads has_access → createChatInviteLink / banChatMember
```

These clocks are related but not identical:

- entitlement may expire at `T`;
- Telegram removal happens when the backend observes expiry (or the next check) and confirms no other valid source.

The contract specification must not assume instantaneous Telegram removal inside the same transaction as expiry.

## 13. Migration from the current contract

1. Treat the current USDT paid-only contract as a prototype if not yet mainnet-critical.
2. Implement v2 with Community / AccessPolicy / Entitlement / PaymentRecord / VerificationRequest.
3. Paid path uses native NEAR.
4. Token FT/NFT adapters and Hybrid remain schema-ready; UI stays paid-only at launch.
5. If any USDT subscriptions exist in production, define an explicit migration or sunset; do not silently mix USDT and NEAR paid ledgers.

## 14. Launch matrix

| Capability | Contract schema | Contract logic | Creator UI | Subscriber UI |
| --- | --- | --- | --- | --- |
| Paid native NEAR subscription | Yes | Yes | Yes | Yes |
| Token-Gated NEAR FT | Yes | Yes when Token-Gated ships | No at launch | No at launch |
| Token-Gated NEAR NFT | Yes | Yes when Token-Gated ships | No at launch | No at launch |
| Hybrid AnyOf/AllOf | Yes | Stub / gated | No | No |
| Cross-chain AssetRef adapters | Reserved | No | No | No |

## 15. Acceptance criteria for the design

The architecture is ready for implementation when:

- membership can exist without a payment record;
- payment can create membership without becoming the membership object;
- FT and NFT each have a distinct verification path;
- a granted period is not revoked by mid-period asset transfer;
- renew is user-initiated and re-checks eligibility only then;
- technical verification failures are retryable and distinct from ineligibility;
- async verification is idempotent before final entitlement write;
- `has_access` unions all valid sources (Hybrid-safe);
- Telegram removal is an off-chain consequence of `has_access`, not a contract call into Telegram;
- MVP can ship paid NEAR only without deleting Token-Gated or Hybrid schema.
