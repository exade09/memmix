import { useEffect, useState } from "react";
import { appConfig } from "../../app/config";
import { SiteFooter } from "../../components/layout/SiteFooter";
import { AnimatedText } from "../../components/motion/AnimatedText";
import { GlassMark } from "../../components/brand/GlassMark";
import { ButtonAnchor, ButtonLink } from "../../components/ui/Button";
import { weiToEthLabel } from "../../chain/units";
import { shortenAddress } from "../../chain/address";
import { explorerTokenUrl } from "../../domain/legalCopy";
import { fetchVaultState, type VaultState } from "../../services/api";
import { ClaimPanel } from "../../components/vault/ClaimPanel";
import { useDistributor } from "../../chain/useDistributor";

/*
  The rewards vault.

  Every figure here is read from the chain when the page loads: the balance is
  the vault wallet's balance, the holder count comes from the token's own
  Transfer history, and what has been paid out is the transfers the vault has
  sent. Nothing is stored server-side, so there is no number here that Fons
  could quietly edit -- anyone can check all of it against the address.

  While it is unconfigured the page says so plainly rather than showing
  zeroes, because a zero reads as a fact ("nothing has accrued") when the
  truth is that nothing is switched on yet.
*/

const EXPLORER = "https://robinhoodchain.blockscout.com";

function addressUrl(address: string): string {
  return `${EXPLORER}/address/${address}`;
}

