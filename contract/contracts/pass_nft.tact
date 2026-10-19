// PassNft — structural placeholder for v2 SBT / token-gate.
// Not wired to the payment path in v1.

import "@stdlib/deploy";

contract PassNft with Deployable {
    owner: Address;
    collectionName: String;

    init(owner: Address) {
        self.owner = owner;
        self.collectionName = "PassGram Access (placeholder)";
    }

    receive("mint") {
        require(false, "Token-Gating not enabled in v1");
    }

    get fun name(): String {
        return self.collectionName;
    }
}
