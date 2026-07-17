import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useFetcher, useRevalidator } from "@remix-run/react";
import { useState, useCallback, useEffect, type ReactNode } from "react";
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, Checkbox, Button, Banner, Frame, Toast,
  Tabs, TextField, Select, Collapsible, List, Badge, Box, InlineGrid,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { adsEnvPresence } from "../utils/google-ads.server";
import { isCurrentUserAccountOwner } from "../utils/account-owner.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  if (!(await isCurrentUserAccountOwner(request, session.shop))) throw new Response("Unauthorized", { status: 403 });

  let settings = await prisma.appSettings.findUnique({ where: { shop: session.shop } });
  if (!settings) {
    settings = await prisma.appSettings.create({
      data: { shop: session.shop, addProductReplicaEnabled: true, dashboardEnabled: true, additionalEnabled: true, reportEnabled: true, storeErrorReportEnabled: true },
    });
  }

  const gs = await prisma.googleAdsSettings.findUnique({ where: { shop: session.shop } });

  return json({
    settings: {
      addProductReplicaEnabled: settings.addProductReplicaEnabled,
      dashboardEnabled: settings.dashboardEnabled,
      additionalEnabled: settings.additionalEnabled,
      reportEnabled: settings.reportEnabled,
      storeErrorReportEnabled: settings.storeErrorReportEnabled,
    },
    googleAds: {
      hasDeveloperToken: !!gs?.developerToken, hasClientId: !!gs?.clientId, hasClientSecret: !!gs?.clientSecret, hasRefreshToken: !!gs?.refreshToken,
      customerId: gs?.customerId || "", loginCustomerId: gs?.loginCustomerId || "",
      enabled: gs?.enabled || false, status: gs?.status || null, lastError: gs?.lastError || null,
      lastSyncAt: gs?.lastSyncAt ? gs.lastSyncAt.toISOString() : null,
      cpcCount: gs?.cpcByProduct ? Object.keys(gs.cpcByProduct as any).length : 0,
      cpcWindowDays: gs?.cpcWindowDays || 30, currency: gs?.currencyCode || null,
      env: adsEnvPresence(),
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!(await isCurrentUserAccountOwner(request, session.shop))) return json({ error: "Unauthorized" }, { status: 403 });

  const formData = await request.formData();
  const settings = JSON.parse(formData.get("settings") as string);
  await prisma.appSettings.upsert({ where: { shop: session.shop }, update: settings, create: { shop: session.shop, ...settings } });
  return json({ success: true });
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return iso.slice(0, 16).replace("T", " "); }
}

// Plain anchor instead of Polaris `Link` — guarantees a real new-tab open (target="_blank")
// regardless of any link-interception quirks inside the embedded-app iframe.
function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#2c6ecb", textDecoration: "underline", fontWeight: 500 }}>
      {children}
    </a>
  );
}

