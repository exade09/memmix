import { appConfig, networkLabel } from "../../app/config";

export function NetworkBadge() {
  const label = networkLabel();
  // Narrow screens still have to say which network this is, just shorter.
  const short = appConfig.mainnet ? "Mainnet" : "Testnet";
  return (
    <span className="network-badge" data-network={appConfig.mainnet ? "mainnet" : "testnet"} title={label}>
      <i className="pip" aria-hidden="true" />
      <span className="net-long">{label}</span>
      <span className="net-short" aria-hidden="true">
        {short}
      </span>
    </span>
  );
}
