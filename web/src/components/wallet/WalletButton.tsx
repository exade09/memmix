import { useChain } from "../../chain/wallet";
import { shortenAddress } from "../../chain/address";
import { Button, ButtonAnchor } from "../ui/Button";
import { track } from "../../services/analytics";

export function WalletButton() {
  const { available, address, phase, onTargetChain, connect, disconnect, switchNetwork } = useChain();

  /*
    No MetaMask in the browser is a real state, not an error. Sending the user
    to install it is more useful than a button that cannot do anything.
  */
  if (!available) {
    return (
      <ButtonAnchor
        variant="secondary"
        size="sm"
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer"
      >
        Get MetaMask
      </ButtonAnchor>
    );
  }

  if (address && !onTargetChain) {
    return (
      <div className="wallet-status" data-wallet-phase={phase}>
        <Button type="button" variant="secondary" size="sm" onClick={() => void switchNetwork()}>
          Switch network
        </Button>
      </div>
    );
  }

  if (address) {
    return (
      <div className="wallet-status" data-wallet-phase={phase}>
        <span className="wallet-chip" title={address}>
          <i className="pip" aria-hidden="true" />
          {shortenAddress(address)}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={disconnect}>
          Disconnect
        </Button>
      </div>
    );
  }

  if (phase === "connecting") {
    return (
      <Button type="button" variant="secondary" size="sm" disabled data-wallet-phase={phase}>
        Connecting…
      </Button>
    );
  }

  return (
    <div className="wallet-status" data-wallet-phase={phase}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          track("wallet_connect_requested");
          void connect();
        }}
      >
        Connect wallet
      </Button>
      {phase === "rejected" ? <span className="note error">Wallet connection was rejected.</span> : null}
    </div>
  );
}
