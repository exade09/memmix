export const RPC_ALLOWED_METHODS = [
  "getLatestBlockhash",
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getFeeForMessage",
  "simulateTransaction",
  "sendTransaction",
  "getSignatureStatuses",
  "getMinimumBalanceForRentExemption",
] as const;

export type RpcAllowedMethod = (typeof RPC_ALLOWED_METHODS)[number];

export function isAllowedRpcMethod(method: string): method is RpcAllowedMethod {
  return (RPC_ALLOWED_METHODS as readonly string[]).includes(method);
}
