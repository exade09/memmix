import { useEffect, useState } from "react";
import type { Address } from "viem";
import { SiteFooter } from "../../components/layout/SiteFooter";
import { Button } from "../../components/ui/Button";
import { useChain } from "../../chain/wallet";
import {
  approveErc20,
  formatTokenAmount,
  parseTokenAmount,
  readErc20Allowance,
  readErc20Balance,
} from "../../chain/erc20";
import {
  isNativeAsset,
  NATIVE_ASSET,
  readDistributorOwner,
  rewardsDistributorAddress,
  submitCreateRound,
} from "../../chain/rewards";
import {
  fetchStocks,
  prepareRewardRound,
  publishRewardRound,
  type PreparedRound,
  type TokenizedStock,
} from "../../services/api";

/*
  Paying out a round.

  The cycle is three steps and they are separate on purpose, because only the
  middle one spends money:

    1. Prepare  -- the server reads holder balances at one block and works out
                   the split. Nothing moves; run it as often as you like.
    2. Create   -- one wallet transaction publishes the root and funds the
                   round in the same call, so a round cannot be announced
                   without the money behind it.
    3. Publish  -- files the payout table against the id the chain gave, so
                   holders can be handed proofs. Records, does not authorise.

  The round id comes from the receipt, never from a count read beforehand.
  Filing a table against the wrong id would hand every holder a proof that
  fails to verify, and the mistake is only visible once someone tries to claim.

  Like the CA page, this is reached by direct URL and the real protection is
  the server-side password check on every call. The password lives in state
  for as long as the tab is open and is never stored.
*/

type Stage = "locked" | "compose" | "prepared" | "created" | "done";

