// PassGramRegistry — USDT Jetton receiver + on-chain fee / community-referral splitter.
// Primary payment path: JettonTransferNotification from the registry's USDT jetton wallet.
// Owner sets usdtJettonWallet after deploy (wallet of this contract for the USDT master).
// Referral links are not stored here. No message writes a link or spends Gram to record one.

import "@stdlib/deploy";

struct CommunityConfig {
    creator: Address;
    payout: Address;
    price: Int as coins;
    durationSeconds: Int as uint32;
    platformReferrer: Address?;
    communityReferralBps: Int as uint16;
    accessMode: Int as uint8; // only 0 is accepted; token-gating is not implemented
    paused: Bool;
}

struct SubscriberReferralLock {
    bps: Int as uint16;
    marketer: Address?;
}

struct ReferralLockMap {
    locks: map<Address, SubscriberReferralLock>;
}

struct SplitResult {
    creatorAmount: Int as coins;
    treasuryAmount: Int as coins;
    platformAffiliateAmount: Int as coins;
    communityAffiliateAmount: Int as coins;
    hasPlatformReferrer: Bool;
    hasCommunityReferrer: Bool;
}

struct ResolvedCommunityReferral {
    payout: Address?;
    bps: Int as uint16;
    writeLock: Bool;
}

struct ParsedSubscribe {
    communityId: Int as uint64;
    payout: Address?;
    validUntil: Int as uint32;
    authorization: Cell;
}

message(0x7362d09c) JettonTransferNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    forwardPayload: Slice as remaining;
}

