import { useEffect, useState } from "react";
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
*/

export function CaAdminPage() {
  const [password, setPassword] = useState("");
  const [ca, setCa] = useState("");
  const [current, setCurrent] = useState<{ ca: string; updated_at: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

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

  async function onSave() {
    setSaving(true);
    setMessage(null);
    const result = await updateContractAddress(password, ca);
    setSaving(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error.message || "Save failed." });
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

          <form
            className="stack"
            style={{ marginTop: 24, maxWidth: "48ch", gap: 16 }}
            onSubmit={(event) => {
              event.preventDefault();
              void onSave();
            }}
          >
            <label className="field">
              <span>Admin password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="off"
                required
              />
            </label>

            <label className="field">
              <span>
                Contract address<span>{ca.length}/128</span>
              </span>
              <input
                value={ca}
                onChange={(event) => setCa(event.target.value)}
                maxLength={128}
                autoComplete="off"
                placeholder="0x…"
              />
            </label>

            <Button type="submit" variant="primary" disabled={saving || !password}>
              {saving ? "Saving…" : "Save"}
            </Button>

            {message ? (
              <p className={`note${message.tone === "error" ? " error" : " live"}`} role="status">
                {message.text}
              </p>
            ) : null}
          </form>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
