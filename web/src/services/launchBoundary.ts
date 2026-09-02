import { appConfig } from "../app/config";
import { launchReadiness, METADATA_URI_MAX } from "../chain/launchpad";

/*
  The one place that decides whether SIGN may be enabled.

  Same contract as the Solana build: every path returns a reason a user can
  read, and the default is disabled. What changed is what it checks — a
  deployed Pons v2 factory: that it holds code, that the simulation passed,
  and that this build has not been switched off.
*/

export const LAUNCH_STATES = [
  "EDITING",
  "PINNING_METADATA",
  "REVIEWING",
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

export const NAME_CHECK_NOTICE = "Identity is the contract address; similar names do not block launch.";
export const NAME_CHECK_UNAVAILABLE = "Check unavailable";

export type SignGateInput = {
  walletConnected?: boolean;
  walletConnecting?: boolean;
  walletRejected?: boolean;
  wrongNetwork?: boolean;
  simulationOk?: boolean;
  contractOk?: boolean;
  metadataUri?: string;
};

type Boundary = {
  launchpadConfigured: boolean;
  signEnabled: boolean;
  unknownCostLabel: string;
  nativeLaunchFlag: boolean;
  reason: string;
};

export function getTransactionBoundary(input: SignGateInput = {}): Boundary {
  const readiness = launchReadiness();
  const launchpadConfigured = readiness.configured;
  const unknownCostLabel = UNKNOWN_COST_LABEL;
  const base = { launchpadConfigured, unknownCostLabel, signEnabled: false };

  // The missing contract comes first: without it nothing is possible on any
  // network, so it is the more useful thing to tell someone.
  if (!launchpadConfigured) {
    return { ...base, nativeLaunchFlag: false, reason: readiness.reason };
  }
  if (appConfig.mainnet && !appConfig.enableMainnetLaunch) {
    return { ...base, nativeLaunchFlag: appConfig.enableNativeLaunch, reason: "Mainnet launch is disabled." };
  }
  if (!appConfig.enableNativeLaunch) {
    return { ...base, nativeLaunchFlag: false, reason: "Launch is switched off in this build." };
  }
  if (input.wrongNetwork) {
    return { ...base, nativeLaunchFlag: true, reason: "The wallet is on a different network. Switch to Robinhood Chain." };
  }
  if (input.walletConnecting) {
    return { ...base, nativeLaunchFlag: true, reason: "Connecting wallet…" };
  }
  if (input.walletRejected) {
    return { ...base, nativeLaunchFlag: true, reason: "Wallet connection was rejected." };
  }
  if (!input.walletConnected) {
    return { ...base, nativeLaunchFlag: true, reason: "Connect MetaMask to review the launch transaction." };
  }
  if (input.metadataUri && input.metadataUri.length > METADATA_URI_MAX) {
    return { ...base, nativeLaunchFlag: true, reason: `Metadata URI exceeds the ${METADATA_URI_MAX}-character limit.` };
  }
  if (input.contractOk === false) {
    return { ...base, nativeLaunchFlag: true, reason: "No contract found at the launch contract address. Sign is disabled." };
  }
  if (input.simulationOk === false) {
    return { ...base, nativeLaunchFlag: true, reason: "Simulation failed. Sign is disabled until the transaction is rebuilt." };
  }
  if (input.simulationOk === true && input.contractOk === true) {
    return {
      ...base,
      signEnabled: true,
      nativeLaunchFlag: true,
      reason: "Review the estimated maximum debit, then approve in MetaMask.",
    };
  }
  return { ...base, nativeLaunchFlag: true, reason: "Building the launch transaction…" };
}

export function canSignLaunch(input: SignGateInput = {}): boolean {
  return getTransactionBoundary(input).signEnabled;
}

export function signAndLaunch(): never {
  throw new Error(getTransactionBoundary().reason);
}

export function expectedContractNote(): string {
  return "The launch contract on Robinhood Chain. Its bytecode is checked and the launch is simulated before any signature is requested.";
}
