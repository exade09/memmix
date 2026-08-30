import { appConfig } from "../app/config";

export const LAUNCH_STATES = [
  "EDITING",
  "PINNING_METADATA",
  "REVIEWING",
  "GENERATING_MINT",
  "BUILDING_TRANSACTION",
  "SIMULATING",
  "READY_TO_SIGN",
  "WALLET_OPEN",
  "SUBMITTING",
  "CONFIRMING",
  "SUCCESS",
  "RECOVERABLE_FAILURE",
  "RECONCILING",
] as const;

export type LaunchState = (typeof LAUNCH_STATES)[number];

export const UNKNOWN_COST_LABEL = "Calculated before signature";

export const NAME_CHECK_NOTICE = "Identity is the mint address; similar names do not block launch.";
export const NAME_CHECK_UNAVAILABLE = "Check unavailable";

export type SignGateInput = {
  walletConnected?: boolean;
  walletConnecting?: boolean;
  walletRejected?: boolean;
  simulationOk?: boolean;
  allowlistOk?: boolean;
  clusterMismatch?: boolean;
  createV2Disabled?: boolean;
  metadataUri?: string;
};

export function getTransactionBoundary(input: SignGateInput = {}) {
  const pumpSdkWired = true;
  const unknownCostLabel = UNKNOWN_COST_LABEL;
  if (appConfig.cluster === "mainnet-beta" && !appConfig.enableMainnetLaunch) {
    return {
      pumpSdkWired,
      signEnabled: false,
      unknownCostLabel,
      nativeLaunchFlag: appConfig.enableNativeLaunch,
      reason: "Mainnet launch is disabled.",
    };
  }
  if (!appConfig.enableNativeLaunch) {
    return {
      pumpSdkWired,
      signEnabled: false,
      unknownCostLabel,
      nativeLaunchFlag: false,
      reason: "Blockchain launch is not connected yet.",
    };
  }
  if (input.clusterMismatch) {
    return {
      pumpSdkWired,
      signEnabled: false,
      unknownCostLabel,
      nativeLaunchFlag: true,
      reason: "RPC cluster does not match the UI network badge. Launch stopped.",
    };
  }
  if (input.createV2Disabled) {
    return {
      pumpSdkWired,
      signEnabled: false,
      unknownCostLabel,
      nativeLaunchFlag: true,
      reason: "create_v2 is disabled on this cluster. Launch stopped.",
    };
  }
  if (input.walletConnecting) {
    return {
      pumpSdkWired,
      signEnabled: false,
      unknownCostLabel,
      nativeLaunchFlag: true,
      reason: "Connecting wallet…",
    };
  }
  if (input.walletRejected) {
    return {
      pumpSdkWired,
      signEnabled: false,
      unknownCostLabel,
      nativeLaunchFlag: true,
      reason: "Wallet connection was rejected.",
    };
  }
  if (!input.walletConnected) {
    return {
      pumpSdkWired,
      signEnabled: false,
      unknownCostLabel,
      nativeLaunchFlag: true,
      reason: "Connect a wallet to review the launch transaction.",
    };
  }
  if (input.metadataUri && input.metadataUri.length > 200) {
    return {
      pumpSdkWired,
      signEnabled: false,
      unknownCostLabel,
      nativeLaunchFlag: true,
      reason: "Metadata URI exceeds the Pump 200-character limit.",
    };
  }
  if (input.allowlistOk === false) {
    return {
      pumpSdkWired,
      signEnabled: false,
      unknownCostLabel,
      nativeLaunchFlag: true,
      reason: "Unexpected program in transaction. Sign is disabled.",
    };
  }
  if (input.simulationOk === false) {
    return {
      pumpSdkWired,
      signEnabled: false,
      unknownCostLabel,
      nativeLaunchFlag: true,
      reason: "Simulation failed. Sign is disabled until the transaction is rebuilt.",
    };
  }
  if (input.simulationOk === true && input.allowlistOk === true) {
    return {
      pumpSdkWired,
      signEnabled: true,
      unknownCostLabel,
      nativeLaunchFlag: true,
      reason: "Review the estimated maximum debit, then approve in your wallet.",
    };
  }
  return {
    pumpSdkWired,
    signEnabled: false,
    unknownCostLabel,
    nativeLaunchFlag: true,
    reason: "Building the launch transaction…",
  };
}

export function canSignLaunch(input: SignGateInput = {}): boolean {
  return getTransactionBoundary(input).signEnabled;
}

export function signAndLaunch(): never {
  throw new Error(getTransactionBoundary().reason);
}

export function expectedProgramsNote(): string {
  return "Official Pump, Token-2022, ATA, System, Compute Budget, and current create_v2 accounts. Verified at sign time.";
}
