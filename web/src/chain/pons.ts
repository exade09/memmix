import { zeroAddress, type Address, type PublicClient } from "viem";
import { normalizeAddress } from "./address";

/*
  Pons v2 on Robinhood Chain.

  Unlike the placeholder this replaces, none of the shapes below are invented.
  They are transcribed from the Pons team's own MIT-licensed sources
  (github.com/ponsdotdev/ponsfamily, contractsV2/src/v2/), and every constant
  was read back off the deployed factory before being written down here:

    launchFee()          0.0005 ETH
    launchEnabled()      true
    launchConfigCount()  1        -> the only valid launchConfigId is 0
    maxCreatorTaxBps()   1000     -> 10%
    launchForwarder()    0xe33E9E479dF8802cb0866d5d05258bEc4cF62948

  Two facts from the factory source shape the whole flow above this file:

  1. `_launchToken` requires `msg.value == launchFee` exactly. An initial buy
     therefore cannot ride along in the launch call; it is a second, separate
     transaction against the curve. Bundling them is only possible through the
     trusted launchForwarder router, whose source Pons has not published, and
     we do not guess an ABI for a contract that moves money.

  2. The deployer and their creator fee recipient are exempted from the snipe
     tax automatically, so paying for that second transaction costs the creator
     nothing beyond gas.
*/

/** Verified deployment. Overridable, but this is the live v2 factory. */
const DEFAULT_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";

/** `pairToken == address(0)` selects the native ETH curve. */
export const NATIVE_PAIR_TOKEN: Address = zeroAddress;

/** launchConfigCount() is 1, so this is the only id the factory accepts. */
export const DEFAULT_LAUNCH_CONFIG_ID = 0n;

/** Read off the factory; the launch call still reverts if it ever changes. */
export const MAX_CREATOR_TAX_BPS = 1000;

export function ponsFactoryAddress(): Address {
  const raw = import.meta.env.VITE_PONS_FACTORY_ADDRESS ?? "";
  const override = normalizeAddress(raw);
  return (override || DEFAULT_FACTORY) as Address;
}

/*
  TokenParams, transcribed field for field from PonsV2LaunchFactory.sol.
  Order matters: it is an ABI tuple, not a named record.
*/
const TOKEN_PARAMS = {
  name: "params",
  type: "tuple",
  components: [
    { name: "name", type: "string" },
    { name: "symbol", type: "string" },
    { name: "logo", type: "string" },
    { name: "description", type: "string" },
    {
      name: "socials",
      type: "tuple",
      components: [
        { name: "twitter", type: "string" },
        { name: "telegram", type: "string" },
        { name: "discord", type: "string" },
        { name: "website", type: "string" },
        { name: "farcaster", type: "string" },
      ],
    },
    { name: "creatorFeeRecipient", type: "address" },
    { name: "creatorTaxBps", type: "uint16" },
    { name: "buybackEnabled", type: "bool" },
    { name: "expectedEconomics", type: "bytes32" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

const LAUNCH_CONFIG_OUTPUT = {
  type: "tuple",
  components: [
    { name: "supply", type: "uint256" },
    { name: "curveFeeBps", type: "uint256" },
    { name: "phantomQuote", type: "uint256" },
    { name: "graduationThreshold", type: "uint256" },
    { name: "poolFee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "enabled", type: "bool" },
  ],
} as const;

export const PONS_FACTORY_ABI = [
  {
    type: "function",
    name: "launchToken",
    stateMutability: "payable",
    inputs: [TOKEN_PARAMS, { name: "launchConfigId", type: "uint256" }, { name: "pairToken", type: "address" }],
    outputs: [
      { name: "token", type: "address" },
      { name: "curve", type: "address" },
    ],
  },
  { type: "function", name: "launchFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "launchEnabled", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "launchConfigCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxCreatorTaxBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "canLaunch",
    stateMutability: "view",
    inputs: [{ name: "launcher", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "getLaunchConfig",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [LAUNCH_CONFIG_OUTPUT],
  },
  {
    type: "function",
    name: "previewLaunchEconomics",
    stateMutability: "view",
    inputs: [
      { name: "launchConfigId", type: "uint256" },
      { name: "pairToken", type: "address" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "event",
    name: "TokenLaunched",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "curve", type: "address", indexed: true },
      { name: "deployer", type: "address", indexed: true },
      { name: "pairToken", type: "address", indexed: false },
      { name: "launchConfigId", type: "uint256", indexed: false },
      { name: "graduationThreshold", type: "uint256", indexed: false },
    ],
  },
] as const;

/** The curve a launch creates. Only what we actually call is declared. */
export const PONS_CURVE_ABI = [
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [
      { name: "quoteIn", type: "uint256" },
      { name: "minTokensOut", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ name: "tokensOut", type: "uint256" }],
  },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "graduated", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "quoteReserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "graduationThreshold",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type PonsSocials = {
  twitter: string;
  telegram: string;
  discord: string;
  website: string;
  farcaster: string;
};

export type PonsLaunchConfig = {
  supply: bigint;
  curveFeeBps: bigint;
  phantomQuote: bigint;
  graduationThreshold: bigint;
  poolFee: number;
  tickSpacing: number;
  enabled: boolean;
};

export type PonsLaunchTerms = {
  launchFeeWei: bigint;
  launchEnabled: boolean;
  config: PonsLaunchConfig;
  /** Pin for TokenParams.expectedEconomics, quoted at the moment we simulate. */
  economics: `0x${string}`;
};

/**
 * Everything the launch depends on, read in one pass.
 *
 * The economics digest is the reason this is a single read: it pins the terms
 * the user was quoted, so an owner re-peg between quoting and signing makes the
 * transaction revert rather than silently reprice the launch.
 */
export async function readLaunchTerms(
  client: PublicClient,
  launchConfigId: bigint = DEFAULT_LAUNCH_CONFIG_ID,
): Promise<PonsLaunchTerms> {
  const address = ponsFactoryAddress();
  const base = { address, abi: PONS_FACTORY_ABI } as const;

  const [launchFeeWei, launchEnabled, rawConfig, economics] = await Promise.all([
    client.readContract({ ...base, functionName: "launchFee" }),
    client.readContract({ ...base, functionName: "launchEnabled" }),
    client.readContract({ ...base, functionName: "getLaunchConfig", args: [launchConfigId] }),
    client.readContract({ ...base, functionName: "previewLaunchEconomics", args: [launchConfigId, NATIVE_PAIR_TOKEN] }),
  ]);

  return {
    launchFeeWei,
    launchEnabled,
    config: {
      supply: rawConfig.supply,
      curveFeeBps: rawConfig.curveFeeBps,
      phantomQuote: rawConfig.phantomQuote,
      graduationThreshold: rawConfig.graduationThreshold,
      poolFee: Number(rawConfig.poolFee),
      tickSpacing: Number(rawConfig.tickSpacing),
      enabled: rawConfig.enabled,
    },
    economics,
  };
}

/** Whether this account is allowed to launch right now. */
export async function canLaunch(client: PublicClient, account: Address): Promise<boolean> {
  return (await client.readContract({
    address: ponsFactoryAddress(),
    abi: PONS_FACTORY_ABI,
    functionName: "canLaunch",
    args: [account],
  })) as boolean;
}

/**
 * A fresh CREATE2 salt.
 *
 * The factory namespaces salts per initiating account, so this only has to be
 * unique among the caller's own launches; an unused random value is all that is
 * needed. Reusing one on identical terms reverts, which is the safe failure.
 */
export function freshSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function emptySocials(): PonsSocials {
  return { twitter: "", telegram: "", discord: "", website: "", farcaster: "" };
}
