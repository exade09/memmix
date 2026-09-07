import { useState } from "react";
import { SiteFooter } from "../../components/layout/SiteFooter";
import { Button } from "../../components/ui/Button";
import {
  detectLaunchBlock,
  fetchAdminSettings,
  saveAdminSettings,
  type AdminSettings,
} from "../../services/api";

/*
  The settings that used to be environment variables.

  All of these are set once, right after $FONS launches, which is exactly the
  moment when going to a hosting dashboard, editing a variable and waiting for
  a redeploy is most annoying and easiest to get wrong.

  Two columns on purpose: what is stored here, and what is actually in effect.
  They differ whenever an environment variable is still answering, and an
  operator who sees only an empty field will conclude nothing is set and be
  wrong. Clearing a field is how you hand the question back to the
  environment, so the effective column is the only way to see what that did.

  Like the other admin pages, this is reached by direct URL and the real
  protection is the password check the server runs on every call -- including
  the read, because the effective column is a map of where the fees go.
*/

type FieldSpec = {
  key: keyof AdminSettings["effective"];
  label: string;
  placeholder: string;
  help: string;
};

const FIELDS: FieldSpec[] = [
  {
    key: "rewards_distributor_address",
    label: "Distributor contract",
    placeholder: "0x…",
    help: "Where holders claim from. Until this is set, no claim button appears anywhere on the site.",
  },
  {
    key: "fons_token_start_block",
    label: "$FONS start block",
    placeholder: "56428635",
    help:
      "The block $FONS was launched in. Without it the holder scan has no floor, so payouts refuse to run rather than quietly paying early buyers nothing. Read it from the chain instead of typing it.",
  },
  {
    key: "fons_token_address",
    label: "$FONS address",
    placeholder: "0x… (optional)",
    help: "Only needed if it should differ from the published CA, which is used otherwise.",
  },
  {
    key: "rewards_vault_address",
    label: "Vault wallet",
    placeholder: "0x…",
    help: "Where creator fees from sponsored launches are sent, and what payouts are funded from.",
  },
  {
    key: "creator_fee_bps",
    label: "Creator fee (bps)",
    placeholder: "50",
    help: "Charged on trades of tokens launched through Fons. 50 is 0.5%. Zero switches it off. Capped at 1000.",
  },
];

export function SettingsAdminPage() {
  const [password, setPassword] = useState("");
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function load(next: AdminSettings) {
    setSettings(next);
    const stored: Record<string, string> = {};
    for (const field of FIELDS) {
      const value = next.stored[field.key];
      stored[field.key] = value === undefined || value === null ? "" : String(value);
    }
    setDraft(stored);
  }

  async function onUnlock() {
    setBusy(true);
    setMessage(null);
    const result = await fetchAdminSettings(password);
    setBusy(false);
    if (!result.ok) return setMessage({ tone: "error", text: result.error.message });
    load(result.data);
  }

  async function onDetect() {
    setBusy(true);
    setMessage(null);
    const typed = (draft.fons_token_address ?? "").trim();
    const result = await detectLaunchBlock(password, typed || undefined);
    setBusy(false);
    if (!result.ok) return setMessage({ tone: "error", text: result.error.message });
    setDraft({ ...draft, fons_token_start_block: String(result.data.block_number) });
    setMessage({
      tone: "ok",
      text: `Found the launch at block ${result.data.block_number}. Save to apply it.`,
    });
  }

  async function onSave() {
    setBusy(true);
    setMessage(null);
    const result = await saveAdminSettings(password, draft);
    setBusy(false);
    if (!result.ok) {
      if (result.error.code === "WRONG_PASSWORD") setSettings(null);
      return setMessage({ tone: "error", text: result.error.message });
    }
    load(result.data);
    const wait = result.data.live_in_seconds ?? 0;
    setMessage({
      tone: "ok",
      text: wait > 0 ? `Saved. Live in about ${wait} seconds.` : "Saved. Live now.",
    });
  }

  /*
    Zero is the unset value for both numbers here: a start block of zero means
    the scan has no floor, and a fee of zero means no fee is charged. Printing
    a bare "0" alongside "in effect" would read as a configured choice.
  */
  function effectiveLabel(field: FieldSpec): string {
    const value = settings?.effective[field.key];
    if (value === null || value === undefined || value === "") return "not set";
    if (field.key === "fons_token_start_block" && value === 0) return "not set";
    if (field.key === "creator_fee_bps" && value === 0) return "off";
    return String(value);
  }

  function isFromEnv(field: FieldSpec): boolean {
    // Only claim the environment answered when it actually supplied a value.
    // Blank here plus nothing in effect is simply unconfigured, and saying
    // otherwise sends someone hunting through a dashboard for a variable that
    // was never set.
    const stored = (draft[field.key] ?? "").trim();
    const label = effectiveLabel(field);
    return stored === "" && label !== "not set" && label !== "off";
  }

  return (
    <>
      <div className="section">
        <div className="wrap legal-page">
          <p className="eyebrow">Admin</p>
          <h1>Rewards settings</h1>
          <p className="body-copy">
            Everything the payout cycle needs, in one place. A blank field is not a zero — it hands the question
            back to the environment variable of the same name.
          </p>
          <p className="metric-label">
            $FONS launches through Pons, the same factory the site uses for everyone else, so the chain already
            knows its start block — read it rather than typing it.
          </p>

          {!settings ? (
            <form
              className="stack"
              style={{ marginTop: 24, maxWidth: "48ch", gap: 16 }}
              onSubmit={(event) => {
                event.preventDefault();
                void onUnlock();
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
              <Button type="submit" variant="primary" disabled={!password || busy}>
                {busy ? "Checking…" : "Continue"}
              </Button>
              {message ? (
                <p className="note error" role="status">
                  {message.text}
                </p>
              ) : null}
            </form>
          ) : (
            <form
              className="stack"
              style={{ marginTop: 24, gap: 20 }}
              onSubmit={(event) => {
                event.preventDefault();
                void onSave();
              }}
            >
              {FIELDS.map((field) => (
                <label className="field" key={field.key}>
                  <span>{field.label}</span>
                  <input
                    value={draft[field.key] ?? ""}
                    onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                    placeholder={field.placeholder}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="metric-label">
                    In effect: {effectiveLabel(field)}
                    {isFromEnv(field) ? " — from the environment, not from here" : ""}
                  </p>
                  <p className="metric-label">{field.help}</p>
                  {field.key === "fons_token_start_block" ? (
                    <div className="btn-row">
                      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void onDetect()}>
                        Read it from the chain
                      </Button>
                    </div>
                  ) : null}
                </label>
              ))}

              <div className="btn-row">
                <Button type="submit" variant="primary" disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setSettings(null)}>
                  Lock
                </Button>
              </div>

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