function GoogleAdsTab({ ga }: { ga: any }) {
  const fetcher = useFetcher<any>();
  const revalidator = useRevalidator();
  const [showHelp, setShowHelp] = useState(!ga.enabled);
  const [showCampaignHelp, setShowCampaignHelp] = useState(false);

  const [developerToken, setDeveloperToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [customerId, setCustomerId] = useState(ga.customerId || "");
  const [loginCustomerId, setLoginCustomerId] = useState(ga.loginCustomerId || "");
  const [windowDays, setWindowDays] = useState(String(ga.cpcWindowDays || 30));

  const busy = fetcher.state !== "idle";
  const acting = (i: string) => busy && fetcher.formData?.get("intent") === i;

  // Refresh the loader after a save/test/refresh so status + "has*" flags update.
  useEffect(() => {
    if (fetcher.data?.ok && (fetcher.data.saved || fetcher.data.matched != null || fetcher.data.disconnected || fetcher.data.customerName != null)) {
      revalidator.revalidate();
      if (fetcher.data.saved) { setDeveloperToken(""); setClientId(""); setClientSecret(""); setRefreshToken(""); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const post = (intent: string, extra: Record<string, string> = {}) =>
    fetcher.submit({ intent, ...extra }, { method: "post", action: "/api/google-ads" });

  const save = () => post("save", { developerToken, clientId, clientSecret, refreshToken, customerId, loginCustomerId, cpcWindowDays: windowDays });
  const secretField = (label: string, value: string, setter: (v: string) => void, has: boolean, envHas: boolean, help: string) => (
    <TextField label={label} value={value} onChange={setter} type="password" autoComplete="off"
      placeholder={has ? "•••••••• saved — leave blank to keep" : envHas ? "Provided app-wide — leave blank" : ""}
      helpText={help} />
  );

  const d = fetcher.data;
  const A = "https://ads.google.com/home/tools/manager-accounts";
  const CLOUD = "https://console.cloud.google.com/";
  const PLAY = "https://developers.google.com/oauthplayground/";

  return (
    <BlockStack gap="400">
      {ga.enabled ? (
        <Banner tone="success" title="Google Ads connected">
          <p>{`Showing CPC for ${ga.cpcCount} product${ga.cpcCount === 1 ? "" : "s"}${ga.currency ? ` (${ga.currency})` : ""} on the Price Radar page.${ga.lastSyncAt ? ` Last synced ${fmtDate(ga.lastSyncAt)}.` : ""}`}</p>
        </Banner>
      ) : ga.status === "error" && ga.lastError ? (
        <Banner tone="warning" title="Connection issue"><p>{ga.lastError}</p></Banner>
      ) : (
        <Banner tone="info" title="Connect Google Ads to show CPC per product">
          <p>Add your Google Ads API credentials below to pull cost-per-click for each product into Price Radar. Follow the one-time setup guide, then Save → Test → Refresh CPC.</p>
        </Banner>
      )}

      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingSm">Setup guide (one-time)</Text>
            <Button variant="plain" onClick={() => setShowHelp((s) => !s)} ariaExpanded={showHelp} ariaControls="ga-help">{showHelp ? "Hide" : "Show steps"}</Button>
          </InlineStack>
          <Collapsible open={showHelp} id="ga-help" transition={{ duration: "200ms", timingFunction: "ease-in-out" }}>
            <BlockStack gap="300">
              <Text as="p" tone="subdued" variant="bodySm">Product-level cost-per-click lives only in the <strong>Google Ads API</strong> (Merchant Center doesn&rsquo;t have it). You need four things — a developer token, an OAuth Client ID + Client secret, and a refresh token — plus your ads account&rsquo;s Customer ID. None of this costs anything, and you only do it once. Every link below opens in a new tab so you don&rsquo;t lose your place here.</Text>
              <List type="number">
                <List.Item>
                  <strong>Create a Google Ads Manager account.</strong> This is a free &ldquo;parent&rdquo; account used only to connect the API — it&rsquo;s separate from the ad account that actually runs your Shopping ads. Open <ExternalLink href={A}>Google Ads Manager Accounts</ExternalLink> → click <strong>Create a manager account</strong> → sign in with the Google account you want to manage this from → fill in a name, your country, time zone and currency → finish the short setup.
                </List.Item>
                <List.Item>
                  <strong>Get a Developer Token.</strong> Inside the Manager account you just created, click the wrench/settings icon in the top-right → <strong>Setup → API Center</strong> → fill in the short access-level form. Copy the <strong>Developer token</strong> shown. <strong>Important:</strong> to read CPC <em>and create campaigns</em> on your real ad account, the token needs <strong>Basic access</strong> — apply for it on the same API Center page (a short form about how you&rsquo;ll use the API; Google usually approves in 1–2 business days). A &ldquo;Test account&rdquo;-level token only works with test accounts.
                </List.Item>
                <List.Item>
                  <strong>Create a Google Cloud project.</strong> Open the <ExternalLink href={CLOUD}>Google Cloud Console</ExternalLink> → click the project drop-down near the top-left (it may say &ldquo;Select a project&rdquo;) → <strong>New Project</strong> → type any name, e.g. &ldquo;My Store Ads&rdquo; → <strong>Create</strong>. Make sure this new project stays selected in that same drop-down for the rest of these steps.
                </List.Item>
                <List.Item>
                  <strong>Turn on the Google Ads API.</strong> Using the ☰ menu (top-left) go to <strong>APIs &amp; Services → Library</strong> → search for &ldquo;<em>Google Ads API</em>&rdquo; → click it → click <strong>Enable</strong>.
                </List.Item>
                <List.Item>
                  <strong>Set up the OAuth consent screen.</strong> Go to <strong>APIs &amp; Services → OAuth consent screen</strong> (newer Google Cloud accounts may show this as &ldquo;Google Auth Platform&rdquo; with &ldquo;Branding&rdquo; and &ldquo;Audience&rdquo; tabs instead — same thing). Choose <strong>External</strong> → fill in an app name, your email as the support email, and your email again as the developer contact → Save. Then open the <strong>Audience</strong> (or &ldquo;Test users&rdquo;) tab and add your own Google account email as a test user — otherwise Google will block you from authorizing your own app in step 8.
                </List.Item>
                <List.Item>
                  <strong>Create your OAuth Client ID (Web application).</strong> Go to <strong>APIs &amp; Services → Credentials</strong> → <strong>+ Create credentials</strong> → <strong>OAuth client ID</strong>. For &ldquo;Application type&rdquo; choose <strong>Web application</strong> — this is the step people miss; picking the wrong type here will stop it working. Give it any name, e.g. &ldquo;ShopFlix connector&rdquo;. Under <strong>Authorized redirect URIs</strong> click <strong>+ Add URI</strong> and paste exactly: <code>https://developers.google.com/oauthplayground</code> → click <strong>Create</strong>. A box pops up with your <strong>Client ID</strong> and <strong>Client secret</strong> — copy both somewhere safe (e.g. a notes app) before closing it.
                </List.Item>
                <List.Item>
                  <strong>Link your Shopping ads account to the Manager account.</strong> Back in the Manager account: go to <strong>Accounts</strong> → click the blue <strong>+</strong> button → <strong>Link existing account</strong> → enter the 10-digit <strong>Customer ID</strong> of the ads account that runs your Shopping campaigns → send the request. Then switch into that ads account itself → <strong>Admin → Access and security → Managers</strong> → click <strong>Accept</strong> on the request. Note down that account&rsquo;s <strong>Customer ID</strong> — you&rsquo;ll paste it below.
                </List.Item>
                <List.Item>
                  <strong>Generate a Refresh Token.</strong> Open the <ExternalLink href={PLAY}>OAuth 2.0 Playground</ExternalLink> → click the gear/settings icon in the top-right corner → tick <strong>Use your own OAuth credentials</strong> → paste the Client ID and Client secret from step 6 → close that panel. On the left-hand side, under &ldquo;Step 1&rdquo;, find the box labelled <strong>Input your own scopes</strong> and type: <code>https://www.googleapis.com/auth/adwords</code> → click <strong>Authorize APIs</strong> → sign in with the Google account that has access to your ads account, and allow the permissions it asks for → back on the Playground, click <strong>Exchange authorization code for tokens</strong> → copy the <strong>Refresh token</strong> value that appears.
                </List.Item>
                <List.Item>
                  <strong>Paste everything into the fields below</strong> — Developer token (step 2), OAuth Client ID and Client secret (step 6), Refresh token (step 8), and the ads account Customer ID (step 7) — then click <strong>Save credentials</strong>, then <strong>Test connection</strong>, then <strong>Refresh CPC now</strong>. CPC only shows up for products with live Shopping / Performance Max spend, listed through Shopify&rsquo;s Google &amp; YouTube sales channel.
                </List.Item>
              </List>
            </BlockStack>
          </Collapsible>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingSm">Creating ad campaigns from ShopFlix (Ad Campaigns page)</Text>
            <Button variant="plain" onClick={() => setShowCampaignHelp((s) => !s)} ariaExpanded={showCampaignHelp} ariaControls="ga-campaign-help">{showCampaignHelp ? "Hide" : "Show requirements"}</Button>
          </InlineStack>
          <Collapsible open={showCampaignHelp} id="ga-campaign-help" transition={{ duration: "200ms", timingFunction: "ease-in-out" }}>
            <BlockStack gap="300">
              <Text as="p" tone="subdued" variant="bodySm">
                Once connected, the <strong>Ad Campaigns</strong> page (in the app navigation, or the <em>Create ad campaign</em> button on Price Radar) can design and create <strong>optimized Google Ads campaigns for you</strong>: AI groups your products by real performance — e.g. your top sellers in one campaign taking 60&ndash;70% of the budget, promising products in a second, and an automatic &ldquo;everything else&rdquo; campaign — then creates them in your ad account as <strong>feed-only Performance&nbsp;Max</strong> campaigns. Google builds the actual ads from your Merchant Center product feed (your images, titles and prices), so there&rsquo;s nothing to design by hand. Before you create campaigns, make sure of the following:
              </Text>
              <List type="number">
                <List.Item>
                  <strong>Your Developer token has Basic access (not Test).</strong> Creating campaigns is a <em>write</em> to your live ad account, and Google only allows that with Basic access. Check in your Manager account → <strong>Setup → API Center</strong>: if the access level says &ldquo;Test account&rdquo;, click apply/upgrade to <strong>Basic access</strong> and fill in the short usage form (typical answers: &ldquo;managing my own store&rsquo;s campaigns&rdquo;). Approval usually takes 1&ndash;2 business days. Reading CPC may already work, but campaign creation will fail with a <code>DEVELOPER_TOKEN_NOT_APPROVED</code> error until Basic is granted.
                </List.Item>
                <List.Item>
                  <strong>Your Merchant Center is linked to the ads account.</strong> Feed-only campaigns serve products straight from <ExternalLink href="https://merchants.google.com">Google Merchant Center</ExternalLink>. If you use Shopify&rsquo;s <strong>Google &amp; YouTube</strong> sales channel this link usually already exists — verify in Google Ads under <strong>Tools → Data manager / Linked accounts → Merchant Center</strong> (status should be Linked/Enabled). The Ad Campaigns page auto-detects your Merchant Center ID from this link; if detection fails you can type the ID (top-right corner of Merchant Center) manually.
                </List.Item>
                <List.Item>
                  <strong>Your products are approved in Merchant Center.</strong> Only approved products can serve. In <ExternalLink href="https://merchants.google.com">Merchant Center</ExternalLink> → <strong>Products</strong>, fix any disapprovals first (ShopFlix&rsquo;s GMC Compliance Fix page helps with exactly this).
                </List.Item>
                <List.Item>
                  <strong>Conversion tracking is set up with values.</strong> The campaigns we create bid with <em>Maximize conversion value</em>, so Google needs purchase conversions (with order value) to learn from. The Google &amp; YouTube channel sets this up automatically; verify in Google Ads under <strong>Goals → Conversions</strong> that a Purchase conversion is recording.
                </List.Item>
                <List.Item>
                  <strong>Billing is active in Google Ads.</strong> Campaigns can&rsquo;t serve without a payment method (<strong>Billing → Settings</strong> in <ExternalLink href="https://ads.google.com">ads.google.com</ExternalLink>).
                </List.Item>
                <List.Item>
                  <strong>How creation works (safe by default):</strong> campaigns are created <strong>PAUSED</strong> with the budget split you set (you can also choose Enabled). Product targeting uses the item IDs Google has already seen for your store, so brand-new products are covered by the &ldquo;everything else&rdquo; campaign automatically. After creating, open <ExternalLink href="https://ads.google.com">Google Ads</ExternalLink>, review each campaign (products, locations, tracking), then enable. Give Performance&nbsp;Max 1&ndash;2 weeks to learn before judging results, and prefer editing budgets over pausing/unpausing repeatedly.
                </List.Item>
              </List>
            </BlockStack>
          </Collapsible>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text as="h3" variant="headingSm">Credentials</Text>
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
            {secretField("Developer token", developerToken, setDeveloperToken, ga.hasDeveloperToken, ga.env.developerToken, "From your Manager account → API Center.")}
            {secretField("OAuth client ID", clientId, setClientId, ga.hasClientId, ga.env.clientId, "From your Google Cloud OAuth client.")}
            {secretField("OAuth client secret", clientSecret, setClientSecret, ga.hasClientSecret, ga.env.clientSecret, "From the same OAuth client.")}
            {secretField("Refresh token", refreshToken, setRefreshToken, ga.hasRefreshToken, false, "Generated via the OAuth Playground (scope adwords).")}
            <TextField label="Ads account Customer ID" value={customerId} onChange={setCustomerId} autoComplete="off" placeholder="123-456-7890" helpText="The 10-digit ID of the ad account with your Shopping campaigns." />
            <TextField label="Manager (MCC) Customer ID" value={loginCustomerId} onChange={setLoginCustomerId} autoComplete="off" placeholder="Optional — your MCC ID" helpText="Leave blank if the ads account is standalone (not under a manager)." />
          </InlineGrid>
          <div style={{ maxWidth: 260 }}>
            <Select label="CPC window" options={[{ label: "Last 7 days", value: "7" }, { label: "Last 14 days", value: "14" }, { label: "Last 30 days", value: "30" }]} value={windowDays} onChange={setWindowDays} helpText="Averaging window for the CPC figure." />
          </div>

          <InlineStack gap="200" blockAlign="center" wrap>
            <Button variant="primary" onClick={save} loading={acting("save")}>Save credentials</Button>
            <Button onClick={() => post("test")} loading={acting("test")}>Test connection</Button>
            <Button onClick={() => post("refresh")} loading={acting("refresh")}>Refresh CPC now</Button>
            {ga.enabled ? <Button variant="plain" tone="critical" onClick={() => post("disconnect")} loading={acting("disconnect")}>Disconnect</Button> : null}
            <Text as="span" variant="bodyXs" tone="subdued">{`API ${ga.env.apiVersion}`}</Text>
          </InlineStack>

          {d && d.ok === false ? <Banner tone="warning"><p>{d.error}</p></Banner> : null}
          {d && d.ok && d.saved ? <Banner tone="success"><p>Credentials saved. Now click <strong>Test connection</strong>, then <strong>Refresh CPC now</strong>.</p></Banner> : null}
          {d && d.ok && d.customerName != null ? <Banner tone="success"><p>{`Connected to “${d.customerName || "account"}”${d.currency ? ` (${d.currency})` : ""}. Click Refresh CPC now to pull product CPC.`}</p></Banner> : null}
          {d && d.ok && d.matched != null ? <Banner tone="success"><p>{`Synced — matched ad data (CPC + actual spend) for ${d.matched} product${d.matched === 1 ? "" : "s"}. It now shows on Price Radar.`}</p></Banner> : null}
          {d && d.ok && d.disconnected ? <Banner tone="info"><p>Disconnected — CPC hidden on Price Radar. Your credentials are kept; Refresh CPC to reconnect.</p></Banner> : null}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

export default function Settings() {
  const { settings, googleAds } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  const [tab, setTab] = useState(0);
  const [addProductReplicaEnabled, setAddProductReplicaEnabled] = useState(settings.addProductReplicaEnabled);
  const [dashboardEnabled, setDashboardEnabled] = useState(settings.dashboardEnabled);
  const [additionalEnabled, setAdditionalEnabled] = useState(settings.additionalEnabled);
  const [reportEnabled, setReportEnabled] = useState(settings.reportEnabled);
  const [storeErrorReportEnabled, setStoreErrorReportEnabled] = useState(settings.storeErrorReportEnabled);
  const [toastActive, setToastActive] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(() => {
    setSaving(true);
    const formData = new FormData();
    formData.append("settings", JSON.stringify({ addProductReplicaEnabled, dashboardEnabled, additionalEnabled, reportEnabled, storeErrorReportEnabled }));
    submit(formData, { method: "post" });
    setTimeout(() => { setSaving(false); setToastActive(true); }, 500);
  }, [submit, addProductReplicaEnabled, dashboardEnabled, additionalEnabled, reportEnabled, storeErrorReportEnabled]);

  const toggleToastActive = useCallback(() => setToastActive((a) => !a), []);
  const toastMarkup = toastActive ? <Toast content="Settings saved successfully!" onDismiss={toggleToastActive} /> : null;

  const tabs = [
    { id: "access", content: "Access control", panelID: "access-panel" },
    { id: "google-ads", content: googleAds.enabled ? "Google Ads ✓" : "Google Ads", panelID: "ga-panel" },
  ];

  return (
    <Frame>
      <Page
        title="Settings"
        subtitle="Feature access and integrations"
        backAction={{ content: "Dashboard", url: "/app" }}
        primaryAction={tab === 0 ? { content: "Save", onAction: handleSave, loading: saving } : undefined}
      >
        <Layout>
          <Layout.Section>
            <Card padding="0">
              <Tabs tabs={tabs} selected={tab} onSelect={setTab} />
              <Box padding="400">
                {tab === 0 ? (
                  <BlockStack gap="400">
                    <Banner tone="info"><p>Only the store owner can access this page. Enable or disable features to control what users see in the app.</p></Banner>
                    <BlockStack gap="300">
                      <Text variant="headingMd" as="h2">Page accessibility</Text>
                      <Text as="p" tone="subdued">Control which pages are visible and accessible to users of the app.</Text>
                      <Checkbox label="AI Product Import" checked={addProductReplicaEnabled} onChange={setAddProductReplicaEnabled} helpText="Allow users to fetch and add products from external URLs" />
                      <Checkbox label="Dashboard" checked={dashboardEnabled} onChange={setDashboardEnabled} helpText="Show the main dashboard with product listings" />
                      <Checkbox label="Additional Features" checked={additionalEnabled} onChange={setAdditionalEnabled} helpText="Enable additional features page" />
                      <Checkbox label="Products Repair" checked={reportEnabled} onChange={setReportEnabled} helpText="Enable the per-product scan & auto-repair page" />
                      <Checkbox label="GMC Compliance Fix" checked={storeErrorReportEnabled} onChange={setStoreErrorReportEnabled} helpText="Enable store-wide compliance scanning & fixes" />
                    </BlockStack>
                  </BlockStack>
                ) : (
                  <GoogleAdsTab ga={googleAds} />
                )}
              </Box>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
      {toastMarkup}
    </Frame>
  );
}
