import { appConfig, clusterLabel } from "../../app/config";

export function NetworkBadge() {
  const label = clusterLabel();
  // Narrow screens still have to say which cluster this is, just shorter.
  const short = appConfig.cluster === "mainnet-beta" ? "Mainnet" : "Devnet";
  return (
    <span className="network-badge" data-cluster={appConfig.cluster} title={label}>
      <i className="pip" aria-hidden="true" />
      <span className="net-long">{label}</span>
      <span className="net-short" aria-hidden="true">
        {short}
      </span>
    </span>
  );
}
