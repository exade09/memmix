import { Keypair } from "@solana/web3.js";

type MintSlot = {
  uri: string;
  keypair: Keypair;
};

let slot: MintSlot | null = null;

export function mintKeypairForUri(uri: string): Keypair {
  if (slot && slot.uri === uri) return slot.keypair;
  wipeMintSecret();
  slot = { uri, keypair: Keypair.generate() };
  return slot.keypair;
}

export function currentMintPublicKey(): string | null {
  return slot ? slot.keypair.publicKey.toBase58() : null;
}

export function wipeMintSecret(): void {
  if (!slot) return;
  slot.keypair.secretKey.fill(0);
  slot = null;
}