export function VaultPage() {
  const [state, setState] = useState<VaultState | null>(null);
  const [loading, setLoading] = useState(true);
  const { distributor } = useDistributor();

  useEffect(() => {
    const controller = new AbortController();
    fetchVaultState({ signal: controller.signal }).then((next) => {
      setState(next);
      setLoading(false);
    });
    return () => controller.abort();
  }, []);

  const live = Boolean(state?.live);
  // Filling up and paying out are separate: the vault can collect for weeks
  // before $FONS exists, and the page should not report that as nothing.
  const collecting = Boolean(state?.collecting);
  const hasVault = Boolean(state?.vault);
  // Whether payouts are enforced by the distributor or are still transfers
  // Fons sends by hand. The page has to say which, because the honest claim
  // is a different one in each case.
  const onChain = Boolean(distributor);
  const feePercent = state ? (state.creator_fee_bps / 100).toFixed(2).replace(/\.?0+$/, "") : null;

  return (
    <>
      <div className="section">
        <div className="wrap legal-page">
          <p className="eyebrow">Rewards</p>
          <AnimatedText as="h1" reveal="lines" lines={["The vault"]} />
          <p className="body-copy">
            Fees from the launches Fons pays for collect in one wallet, and that balance is split across $
            {appConfig.tokenSymbol} holders in proportion to how much they hold. Everything below is read from the
            chain, not from our database.
          </p>

          <div className="panel stack" style={{ marginTop: 8 }}>
            <p className="eyebrow">Live state</p>
            {loading ? (
              <p className="metric-label">Reading the chain…</p>
            ) : !state ? (
              <p className="note warn">
                The vault could not be read just now. Nothing is wrong with the balance — this page simply could not
                reach the chain, so it is not going to guess at a number.
              </p>
            ) : (
              <>
                <dl className="facts strong">
                  <div>
                    <dt>In the vault</dt>
                    <dd>{hasVault ? weiToEthLabel(BigInt(state.balance_wei)) : "No wallet yet"}</dd>
                  </div>
                  <div>
                    <dt>Paid out so far</dt>
                    <dd>{hasVault ? weiToEthLabel(BigInt(state.distributed_wei)) : "Nothing"}</dd>
                  </div>
                  <div>
                    <dt>Holders</dt>
                    <dd>{live ? state.holder_count.toLocaleString() : "No token yet"}</dd>
                  </div>
                  <div>
                    <dt>Fee funding it</dt>
                    <dd>{state.creator_fee_bps > 0 ? `${feePercent}% of trades` : "Off"}</dd>
                  </div>
                </dl>

                {state.reason === "no_vault" ? (
                  <p className="note warn">
                    The vault wallet is not set up yet, so no fee is being collected.
                  </p>
                ) : null}

                {state.reason === "no_token" ? (
                  <p className="note">
                    {collecting
                      ? `The vault is collecting. Payouts begin once $${appConfig.tokenSymbol} launches — until it exists there is no holder list to split across, so the balance simply builds up.`
                      : `The vault is set up, but the fee that funds it is switched off, so the balance is not growing yet.`}
                  </p>
                ) : null}

                {live && !collecting ? (
                  <p className="note warn">
                    The fee that funds the vault is switched off, so the balance is not growing.
                  </p>
                ) : null}

                {live && !state.complete_scan ? (
                  <p className="metric-label">
                    The holder count comes from a bounded scan of recent history, so treat it as a floor rather than
                    a final total. Payout shares are always computed from balances at one block, not from this count.
                  </p>
                ) : null}

                {state.vault ? (
                  <p className="metric-label">
                    Vault wallet {shortenAddress(state.vault)} — check every payment yourself on the explorer.
                  </p>
                ) : null}
              </>
            )}
          </div>

          <ClaimPanel />

          <h3>How it works</h3>
          <ol className="doc-steps">
            <li>
              <span className="doc-step-index">01</span>
              <div>
                <strong>Fons launches a token and pays for it</strong>
                <p>
                  Fons covers the launch fee and the gas, and takes the creator fee on that token's trades in
                  return. That trade is what funds everything below. Launch from your own wallet instead and the
                  fee stays yours — and ${appConfig.tokenSymbol} itself was launched that way, so its own fee is
                  not part of this.
                </p>
              </div>
            </li>
            <li>
              <span className="doc-step-index">02</span>
              <div>
                <strong>That fee lands in the vault</strong>
                <p>
                  It is pointed at one wallet whose address is published above, instead of at a private one. Its
                  balance is public and always has been.
                </p>
              </div>
            </li>
            <li>
              <span className="doc-step-index">03</span>
              <div>
                <strong>It is split across ${appConfig.tokenSymbol} holders</strong>
                <p>
                  Balances are read at a single block and each holder receives a share proportional to what they
                  hold. Rounding is left over rather than given to whoever sorts first.
                </p>
              </div>
            </li>
            {onChain ? (
              <li>
                <span className="doc-step-index">04</span>
                <div>
                  <strong>You claim it yourself</strong>
                  <p>
                    The split is published as a round and funded in the same transaction, so the money is in the
                    contract before the round exists. Your share is yours to take whenever you want it; nobody can
                    claim it for themselves, and it cannot be taken back while the round is still claimable.
                  </p>
                </div>
              </li>
            ) : null}
          </ol>

          <aside className="doc-note">
            {onChain ? (
              <>
                Deciding the split still happens off chain, and Fons decides when a round runs and how much goes
                into it — neither is forced by anything. What the contract does guarantee is the part that follows:
                a round cannot promise more than was paid into it, nobody can claim twice or claim into someone
                else's pocket, and Fons cannot take a round back once it is claimable. The snapshot block and the
                root are published with each round, so the split itself can be recomputed and compared rather than
                taken on trust.
              </>
            ) : (
              <>
                Payouts are sent by Fons from that wallet. They are not enforced by a contract, so this depends on
                Fons actually sending them — that is a real difference from a system that distributes on its own,
                and it is why the wallet address is published for you to audit.
              </>
            )}{" "}
            Fees only exist if people trade, the amount is whatever trading produces, and no rate or projection is
            promised anywhere on this site.
          </aside>

          <div className="btn-row" style={{ marginTop: 8 }}>
            {state?.vault ? (
              <ButtonAnchor href={addressUrl(state.vault)} target="_blank" rel="noreferrer" variant="outline">
                View the vault wallet
              </ButtonAnchor>
            ) : null}
            {state?.token ? (
              <ButtonAnchor
                href={explorerTokenUrl(state.token)}
                target="_blank"
                rel="noreferrer"
                variant="outline"
              >
                View ${appConfig.tokenSymbol}
              </ButtonAnchor>
            ) : null}
            <ButtonLink to="/docs" variant="ghost">
              Read the docs
            </ButtonLink>
          </div>

          <div style={{ display: "grid", placeItems: "center", marginTop: 8 }}>
            <GlassMark state="idle" className="sz-sm" quiet />
          </div>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
