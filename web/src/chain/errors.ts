export class LaunchError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "LaunchError";
    this.code = code;
  }
}

function text(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error.toLowerCase();
  const anyError = error as { message?: unknown; shortMessage?: unknown; code?: unknown };
  return `${String(anyError.shortMessage ?? "")} ${String(anyError.message ?? "")} ${String(anyError.code ?? "")}`.toLowerCase();
}

/** EIP-1193 uses 4001 for a user-rejected request. */
export function isWalletRejection(error: unknown): boolean {
  const body = text(error);
  const code = (error as { code?: unknown })?.code;
  return code === 4001 || body.includes("user rejected") || body.includes("user denied");
}

export function isInsufficientBalance(error: unknown): boolean {
  const body = text(error);
  return body.includes("insufficient funds") || body.includes("exceeds balance");
}

export function isWrongNetwork(error: unknown): boolean {
  const body = text(error);
  const code = (error as { code?: unknown })?.code;
  return code === 4902 || body.includes("unrecognized chain") || body.includes("chain mismatch");
}

export function mapSendFailure(error: unknown): LaunchError {
  if (isWalletRejection(error)) {
    return new LaunchError("Wallet signature was rejected. Nothing was sent.", "WALLET_REJECTED");
  }
  if (isInsufficientBalance(error)) {
    return new LaunchError("This wallet does not have enough ETH for the review total.", "INSUFFICIENT_BALANCE");
  }
  if (isWrongNetwork(error)) {
    return new LaunchError("The wallet is not on Robinhood Chain.", "WRONG_NETWORK");
  }
  const body = text(error);
  if (body.includes("replacement") || body.includes("nonce too low")) {
    return new LaunchError("A competing transaction replaced this one. Rebuild before sending again.", "TRANSACTION_REPLACED");
  }
  if (body.includes("timeout") || body.includes("timed out")) {
    return new LaunchError("Send result is unknown. Reconcile before building a new token.", "TRANSACTION_UNKNOWN");
  }
  return new LaunchError(error instanceof Error ? error.message : "Launch failed.", "SEND_FAILED");
}
