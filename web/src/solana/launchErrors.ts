export class LaunchError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "LaunchError";
  }
}

export function isWalletRejection(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /reject|denied|cancelled|canceled|user.*declin/i.test(text);
}

export function isInsufficientBalance(error: unknown): boolean {
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : JSON.stringify(error);
  return /insufficient|0x1\b|custom program error: 0x1/i.test(text);
}

export function isStaleBlockhash(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /blockhash|expired|block height exceeded/i.test(text);
}

export function mapSendFailure(error: unknown): LaunchError {
  if (isWalletRejection(error)) {
    return new LaunchError("WALLET_REJECTED", "Wallet signature was rejected. Nothing was sent.");
  }
  if (isInsufficientBalance(error)) {
    return new LaunchError("INSUFFICIENT_BALANCE", "This wallet does not have enough SOL for the review total.");
  }
  if (isStaleBlockhash(error)) {
    return new LaunchError("TRANSACTION_EXPIRED", "The blockhash expired. Rebuild the same mint transaction.");
  }
  return new LaunchError("TRANSACTION_UNKNOWN", "Send result is unknown. Reconcile before building a new mint.");
}
