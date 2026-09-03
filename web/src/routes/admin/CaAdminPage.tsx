import { useEffect, useRef, useState } from "react";
import { SiteFooter } from "../../components/layout/SiteFooter";
import { Button } from "../../components/ui/Button";
import { fetchContractAddress, updateContractAddress } from "../../services/api";

/*
  The only place the CA is written. Reached by direct URL, not linked from any
  nav — the real protection is the server-side password check on every save,
  not the URL being obscure.

  The password is never stored: it lives in this component's state for as
  long as the tab is open and is sent fresh with every save, never written to
  localStorage or a cookie.

  Two steps, deliberately: the CA field does not exist until a password has
  been entered. "Continue" does not check it against the server — there is no
  endpoint for that, and the real check still happens on Save — it just moves
  you from typing a password to typing the address, so the two never sit side
  by side asking to be filled in either order.

  No format is enforced on the address itself beyond a generous length cap
  against a pathological paste: "TBA", an address, a note, whatever the
  launch actually needs at the time, all save the same way.
*/

export function CaAdminPage() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [ca, setCa] = useState("");
  const [current, setCurrent] = useState<{ ca: string; updated_at: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const caInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchContractAddress().then((state) => {
      if (cancelled) return;
      setCurrent(state);
      setCa(state.ca);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (unlocked) caInputRef.current?.focus();
  }, [unlocked]);

  function onContinue() {
    if (!password) return;
    setMessage(null);
    setUnlocked(true);
  }

  function onChangePassword() {
    setUnlocked(false);
    setMessage(null);
  }

  async function onSave() {
    setSaving(true);
    setMessage(null);
    const result = await updateContractAddress(password, ca);
    setSaving(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error.message || "Save failed." });
      // A wrong password is the one failure worth sending them back a step
      // for, since typing a new CA will not fix it.
      if (result.error.code === "WRONG_PASSWORD") setUnlocked(false);
      return;
    }
    setCurrent({ ca: result.data.ca, updated_at: result.data.updated_at });
    setMessage({
      tone: "ok",
      text:
        result.data.live_in_seconds > 0
          ? `Saved. Live on the site in about ${result.data.live_in_seconds} seconds.`
          : "Saved. Live now.",
    });
  }

  return (
    <>
      <div className="section">
        <div className="wrap legal-page">
          <p className="eyebrow">Admin</p>
          <h1>Contract address</h1>
          <p className="body-copy">
            Sets the CA badge shown in the site header. Nothing here is public except the text itself once saved.
          </p>

          <dl className="doc-facts" style={{ marginTop: 8 }}>
            <div>
              <dt>Current value</dt>
              <dd>{current === null ? "…" : current.ca || "not set"}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{current?.updated_at ?? "—"}</dd>
            </div>
          </dl>

          {!unlocked ? (
            <form
              className="stack"
              style={{ marginTop: 24, maxWidth: "48ch", gap: 16 }}
              onSubmit={(event) => {
                event.preventDefault();
                onContinue();
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
                <p className={`note${message.tone === "error" ? " error" : " live"}`} role="status">
                  {message.text}
                </p>
              ) : null}
            </form>
          ) : (
            <form
              className="stack"
              style={{ marginTop: 24, maxWidth: "48ch", gap: 16 }}
              onSubmit={(event) => {
                event.preventDefault();
                void onSave();
              }}
            >
              <div className="field">
                <span>
                  <span>Admin password</span>
                  <Button type="button" variant="ghost" size="sm" onClick={onChangePassword}>
                    Change
                  </Button>
                </span>
                <p className="metric-label">Entered — hidden while you fill in the address below.</p>
              </div>

              <label className="field">
                <span>Contract address</span>
                <input
                  ref={caInputRef}
                  value={ca}
                  onChange={(event) => setCa(event.target.value)}
                  autoComplete="off"
                  placeholder="0x… or TBA"
                />
              </label>

              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>

              {message ? (
                <p className={`note${message.tone === "error" ? " error" : " live"}`} role="status">
                  {message.text}
                </p>
              ) : null}
            </form>
          )}
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
