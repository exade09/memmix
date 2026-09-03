import { useEffect, useState } from "react";
import { fetchContractAddress } from "../../services/api";

/*
  The token's own contract address, shown in the header once it exists.

  Read-only here: it is set from /admin/ca, a separate password-protected
  page that is not linked from anywhere in this nav. Polled rather than
  fetched once, since a production edit lands as a fresh deploy a little
  after the admin saves it, and a visitor already on the page should not
  have to reload to see it.
*/

const POLL_MS = 60_000;

export function CaBadge() {
  const [ca, setCa] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchContractAddress().then((state) => {
        if (!cancelled) setCa(state.ca || "");
      });
    };
    load();
    const interval = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const hasCa = ca.length > 0;

  return (
    <button
      type="button"
      className={`ca-badge${hasCa ? "" : " is-empty"}`}
      disabled={!hasCa}
      onClick={() => {
        if (!hasCa) return;
        navigator.clipboard
          ?.writeText(ca)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          })
          .catch(() => {});
      }}
      title={hasCa ? "Copy contract address" : "The contract address is not live yet"}
    >
      <span className="ca-badge-label">CA:</span>
      <span className="ca-badge-value">{hasCa ? (copied ? "Copied" : ca) : "not live yet"}</span>
    </button>
  );
}
