export function walletPhase(input: {
  connected: boolean;
  connecting: boolean;
  rejected: boolean;
}): "connected" | "connecting" | "disconnected" | "rejected" {
  if (input.connected) return "connected";
  if (input.connecting) return "connecting";
  if (input.rejected) return "rejected";
  return "disconnected";
}