message(0x0f8a7ea5) JettonTransfer {
    queryId: Int as uint64;
    amount: Int as coins;
    destination: Address;
    responseDestination: Address;
    customPayload: Cell?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

message SubscriptionPaid {
    subscriber: Address;
    creator: Address;
    communityId: Int as uint64;
    amount: Int as coins;
    paidAt: Int as uint32;
    expiresAt: Int as uint32;
    hasPlatformReferrer: Bool;
    hasCommunityReferrer: Bool;
    communityAffiliateAmount: Int as coins;
    creatorAmount: Int as coins;
    treasuryAmount: Int as coins;
    platformAffiliateAmount: Int as coins;
}

/// opcode "RFND". USDT was credited by the jetton wallet and is being returned to the payer.
/// reason: 1 bad payload, 2 unknown community, 3 paused, 4 token-gated, 5 underpaid,
/// 6 payout transfers cannot be funded, 7 referral authorization missing, expired, or mismatched.
/// A payment above the price is not a refund. The extra USDT is returned and the price is settled.
message(0x52464e44) PaymentRefunded {
    payer: Address;
    amount: Int as coins;
    communityId: Int as uint64;
    reason: Int as uint8;
}

message SetUsdtJettonWallet {
    wallet: Address;
}

/// opcode "EXCS" — USDT above the subscription price was returned to the payer.
/// The subscription itself was settled and SubscriptionPaid was emitted for the price.
message(0x45584353) ExcessReturned {
    payer: Address;
    communityId: Int as uint64;
    amount: Int as coins;
}

/// USDT jetton wallet returns unused Gram here. opcode "excesses".
message(0xd53276db) JettonExcesses {
    queryId: Int as uint64;
}

/// opcode "RTRY". Sends bounced USDT shares again. The subscriber is not charged.
message(0x52545259) RetryPayouts {
    queryId: Int as uint64;
}

/// opcode "RTRP". A previously bounced USDT share was sent again.
message PayoutRetried {
    destination: Address;
    amount: Int as coins;
}

struct OutgoingPayout {
    destination: Address;
    amount: Int as coins;
    queued: Bool;
    nextRetry: Int as uint64;
}

/// opcode "REGC" — community creator signs this with their own wallet.
/// platformMarketer is the PassGram referrer's payout wallet, supplied from the database.
/// It is stored as-is. Later payments pay it whenever it is present.
/// authorization is the owner's 512-bit signature over every field this message stores.
message(0x52454743) RegisterCommunity {
    communityId: Int as uint64;
    creator: Address;
    payout: Address;
    price: Int as coins;
    durationSeconds: Int as uint32;
    platformMarketer: Address?;
    communityReferralBps: Int as uint16;
    accessMode: Int as uint8;
    authorization: Slice as bytes64;
}

/// opcode "UPDC" — only the wallet that registered the community may change its terms.
/// payout is the creator share wallet for subscriptions and renewals after this message.
/// Payments already settled stay in the wallet that received them.
message(0x55504443) UpdateCommunity {
    queryId: Int as uint64;
    communityId: Int as uint64;
    price: Int as coins;
    durationSeconds: Int as uint32;
    payout: Address;
}

/// opcode "SCRF" — matches frontend/lib/ton/registry.ts
message(0x53435246) SetCommunityReferral {
    queryId: Int as uint64;
    communityId: Int as uint64;
    communityReferralBps: Int as uint16;
}

/// Emitted when the creator wallet stores a new community referral rate.
message CommunityReferralActivated {
    communityId: Int as uint64;
    communityReferralBps: Int as uint16;
}

/// Emitted when the creator wallet stops new community referrals.
/// Subscribers who already locked a rate keep that rate.
message CommunityReferralStopped {
    communityId: Int as uint64;
}

/// opcode "SCPS" — creator wallet pauses or resumes payments for this community.
message(0x53435053) SetCommunityPaused {
    queryId: Int as uint64;
    communityId: Int as uint64;
    paused: Bool;
}

message CommunityDeactivated {
    communityId: Int as uint64;
}

message CommunityReactivated {
    communityId: Int as uint64;
}

contract PassGramRegistry with Deployable {
    owner: Address;
    treasury: Address;
    platformFeeBps: Int as uint16;
    affiliateShareOfPlatformBps: Int as uint16;
    maxCommunityReferralBps: Int as uint16;
    usdtJettonMaster: Address;
    /// Ed25519 public key of the owner. RegisterCommunity is accepted only when this key
    /// signed every field stored for that community on this contract.
    ownerPublicKey: Int as uint256;
    /// Jetton wallet owned by THIS contract for usdtJettonMaster. Set by owner after deploy.
    usdtJettonWallet: Address?;
    communities: map<Int as uint64, CommunityConfig>;
    /// First payment locks the community payout address and the community's rate at that moment.
    referralLocks: map<Int as uint64, ReferralLockMap>;
    /// Identifiers for outgoing USDT shares. A bounced share stays here until it is sent again.
    nextPayoutId: Int as uint64;
    retryHead: Int as uint64;
    retryTail: Int as uint64;
    payouts: map<Int as uint64, OutgoingPayout>;

    init(owner: Address, treasury: Address, usdtJettonMaster: Address, ownerPublicKey: Int as uint256) {
        require(ownerPublicKey != 0, "Owner key required");
        self.owner = owner;
        self.treasury = treasury;
        self.platformFeeBps = 250;
        self.affiliateShareOfPlatformBps = 2000;
        self.maxCommunityReferralBps = 5000;
        self.usdtJettonMaster = usdtJettonMaster;
        self.ownerPublicKey = ownerPublicKey;
        self.usdtJettonWallet = null;
        self.communities = emptyMap();
        self.referralLocks = emptyMap();
        self.nextPayoutId = 1;
        self.retryHead = 0;
        self.retryTail = 0;
        self.payouts = emptyMap();
    }

    receive(msg: SetUsdtJettonWallet) {
        require(sender() == self.owner, "Owner only");
        require(self.usdtJettonWallet == null, "USDT wallet already set");
        self.usdtJettonWallet = msg.wallet;
    }

    receive(msg: JettonExcesses) {
        // The jetton wallet accepted this share. Keep the returned Gram and clear the record.
        self.payouts.del(msg.queryId);
        self.retryBouncedPayouts(0);
    }

    receive(_: RetryPayouts) {
        self.retryBouncedPayouts(0);
    }

    receive(msg: RegisterCommunity) {
        // Tag 0x41555448 "AUTH", this contract, and every field stored below.
        // The terms sit in a reference so the marketer address fits in the signed cell.
        let terms: Builder = beginCell()
            .storeAddress(msg.payout)
            .storeCoins(msg.price)
            .storeUint(msg.durationSeconds, 32);
        if (msg.platformMarketer != null) {
            terms = terms.storeBit(true).storeAddress(msg.platformMarketer!!);
        } else {
            terms = terms.storeBit(false);
        }
        let approved: Cell = beginCell()
            .storeUint(0x41555448, 32)
            .storeAddress(myAddress())
            .storeUint(msg.communityId, 64)
            .storeAddress(msg.creator)
            .storeRef(terms.storeUint(msg.communityReferralBps, 16).storeUint(msg.accessMode, 8).endCell())
            .endCell();
        require(checkSignature(approved.hash(), msg.authorization, self.ownerPublicKey), "Owner approval required");
        require(sender() == msg.creator, "Creator must sign");
        require(self.communities.get(msg.communityId) == null, "Community exists");
        require(msg.accessMode == 0, "Token gating is not enabled");
        require(msg.communityReferralBps <= self.maxCommunityReferralBps, "Referral bps too high");
        require(msg.price > 0, "Price required");
        require(msg.durationSeconds >= 86400 && msg.durationSeconds <= 31622400, "Bad duration");
        if (msg.platformMarketer != null) {
            require(msg.platformMarketer!! != sender(), "Self referral");
        }
        let platformPayout: Address? = msg.platformMarketer;
        let cfg: CommunityConfig = CommunityConfig{
            creator: sender(),
            payout: msg.payout,
            price: msg.price,
            durationSeconds: msg.durationSeconds,
            platformReferrer: platformPayout,
            communityReferralBps: msg.communityReferralBps,
            accessMode: msg.accessMode,
            paused: false,
        };
        self.communities.set(msg.communityId, cfg);
    }

    receive(msg: UpdateCommunity) {
        let cfg: CommunityConfig? = self.communities.get(msg.communityId);
        require(cfg != null, "Unknown community");
        let community: CommunityConfig = cfg!!;
        require(sender() == community.creator, "Creator only");
        require(!community.paused, "Community paused");
        require(msg.price > 0, "Price required");
        require(msg.durationSeconds >= 86400 && msg.durationSeconds <= 31622400, "Bad duration");
        community.price = msg.price;
        community.durationSeconds = msg.durationSeconds;
        community.payout = msg.payout;
        self.communities.set(msg.communityId, community);
    }

    receive(msg: SetCommunityReferral) {
        let cfg: CommunityConfig? = self.communities.get(msg.communityId);
        require(cfg != null, "Unknown community");
        let community: CommunityConfig = cfg!!;
        require(sender() == community.creator, "Creator only");
        require(!community.paused, "Community paused");
        require(msg.communityReferralBps <= self.maxCommunityReferralBps, "Referral bps too high");
        if (msg.communityReferralBps == 0) {
            // Stop new referrals. Locks already written for a subscriber stay payable.
            community.communityReferralBps = 0;
            self.communities.set(msg.communityId, community);
            emit(CommunityReferralStopped{ communityId: msg.communityId }.toCell());
        } else {
            community.communityReferralBps = msg.communityReferralBps;
            self.communities.set(msg.communityId, community);
            emit(CommunityReferralActivated{
                communityId: msg.communityId,
                communityReferralBps: msg.communityReferralBps,
            }.toCell());
        }
    }

    receive(msg: SetCommunityPaused) {
        let cfg: CommunityConfig? = self.communities.get(msg.communityId);
        require(cfg != null, "Unknown community");
        let community: CommunityConfig = cfg!!;
        require(sender() == community.creator, "Creator only");
        community.paused = msg.paused;
        self.communities.set(msg.communityId, community);
        if (msg.paused) {
            emit(CommunityDeactivated{ communityId: msg.communityId }.toCell());
        } else {
            emit(CommunityReactivated{ communityId: msg.communityId }.toCell());
        }
    }

    /// Real payment path. USDT is already in the jetton wallet before this message runs.
    /// An invalid subscription is returned to the payer. A first payment is settled only
    /// when the registry owner signed the payout in this message. A missing or wrong
    /// signature returns the whole payment and writes no referral lock.
    /// The sender check stays a hard reject: any other sender did not deliver USDT.
    receive(msg: JettonTransferNotification) {
        require(self.usdtJettonWallet != null, "USDT wallet unset");
        require(sender() == self.usdtJettonWallet!!, "Not USDT wallet");

        let parsed: ParsedSubscribe? = self.tryParseSubscribe(msg.forwardPayload);
        if (parsed == null) {
            self.refundPayment(msg.sender, msg.amount, 0, 1);
            return;
        }
        let request: ParsedSubscribe = parsed!!;
        let cfg: CommunityConfig? = self.communities.get(request.communityId);
        if (cfg == null) {
            self.refundPayment(msg.sender, msg.amount, request.communityId, 2);
            return;
        }
        let community: CommunityConfig = cfg!!;
        if (community.paused) {
            self.refundPayment(msg.sender, msg.amount, request.communityId, 3);
            return;
        }
        if (community.accessMode != 0) {
            self.refundPayment(msg.sender, msg.amount, request.communityId, 4);
            return;
        }
        if (msg.amount < community.price) {
            self.refundPayment(msg.sender, msg.amount, request.communityId, 5);
            return;
        }
        if (!self.communityReferralApproved(request, msg.sender)) {
            self.refundPayment(msg.sender, msg.amount, request.communityId, 7);
            return;
        }

        let subscriber: Address = msg.sender;
        let settled: Int = community.price;
        let excess: Int = msg.amount - settled;
        let decision: ResolvedCommunityReferral = self.decideCommunityReferral(
            request.communityId,
            subscriber,
            community,
            request.payout,
        );
        let communityPay: Address? = self.payableMarketer(decision.payout, community.creator, subscriber);
        let platformPay: Address? = self.payableMarketer(community.platformReferrer, community.creator, subscriber);
        let maybeSplit: SplitResult? = self.computeSplit(settled, community, communityPay, decision.bps, platformPay != null);
        if (maybeSplit == null) {
            self.refundPayment(msg.sender, msg.amount, request.communityId, 1);
            return;
        }
        let split: SplitResult = maybeSplit!!;
        let transferCount: Int = self.outgoingTransfers(split);
        if (excess > 0) {
            transferCount += 1;
        }
        if (!self.canFundTransfers(transferCount)) {
            self.refundPayment(msg.sender, msg.amount, request.communityId, 6);
            return;
        }
        if (decision.writeLock) {
            self.saveReferralLock(request.communityId, subscriber, decision.bps, decision.payout);
        }

        let paidAt: Int = now();
        self.recordAndPay(community.payout, split.creatorAmount);
        if (split.treasuryAmount > 0) {
            self.recordAndPay(self.treasury, split.treasuryAmount);
        }
        if (split.platformAffiliateAmount > 0 && platformPay != null) {
            self.recordAndPay(platformPay!!, split.platformAffiliateAmount);
        }
        if (split.communityAffiliateAmount > 0 && communityPay != null) {
            self.recordAndPay(communityPay!!, split.communityAffiliateAmount);
        }
        if (excess > 0) {
            self.recordAndPay(subscriber, excess);
            emit(ExcessReturned{
                payer: subscriber,
                communityId: request.communityId,
                amount: excess,
            }.toCell());
        }

        emit(SubscriptionPaid{
            subscriber: subscriber,
            creator: community.creator,
            communityId: request.communityId,
            amount: settled,
            paidAt: paidAt,
            expiresAt: paidAt + community.durationSeconds,
            hasPlatformReferrer: split.hasPlatformReferrer,
            hasCommunityReferrer: split.hasCommunityReferrer,
            communityAffiliateAmount: split.communityAffiliateAmount,
            creatorAmount: split.creatorAmount,
            treasuryAmount: split.treasuryAmount,
            platformAffiliateAmount: split.platformAffiliateAmount,
        }.toCell());
        self.retryBouncedPayouts(transferCount);
    }

    receive() {
        // Accept plain TON for gas reserves, then send any bounced shares the reserve can fund.
        self.retryBouncedPayouts(0);
    }

    /// The jetton wallet returned this transfer. The USDT is still in its balance, so the share stays queued.
    bounced(msg: bounced<JettonTransfer>) {
        self.queueBouncedPayout(msg.queryId);
    }

    get fun platformFeeBps(): Int {
        return self.platformFeeBps;
    }

    get fun affiliateShareOfPlatformBps(): Int {
        return self.affiliateShareOfPlatformBps;
    }

    get fun maxCommunityReferralBps(): Int {
        return self.maxCommunityReferralBps;
    }

    get fun treasury(): Address {
        return self.treasury;
    }

    get fun usdtJettonMaster(): Address {
        return self.usdtJettonMaster;
    }

    get fun usdtJettonWallet(): Address? {
        return self.usdtJettonWallet;
    }

    get fun communityReferralBps(communityId: Int): Int {
        let cfg: CommunityConfig? = self.communities.get(communityId);
        if (cfg == null) {
            return 0;
        }
        return cfg!!.communityReferralBps;
    }

    inline fun unwrapForwardPayload(raw: Slice): Slice? {
        // TEP-74 Either Cell ^Cell: bit 0 = inline, bit 1 = ref.
        if (raw.bits() < 1) {
            return null;
        }
        if (raw.loadBool()) {
            if (raw.refs() < 1) {
                return null;
            }
            return raw.loadRef().beginParse();
        }
        return raw;
    }

    inline fun tryParseSubscribe(raw: Slice): ParsedSubscribe? {
        let unwrapped: Slice? = self.unwrapForwardPayload(raw);
        if (unwrapped == null) {
            return null;
        }
        let payload: Slice = unwrapped!!;
        // opcode + communityId + hasPayout
        if (payload.bits() < 97) {
            return null;
        }
        if (payload.loadUint(32) != 0x53554253) {
            return null;
        }
        let communityId: Int = payload.loadUint(64);
        let hasPayout: Bool = payload.loadBool();
        let payout: Address? = null;
        if (hasPayout) {
            // addr_std is 267 bits. A short slice is a damaged payload, not an address to pay.
            if (payload.bits() < 267) {
                return null;
            }
            payout = payload.loadAddress();
        }
        // validUntil + 64-byte owner signature. A short tail is a damaged payload.
        if (payload.bits() < 32 + 512) {
            return null;
        }
        let validUntil: Int = payload.loadUint(32);
        let authorization: Cell = beginCell().storeSlice(payload.loadBits(512)).endCell();
        return ParsedSubscribe{
            communityId: communityId,
            payout: payout,
            validUntil: validUntil,
            authorization: authorization,
        };
    }

    /// CREF cell: tag, this registry, communityId, paying wallet, maybe payout, validUntil.
    /// The maybe-payout is one bit, then a standard address only when that bit is set.
    inline fun communityReferralAuthorizationCell(communityId: Int, subscriber: Address, payout: Address?, validUntil: Int): Cell {
        let b: Builder = beginCell()
            .storeUint(0x43524546, 32)
            .storeAddress(myAddress())
            .storeUint(communityId, 64)
            .storeAddress(subscriber);
        if (payout != null) {
            b = b.storeBit(true).storeAddress(payout!!);
        } else {
            b = b.storeBit(false);
        }
        return b.storeUint(validUntil, 32).endCell();
    }

    /// The signature is data inside the subscriber's payment. It is not a separate owner message.
    inline fun communityReferralApproved(request: ParsedSubscribe, subscriber: Address): Bool {
        if (request.validUntil < now()) {
            return false;
        }
        let approved: Cell = self.communityReferralAuthorizationCell(request.communityId, subscriber, request.payout, request.validUntil);
        return checkSignature(approved.hash(), request.authorization.beginParse(), self.ownerPublicKey);
    }

    /// Decides the community commission without writing state and without aborting the payment.
    /// A first payment uses only the rate currently stored on the community. Any rate in the
    /// payload is ignored. That result is locked. A renewal pays the locked rate.
    inline fun decideCommunityReferral(
        communityId: Int,
        subscriber: Address,
        community: CommunityConfig,
        namedPayout: Address?,
    ): ResolvedCommunityReferral {
        let stored: ReferralLockMap? = self.referralLocks.get(communityId);
        if (stored != null) {
            let existing: SubscriberReferralLock? = stored!!.locks.get(subscriber);
            if (existing != null) {
                return self.payoutForLock(existing!!);
            }
        }
        if (namedPayout == null) {
            return ResolvedCommunityReferral{ payout: null, bps: 0, writeLock: true };
        }
        // The payer cannot name the creator or themselves and collect the community commission.
        if (namedPayout!! == community.creator || namedPayout!! == subscriber) {
            return ResolvedCommunityReferral{ payout: null, bps: 0, writeLock: true };
        }
        let applied: Int = community.communityReferralBps;
        if (applied <= 0 || applied > self.maxCommunityReferralBps) {
            return ResolvedCommunityReferral{ payout: null, bps: 0, writeLock: true };
        }
        return ResolvedCommunityReferral{ payout: namedPayout, bps: applied, writeLock: true };
    }

    inline fun payoutForLock(lock: SubscriberReferralLock): ResolvedCommunityReferral {
        if (lock.marketer == null || lock.bps == 0) {
            return ResolvedCommunityReferral{ payout: null, bps: 0, writeLock: false };
        }
        return ResolvedCommunityReferral{ payout: lock.marketer, bps: lock.bps, writeLock: false };
    }

    inline fun saveReferralLock(
        communityId: Int,
        subscriber: Address,
        bps: Int,
        marketer: Address?,
    ) {
        let stored: ReferralLockMap? = self.referralLocks.get(communityId);
        let nextLocks: map<Address, SubscriberReferralLock> = emptyMap();
        if (stored != null) {
            nextLocks = stored!!.locks;
        }
        nextLocks.set(subscriber, SubscriberReferralLock{ bps: bps, marketer: marketer });
        self.referralLocks.set(communityId, ReferralLockMap{ locks: nextLocks });
    }

    /// A commission is paid to the stored address. The creator and the subscriber receive none.
    inline fun payableMarketer(stored: Address?, creator: Address, subscriber: Address): Address? {
        if (stored == null) {
            return null;
        }
        if (stored!! == creator || stored!! == subscriber) {
            return null;
        }
        return stored;
    }

    inline fun computeSplit(
        gross: Int,
        community: CommunityConfig,
        communityReferrer: Address?,
        communityReferralBps: Int,
        payPlatform: Bool,
    ): SplitResult? {
        let platformFee: Int = (gross * self.platformFeeBps) / 10000;
        let platformAffiliateCut: Int = 0;
        // Pay the stored platform referrer whenever the caller says it is still payable.
        let hasPlatformReferrer: Bool = payPlatform;
        if (hasPlatformReferrer) {
            platformAffiliateCut = (platformFee * self.affiliateShareOfPlatformBps) / 10000;
        }
        let treasuryCut: Int = platformFee - platformAffiliateCut;

        let creatorBeforeReferral: Int = gross - platformFee;
        let communityAffiliateCut: Int = 0;
        let hasCommunityReferrer: Bool = false;
        if (communityReferrer != null && communityReferralBps > 0 && communityReferralBps <= self.maxCommunityReferralBps && communityReferrer!! != community.creator) {
            communityAffiliateCut = (creatorBeforeReferral * communityReferralBps) / 10000;
            hasCommunityReferrer = true;
        }

        let creatorCut: Int = creatorBeforeReferral - communityAffiliateCut;
        if (creatorCut < 0 || creatorCut + treasuryCut + platformAffiliateCut + communityAffiliateCut != gross) {
            return null;
        }

        return SplitResult{
            creatorAmount: creatorCut,
            treasuryAmount: treasuryCut,
            platformAffiliateAmount: platformAffiliateCut,
            communityAffiliateAmount: communityAffiliateCut,
            hasPlatformReferrer: hasPlatformReferrer,
            hasCommunityReferrer: hasCommunityReferrer,
        };
    }

    inline fun outgoingTransfers(split: SplitResult): Int {
        let count: Int = 0;
        if (split.creatorAmount > 0) { count += 1; }
        if (split.treasuryAmount > 0) { count += 1; }
        if (split.platformAffiliateAmount > 0) { count += 1; }
        if (split.communityAffiliateAmount > 0) { count += 1; }
        return count;
    }

    /// USDT jetton wallet (stablecoin-contract, mainnet jUSDT) rejects a transfer that cannot
    /// deploy the recipient wallet. Its check covers forward fees, state-init overhead,
    /// 9255 gas to send, 10355 gas to receive, and five years of storage for 1033 bits and 3 cells.
    /// The measured floor at older network prices was about 0.029 Gram. This message's own
    /// forward fee is taken before that check, so each transfer attaches 0.15 Gram.
    /// Unused Gram is returned to this contract as JettonExcesses.
    inline fun jettonTransferValue(): Int {
        return ton("0.15");
    }

    /// The extra 0.05 Gram stays for this contract's own fees. A short balance returns the USDT.
    inline fun canFundTransfers(count: Int): Bool {
        if (count <= 0) {
            return true;
        }
        return myBalance() >= self.jettonTransferValue() * count + ton("0.05");
    }

    inline fun refundPayment(payer: Address, amount: Int, communityId: Int, reason: Int) {
        self.recordAndPay(payer, amount);
        emit(PaymentRefunded{
            payer: payer,
            amount: amount,
            communityId: communityId,
            reason: reason,
        }.toCell());
        self.retryBouncedPayouts(1);
    }

    /// Remembers a share, then sends it. queryId on the jetton message is the stored identifier.
    inline fun recordAndPay(to: Address, amount: Int) {
        if (amount <= 0 || self.usdtJettonWallet == null) {
            return;
        }
        let id: Int = self.nextPayoutId;
        self.nextPayoutId = id + 1;
        self.payouts.set(id, OutgoingPayout{ destination: to, amount: amount, queued: false, nextRetry: 0 });
        self.payJettons(to, amount, id);
    }

    inline fun queueBouncedPayout(id: Int) {
        let found: OutgoingPayout? = self.payouts.get(id);
        if (found == null) {
            return;
        }
        let payout: OutgoingPayout = found!!;
        if (payout.queued) {
            return;
        }
        payout.queued = true;
        payout.nextRetry = 0;
        if (self.retryHead == 0) {
            self.retryHead = id;
            self.retryTail = id;
        } else {
            let tailFound: OutgoingPayout? = self.payouts.get(self.retryTail);
            if (tailFound != null) {
                let tail: OutgoingPayout = tailFound!!;
                tail.nextRetry = id;
                self.payouts.set(self.retryTail, tail);
            }
            self.retryTail = id;
        }
        self.payouts.set(id, payout);
    }

    /// alreadyQueued counts jetton sends already made in this transaction. Balance is not reduced until it ends.
    inline fun retryBouncedPayouts(alreadyQueued: Int) {
        let queued: Int = alreadyQueued;
        repeat (4) {
            if (self.retryHead == 0) {
                return;
            }
            if (!self.canFundTransfers(queued + 1)) {
                return;
            }
            let id: Int = self.retryHead;
            let found: OutgoingPayout? = self.payouts.get(id);
            if (found == null) {
                self.retryHead = 0;
                self.retryTail = 0;
                return;
            }
            let payout: OutgoingPayout = found!!;
            self.retryHead = payout.nextRetry;
            if (self.retryHead == 0) {
                self.retryTail = 0;
            }
            self.payouts.del(id);
            self.recordAndPay(payout.destination, payout.amount);
            emit(PayoutRetried{ destination: payout.destination, amount: payout.amount }.toCell());
            queued = queued + 1;
        }
    }

    inline fun payJettons(to: Address, amount: Int, queryId: Int) {
        if (amount <= 0 || self.usdtJettonWallet == null) {
            return;
        }
        send(SendParameters{
            to: self.usdtJettonWallet!!,
            value: self.jettonTransferValue(),
            bounce: true,
            body: JettonTransfer{
                queryId: queryId,
                amount: amount,
                destination: to,
                responseDestination: myAddress(),
                customPayload: null,
                forwardTonAmount: 0,
                forwardPayload: emptySlice(),
            }.toCell(),
        });
    }
}
