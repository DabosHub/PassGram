import { beginCell, Address, Cell, toNano } from "@ton/core";
import { contractIsConfigured, tonConfig } from "./config";

type Adapter = {
  sendTransaction?: (tx: {
    validUntil: number;
    messages: Array<{ address: string; amount: string; payload?: string }>;
  }) => Promise<{ boc?: string } | null>;
};

let sendAdapter: Adapter | null = null;

export function setSendAdapter(adapter: Adapter | null): void {
  sendAdapter = adapter;
}

/** Jetton transfer opcode (TEP-74). */
const JETTON_TRANSFER = 0xf8a7ea5;

export function buildJettonTransferBody(input: {
  amount: bigint;
  to: string;
  responseTo: string;
  forwardPayloadBase64?: string;
}): string {
  const to = Address.parse(input.to);
  const response = Address.parse(input.responseTo);
  const builder = beginCell()
    .storeUint(JETTON_TRANSFER, 32)
    .storeUint(0, 64)
    .storeCoins(input.amount)
    .storeAddress(to)
    .storeAddress(response)
    .storeBit(false)
    .storeCoins(toNano("0.05"));

  if (input.forwardPayloadBase64) {
    // forward_payload is Either Cell ^Cell — right branch = ref to subscribe cell
    const payload = Cell.fromBase64(input.forwardPayloadBase64);
    builder.storeBit(true).storeRef(payload);
  } else {
    builder.storeBit(false);
  }

  return builder.endCell().toBoc().toString("base64");
}

export async function sendViaAdapter(input: {
  jettonWalletAddress: string;
  registryAddress: string;
  amount: string;
  responseAddress: string;
  forwardPayload?: string;
}): Promise<string | null> {
  if (!sendAdapter?.sendTransaction || !contractIsConfigured()) return null;
  const body = buildJettonTransferBody({
    amount: BigInt(input.amount),
    to: input.registryAddress,
    responseTo: input.responseAddress,
    forwardPayloadBase64: input.forwardPayload,
  });
  const result = await sendAdapter.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 600,
    messages: [
      {
        address: input.jettonWalletAddress,
        amount: toNano("0.15").toString(),
        payload: body,
      },
    ],
  });
  return result?.boc ?? null;
}

/** Send a TON message to the PassGram registry (e.g. SetCommunityReferral). */
export async function sendRegistryCall(input: {
  payloadBase64: string;
  tonAmount?: string;
}): Promise<string | null> {
  if (!sendAdapter?.sendTransaction || !contractIsConfigured() || !tonConfig.registryAddress) return null;
  const result = await sendAdapter.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 600,
    messages: [
      {
        address: tonConfig.registryAddress,
        amount: input.tonAmount ?? toNano("0.05").toString(),
        payload: input.payloadBase64,
      },
    ],
  });
  return result?.boc ?? null;
}

export { tonConfig };
