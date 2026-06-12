// ShopFlix AI — scan data, scanning animation, results (free preview + locked)
const { useState: useStateS, useEffect: useEffectS, useRef: useRefS } = React;

/* ============ MOCK SCAN DATA ============ */
const SCAN_CATEGORIES = [
  {
    id: 'policy', tier: 'basic', name: 'Policy pages & legal', icon: 'doc',
    issues: [
      { sev: 'High', title: 'Refund/return policy is not linked in the footer', why: 'Google requires the refund policy to be reachable from every page. Missing footer links are one of the most common instant-suspension triggers.', fix: 'In Shopify admin, go to Online Store \u2192 Navigation \u2192 Footer menu and add a link to your refund policy page.' },
      { sev: 'High', title: 'Shipping policy has no delivery timeframes', why: 'Google checks that shipping pages state concrete delivery estimates. Vague wording like "fast shipping" fails review.', fix: 'Add explicit processing and delivery times per region, e.g. "US orders: 3\u20135 business days".' },
      { sev: 'Medium', title: 'Terms of service page is not linked anywhere', why: 'A terms page that exists but is unreachable counts as missing during automated review.', fix: 'Link the terms of service page in your footer menu.' },
      { sev: 'Low', title: 'Privacy policy missing data-deletion contact', why: 'Newer GMC checks look for a way customers can request data deletion.', fix: 'Add a short section with a contact email for privacy requests.' },
    ],
  },
  {
    id: 'contact', tier: 'basic', name: 'Contact & trust signals', icon: 'phone',
    issues: [
      { sev: 'High', title: 'No physical business address found on the store', why: 'Google\u2019s misrepresentation policy requires a verifiable business address. Stores without one are routinely suspended.', fix: 'Add your registered business address to the contact page and footer.' },
      { sev: 'Medium', title: 'Contact page has a form but no direct email or phone', why: 'Google expects at least two direct contact methods beyond a contact form.', fix: 'Display a support email (and ideally a phone number) on the contact page.' },
      { sev: 'Low', title: 'No "About us" page describing the business', why: 'Business identity signals reduce manual-review friction and improve trust.', fix: 'Create a short About page: who you are, where you operate, what you sell.' },
    ],
  },
  {
    id: 'nav', tier: 'basic', name: 'Navigation & links', icon: 'link',
    issues: [
      { sev: 'Medium', title: '2 broken links found in main navigation', why: 'Broken navigation reads as an unmaintained store and can fail landing-page checks for ads.', fix: 'Fix or remove the dead links: /collections/summer-sale and /pages/faq.' },
      { sev: 'Low', title: 'Footer menu duplicates two links with different labels', why: 'Minor, but inconsistent navigation lowers crawl quality scores.', fix: 'Remove the duplicate entries from the footer menu.' },
    ],
  },
  {
    id: 'feed', tier: 'advanced', name: 'Product feed data', icon: 'cart',
    issues: [
      { sev: 'High', title: '38 products are missing GTINs (barcodes)', why: 'Products without GTINs get limited visibility or disapproval in Google Shopping.', fix: 'Add GTIN/UPC values in each product\u2019s variant settings, or mark them correctly as custom goods.' },
      { sev: 'High', title: '12 products show a different price in the feed vs the storefront', why: 'Price mismatch between feed and landing page is a top disapproval reason.', fix: 'Resync your feed after price changes, and disable apps that alter displayed prices.' },
      { sev: 'Medium', title: '17 products are missing a brand attribute', why: 'Brand is required for most product categories in Google Shopping.', fix: 'Fill in the vendor field for each product \u2014 it maps to the brand attribute.' },
      { sev: 'Medium', title: 'Sale prices active longer than 180 days on 6 products', why: 'Permanent "sales" violate Google\u2019s pricing-honesty rules.', fix: 'End the sale or update the compare-at price to reflect the real regular price.' },
    ],
  },
  {
    id: 'images', tier: 'advanced', name: 'Images & media', icon: 'img',
    issues: [
      { sev: 'High', title: '9 product images contain watermarks or logos', why: 'Google disapproves images with watermarks, promo text, or overlaid logos.', fix: 'Replace with clean images \u2014 the ShopFlix app\u2019s AI Image Fixer can do this automatically.' },
      { sev: 'Medium', title: '23 images are below the recommended 800\u00d7800px', why: 'Low-resolution images reduce ad eligibility and conversion.', fix: 'Upload higher-resolution originals (at least 800\u00d7800, ideally 1200+).' },
      { sev: 'Low', title: '41 images are missing alt text', why: 'Hurts SEO and accessibility; weak signal for landing-page quality.', fix: 'Add descriptive alt text \u2014 product name + key attribute works well.' },
    ],
  },
  {
    id: 'misrep', tier: 'deep', name: 'Misrepresentation & checkout', icon: 'eye',
    issues: [
      { sev: 'High', title: 'Countdown timer resets on page reload (false scarcity)', why: 'Fake urgency timers are explicitly listed under Google\u2019s misrepresentation policy \u2014 a leading cause of account-level suspension.', fix: 'Remove the timer app or switch to honest, inventory-based messaging.' },
      { sev: 'High', title: 'Checkout shows unexpected fees not stated on product pages', why: 'Undisclosed fees at checkout violate pricing transparency rules.', fix: 'Disclose all fees on the product page or fold them into the price.' },
      { sev: 'Medium', title: 'Product schema markup missing on 100% of product pages', why: 'Missing structured data slows automated verification and limits rich results.', fix: 'Enable structured data in your theme or use an SEO schema app.' },
      { sev: 'Medium', title: 'Store name differs between domain, logo and GMC account', why: 'Identity mismatches trigger manual review of business legitimacy.', fix: 'Use one consistent store name everywhere, including your Merchant Center profile.' },
    ],
  },
];
const ALL_ISSUES = SCAN_CATEGORIES.flatMap((c) => c.issues.map((i) => ({ ...i, cat: c.name, tier: c.tier })));
const TOTAL_ISSUES = ALL_ISSUES.length;
const FREE_PREVIEW = ALL_ISSUES.filter((i) => i.tier === 'basic').slice(0, 4);
const SCAN_SCORE = 54;
const sevRank = { High: 0, Medium: 1, Low: 2 };

