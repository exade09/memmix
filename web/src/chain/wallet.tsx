import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPublicClient, createWalletClient, custom, http, type Address, type PublicClient, type WalletClient } from "viem";
import { chainFor, chainLabel, ROBINHOOD_MAINNET_ID, ROBINHOOD_TESTNET_ID } from "./robinhood";
import { isWalletRejection } from "./errors";

/*
  MetaMask, spoken to directly over EIP-1193.

  The Solana build needed a wallet-adapter package to abstract over a dozen
  wallets; here the browser already exposes the interface, so the whole
  connection is a context and three RPC calls. Nothing is requested until the
  user asks for it: no eager connect, no silent account access.
*/

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
  isMetaMask?: boolean;
  providers?: Eip1193[];
};

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

/*
  With more than one wallet extension installed, `window.ethereum` is often a
  shared multi-provider object rather than any single wallet — reading it, or
  even a read-only call like eth_accounts, can make that object's own
  extension (Phantom does this) pop up a "which wallet" chooser before it will
  answer. Since this app only ever speaks MetaMask, pick that provider out of
  window.ethereum.providers directly so no call ever touches the ambiguous
  top-level object in the first place.
*/
function resolveMetaMask(eth: Eip1193 | undefined): Eip1193 | undefined {
  if (!eth) return undefined;
  if (Array.isArray(eth.providers) && eth.providers.length) {
    return eth.providers.find((candidate) => candidate.isMetaMask) ?? eth.providers[0];
  }
  return eth;
}

/*
  Mainnet by default, because the published RPC is the mainnet endpoint and
  there is no public testnet one to default to. Reading is all this enables;
  launching still needs the flags and a deployed launchpad.
*/
export const TARGET_CHAIN_ID =
  import.meta.env.VITE_ROBINHOOD_TESTNET === "true" ? ROBINHOOD_TESTNET_ID : ROBINHOOD_MAINNET_ID;

/** Reads go through our own proxy, so the browser never talks to an RPC directly. */
export function rpcEndpoint(): string {
  if (typeof window === "undefined") return "/api/chain/rpc";
  return `${window.location.origin}/api/chain/rpc`;
}

export type WalletPhase = "unavailable" | "idle" | "connecting" | "connected" | "rejected" | "wrong-network";

type WalletState = {
  available: boolean;
  address: Address | null;
  chainId: number | null;
  phase: WalletPhase;
  onTargetChain: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
  publicClient: PublicClient;
  walletClient: WalletClient | null;
};

const WalletContext = createContext<WalletState | null>(null);

export function ChainProvider({ children }: { children: ReactNode }) {
  const provider = typeof window === "undefined" ? undefined : resolveMetaMask(window.ethereum);
  const available = Boolean(provider);
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [rejected, setRejected] = useState(false);

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: chainFor(TARGET_CHAIN_ID),
        transport: http(rpcEndpoint()),
      }) as PublicClient,
    [],
  );

  const walletClient = useMemo(() => {
    if (!provider || !address) return null;
    return createWalletClient({
      account: address,
      chain: chainFor(TARGET_CHAIN_ID),
      transport: custom(provider),
    });
  }, [provider, address]);

  // Reflect an already-granted connection, but never ask for one on load.
  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    void (async () => {
      try {
        const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
        const current = (await provider.request({ method: "eth_chainId" })) as string;
        if (cancelled) return;
        if (accounts?.length) setAddress(accounts[0] as Address);
        setChainId(Number.parseInt(current, 16));
      } catch {
        // A provider that will not answer eth_accounts is simply not connected.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  useEffect(() => {
    if (!provider?.on) return;
    const onAccounts = (...args: never[]) => {
      const accounts = args[0] as unknown as string[];
      setAddress(accounts?.length ? (accounts[0] as Address) : null);
    };
    const onChain = (...args: never[]) => {
      const hex = args[0] as unknown as string;
      setChainId(Number.parseInt(hex, 16));
    };
    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [provider]);

  const switchNetwork = useCallback(async () => {
    if (!provider) return;
    const target = chainFor(TARGET_CHAIN_ID);
    const hexId = `0x${TARGET_CHAIN_ID.toString(16)}`;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    } catch (error: unknown) {
      // 4902: the wallet does not know this network yet, so offer to add it.
      if ((error as { code?: number })?.code !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hexId,
            chainName: target.name,
            nativeCurrency: target.nativeCurrency,
            rpcUrls: target.rpcUrls.default.http,
            blockExplorerUrls: [target.blockExplorers.default.url],
          },
        ],
      });
    }
  }, [provider]);

  const connect = useCallback(async () => {
    if (!provider) return;
    setConnecting(true);
    setRejected(false);
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      setAddress(accounts?.length ? (accounts[0] as Address) : null);
      await switchNetwork();
      const current = (await provider.request({ method: "eth_chainId" })) as string;
      setChainId(Number.parseInt(current, 16));
    } catch (error: unknown) {
      if (isWalletRejection(error)) setRejected(true);
    } finally {
      setConnecting(false);
    }
  }, [provider, switchNetwork]);

  /*
    A dapp cannot revoke its own permission, so this clears local state only.
    Saying otherwise would be a lie about what the button does.
  */
  const disconnect = useCallback(() => {
    setAddress(null);
    setRejected(false);
  }, []);

  const onTargetChain = chainId === TARGET_CHAIN_ID;
  const phase: WalletPhase = !available
    ? "unavailable"
    : connecting
      ? "connecting"
      : rejected
        ? "rejected"
        : address
          ? onTargetChain
            ? "connected"
            : "wrong-network"
          : "idle";

  const value = useMemo<WalletState>(
    () => ({
      available,
      address,
      chainId,
      phase,
      onTargetChain,
      connect,
      disconnect,
      switchNetwork,
      publicClient,
      walletClient,
    }),
    [available, address, chainId, phase, onTargetChain, connect, disconnect, switchNetwork, publicClient, walletClient],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useChain(): WalletState {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useChain must be used inside ChainProvider");
  return value;
}

export function targetChainLabel(): string {
  return chainLabel(TARGET_CHAIN_ID);
}