export function VaultAdminPage() {
  const { address, walletClient, publicClient, connect, phase, onTargetChain, switchNetwork } = useChain();
  const distributor = rewardsDistributorAddress();

  const [password, setPassword] = useState("");
  const [stage, setStage] = useState<Stage>("locked");
  const [stocks, setStocks] = useState<TokenizedStock[]>([]);
  const [asset, setAsset] = useState<string>(NATIVE_ASSET);
  const [amount, setAmount] = useState("");
  const [prepared, setPrepared] = useState<PreparedRound | null>(null);
  const [roundId, setRoundId] = useState<number | null>(null);
  const [owner, setOwner] = useState<Address | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchStocks(controller.signal).then(setStocks);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!distributor) return;
    readDistributorOwner(publicClient, distributor).then(setOwner).catch(() => setOwner(null));
  }, [distributor, publicClient]);

  const decimals = prepared?.asset_decimals ?? (asset === NATIVE_ASSET ? 18 : 18);
  const isOwner = Boolean(owner && address && owner.toLowerCase() === address.toLowerCase());

  function fail(text: string) {
    setMessage({ tone: "error", text });
    setBusy("");
  }

  async function onPrepare() {
    setBusy("prepare");
    setMessage(null);
    let amountWei: bigint;
    try {
      amountWei = parseTokenAmount(amount, decimals);
    } catch {
      return fail("That amount is not a number.");
    }
    if (amountWei <= 0n) return fail("Enter an amount above zero.");

    const result = await prepareRewardRound(password, amountWei.toString(), asset);
    setBusy("");
    if (!result.ok) {
      if (result.error.code === "WRONG_PASSWORD") setStage("locked");
      return setMessage({ tone: "error", text: result.error.message });
    }
    setPrepared(result.data);
    setStage("prepared");
  }

  async function onCreate() {
    if (!prepared || !distributor) return;
    if (!address || !walletClient) return fail("Connect the owner wallet first.");
    if (!isOwner) return fail("This wallet does not own the distributor, so it cannot create a round.");

    setBusy("create");
    setMessage(null);
    const total = BigInt(prepared.total_wei);

    try {
      // An ERC-20 round is pulled from the wallet, so it needs both the
      // balance and an allowance. Checking here turns two silent reverts
      // into two sentences.
      if (!isNativeAsset(prepared.asset)) {
        const token = prepared.asset as Address;
        const held = await readErc20Balance(publicClient, token, address);
        if (held < total) {
          return fail(
            `This wallet holds ${formatTokenAmount(held, prepared.asset_decimals)} ${prepared.asset_symbol}, ` +
              `and the round needs ${formatTokenAmount(total, prepared.asset_decimals)}.`,
          );
        }
        const allowance = await readErc20Allowance(publicClient, token, address, distributor);
        if (allowance < total) {
          setBusy("approve");
          const hash = await approveErc20(walletClient, address, token, distributor, total);
          await publicClient.waitForTransactionReceipt({ hash });
          setBusy("create");
        }
      }

      const { roundId: id } = await submitCreateRound(walletClient, publicClient, distributor, address, {
        asset: prepared.asset as Address,
        merkleRoot: prepared.root as `0x${string}`,
        total,
        snapshotBlock: BigInt(prepared.snapshot_block),
        expiresAt: 0n,
      });
      setRoundId(id);
      setStage("created");
      setBusy("");
      setMessage({
        tone: "ok",
        text: `Round ${id} is on chain and funded. It is not claimable until it is published below.`,
      });
    } catch (err: unknown) {
      fail(err instanceof Error ? err.message.slice(0, 200) : "The round was not created.");
    }
  }

  async function onPublish() {
    if (!prepared || roundId === null) return;
    setBusy("publish");
    setMessage(null);
    const result = await publishRewardRound(password, {
      roundId,
      asset: prepared.asset,
      root: prepared.root,
      snapshotBlock: prepared.snapshot_block,
      payouts: prepared.payouts,
    });
    setBusy("");
    if (!result.ok) return setMessage({ tone: "error", text: result.error.message });
    setStage("done");
    setMessage({
      tone: "ok",
      text: `Round ${roundId} published. Holders can claim it now.`,
    });
  }

  function reset() {
    setPrepared(null);
    setRoundId(null);
    setAmount("");
    setMessage(null);
    setStage("compose");
  }

  if (!distributor) {
    return (
      <>
        <div className="section">
          <div className="wrap legal-page">
            <p className="eyebrow">Admin</p>
            <h1>Payout rounds</h1>
            <p className="note warn">
              No distributor is configured. Deploy it with{" "}
              <code>contracts/scripts/deploy-distributor.cjs</code>, then set{" "}
              <code>VITE_REWARDS_DISTRIBUTOR_ADDRESS</code> and redeploy.
            </p>
          </div>
        </div>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <div className="section">
        <div className="wrap legal-page">
          <p className="eyebrow">Admin</p>
          <h1>Payout rounds</h1>
          <p className="body-copy">
            Splits an amount across $FONS holders and publishes it as a claimable round. Preparing costs nothing;
            only the middle step spends.
          </p>

          {stage === "locked" ? (
            <form
              className="stack"
              style={{ marginTop: 24, maxWidth: "48ch", gap: 16 }}
              onSubmit={(event) => {
                event.preventDefault();
                if (password) setStage("compose");
              }}
            >
              <label className="field">
                <span>Admin password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="off"
                  autoFocus
                  required
                />
              </label>
              <Button type="submit" variant="primary" disabled={!password}>
                Continue
              </Button>
              {message ? (
                <p className="note error" role="status">
                  {message.text}
                </p>
              ) : null}
            </form>
          ) : (
            <>
              <div className="panel stack" style={{ marginTop: 16 }}>
                <p className="eyebrow">Step 1 — work out the split</p>
                <label className="field">
                  <span>Asset</span>
                  <select
                    value={asset}
                    disabled={stage !== "compose"}
                    onChange={(event) => setAsset(event.target.value)}
                  >
                    <option value={NATIVE_ASSET}>ETH</option>
                    {stocks.map((s) => (
                      <option key={s.address} value={s.address}>
                        {s.symbol} — {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Amount to distribute</span>
                  <input
                    value={amount}
                    disabled={stage !== "compose"}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="0.5"
                    inputMode="decimal"
                    autoComplete="off"
                  />
                </label>
                <div className="btn-row">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={stage !== "compose" || !amount || busy === "prepare"}
                    onClick={() => void onPrepare()}
                  >
                    {busy === "prepare" ? "Reading holders…" : "Prepare"}
                  </Button>
                  {stage !== "compose" ? (
                    <Button type="button" variant="ghost" onClick={reset}>
                      Start over
                    </Button>
                  ) : null}
                </div>
              </div>

              {prepared ? (
                <div className="panel stack">
                  <p className="eyebrow">Step 2 — publish and fund it</p>
                  <dl className="facts strong">
                    <div>
                      <dt>Asset</dt>
                      <dd>{prepared.asset_symbol}</dd>
                    </div>
                    <div>
                      <dt>Total</dt>
                      <dd>
                        {formatTokenAmount(BigInt(prepared.total_wei), prepared.asset_decimals)}{" "}
                        {prepared.asset_symbol}
                      </dd>
                    </div>
                    <div>
                      <dt>Recipients</dt>
                      <dd>{prepared.recipient_count.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Snapshot block</dt>
                      <dd>{prepared.snapshot_block.toLocaleString()}</dd>
                    </div>
                  </dl>
                  <p className="metric-label" style={{ wordBreak: "break-all" }}>
                    Root {prepared.root}
                  </p>
                  {BigInt(prepared.total_wei) !== BigInt(prepared.requested_wei) ? (
                    <p className="metric-label">
                      This is slightly under what you asked for. Rounding is left undistributed rather than given to
                      whoever sorts first.
                    </p>
                  ) : null}

                  {!address ? (
                    <div className="btn-row">
                      <Button
                        type="button"
                        variant="primary"
                        onClick={() => void connect()}
                        disabled={phase === "connecting"}
                      >
                        {phase === "connecting" ? "Connecting…" : "Connect the owner wallet"}
                      </Button>
                    </div>
                  ) : !onTargetChain ? (
                    <div className="btn-row">
                      <Button type="button" variant="primary" onClick={() => void switchNetwork()}>
                        Switch to Robinhood Chain
                      </Button>
                    </div>
                  ) : !isOwner ? (
                    <p className="note warn">
                      This wallet does not own the distributor. Only {owner ?? "its owner"} can create a round.
                    </p>
                  ) : (
                    <div className="btn-row">
                      <Button
                        type="button"
                        variant="primary"
                        disabled={stage !== "prepared" || busy !== ""}
                        onClick={() => void onCreate()}
                      >
                        {busy === "approve"
                          ? "Approving…"
                          : busy === "create"
                            ? "Creating round…"
                            : `Create round with ${formatTokenAmount(BigInt(prepared.total_wei), prepared.asset_decimals)} ${prepared.asset_symbol}`}
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}

              {roundId !== null ? (
                <div className="panel stack">
                  <p className="eyebrow">Step 3 — hand out the proofs</p>
                  <p className="body-copy">
                    Round {roundId} exists on chain. Until it is published here, holders have no proof to claim with.
                  </p>
                  <div className="btn-row">
                    <Button
                      type="button"
                      variant="primary"
                      disabled={stage === "done" || busy === "publish"}
                      onClick={() => void onPublish()}
                    >
                      {busy === "publish" ? "Publishing…" : stage === "done" ? "Published" : "Publish round"}
                    </Button>
                  </div>
                </div>
              ) : null}

              {message ? (
                <p className={`note${message.tone === "error" ? " error" : " live"}`} role="status">
                  {message.text}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
