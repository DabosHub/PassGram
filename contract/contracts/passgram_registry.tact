// PassGramRegistry — USDT Jetton receiver + on-chain fee / community-referral splitter.
// Primary payment path: JettonTransferNotification from the registry's USDT jetton wallet.
// Owner sets usdtJettonWallet after deploy (wallet of this contract for the USDT master).

import "@stdlib/deploy";

struct CommunityConfig {
    creator: Address;
    payout: Address;
    price: Int as coins;
    durationSeconds: Int as uint32;
    platformReferrer: Address?;
    communityReferralBps: Int as uint16;
    accessMode: Int as uint8; // 0 = subscription, 1 = token_gated
}

struct SplitResult {
    creatorAmount: Int as coins;
    treasuryAmount: Int as coins;
    platformAffiliateAmount: Int as coins;
    communityAffiliateAmount: Int as coins;
    hasPlatformReferrer: Bool;
    hasCommunityReferrer: Bool;
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

message SetUsdtJettonWallet {
    wallet: Address;
}

message RegisterCommunity {
    communityId: Int as uint64;
    creator: Address;
    payout: Address;
    price: Int as coins;
    durationSeconds: Int as uint32;
    platformReferrer: Address?;
    communityReferralBps: Int as uint16;
    accessMode: Int as uint8;
}

/// opcode "SCRF" — matches frontend/lib/ton/registry.ts
message(0x53435246) SetCommunityReferral {
    queryId: Int as uint64;
    communityId: Int as uint64;
    communityReferralBps: Int as uint16;
}

message RecordSubscription {
    communityId: Int as uint64;
    subscriber: Address;
    amount: Int as coins;
    hasPlatformReferrer: Bool;
    communityReferrer: Address?;
}

contract PassGramRegistry with Deployable {
    owner: Address;
    treasury: Address;
    platformFeeBps: Int as uint16;
    affiliateShareOfPlatformBps: Int as uint16;
    maxCommunityReferralBps: Int as uint16;
    usdtJettonMaster: Address;
    /// Jetton wallet owned by THIS contract for usdtJettonMaster. Set by owner after deploy.
    usdtJettonWallet: Address?;
    communities: map<Int as uint64, CommunityConfig>;

    init(owner: Address, treasury: Address, usdtJettonMaster: Address) {
        self.owner = owner;
        self.treasury = treasury;
        self.platformFeeBps = 250;
        self.affiliateShareOfPlatformBps = 2000;
        self.maxCommunityReferralBps = 5000;
        self.usdtJettonMaster = usdtJettonMaster;
        self.usdtJettonWallet = null;
        self.communities = emptyMap();
    }

    /// Owner binds the contract's USDT jetton wallet address (must match master).
    receive(msg: SetUsdtJettonWallet) {
        require(sender() == self.owner, "Owner only");
        self.usdtJettonWallet = msg.wallet;
    }

    receive(msg: RegisterCommunity) {
        require(sender() == self.owner, "Owner only");
        require(msg.accessMode == 0 || msg.accessMode == 1, "Bad access mode");
        require(msg.communityReferralBps <= self.maxCommunityReferralBps, "Referral bps too high");
        let cfg: CommunityConfig = CommunityConfig{
            creator: msg.creator,
            payout: msg.payout,
            price: msg.price,
            durationSeconds: msg.durationSeconds,
            platformReferrer: msg.platformReferrer,
            communityReferralBps: msg.communityReferralBps,
            accessMode: msg.accessMode,
        };
        self.communities.set(msg.communityId, cfg);
    }

    receive(msg: SetCommunityReferral) {
        let cfg: CommunityConfig? = self.communities.get(msg.communityId);
        require(cfg != null, "Unknown community");
        let community: CommunityConfig = cfg!!;
        require(sender() == community.creator || sender() == self.owner, "Creator only");
        require(msg.communityReferralBps <= self.maxCommunityReferralBps, "Referral bps too high");
        require(self.platformFeeBps + msg.communityReferralBps <= 10000, "Split exceeds gross");
        community.communityReferralBps = msg.communityReferralBps;
        self.communities.set(msg.communityId, community);
    }

    /// Real payment path: USDT arrives via the contract jetton wallet notification.
    receive(msg: JettonTransferNotification) {
        require(self.usdtJettonWallet != null, "USDT wallet unset");
        require(sender() == self.usdtJettonWallet!!, "Not USDT wallet");

        let payload: Slice = self.unwrapForwardPayload(msg.forwardPayload);
        let op: Int = payload.loadUint(32);
        require(op == 0x53554253, "Bad subscribe op"); // "SUBS"
        let communityId: Int = payload.loadUint(64);
        let hasPlatformReferrerFlag: Bool = payload.loadBool();
        let hasCommunityReferrerBit: Bool = payload.loadBool();
        let communityReferrer: Address? = null;
        if (hasCommunityReferrerBit) {
            communityReferrer = payload.loadAddress();
        }

        let cfg: CommunityConfig? = self.communities.get(communityId);
        require(cfg != null, "Unknown community");
        let community: CommunityConfig = cfg!!;
        require(community.accessMode == 0, "Token-gated not enabled");
        require(msg.amount >= community.price, "Insufficient amount");

        let subscriber: Address = msg.sender;
        let paidAt: Int = now();
        let split: SplitResult = self.computeSplit(
            msg.amount,
            community,
            hasPlatformReferrerFlag,
            communityReferrer,
        );

        let q: Int = msg.queryId;
        self.payJettons(community.payout, split.creatorAmount, q);
        if (split.treasuryAmount > 0) {
            self.payJettons(self.treasury, split.treasuryAmount, q + 1);
        }
        if (split.platformAffiliateAmount > 0 && community.platformReferrer != null) {
            self.payJettons(community.platformReferrer!!, split.platformAffiliateAmount, q + 2);
        }
        if (split.communityAffiliateAmount > 0 && communityReferrer != null) {
            self.payJettons(communityReferrer!!, split.communityAffiliateAmount, q + 3);
        }

        emit(SubscriptionPaid{
            subscriber: subscriber,
            creator: community.creator,
            communityId: communityId,
            amount: msg.amount,
            paidAt: paidAt,
            expiresAt: paidAt + community.durationSeconds,
            hasPlatformReferrer: split.hasPlatformReferrer,
            hasCommunityReferrer: split.hasCommunityReferrer,
            communityAffiliateAmount: split.communityAffiliateAmount,
            creatorAmount: split.creatorAmount,
            treasuryAmount: split.treasuryAmount,
            platformAffiliateAmount: split.platformAffiliateAmount,
        }.toCell());
    }

    /// Owner/test path: settle without moving jettons (math + event only).
    receive(msg: RecordSubscription) {
        require(sender() == self.owner, "Owner only");
        let cfg: CommunityConfig? = self.communities.get(msg.communityId);
        require(cfg != null, "Unknown community");
        let community: CommunityConfig = cfg!!;
        require(community.accessMode == 0, "Token-gated not enabled");
        require(msg.amount >= community.price, "Insufficient amount");

        let paidAt: Int = now();
        let split: SplitResult = self.computeSplit(
            msg.amount,
            community,
            msg.hasPlatformReferrer,
            msg.communityReferrer,
        );

        emit(SubscriptionPaid{
            subscriber: msg.subscriber,
            creator: community.creator,
            communityId: msg.communityId,
            amount: msg.amount,
            paidAt: paidAt,
            expiresAt: paidAt + community.durationSeconds,
            hasPlatformReferrer: split.hasPlatformReferrer,
            hasCommunityReferrer: split.hasCommunityReferrer,
            communityAffiliateAmount: split.communityAffiliateAmount,
            creatorAmount: split.creatorAmount,
            treasuryAmount: split.treasuryAmount,
            platformAffiliateAmount: split.platformAffiliateAmount,
        }.toCell());
    }

    receive() {
        // Accept plain TON for gas reserves used when sending JettonTransfer outs.
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

    inline fun unwrapForwardPayload(raw: Slice): Slice {
        // TEP-74 Either Cell ^Cell: bit0 = inline, bit1 = ref
        if (raw.loadBool()) {
            return raw.loadRef().beginParse();
        }
        return raw;
    }

    inline fun computeSplit(
        gross: Int,
        community: CommunityConfig,
        hasPlatformReferrerFlag: Bool,
        communityReferrer: Address?,
    ): SplitResult {
        let platformFee: Int = (gross * self.platformFeeBps) / 10000;
        let platformAffiliateCut: Int = 0;
        let hasPlatformReferrer: Bool = hasPlatformReferrerFlag && community.platformReferrer != null;
        if (hasPlatformReferrer) {
            platformAffiliateCut = (platformFee * self.affiliateShareOfPlatformBps) / 10000;
        }
        let treasuryCut: Int = platformFee - platformAffiliateCut;

        let communityAffiliateCut: Int = 0;
        let hasCommunityReferrer: Bool = false;
        if (communityReferrer != null && community.communityReferralBps > 0) {
            require(communityReferrer!! != community.creator, "Self referral");
            communityAffiliateCut = (gross * community.communityReferralBps) / 10000;
            hasCommunityReferrer = true;
        }

        let creatorCut: Int = gross - platformFee - communityAffiliateCut;
        require(creatorCut >= 0, "Creator cut negative");
        require(creatorCut + treasuryCut + platformAffiliateCut + communityAffiliateCut == gross, "Split invariant");

        return SplitResult{
            creatorAmount: creatorCut,
            treasuryAmount: treasuryCut,
            platformAffiliateAmount: platformAffiliateCut,
            communityAffiliateAmount: communityAffiliateCut,
            hasPlatformReferrer: hasPlatformReferrer,
            hasCommunityReferrer: hasCommunityReferrer,
        };
    }

    inline fun payJettons(to: Address, amount: Int, queryId: Int) {
        if (amount <= 0) {
            return;
        }
        require(self.usdtJettonWallet != null, "USDT wallet unset");
        send(SendParameters{
            to: self.usdtJettonWallet!!,
            value: ton("0.06"),
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
