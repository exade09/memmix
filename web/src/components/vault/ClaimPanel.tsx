import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { useChain } from "../../chain/wallet";
import { isClaimed, submitClaim } from "../../chain/rewards";
import { useDistributor } from "../../chain/useDistributor";
import { formatTokenAmount } from "../../chain/erc20";
import { fetchRewardClaims, type RewardClaim } from "../../services/api";
import { Button } from "../ui/Button";
import { AssetBadge } from "./AssetBadge";

/*
  What a holder can claim, and the button that claims it.

  Each entry is checked against the chain before it is offered, because the
  server only knows what it published -- whether an entry has already been
  taken is a fact only the contract has. An entry that is already claimed is
  shown as claimed rather than dangling a button that would revert.
*/

type ClaimRow = RewardClaim & { claimed: boolean; pending: boolean; error: string };

export function ClaimPanel() {
  const { address, walletClient, publicClient, connect, phase } = useChain();
  const { distributor, loading: resolving } = useDistributor();
  const [rows, setRows] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!address || !distributor) return;
    setLoading(true);
    const claims = await fetchRewardClaims(address);
    const withStatus = await Promise.all(
      claims.map(async (claim) => {
        let claimed = false;
        try {
          claimed = await isClaimed(publicClient, distributor, BigInt(claim.round_id), BigInt(claim.index));
        } catch {
          // If the chain cannot be read, leave it claimable: the claim call
          // simulates first and will refuse if it is already taken.
        }
        return { ...claim, claimed, pending: false, error: "" };
      }),
    );
    setRows(withStatus);
    setLoading(false);
    setLoaded(true);
  }, [address, distributor, publicClient]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onClaim(row: ClaimRow) {
    if (!address || !walletClient || !distributor) return;
    setRows((current) =>
      current.map((r) => (r.round_id === row.round_id ? { ...r, pending: true, error: "" } : r)),
    );
    try {
      await submitClaim(walletClient, publicClient, distributor, address, {
        roundId: BigInt(row.round_id),
        index: BigInt(row.index),
        account: row.account as Address,
        amount: BigInt(row.amount_wei),
        proof: row.proof as `0x${string}`[],
      });
      setRows((current) =>
        current.map((r) =>
          r.round_id === row.round_id ? { ...r, claimed: true, pending: false } : r,
        ),
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message.slice(0, 160)
          : "The claim did not go through. Nothing was sent.";
      setRows((current) =>
        current.map((r) => (r.round_id === row.round_id ? { ...r, pending: false, error: message } : r)),
      );
    }
  }

  if (resolving) return null;

  if (!distributor) {
    return (
      <div className="panel stack">
        <p className="eyebrow">Your rewards</p>
        <p className="metric-label">
          No payout rounds have been published yet. When they are, anything owed to your wallet shows up here.
        </p>
      </div>
    );
  }

  if (!address) {
    return (
      <div className="panel stack">
        <p className="eyebrow">Your rewards</p>
        <p className="body-copy">Connect a wallet to see what it can claim.</p>
        <div className="btn-row">
          <Button type="button" variant="primary" onClick={() => void connect()} disabled={phase === "connecting"}>
            {phase === "connecting" ? "Connecting…" : "Connect wallet"}
          </Button>
        </div>
      </div>
    );
  }

  const unclaimed = rows.filter((r) => !r.claimed);

  return (
    <div className="panel stack">
      <p className="eyebrow">Your rewards</p>

      {loading && !loaded ? <p className="metric-label">Checking the chain…</p> : null}

      {loaded && rows.length === 0 ? (
        <p className="metric-label">
          Nothing to claim on this wallet yet. Rounds are paid to whoever held ${"FONS"} at the snapshot block, so
          holding through the next one is what puts something here.
        </p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="claim-list">
          {rows.map((row) => (
            <li key={`${row.round_id}-${row.index}`} className={`claim-row${row.claimed ? " is-done" : ""}`}>
              <AssetBadge symbol={row.asset_symbol} address={row.asset} />
              <div className="claim-amount">
                <strong>
                  {formatTokenAmount(BigInt(row.amount_wei), row.asset_decimals)} {row.asset_symbol}
                </strong>
                <span className="metric-label">Round {row.round_id}</span>
              </div>
              <div className="claim-action">
                {row.claimed ? (
                  <span className="chip">Claimed</span>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={row.pending}
                    aria-busy={row.pending || undefined}
                    onClick={() => void onClaim(row)}
                  >
                    {row.pending ? "Claiming…" : "Claim"}
                  </Button>
                )}
              </div>
              {row.error ? <p className="note error claim-error">{row.error}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {unclaimed.length > 0 ? (
        <p className="metric-label">
          Each claim is one transaction you sign, and you pay its gas. Amounts are fixed by the published round, so
          claiming later never gets you less.
        </p>
      ) : null}
    </div>
  );
}
