import { useEffect, useMemo, useState } from "react";
import { fetchStocks, type TokenizedStock } from "../../services/api";

/*
  What the new token trades against.

  Every launch so far has been priced in ETH. Robinhood Chain also carries
  tokenized equities, and the launch factory takes the pair token as a
  parameter, so a token can just as well be bought and sold in Apple. This is
  where that choice is made.

  The list is the server's verified registry rather than free text: a
  sponsored launch is paid for out of Fons's own wallet, and the factory does
  not check the pair token itself, so an arbitrary address here is a way to
  spend real money deploying a curve against something that is not an equity.
*/

export type PairChoice = { kind: "native" } | { kind: "stock"; stock: TokenizedStock };

export const NATIVE_PAIR: PairChoice = { kind: "native" };

export function pairLabel(choice: PairChoice): string {
  return choice.kind === "native" ? "ETH" : choice.stock.symbol;
}

export function StockPairPicker({
  value,
  onChange,
  disabled,
}: {
  value: PairChoice;
  onChange: (next: PairChoice) => void;
  disabled?: boolean;
}) {
  const [stocks, setStocks] = useState<TokenizedStock[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetchStocks(controller.signal).then((list) => {
      setStocks(list);
      setLoading(false);
    });
    return () => controller.abort();
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return stocks.slice(0, 24);
    return stocks
      .filter(
        (stock) =>
          stock.symbol.toLowerCase().includes(needle) || stock.name.toLowerCase().includes(needle),
      )
      .slice(0, 24);
  }, [stocks, query]);

  const isStock = value.kind === "stock";

  return (
    <div className="stack sm pair-picker">
      <div className="segmented" role="group" aria-label="What the token trades against">
        <button
          type="button"
          className={!isStock ? "is-on" : ""}
          aria-pressed={!isStock}
          disabled={disabled}
          onClick={() => onChange(NATIVE_PAIR)}
        >
          ETH
        </button>
        <button
          type="button"
          className={isStock ? "is-on" : ""}
          aria-pressed={isStock}
          disabled={disabled || (!loading && stocks.length === 0)}
          onClick={() => {
            if (value.kind === "stock") return;
            const first = stocks[0];
            if (first) onChange({ kind: "stock", stock: first });
          }}
        >
          A stock
        </button>
      </div>

      {!isStock ? (
        <p className="metric-label">Bought and sold in ETH, the way every Fons launch has been so far.</p>
      ) : (
        <>
          <label className="field">
            <span>Which stock</span>
            <input
              className="control"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search AAPL, Tesla, SPY…"
              autoComplete="off"
              disabled={disabled}
            />
          </label>

          <div className="pair-options" role="listbox" aria-label="Tokenized stocks">
            {loading ? <p className="metric-label">Loading the verified list…</p> : null}
            {!loading && matches.length === 0 ? (
              <p className="metric-label">Nothing matches that. The list only holds verified equities.</p>
            ) : null}
            {matches.map((stock) => {
              const selected = value.kind === "stock" && value.stock.address === stock.address;
              return (
                <button
                  type="button"
                  key={stock.address}
                  role="option"
                  aria-selected={selected}
                  className={`pair-option${selected ? " is-on" : ""}`}
                  disabled={disabled}
                  onClick={() => onChange({ kind: "stock", stock })}
                >
                  <strong>{stock.symbol}</strong>
                  <span>{stock.name}</span>
                </button>
              );
            })}
          </div>

          {value.kind === "stock" ? (
            <p className="metric-label">
              Priced in {value.stock.symbol}. Buyers need {value.stock.symbol} to buy it, and it graduates in{" "}
              {value.stock.symbol} rather than ETH. The launch fee is still paid in ETH.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
