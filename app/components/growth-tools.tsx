import { useState, useEffect } from "react";
import { Spinner } from "@shopify/polaris";

// Shared POST helper for these tool panels.
const post = async (intent: string, extra: Record<string, any> = {}, endpoint = "/api/merchandising") => {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent, ...extra }),
  });
  const data = await res.json();
  return { ok: res.ok && !data.error, data };
};

// ════════════════════════════════════════════════════════════════════════════
// Image Compliance Fixer
// ════════════════════════════════════════════════════════════════════════════
function ImageFixerRow({ p, credits }: { p: any; credits: number }) {
  const [state, setState] = useState<"idle" | "fixing" | "done" | "error">("idle");
  const [result, setResult] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [useAI, setUseAI] = useState(true);

  const fix = async () => {
    setState("fixing"); setMsg("");
    const { ok, data } = await post("fix", { productId: p.productId, useAI }, "/api/image-fixer");
    if (!ok) { setState("error"); setMsg(data.error || "Failed to fix image."); return; }
    setResult(data); setState("done");
  };

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px 14px", display: "flex", gap: "14px", alignItems: "center", flexWrap: "wrap" }}>
      {p.imageUrl && (
        <img src={p.imageUrl} alt="" width={64} height={64}
          style={{ width: "64px", height: "64px", objectFit: "cover", borderRadius: "8px", border: "1px solid #eee", flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: "160px" }}>
        <p style={{ margin: "0 0 3px 0", fontSize: "13px", fontWeight: 700, color: "#212121" }}>{p.title}</p>
        <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
          {(p.issues || []).map((iss: string, i: number) => (
            <span key={i} style={{ fontSize: "11px", color: "#92400e", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "4px", padding: "1px 7px" }}>{iss}</span>
          ))}
        </div>
      </div>

      {state === "done" && result ? (
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {result.newImageUrl && <img src={result.newImageUrl} alt="" width={64} height={64} style={{ width: "64px", height: "64px", objectFit: "cover", borderRadius: "8px", border: "2px solid #86efac", flexShrink: 0 }} />}
          <span style={{ fontSize: "12px", fontWeight: 700, color: "#166534" }}>✓ Fixed{result.method === "ai" ? " with AI" : ""}</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }}>
          <button onClick={fix} disabled={state === "fixing" || credits < 2}
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 14px", background: state === "fixing" ? "#9ca3af" : "#1a4a5a", color: "white", border: "none", borderRadius: "7px", fontSize: "12px", fontWeight: 700, cursor: state === "fixing" ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
            {state === "fixing" ? <><Spinner size="small" /> Fixing…</> : "✨ Fix Image (2 cr)"}
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "10px", color: "#6b7280", cursor: "pointer" }}>
            <input type="checkbox" checked={useAI} onChange={e => setUseAI(e.target.checked)} style={{ margin: 0 }} /> AI cleanup
          </label>
          {state === "error" && <span style={{ fontSize: "11px", color: "#d72c0d", maxWidth: "180px" }}>{msg}</span>}
        </div>
      )}
    </div>
  );
}