/* ============ SCANNING SCREEN ============ */
const SCAN_STEPS = [
  { label: 'Fetching homepage', log: ['GET https://{URL}/ \u2026 200 OK (212ms)', 'Parsing storefront HTML \u2026 7 pages discovered'] },
  { label: 'Checking policy pages', log: ['\u2713 /policies/privacy-policy found', '\u2715 refund policy not linked in footer', '\u26a0 shipping policy: no delivery timeframes'] },
  { label: 'Verifying contact & trust signals', log: ['\u2713 contact page found', '\u2715 no physical business address detected', '\u26a0 only 1 direct contact method visible'] },
  { label: 'Crawling navigation & links', log: ['Checked 64 links \u2026 2 broken', '\u26a0 /collections/summer-sale \u2192 404'] },
  { label: 'Sampling product data & images', log: ['Sampled 25 products \u2026', '\u26a0 GTIN coverage looks low', '\u26a0 watermark patterns detected on images'] },
  { label: 'Scoring against GMC policies', log: ['Running 38 policy checks \u2026', 'Compiling report \u2026'] },
];
function ScanningScreen({ storeUrl, fast, onDone }) {
  const [step, setStep] = useStateS(0);
  const [lines, setLines] = useStateS([]);
  const bodyRef = useRefS(null);
  const speed = fast ? 220 : 750;
  useEffectS(() => {
    let cancelled = false;
    const flat = [];
    SCAN_STEPS.forEach((s, si) => s.log.forEach((l, li) => flat.push({ si, text: l.replace('{URL}', storeUrl), last: li === s.log.length - 1 })));
    let i = 0;
    const tick = () => {
      if (cancelled) return;
      if (i < flat.length) {
        const f = flat[i];
        setLines((prev) => [...prev, f.text]);
        setStep(f.last ? f.si + 1 : f.si);
        i += 1;
        setTimeout(tick, speed);
      } else {
        setTimeout(() => { if (!cancelled) onDone(); }, fast ? 300 : 900);
      }
    };
    const t0 = setTimeout(tick, 400);
    return () => { cancelled = true; clearTimeout(t0); };
  }, []);
  const pct = Math.min(100, Math.round((step / SCAN_STEPS.length) * 100));
  const lineClass = (l) => l.startsWith('\u2713') ? 't-ok' : l.startsWith('\u2715') ? 't-bad' : l.startsWith('\u26a0') ? 't-warn' : 't-dim';
  return (
    <div data-screen-label="Scanning" style={{ position: 'relative', overflow: 'hidden', minHeight: 'calc(100vh - 66px)' }}>
      <div className="grid-bg"></div>
      <div className="wrap" style={{ position: 'relative', padding: '70px 32px', maxWidth: '880px' }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div className="radar" style={{ width: '120px', height: '120px', margin: '0 auto 28px' }}>
            <div className="radar-sweep"></div>
            <div className="radar-dot" style={{ top: '28%', left: '60%' }}></div>
            <div className="radar-dot" style={{ top: '64%', left: '30%', animationDelay: '1.4s' }}></div>
          </div>
          <h1 style={{ fontSize: '30px', fontWeight: 700, letterSpacing: '-0.02em' }}>Scanning <span style={{ color: 'var(--accent)' }} className="mono">{storeUrl}</span></h1>
          <p style={{ color: 'var(--muted)', marginTop: '8px', fontSize: '15px' }}>Checking your store against Google Merchant Center policies&hellip;</p>
        </div>
        <div className="progress" style={{ marginBottom: '28px' }}><i style={{ width: pct + '%' }}></i></div>
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '20px' }} className="grid-2">
          <div className="card" style={{ padding: '20px' }}>
            {SCAN_STEPS.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '7px 0', fontSize: '13.5px', color: i < step ? 'var(--green)' : i === step ? 'var(--text)' : 'var(--faint)' }}>
                {i < step ? <Icons.check size={14} color="var(--green)" sw={2.6} /> :
                  i === step ? <span className="cursor" style={{ width: '7px', height: '13px' }}></span> :
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--line-strong)', display: 'inline-block', margin: '0 3.5px' }}></span>}
                {s.label}
              </div>
            ))}
          </div>
          <div className="term">
            <div className="term-bar">
              <i style={{ background: '#f87171' }}></i><i style={{ background: '#fbbf24' }}></i><i style={{ background: '#34d399' }}></i>
              <span className="t-title">live scan log</span>
            </div>
            <div className="term-body" ref={bodyRef} style={{ height: '280px', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              {lines.slice(-11).map((l, i) => <div key={i} className={lineClass(l)}>{l}</div>)}
              <span className="cursor"></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ SCORE RING ============ */
function ScoreRing({ score, size = 150 }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const color = score < 60 ? 'var(--red)' : score < 80 ? 'var(--yellow)' : 'var(--green)';
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(141,180,230,0.12)" strokeWidth="9"></circle>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)}
          transform={'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')'}
          style={{ transition: 'stroke-dashoffset 1.2s ease' }}></circle>
      </svg>
      <div className="ring-num"><b style={{ color }}>{score}</b><span>/ 100</span></div>
    </div>
  );
}

/* ============ RESULTS (free preview) ============ */
function ResultsScreen({ storeUrl, onUnlock, onRescan }) {
  const lockedCount = TOTAL_ISSUES - FREE_PREVIEW.length;
  const highCount = ALL_ISSUES.filter((i) => i.sev === 'High').length;
  return (
    <div data-screen-label="Scan results (free preview)">
      <div style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg2)' }}>
        <div className="wrap" style={{ padding: '40px 32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <div className="kicker" style={{ marginBottom: '8px' }}>Free scan preview</div>
              <h1 style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.02em' }}>
                Scan report for <span className="mono" style={{ color: 'var(--accent)' }}>{storeUrl}</span>
              </h1>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onRescan}><Icons.search size={14} /> Scan another store</button>
          </div>
        </div>
      </div>

      <div className="wrap" style={{ padding: '40px 32px 90px' }}>
        {/* summary card */}
        <div className="card" style={{ display: 'flex', gap: '40px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '36px' }}>
          <ScoreRing score={SCAN_SCORE} />
          <div style={{ flex: 1, minWidth: '220px' }}>
            <span className="sev sev-high" style={{ fontSize: '12px', padding: '5px 12px' }}>High suspension risk</span>
            <p style={{ color: 'var(--muted)', fontSize: '15px', marginTop: '12px', maxWidth: '480px' }}>
              Your store has issues Google treats as instant-suspension triggers. The good news: every one of them is fixable, and most take under an hour.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, auto)', gap: '14px 40px' }}>
            {[['Pages scanned', '7'], ['Checks run', '38'], ['Issues found', String(TOTAL_ISSUES)], ['High severity', String(highCount)]].map(([k, v]) => (
              <div key={k}>
                <div className="mono" style={{ fontSize: '11px', color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{k}</div>
                <div style={{ fontSize: '26px', fontWeight: 700 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* free issues */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700 }}>Your free preview — {FREE_PREVIEW.length} of {TOTAL_ISSUES} issues</h2>
          <span className="mono" style={{ fontSize: '12px', color: 'var(--faint)' }}>sorted by severity</span>
        </div>
        {FREE_PREVIEW.map((iss, i) => (
          <div key={i} className="issue">
            <span className={'sev sev-' + iss.sev.toLowerCase()}>{iss.sev}</span>
            <div style={{ flex: 1 }}>
              <h4>{iss.title}</h4>
              <p>{iss.why}</p>
            </div>
            <span className="tag" style={{ flexShrink: 0 }}>{iss.cat}</span>
          </div>
        ))}

        {/* locked issues */}
        <div style={{ position: 'relative', marginTop: '10px' }}>
          <div aria-hidden="true">
            {ALL_ISSUES.filter((i) => !FREE_PREVIEW.includes(i)).slice(0, 5).map((iss, i) => (
              <div key={i} className="issue issue-locked">
                <span className={'sev sev-' + iss.sev.toLowerCase()}>{iss.sev}</span>
                <div style={{ flex: 1 }}>
                  <h4>{iss.title}</h4>
                  <p>{iss.why}</p>
                </div>
                <span className="tag">{iss.cat}</span>
              </div>
            ))}
          </div>
          <div style={{ position: 'absolute', inset: '-6px', background: 'linear-gradient(180deg, rgba(6,13,27,0.25), rgba(6,13,27,0.92) 70%)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '14px' }}>
            <div style={{ textAlign: 'center', padding: '24px' }}>
              <div style={{ width: '52px', height: '52px', borderRadius: '14px', background: 'rgba(232,155,60,0.14)', border: '1px solid rgba(232,155,60,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--amber)', margin: '0 auto 16px' }}>
                <Icons.lock size={24} />
              </div>
              <h3 style={{ fontSize: '22px', fontWeight: 700 }}>{lockedCount} more issues found</h3>
              <p style={{ color: 'var(--muted)', fontSize: '14.5px', marginTop: '6px' }}>Including {highCount - FREE_PREVIEW.filter((i) => i.sev === 'High').length} more high-severity issues. Unlock the full report with fixes for every one.</p>
            </div>
          </div>
        </div>

        {/* unlock plans */}
        <div id="unlock" style={{ marginTop: '56px' }}>
          <div style={{ textAlign: 'center', marginBottom: '36px' }}>
            <h2 style={{ fontSize: '26px', fontWeight: 700, letterSpacing: '-0.02em' }}>Unlock your full report</h2>
            <p style={{ color: 'var(--muted)', marginTop: '8px' }}>One-time payment. Full fix instructions for every issue.</p>
          </div>
          <div className="grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', alignItems: 'stretch' }}>
            {PLANS.map((p) => (
              <PlanCard key={p.id} plan={p} compact cta={'Unlock for $' + p.price} onSelect={onUnlock} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ScanningScreen, ResultsScreen, ScoreRing, SCAN_CATEGORIES, ALL_ISSUES, TOTAL_ISSUES, SCAN_SCORE, sevRank });
