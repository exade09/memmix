import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "../ui/Button";
import { walletPhase } from "../../solana/walletPhase";
import { track } from "../../services/analytics";

function shortKey(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function WalletButton() {
  const { connected, connecting, publicKey, disconnect, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    if (!wallet) return;
    const onError = () => setRejected(true);
    wallet.adapter.on("error", onError);
    return () => {
      wallet.adapter.off("error", onError);
    };
  }, [wallet]);

  useEffect(() => {
    if (connected) setRejected(false);
  }, [connected]);

  if (connected && publicKey) {
    return (
      <div className="wallet-status" data-wallet-phase={walletPhase({ connected, connecting, rejected })}>
        <span className="wallet-chip" title={publicKey.toBase58()}>
          <i className="pip" aria-hidden="true" />
          {shortKey(publicKey.toBase58())}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => void disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }

  if (connecting) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled
        data-wallet-phase={walletPhase({ connected, connecting, rejected })}
      >
        Connecting…
      </Button>
    );
  }

  return (
    <div className="wallet-status" data-wallet-phase={walletPhase({ connected, connecting, rejected })}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          setRejected(false);
          track("wallet_connect_requested");
          setVisible(true);
        }}
      >
        Connect wallet
      </Button>
      {rejected ? <span className="note error">Wallet connection was rejected.</span> : null}
    </div>
  );
}

export { walletPhase };