export function ImageFixerPanel({ credits }: { credits: number }) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [products, setProducts] = useState<any[]>([]);
  const [msg, setMsg] = useState("");

  const scan = async () => {
    setState("loading"); setMsg("");
    const { ok, data } = await post("scan", {}, "/api/image-fixer");
    if (!ok) { setState("error"); setMsg(data.error || "Scan failed."); return; }
    setProducts(data.products || []); setState("ready");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ background: "#f0f9ff", border: "1px solid #7dd3fc", borderRadius: "10px", padding: "16px 20px" }}>
        <p style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#0c4a6e", lineHeight: 1.6 }}>
          Google rejects product images that are <strong>too small, watermarked, or have promo text/overlays</strong>. This tool finds them and fixes each with AI — a clean <strong>white background</strong>, overlays removed, upscaled — then re-uploads it as the main image automatically.
        </p>
        <p style={{ margin: 0, fontSize: "12px", color: "#0369a1" }}>
          💡 AI cleanup needs Gemini image generation (a paid Google AI feature). If it's unavailable on your key, we still <strong>enhance</strong> the image (resize onto a clean white square) — that always works.
        </p>
        <p style={{ margin: "8px 0 0 0", fontSize: "12px", color: "#0369a1" }}>
          Scanning your catalog costs <strong>10 credits</strong>; each image fix then costs <strong>2 credits</strong>.
        </p>
      </div>

      {state === "idle" && (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <button className="feature-card-button" style={{ maxWidth: "320px" }} onClick={scan} disabled={credits < 10}>
            🔍 Scan products for image issues (10 credits)
          </button>
          {credits < 10 && <span style={{ fontSize: "12px", color: "#d72c0d" }}>You need 10 credits.</span>}
        </div>
      )}
      {state === "loading" && (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px", background: "#f9fafb", borderRadius: "8px" }}>
          <Spinner size="small" /> <span style={{ fontSize: "13px", color: "#6b7280" }}>Checking your product images…</span>
        </div>
      )}
      {state === "ready" && (
        <>
          {products.length === 0 ? (
            <div style={{ padding: "14px 16px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px" }}>
              <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#166534" }}>✓ No image issues found — your product images look GMC-ready!</p>
            </div>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: "13px", color: "#374151" }}>
                <strong>{products.length}</strong> product{products.length !== 1 ? "s" : ""} have image issues. Fix each one below (2 credits each).
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {products.map((p, i) => <ImageFixerRow key={p.productId || i} p={p} credits={credits} />)}
              </div>
            </>
          )}
        </>
      )}
      {state === "error" && <p style={{ margin: 0, fontSize: "13px", color: "#d72c0d" }}>✕ {msg}</p>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Always-On Monitoring & Alerts
// ════════════════════════════════════════════════════════════════════════════
export function MonitoringPanel() {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState<"daily" | "weekly">("weekly");
  const [email, setEmail] = useState("");
  const [monitor, setMonitor] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/monitoring")
      .then(r => r.json())
      .then(d => {
        if (d.monitor) {
          setEnabled(!!d.monitor.enabled);
          setFrequency(d.monitor.frequency === "daily" ? "daily" : "weekly");
          setEmail(d.monitor.email || "");
          setMonitor(d.monitor);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const save = async (nextEnabled = enabled) => {
    setSaving(true); setMsg(null);
    try {
      const res = await fetch("/api/monitoring", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled, frequency, email }),
      });
      const d = await res.json();
      if (!res.ok || d.error) { setMsg({ ok: false, text: d.error || "Failed to save." }); setSaving(false); return; }
      setMonitor(d.monitor);
      setEnabled(!!d.monitor.enabled);
      if (d.monitor.email) setEmail(d.monitor.email);
      setMsg({ ok: true, text: d.monitor.enabled ? "✓ Monitoring is on. We'll email you when new issues appear." : "Monitoring turned off." });
    } catch { setMsg({ ok: false, text: "Network error." }); }
    setSaving(false);
  };

  const isActive = monitor?.enabled;
  const lastChecked = monitor?.lastRunAt ? new Date(monitor.lastRunAt).toLocaleString() : null;

  if (!loaded) {
    return <div style={{ display: "flex", alignItems: "center", gap: "10px" }}><Spinner size="small" /><span style={{ fontSize: "13px", color: "#6b7280" }}>Loading your settings…</span></div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "12px 16px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
        <div>
          <p style={{ margin: "0 0 2px 0", fontSize: "14px", fontWeight: 700, color: "#212121", display: "flex", alignItems: "center", gap: "8px" }}>
            Enable monitoring
            {isActive && <span style={{ fontSize: "11px", fontWeight: 700, color: "#166534", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "4px", padding: "1px 7px" }}>● Active</span>}
          </p>
          <p style={{ margin: 0, fontSize: "12px", color: "#6b7280" }}>{isActive ? "Currently watching your store." : "Turn on to start automatic checks."}</p>
        </div>
        <button
          onClick={() => save(!enabled)}
          disabled={saving}
          style={{
            position: "relative", width: "52px", height: "28px", borderRadius: "999px", border: "none",
            background: enabled ? "#166534" : "#cbd5e1", cursor: saving ? "wait" : "pointer", transition: "background .2s", flexShrink: 0,
          }}
          aria-label="Toggle monitoring"
        >
          <span style={{ position: "absolute", top: "3px", left: enabled ? "27px" : "3px", width: "22px", height: "22px", borderRadius: "50%", background: "white", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
        </button>
      </div>

      <div>
        <p style={{ margin: "0 0 8px 0", fontSize: "12px", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.4px" }}>Check frequency</p>
        <div style={{ display: "flex", gap: "8px" }}>
          {(["daily", "weekly"] as const).map(f => (
            <button key={f} onClick={() => setFrequency(f)}
              style={{
                padding: "8px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", textTransform: "capitalize",
                background: frequency === f ? "#1a4a5a" : "white", color: frequency === f ? "white" : "#374151",
                border: `1px solid ${frequency === f ? "#1a4a5a" : "#d1d5db"}`,
              }}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p style={{ margin: "0 0 6px 0", fontSize: "12px", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.4px" }}>Alert email</p>
        <input
          type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="you@yourstore.com"
          style={{ width: "100%", maxWidth: "360px", boxSizing: "border-box", padding: "9px 12px", border: "1px solid #d1d5db", borderRadius: "8px", fontSize: "13px", outline: "none" }}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
        <button onClick={() => save()} disabled={saving}
          className="feature-card-button" style={{ maxWidth: "200px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
          {saving ? <><Spinner size="small" /> Saving…</> : "💾 Save Settings"}
        </button>
        {msg && <span style={{ fontSize: "13px", fontWeight: 600, color: msg.ok ? "#166534" : "#d72c0d" }}>{msg.text}</span>}
      </div>

      {isActive && (
        <div style={{ fontSize: "12px", color: "#6b7280", borderTop: "1px solid #f3f4f6", paddingTop: "12px" }}>
          Watching <strong>{frequency}</strong> · {lastChecked ? <>Last checked: <strong>{lastChecked}</strong> ({monitor.lastIssueCount} issue{monitor.lastIssueCount !== 1 ? "s" : ""} found)</> : "First check runs shortly."}
        </div>
      )}

      <p style={{ margin: 0, fontSize: "11px", color: "#9ca3af", lineHeight: 1.6 }}>
        Monitoring re-runs the store-level (Basic) compliance check and compares it to the last result — you're only emailed when something <strong>new</strong> breaks (e.g. a policy page deleted, a footer link removed, or the store re-locked). It never spams you when nothing changed. Each automated check uses <strong>2 credits</strong>; checks are skipped automatically if your balance runs out.
      </p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Auto Structured Data (JSON-LD)
// ════════════════════════════════════════════════════════════════════════════
export function AutoSchemaPanel({ shop, apiKey }: { shop: string; apiKey: string }) {
  const enableUrl = `https://${shop}/admin/themes/current/editor?context=apps&template=product&activateAppId=${apiKey}/product-schema`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <p style={{ margin: 0, fontSize: "13px", color: "#374151", lineHeight: 1.7 }}>
        Google reads invisible <strong>structured data</strong> (schema.org) on your product pages to verify your prices, availability and identifiers. If it's missing or wrong, you get <strong>"Structured data mismatch"</strong> warnings in Merchant Center and miss out on rich results (price, ratings, stock) in Search. Our block injects accurate JSON-LD — brand, GTIN, MPN, price, availability and ratings — built from your real product data, automatically on every product page.
      </p>

      <div style={{ background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: "8px", padding: "14px 16px" }}>
        <p style={{ margin: "0 0 8px 0", fontSize: "13px", fontWeight: 700, color: "#3730a3" }}>One-time setup (no code)</p>
        <ol style={{ margin: "0 0 12px 0", paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <li style={{ fontSize: "13px", color: "#374151", lineHeight: 1.6 }}>Click "Enable on my store" — it opens your theme editor with our <strong>Product Structured Data</strong> embed ready.</li>
          <li style={{ fontSize: "13px", color: "#374151", lineHeight: 1.6 }}>Toggle it <strong>on</strong> in the App embeds panel, then click <strong>Save</strong>.</li>
          <li style={{ fontSize: "13px", color: "#374151", lineHeight: 1.6 }}>Done — valid JSON-LD now renders on every product page and updates automatically.</li>
        </ol>
        <a href={enableUrl} target="_blank" rel="noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: "7px", padding: "10px 20px", background: "#4338ca", color: "white", borderRadius: "8px", fontSize: "14px", fontWeight: 700, textDecoration: "none" }}>
          🧩 Enable on my store (1 click) →
        </a>
        <p style={{ margin: "10px 0 0 0", fontSize: "11px", color: "#6b7280" }}>
          Requires an Online Store 2.0 theme. If your theme already outputs Product schema, this enriches it with GTIN/MPN/brand that Google Merchant Center specifically checks.
        </p>
        <p style={{ margin: "8px 0 0 0", fontSize: "11px", color: "#166534", fontWeight: 600 }}>
          ✓ Free — this is a one-time theme toggle with no AI generation, so it costs no credits and keeps working automatically.
        </p>
      </div>
    </div>
  );
}
