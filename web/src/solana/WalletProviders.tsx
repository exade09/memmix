import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";

export function rpcEndpoint(): string {
  if (typeof window === "undefined") return "/api/solana/rpc";
  return `${window.location.origin}/api/solana/rpc`;
}

export function SolanaProviders({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => rpcEndpoint(), []);
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
