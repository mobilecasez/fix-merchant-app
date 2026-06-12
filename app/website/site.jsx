// AUTO-GENERATED from the Claude design bundle (ShopFlix AI Website/extracted).
// Edit the design there + regenerate, OR edit wiring blocks marked WIRING below.
/* eslint-disable */
import React from "react";

// design tweaks are fixed in production (editor panel removed)
function useTweaks(d){ return [d, function(){}]; }

// asset URLs served from /public/web-assets
if (typeof window !== "undefined") { window.__resources = window.__resources || { logoImg: "/web-assets/logo.png", appScanImg: "/web-assets/app-scan.png" }; }


/* ===================== file6.js ===================== */
// ShopFlix AI — shared components: icons, nav, footer, scan input, plan data
const { useState, useEffect, useRef } = React;

/* ---------- tiny icon set (simple strokes only) ---------- */
function Ic({ d, size = 16, color = 'currentColor', sw = 1.8, fill = 'none' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>);

}
const Icons = {
  check: (p) => <Ic {...p} d={<polyline points="4.5 12.5 9.5 17.5 19.5 6.5"></polyline>} />,
  x: (p) => <Ic {...p} d={<g><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></g>} />,
  lock: (p) => <Ic {...p} d={<g><rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></g>} />,
  search: (p) => <Ic {...p} d={<g><circle cx="11" cy="11" r="6.5"></circle><line x1="16" y1="16" x2="21" y2="21"></line></g>} />,
  shield: (p) => <Ic {...p} d={<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"></path>} />,
  alert: (p) => <Ic {...p} d={<g><path d="M12 4L2.5 20h19L12 4z"></path><line x1="12" y1="10" x2="12" y2="14"></line><circle cx="12" cy="17" r="0.5" fill="currentColor"></circle></g>} />,
  arrow: (p) => <Ic {...p} d={<g><line x1="4" y1="12" x2="20" y2="12"></line><polyline points="13 5 20 12 13 19"></polyline></g>} />,
  bolt: (p) => <Ic {...p} d={<path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z"></path>} />,
  doc: (p) => <Ic {...p} d={<g><path d="M6 3h8l4 4v14H6V3z"></path><line x1="9" y1="12" x2="15" y2="12"></line><line x1="9" y1="16" x2="15" y2="16"></line></g>} />,
  cart: (p) => <Ic {...p} d={<g><circle cx="9" cy="20" r="1.4"></circle><circle cx="17" cy="20" r="1.4"></circle><path d="M3 4h2l2.5 11h10L20 7H6"></path></g>} />,
  img: (p) => <Ic {...p} d={<g><rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="8.5" cy="10" r="1.5"></circle><path d="M3 17l5-4 4 3 4-4 5 5"></path></g>} />,
  link: (p) => <Ic {...p} d={<g><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 1 0-6-6l-1 1"></path><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 1 0 6 6l1-1"></path></g>} />,
  eye: (p) => <Ic {...p} d={<g><path d="M2 12s4-6.5 10-6.5S22 12 22 12s-4 6.5-10 6.5S2 12 2 12z"></path><circle cx="12" cy="12" r="2.5"></circle></g>} />,
  phone: (p) => <Ic {...p} d={<g><rect x="7" y="2.5" width="10" height="19" rx="2.5"></rect><line x1="10.5" y1="18.5" x2="13.5" y2="18.5"></line></g>} />,
  star: (p) => <Ic {...p} fill="currentColor" sw={0} d={<path d="M12 2.5l2.9 6 6.6 0.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-0.9 2.9-6z"></path>} />,
  download: (p) => <Ic {...p} d={<g><line x1="12" y1="4" x2="12" y2="15"></line><polyline points="6 10 12 16 18 10"></polyline><line x1="4" y1="20" x2="20" y2="20"></line></g>} />,
  mail: (p) => <Ic {...p} d={<g><rect x="3" y="5" width="18" height="14" rx="2"></rect><polyline points="3 7 12 13.5 21 7"></polyline></g>} />,
  back: (p) => <Ic {...p} d={<g><line x1="20" y1="12" x2="4" y2="12"></line><polyline points="11 5 4 12 11 19"></polyline></g>} />
};

/* ---------- plan data ---------- */
const PLANS = [
{
  id: 'basic', name: 'Basic Scan', price: 3.99, tagline: 'Store fundamentals & legal compliance',
  flag: 'Free preview included',
  features: [
  'All store-level compliance issues, unlocked',
  'Policy pages, contact info & navigation checks',
  'Plain-English fix instructions for every issue',
  'Compliance score & risk level',
  'Downloadable PDF report']

},
{
  id: 'advanced', name: 'Advanced Scan', price: 5.99, tagline: 'Product feed data & accuracy', pop: true,
  flag: 'Most popular',
  features: [
  'Everything in Basic Scan',
  'Product feed analysis — GTINs, brands & MPNs',
  'Pricing logic & feed-vs-storefront integrity',
  'Image compliance — watermarks & promo text',
  'Excel export of every flagged product']

},
{
  id: 'deep', name: 'Deep Scan', price: 9.99, tagline: 'Misrepresentation & checkout audit',
  flag: null,
  features: [
  'Everything in Advanced Scan',
  'Mirrors Google\u2019s manual review process',
  'Schema markup & checkout flow audit',
  'False-scarcity & business identity checks',
  'Suspension appeal readiness checklist']

}];


/* ---------- url helpers ---------- */
function cleanUrl(raw) {
  let u = raw.trim().toLowerCase();
  u = u.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  return u;
}
function validUrl(u) {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(u);
}

/* ---------- scan input box ---------- */
function ScanBox({ onScan, big, placeholder, autoFocus }) {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const inputRef = useRef(null);
  useEffect(() => {if (autoFocus && inputRef.current) inputRef.current.focus();}, []);
  const go = () => {
    const u = cleanUrl(url);
    if (!validUrl(u)) {setErr('Hmm, that doesn\u2019t look like a store URL. Try something like mystore.com');return;}
    setErr('');
    onScan(u);
  };
  return (
    <div>
      <div className="scanbox" data-scanbox="1" style={big ? { padding: '8px 8px 8px 20px' } : null}>
        <span className="prompt">&#9656;</span>
        <input
          ref={inputRef}
          value={url}
          placeholder={placeholder || 'yourstore.com or yourstore.myshopify.com'}
          onChange={(e) => {setUrl(e.target.value);if (err) setErr('');}}
          onKeyDown={(e) => {if (e.key === 'Enter') go();}}
          aria-label="Store URL" />
        
        <button className={'btn btn-primary' + (big ? ' btn-lg' : '')} onClick={go}>
          Scan my store <Icons.arrow size={15} sw={2.2} />
        </button>
      </div>
      {err ? <div className="scan-err">{err}</div> : null}
    </div>);

}

/* ---------- nav ---------- */
function Nav({ route, onHome }) {
  const onLanding = route === 'landing';
  return (
    <nav className="nav">
      <div className="wrap nav-inner" style={{ fontSize: "16px" }}>
        <a href="#top" className="brand" onClick={(e) => {e.preventDefault();onHome();}}>
          <img src={(window.__resources || {}).logoImg || "assets/logo.png"} alt="ShopFlix AI logo" />
          <span style={{ fontSize: "18px" }}>ShopFlix<span className="ai"> AI</span></span>
        </a>
        <div className="nav-links">
          {onLanding ?
          <React.Fragment>
              <a href="#how">How it works</a>
              <a href="#checks">What we check</a>
              <a href="#plans">Pricing</a>
              <a href="#sample">Sample report</a>
              <a href="#app">Shopify app</a>
            </React.Fragment> :

          <a href="#top" onClick={(e) => {e.preventDefault();onHome();}} style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <Icons.back size={14} /> Back to home
            </a>
          }
          <a className="btn btn-ghost btn-sm nav-cta" href="https://apps.shopify.com/shopflix-ai" target="_blank" rel="noopener">Install Shopify app</a>
        </div>
      </div>
    </nav>);

}

/* ---------- footer ---------- */
function Footer() {
  return (
    <footer className="footer">
      <div className="wrap" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.2fr', gap: '40px' }} data-footer-grid="1">
        <div>
          <div className="brand" style={{ marginBottom: '14px' }}>
            <img src={(window.__resources || {}).logoImg || "assets/logo.png"} alt="ShopFlix AI logo" />
            <span>ShopFlix<span className="ai"> AI</span></span>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '14px', maxWidth: '300px' }}>
            We scan your Shopify store the way Google&rsquo;s review does — so you get approved, stay approved, and sell more.
          </p>
        </div>
        <div>
          <h5>Product</h5>
          <a href="#how">How it works</a>
          <a href="#checks">What we check</a>
          <a href="#plans">Pricing</a>
          <a href="https://apps.shopify.com/shopflix-ai" target="_blank" rel="noopener">Shopify app</a>
        </div>
        <div>
          <h5>Legal</h5>
          <a href="https://shopflixai.com/privacy-policy.html" target="_blank" rel="noopener">Privacy policy</a>
          <a href="https://shopflixai.com/terms-of-service.html" target="_blank" rel="noopener">Terms of service</a>
          <a href="https://shopflixai.com/refund-policy.html" target="_blank" rel="noopener">Refund policy</a>
        </div>
        <div>
          <h5>Contact</h5>
          <a href="mailto:support@shopflixai.com">support@shopflixai.com</a>
          <p style={{ color: 'var(--faint)', fontSize: '13px', marginTop: '18px' }}>
            &copy; 2026 ShopFlix AI by zSellr Enterprises LLP.<br />All rights reserved.
          </p>
        </div>
      </div>
    </footer>);

}

/* ---------- plan card (shared by landing + results) ---------- */
function PlanCard({ plan, cta, onSelect, compact }) {
  return (
    <div className={'card card-hover plan' + (plan.pop ? ' plan-pop' : '')} style={compact ? { padding: '22px' } : null}>
      {plan.flag ? <div className="plan-flag" style={plan.pop ? null : { background: 'var(--panel2)', color: 'var(--accent)', border: '1px solid var(--line-strong)' }}>{plan.flag}</div> : null}
      <div style={{ fontWeight: 700, fontSize: compact ? '16px' : '19px' }}>{plan.name}</div>
      <div className="mono" style={{ fontSize: '12px', color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '4px' }}>{plan.tagline}</div>
      <div className="plan-price">
        <b style={compact ? { fontSize: '30px' } : null}>${plan.price}</b>
        <span>one-time / scan</span>
      </div>
      <ul>
        {plan.features.map((f, i) =>
        <li key={i}><Icons.check size={15} color="var(--green)" sw={2.4} />{f}</li>
        )}
      </ul>
      <button className={'btn btn-block ' + (plan.pop ? 'btn-primary' : 'btn-ghost')} onClick={() => onSelect(plan.id)}>{cta}</button>
    </div>);

}



/* ===================== file7.js ===================== */
// ShopFlix AI — landing page: 3 hero variants + content sections
const { useState: useStateL, useEffect: useEffectL } = React;

/* ============ HERO VARIANTS ============ */

function HeroShell({ children, minHeight }) {
  return (
    <header style={{ position: 'relative', overflow: 'hidden', borderBottom: '1px solid var(--line)' }}>
      <div className="grid-bg"></div>
      <div className="glow" style={{ width: '560px', height: '560px', background: 'var(--accent)', top: '-220px', left: '50%', transform: 'translateX(-50%)' }}></div>
      <div className="wrap" style={{ position: 'relative', minHeight: minHeight || 'auto' }}>{children}</div>
    </header>);

}

function TrustStrip() {
  return (
    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '28px', fontSize: "14px" }}>
      <span className="chip"><span className="dot"></span>First scan preview is free</span>
      <span className="chip">No login needed to start</span>
      <span className="chip">Reads your store like Google&rsquo;s review bot</span>
    </div>);

}

/* --- Variant 1: Radar — centered, radar animation behind --- */
function HeroRadar({ onScan }) {
  return (
    <HeroShell>
      <div style={{ padding: '100px 0 110px', textAlign: 'center', position: 'relative' }}>
        <div className="radar" style={{ position: 'absolute', width: '620px', height: '620px', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', opacity: 0.5, pointerEvents: 'none' }}>
          <div className="radar-sweep"></div>
          <div className="radar-dot" style={{ top: '22%', left: '63%' }}></div>
          <div className="radar-dot" style={{ top: '58%', left: '20%', animationDelay: '1.2s' }}></div>
          <div className="radar-dot" style={{ top: '74%', left: '70%', animationDelay: '2.1s' }}></div>
        </div>
        <div style={{ position: 'relative' }}>
          <div className="kicker">Free Shopify store scan</div>
          <h1 style={{ fontSize: '56px', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.08, maxWidth: '820px', margin: '0 auto', textWrap: 'balance' }}>
            Is your store one scan away from a <span style={{ color: 'var(--red)' }}>Google suspension</span>?
          </h1>
          <p className="sub" style={{ margin: '22px auto 38px', maxWidth: '600px', fontSize: '18px' }}>
            Enter your store URL and we&rsquo;ll check it against Google Merchant Center policies — the same things Google looks at before approving your products.
          </p>
          <div style={{ maxWidth: '620px', margin: '0 auto' }}>
            <ScanBox onScan={onScan} big autoFocus />
          </div>
          <TrustStrip />
        </div>
      </div>
    </HeroShell>);

}

/* --- Variant 2: Split — copy left, live terminal right --- */
const TERM_LINES = [
{ t: '$ shopflix scan yourstore.com', c: 't-acc' },
{ t: 'Fetching homepage\u2026 ok (212ms)', c: 't-dim' },
{ t: '\u2713 Contact page found', c: 't-ok' },
{ t: '\u2713 Privacy policy linked in footer', c: 't-ok' },
{ t: '\u26a0 Shipping policy missing timeframes', c: 't-warn' },
{ t: '\u2715 Refund policy not linked in footer', c: 't-bad' },
{ t: '\u2715 No physical address on contact page', c: 't-bad' },
{ t: 'Risk level: HIGH \u2014 21 issues found', c: 't-warn' }];

function HeroSplit({ onScan }) {
  const [n, setN] = useStateL(0);
  useEffectL(() => {
    const id = setInterval(() => setN((v) => v >= TERM_LINES.length ? 0 : v + 1), 900);
    return () => clearInterval(id);
  }, []);
  return (
    <HeroShell>
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '64px', alignItems: 'center', padding: '90px 0 100px' }} className="grid-2">
        <div>
          <div className="kicker">Free Shopify store scan</div>
          <h1 style={{ fontSize: '50px', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.1, textWrap: 'balance' }}>
            See your store the way <span style={{ color: 'var(--accent)' }}>Google sees it</span>
          </h1>
          <p className="sub" style={{ margin: '20px 0 34px', fontSize: '17px' }}>
            One URL. One minute. We check the policies, pages and trust signals Google Merchant Center reviews before letting you advertise.
          </p>
          <ScanBox onScan={onScan} big autoFocus />
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '24px' }}>
            <span className="chip"><span className="dot"></span>First scan preview is free</span>
            <span className="chip">No login needed</span>
          </div>
        </div>
        <div className="term" aria-hidden="true">
          <div className="term-bar">
            <i style={{ background: '#f87171' }}></i><i style={{ background: '#fbbf24' }}></i><i style={{ background: '#34d399' }}></i>
            <span className="t-title">shopflix-scanner</span>
          </div>
          <div className="term-body" style={{ minHeight: '300px' }}>
            {TERM_LINES.slice(0, n).map((l, i) => <div key={i} className={l.c}>{l.t}</div>)}
            <span className="cursor"></span>
          </div>
        </div>
      </div>
    </HeroShell>);

}

/* --- Variant 3: Command — minimal, huge type, command-palette input --- */
function HeroCommand({ onScan }) {
  return (
    <HeroShell>
      <div style={{ padding: '120px 0 130px', textAlign: 'center' }}>
        <div className="mono" style={{ color: 'var(--faint)', marginBottom: '28px', letterSpacing: '0.1em', fontSize: "15px", fontWeight: "500" }}>
          [ GOOGLE MERCHANT CENTER &middot; COMPLIANCE SCANNER ]
        </div>
        <h1 style={{ fontSize: '72px', fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1.02, textWrap: 'balance' }}>
          Scan it.<br />
          <span style={{ color: 'var(--accent)' }}>Fix it.</span> Get approved.
        </h1>
        <p className="sub" style={{ margin: '26px auto 44px', maxWidth: '520px', fontSize: "19px" }}>
          Paste your Shopify store URL below. We&rsquo;ll find what&rsquo;s blocking your Google approval — before Google does.
        </p>
        <div style={{ maxWidth: '640px', margin: '0 auto' }}>
          <ScanBox onScan={onScan} big autoFocus placeholder={'paste your store url\u2026'} />
        </div>
        <TrustStrip />
      </div>
    </HeroShell>);

}

/* ============ SECTIONS ============ */

function HowItWorks() {
  const steps = [
  { n: '01', icon: 'link', title: 'Paste your store URL', body: 'No install, no login. Just type your store address and hit scan — we do the rest.' },
  { n: '02', icon: 'search', title: 'We scan it like Google does', body: 'Policy pages, contact info, navigation, trust signals — checked against the latest Google Merchant Center policies.' },
  { n: '03', icon: 'check', title: 'Fix issues & get approved', body: 'Every issue comes with a plain-English fix. Or let the ShopFlix Shopify app fix them for you in one click.' }];

  return (
    <section className="section" id="how">
      <div className="wrap">
        <div className="kicker">How it works</div>
        <h2 className="h2">From URL to action plan in about a minute</h2>
        <div className="grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginTop: '48px' }}>
          {steps.map((s) => {
            const I = Icons[s.icon];
            return (
              <div key={s.n} className="card card-hover" style={{ fontSize: "6px" }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '40px' }}>
                  <div style={{ width: '42px', height: '42px', borderRadius: '11px', background: 'rgba(65,198,238,0.1)', border: '1px solid rgba(65,198,238,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                    <I size={20} />
                  </div>
                  <span className="mono" style={{ fontSize: '13px', color: 'var(--faint)' }}>{s.n}</span>
                </div>
                <h3 style={{ fontSize: '18px', fontWeight: 600 }}>{s.title}</h3>
                <p style={{ color: 'var(--muted)', fontSize: '14.5px', marginTop: '8px' }}>{s.body}</p>
              </div>);

          })}
        </div>
      </div>
    </section>);

}

function WhatWeCheck() {
  const cats = [
  { icon: 'doc', tier: 'Basic', title: 'Policy pages & legal', items: 'Privacy, refund, shipping & terms pages — present, complete and linked.' },
  { icon: 'phone', tier: 'Basic', title: 'Contact & trust signals', items: 'Email, phone and physical address where Google expects to find them.' },
  { icon: 'link', tier: 'Basic', title: 'Navigation & links', items: 'Broken links, missing footer links and orphaned pages that fail review.' },
  { icon: 'cart', tier: 'Advanced', title: 'Product feed data', items: 'GTINs, brands, MPNs, pricing logic and feed-vs-storefront integrity.' },
  { icon: 'img', tier: 'Advanced', title: 'Images & media', items: 'Watermarks, promo text and low-quality images that get products disapproved.' },
  { icon: 'eye', tier: 'Deep', title: 'Misrepresentation & checkout', items: 'False scarcity, schema markup, checkout flow and business identity alignment.' }];

  const tierColor = { Basic: 'var(--green)', Advanced: 'var(--accent)', Deep: 'var(--amber)' };
  return (
    <section className="section section-alt" id="checks">
      <div className="wrap">
        <div className="kicker">What we check</div>
        <h2 className="h2">38 checks across 6 areas Google cares about</h2>
        <p className="sub">Google approves stores, not just feeds. These are the areas its review actually looks at.</p>
        <div className="grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginTop: '48px' }}>
          {cats.map((c) => {
            const I = Icons[c.icon];
            return (
              <div key={c.title} className="card card-hover" style={{ padding: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                  <span style={{ color: 'var(--accent)' }}><I size={20} /></span>
                  <span className="tag" style={{ color: tierColor[c.tier], borderColor: 'var(--line-strong)' }}>{c.tier} scan</span>
                </div>
                <h3 style={{ fontSize: '16.5px', fontWeight: 600 }}>{c.title}</h3>
                <p style={{ color: 'var(--muted)', marginTop: '6px', fontSize: "6px" }}>{c.items}</p>
              </div>);

          })}
        </div>
      </div>
    </section>);

}

function PlansSection({ onSelectPlan }) {
  return (
    <section className="section" id="plans">
      <div className="wrap">
        <div style={{ textAlign: 'center' }}>
          <div className="kicker">Pricing</div>
          <h2 className="h2">Pay per scan. No subscription.</h2>
          <p className="sub" style={{ margin: '14px auto 0' }}>Your first Basic Scan preview is free. Unlock the full report whenever you&rsquo;re ready.</p>
        </div>
        <div className="grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginTop: '56px', alignItems: 'stretch' }}>
          {PLANS.map((p) =>
          <PlanCard key={p.id} plan={p} cta={p.id === 'basic' ? 'Start with a free scan' : 'Run ' + p.name} onSelect={onSelectPlan} />
          )}
        </div>
        <p className="mono" style={{ textAlign: 'center', color: 'var(--faint)', fontSize: '12.5px', marginTop: '28px' }}>
          One-time payment per scan &middot; secure checkout &middot; results in about a minute
        </p>
      </div>
    </section>);

}

function SampleReport() {
  return (
    <section className="section section-alt" id="sample">
      <div className="wrap grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: '64px', alignItems: 'center' }}>
        <div>
          <div className="kicker">Sample report</div>
          <h2 className="h2">Know exactly what to fix — and why</h2>
          <p className="sub" style={{ marginTop: '14px' }}>
            Every issue is graded by severity, explained in plain English, and paired with a step-by-step fix. No jargon, no guesswork.
          </p>
          <ul style={{ listStyle: 'none', marginTop: '26px', display: 'flex', flexDirection: 'column', gap: '13px' }}>
            {['Compliance score & suspension risk level', 'Issues grouped by Google policy area', 'A concrete fix for every single issue', 'PDF & Excel export, or emailed to you'].map((f) =>
            <li key={f} style={{ display: 'flex', gap: '11px', alignItems: 'flex-start', color: 'var(--muted)', fontSize: '15px' }}>
                <Icons.check size={16} color="var(--green)" sw={2.4} /> {f}
              </li>
            )}
          </ul>
        </div>
        <div className="term" aria-hidden="true">
          <div className="term-bar">
            <i style={{ background: '#f87171' }}></i><i style={{ background: '#fbbf24' }}></i><i style={{ background: '#34d399' }}></i>
            <span className="t-title">scan-report &middot; yourstore.com</span>
          </div>
          <div style={{ padding: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '18px' }}>
              <div style={{ width: '58px', height: '58px', borderRadius: '50%', border: '3px solid var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '18px' }}>54</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '15px' }}>Compliance score</div>
                <div className="mono" style={{ fontSize: '12px', color: 'var(--red)' }}>HIGH RISK &middot; 21 issues</div>
              </div>
            </div>
            {[
            { sev: 'sev-high', s: 'High', t: 'Refund policy not linked in footer' },
            { sev: 'sev-high', s: 'High', t: 'No physical address on contact page' },
            { sev: 'sev-medium', s: 'Med', t: 'Shipping policy missing delivery timeframes' },
            { sev: 'sev-low', s: 'Low', t: 'Terms of service not in navigation' }].
            map((r, i) =>
            <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '11px 0', borderTop: '1px solid var(--line)' }}>
                <span className={'sev ' + r.sev}>{r.s}</span>
                <span style={{ fontSize: '13.5px', color: 'var(--muted)' }}>{r.t}</span>
              </div>
            )}
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: '13px', display: 'flex', alignItems: 'center', gap: '9px', color: 'var(--faint)', fontSize: '13px' }}>
              <Icons.lock size={14} /> 17 more issues in the full report
            </div>
          </div>
        </div>
      </div>
    </section>);

}

function AppPromo() {
  const feats = [
  { icon: 'bolt', t: 'One-click AI fixes', b: 'Missing policy pages, footer links and contact info — generated and published for you.' },
  { icon: 'shield', t: 'Suspension recovery', b: 'Diagnosis, fix checklist and a drafted reinstatement appeal letter.' },
  { icon: 'cart', t: 'AI product import', b: 'Paste a product URL from Amazon, eBay or AliExpress — get a complete, SEO-ready Shopify product.' }];

  return (
    <section className="section" id="app">
      <div className="wrap grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1.15fr', gap: '64px', alignItems: 'center' }}>
        <div>
          <div className="kicker">The ShopFlix Shopify app</div>
          <h2 className="h2">Don&rsquo;t just find issues. Fix them in one click.</h2>
          <p className="sub" style={{ marginTop: '14px' }}>
            The scanner tells you what&rsquo;s wrong. The ShopFlix app — right inside your Shopify admin — fixes it for you and keeps watching so it never happens again.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', margin: '28px 0 32px' }}>
            {feats.map((f) => {
              const I = Icons[f.icon];
              return (
                <div key={f.t} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '9px', background: 'rgba(232,155,60,0.12)', border: '1px solid rgba(232,155,60,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--amber)', flexShrink: 0 }}>
                    <I size={17} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '15.5px' }}>{f.t}</div>
                    <div style={{ color: 'var(--muted)', fontSize: '14px', marginTop: '2px' }}>{f.b}</div>
                  </div>
                </div>);

            })}
          </div>
          <a className="btn btn-amber btn-lg" href="https://apps.shopify.com/shopflix-ai" target="_blank" rel="noopener">
            Install on Shopify <Icons.arrow size={15} sw={2.2} />
          </a>
          <span className="mono" style={{ display: 'block', fontSize: '12px', color: 'var(--faint)', marginTop: '12px' }}>From $4.99/month &middot; 7-day free trial</span>
        </div>
        <div className="browser-frame">
          <div className="bf-bar">
            <i style={{ width: '11px', height: '11px', borderRadius: '50%', background: '#f87171', display: 'block' }}></i>
            <i style={{ width: '11px', height: '11px', borderRadius: '50%', background: '#fbbf24', display: 'block' }}></i>
            <i style={{ width: '11px', height: '11px', borderRadius: '50%', background: '#34d399', display: 'block' }}></i>
            <span className="bf-url">admin.shopify.com &middot; ShopFlix: GMC Suspension Fix</span>
          </div>
          <img src={(window.__resources || {}).appScanImg || "assets/app-scan.png"} alt="ShopFlix app scan dashboard inside Shopify admin" />
        </div>
      </div>
    </section>);

}

function Testimonials() {
  const quotes = [
  { q: 'Google disapproved half my catalog and I had no idea why. The scan found a missing refund policy link in two minutes. Approved a week later.', n: 'Priya S.', r: 'Home & decor store' },
  { q: 'I ran the free scan expecting nothing. It flagged 14 issues — including the exact misrepresentation problem from my suspension email.', n: 'Marcus T.', r: 'Phone accessories, 1.2k products' },
  { q: 'The fix instructions are written for normal people. I did everything myself in an afternoon without touching a developer.', n: 'Elena R.', r: 'Handmade jewelry store' }];

  return (
    <section className="section section-alt">
      <div className="wrap">
        <div style={{ textAlign: 'center' }}>
          <div className="kicker">Merchants</div>
          <h2 className="h2">Stores that scanned before Google did</h2>
        </div>
        <div className="grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginTop: '48px' }}>
          {quotes.map((t) =>
          <div key={t.n} className="card">
              <div style={{ display: 'flex', gap: '3px', color: 'var(--amber)', marginBottom: '16px' }}>
                {[0, 1, 2, 3, 4].map((i) => <Icons.star key={i} size={14} />)}
              </div>
              <p style={{ fontSize: '14.5px', color: 'var(--text)', lineHeight: 1.65 }}>&ldquo;{t.q}&rdquo;</p>
              <div style={{ marginTop: '18px', paddingTop: '16px', borderTop: '1px solid var(--line)' }}>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>{t.n}</div>
                <div className="mono" style={{ fontSize: '12px', color: 'var(--faint)', marginTop: '2px' }}>{t.r}</div>
              </div>
            </div>
          )}
        </div>
        <p className="mono" style={{ textAlign: 'center', color: 'var(--faint)', fontSize: '11.5px', marginTop: '24px' }}>Early-access merchant feedback</p>
      </div>
    </section>);

}

function FinalCta({ onScan }) {
  return (
    <section className="section" style={{ position: 'relative', overflow: 'hidden' }}>
      <div className="glow" style={{ width: '500px', height: '400px', background: 'var(--accent)', bottom: '-260px', left: '50%', transform: 'translateX(-50%)' }}></div>
      <div className="wrap" style={{ textAlign: 'center', position: 'relative' }}>
        <h2 className="h2" style={{ fontSize: '42px' }}>Scan your store before Google does</h2>
        <p className="sub" style={{ margin: '14px auto 36px' }}>Free preview. No login. About a minute.</p>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <ScanBox onScan={onScan} big />
        </div>
      </div>
    </section>);

}

function Landing({ t, onScan, onSelectPlan }) {
  const Hero = t.heroVariant === 'Split' ? HeroSplit : t.heroVariant === 'Command' ? HeroCommand : HeroRadar;
  return (
    <div data-screen-label="Landing page">
      <Hero onScan={onScan} />
      <HowItWorks />
      <WhatWeCheck />
      <PlansSection onSelectPlan={onSelectPlan} />
      <SampleReport />
      <AppPromo />
      <Testimonials />
      <FinalCta onScan={onScan} />
    </div>);

}



/* ===================== file9.js ===================== */
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
function ResultsScreen({ storeUrl, onUnlock, onRescan, data }) {
  // WIRING: render the live scan from /api/web-scan; loading + error states first.
  if (!data) {
    return (
      <div data-screen-label="Compiling" className="wrap" style={{ padding: '120px 32px', textAlign: 'center' }}>
        <div className="radar" style={{ width: '90px', height: '90px', margin: '0 auto 24px' }}><div className="radar-sweep"></div></div>
        <h1 style={{ fontSize: '24px', fontWeight: 700 }}>Compiling your report&hellip;</h1>
        <p style={{ color: 'var(--muted)', marginTop: '8px' }}>Scanning <span className="mono" style={{ color: 'var(--accent)' }}>{storeUrl}</span> against Google Merchant Center policies.</p>
      </div>
    );
  }
  if (data.ok === false) {
    return (
      <div data-screen-label="Scan error" className="wrap" style={{ padding: '110px 32px', textAlign: 'center', maxWidth: '640px' }}>
        <div style={{ width: '52px', height: '52px', borderRadius: '14px', background: 'rgba(248,113,113,0.14)', border: '1px solid rgba(248,113,113,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--red)', margin: '0 auto 18px' }}><Icons.search size={22} /></div>
        <h1 style={{ fontSize: '24px', fontWeight: 700 }}>We couldn&rsquo;t scan that store</h1>
        <p style={{ color: 'var(--muted)', marginTop: '10px' }}>{data.error || 'Please try a different store URL.'}</p>
        <button className="btn btn-primary" style={{ marginTop: '24px' }} onClick={onRescan}>Try another store</button>
      </div>
    );
  }
  const score = data.score != null ? data.score : SCAN_SCORE;
  const totalIssues = data.totalIssues != null ? data.totalIssues : TOTAL_ISSUES;
  const freePreview = data.freePreview || FREE_PREVIEW;
  const highCount = data.highCount != null ? data.highCount : ALL_ISSUES.filter((i) => i.sev === 'High').length;
  const lockedCount = data.lockedCount != null ? data.lockedCount : (totalIssues - freePreview.length);
  const pagesScanned = data.pagesScanned != null ? data.pagesScanned : 7;
  const checksRun = data.checksRun != null ? data.checksRun : 38;
  const risk = data.riskLevel || (score < 60 ? 'High' : score < 80 ? 'Medium' : 'Low');
  const riskClass = risk === 'High' ? 'sev-high' : risk === 'Medium' ? 'sev-medium' : 'sev-low';
  const clean = totalIssues === 0;
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
          <ScoreRing score={score} />
          <div style={{ flex: 1, minWidth: '220px' }}>
            <span className={'sev ' + riskClass} style={{ fontSize: '12px', padding: '5px 12px' }}>{risk} suspension risk</span>
            <p style={{ color: 'var(--muted)', fontSize: '15px', marginTop: '12px', maxWidth: '480px' }}>
              {clean
                ? 'No blocking store-level issues found — your storefront looks compliant with Google Merchant Center basics. Run an Advanced or Deep scan for product-feed and misrepresentation checks.'
                : 'Your store has issues Google can treat as suspension triggers. The good news: every one of them is fixable, and most take under an hour.'}
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, auto)', gap: '14px 40px' }}>
            {[['Pages scanned', String(pagesScanned)], ['Checks run', String(checksRun)], ['Issues found', String(totalIssues)], ['High severity', String(highCount)]].map(([k, v]) => (
              <div key={k}>
                <div className="mono" style={{ fontSize: '11px', color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{k}</div>
                <div style={{ fontSize: '26px', fontWeight: 700 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* free issues */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700 }}>{clean ? 'No store-level issues in your free preview' : 'Your free preview — ' + freePreview.length + ' of ' + totalIssues + ' issues'}</h2>
          <span className="mono" style={{ fontSize: '12px', color: 'var(--faint)' }}>sorted by severity</span>
        </div>
        {freePreview.map((iss, i) => (
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
        {lockedCount > 0 ? (
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
              <p style={{ color: 'var(--muted)', fontSize: '14.5px', marginTop: '6px' }}>Including {Math.max(0, highCount - freePreview.filter((i) => i.sev === 'High').length)} more high-severity issues. Unlock the full report with fixes for every one.</p>
            </div>
          </div>
        </div>
        ) : null}

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



/* ===================== file10.js ===================== */
// ShopFlix AI — auth modal, checkout, unlocked full report
const { useState: useStateF, useEffect: useEffectF } = React;

/* ============ AUTH MODAL ============ */
function AuthModal({ plan, onClose, onAuthed }) {
  const [mode, setMode] = useStateF('signup');
  const [email, setEmail] = useStateF('');
  const [pw, setPw] = useStateF('');
  const [busy, setBusy] = useStateF(false);
  const submit = (via) => {
    if (via === 'form' && (!email.includes('@') || pw.length < 4)) return;
    setBusy(true);
    setTimeout(() => onAuthed(via === 'form' ? email : 'merchant@gmail.com'), 900);
  };
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" data-screen-label="Login / signup modal">
        <button className="modal-x" onClick={onClose} aria-label="Close">&times;</button>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <img src={(window.__resources || {}).logoImg || "assets/logo.png"} alt="" style={{ width: '44px', height: '44px', borderRadius: '12px', margin: '0 auto 14px' }} />
          <h2 style={{ fontSize: '21px', fontWeight: 700 }}>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
          <p style={{ color: 'var(--muted)', fontSize: '14px', marginTop: '6px' }}>
            To unlock the <b style={{ color: 'var(--text)' }}>{plan.name}</b> report for ${plan.price}
          </p>
        </div>
        <button className="btn btn-ghost btn-block" onClick={() => submit('google')} disabled={busy} style={{ marginBottom: '10px' }}>
          <span className="mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>G</span>&nbsp;Continue with Google
        </button>
        <div className="divider">or with email</div>
        <div className="field">
          <label>Email</label>
          <input type="email" placeholder="you@store.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" placeholder={mode === 'signup' ? 'Create a password' : 'Your password'} value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit('form'); }} />
        </div>
        <button className="btn btn-primary btn-block" onClick={() => submit('form')} disabled={busy || !email.includes('@') || pw.length < 4} style={{ marginTop: '6px' }}>
          {busy ? 'One moment\u2026' : mode === 'signup' ? 'Create account & continue' : 'Log in & continue'}
        </button>
        <p style={{ textAlign: 'center', fontSize: '13px', color: 'var(--muted)', marginTop: '18px' }}>
          {mode === 'signup' ? 'Already have an account? ' : 'New to ShopFlix? '}
          <a href="#switch" style={{ color: 'var(--accent)' }} onClick={(e) => { e.preventDefault(); setMode(mode === 'signup' ? 'login' : 'signup'); }}>
            {mode === 'signup' ? 'Log in' : 'Sign up'}
          </a>
        </p>
      </div>
    </div>
  );
}

/* ============ CHECKOUT ============ */
function fmtCard(v) { return v.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 '); }
function CheckoutScreen({ plan, storeUrl, email, onPaid, onBack }) {
  const [card, setCard] = useStateF('');
  const [exp, setExp] = useStateF('');
  const [cvc, setCvc] = useStateF('');
  const [name, setName] = useStateF('');
  const [busy, setBusy] = useStateF(false);
  const ready = card.replace(/\s/g, '').length === 16 && exp.length >= 4 && cvc.length >= 3 && name.length > 2;
  const pay = () => {
    if (!ready) return;
    setBusy(true);
    setTimeout(onPaid, 1600);
  };
  return (
    <div data-screen-label="Checkout" style={{ position: 'relative', overflow: 'hidden', minHeight: 'calc(100vh - 66px)' }}>
      <div className="grid-bg"></div>
      <div className="wrap" style={{ position: 'relative', maxWidth: '920px', padding: '56px 32px 90px' }}>
        <div className="steps-rail" style={{ justifyContent: 'center', marginBottom: '44px' }}>
          <span className="st done"><Icons.check size={13} sw={2.6} /> Scan</span><span className="sep"></span>
          <span className="st done"><Icons.check size={13} sw={2.6} /> Account</span><span className="sep"></span>
          <span className="st on">&#9656; Payment</span><span className="sep"></span>
          <span className="st">Full report</span>
        </div>
        <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '28px', alignItems: 'start' }}>
          <div className="card">
            <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '22px' }}>Payment details</h2>
            <div className="field">
              <label>Name on card</label>
              <input placeholder="Jane Merchant" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label>Card number</label>
              <input className="mono" placeholder="4242 4242 4242 4242" value={card} onChange={(e) => setCard(fmtCard(e.target.value))} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div className="field">
                <label>Expiry</label>
                <input className="mono" placeholder="MM/YY" value={exp} onChange={(e) => setExp(e.target.value.replace(/[^\d/]/g, '').slice(0, 5))} />
              </div>
              <div className="field">
                <label>CVC</label>
                <input className="mono" placeholder="123" value={cvc} onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))} />
              </div>
            </div>
            <button className="btn btn-primary btn-block btn-lg" onClick={pay} disabled={!ready || busy} style={{ marginTop: '10px' }}>
              {busy ? 'Processing payment\u2026' : 'Pay $' + plan.price + ' & unlock report'}
            </button>
            <p className="mono" style={{ fontSize: '11.5px', color: 'var(--faint)', textAlign: 'center', marginTop: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px' }}>
              <Icons.lock size={12} /> Demo checkout &mdash; no real charge. Secure 256-bit encryption.
            </p>
          </div>
          <div>
            <div className="card" style={{ padding: '24px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '18px' }}>Order summary</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '10px' }}>
                <span style={{ color: 'var(--muted)' }}>{plan.name}</span><b>${plan.price}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--faint)', marginBottom: '10px' }} className="mono">
                <span>Store</span><span>{storeUrl}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--faint)' }} className="mono">
                <span>Account</span><span>{email}</span>
              </div>
              <div style={{ borderTop: '1px solid var(--line)', marginTop: '16px', paddingTop: '16px', display: 'flex', justifyContent: 'space-between', fontSize: '16px' }}>
                <b>Total</b><b style={{ color: 'var(--accent)' }}>${plan.price}</b>
              </div>
            </div>
            <button className="btn btn-ghost btn-sm btn-block" onClick={onBack} style={{ marginTop: '12px' }}>
              <Icons.back size={13} /> Back to results
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ FULL REPORT ============ */
const TIER_ORDER = { basic: 0, advanced: 1, deep: 2 };
function FullReport({ plan, storeUrl, onUpgrade, onRescan, toast }) {
  const ownedTier = TIER_ORDER[plan.id];
  const [open, setOpen] = useStateF(null);
  return (
    <div data-screen-label="Full unlocked report">
      <div style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg2)' }}>
        <div className="wrap" style={{ padding: '40px 32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '18px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <span className="chip" style={{ borderColor: 'rgba(52,211,153,0.4)', color: 'var(--green)' }}><Icons.check size={12} sw={2.6} /> {plan.name} unlocked</span>
              </div>
              <h1 style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.02em' }}>
                Full report &middot; <span className="mono" style={{ color: 'var(--accent)' }}>{storeUrl}</span>
              </h1>
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => toast('Report PDF download started (demo)')}><Icons.download size={14} /> PDF</button>
              <button className="btn btn-ghost btn-sm" onClick={() => toast('Report emailed to your inbox (demo)')}><Icons.mail size={14} /> Email report</button>
              <button className="btn btn-ghost btn-sm" onClick={onRescan}><Icons.search size={14} /> New scan</button>
            </div>
          </div>
        </div>
      </div>

      <div className="wrap" style={{ padding: '40px 32px 90px' }}>
        <div className="card" style={{ display: 'flex', gap: '36px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '40px' }}>
          <ScoreRing score={SCAN_SCORE} size={120} />
          <div style={{ flex: 1, minWidth: '240px' }}>
            <span className="sev sev-high" style={{ fontSize: '12px', padding: '5px 12px' }}>High suspension risk</span>
            <p style={{ color: 'var(--muted)', fontSize: '14.5px', marginTop: '10px', maxWidth: '520px' }}>
              Fix the high-severity issues first — they&rsquo;re the ones Google&rsquo;s automated review treats as suspension triggers. Re-scan after fixing to watch your score climb.
            </p>
          </div>
          <a className="btn btn-amber" href="https://apps.shopify.com/shopflix-ai" target="_blank" rel="noopener">
            <Icons.bolt size={15} /> Auto-fix with the Shopify app
          </a>
        </div>

        {SCAN_CATEGORIES.map((cat) => {
          const owned = TIER_ORDER[cat.tier] <= ownedTier;
          const I = Icons[cat.icon];
          const upgradePlan = PLANS.find((p) => p.id === cat.tier);
          return (
            <div key={cat.id} style={{ marginBottom: '36px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                <span style={{ color: owned ? 'var(--accent)' : 'var(--faint)' }}><I size={18} /></span>
                <h2 style={{ fontSize: '18px', fontWeight: 700 }}>{cat.name}</h2>
                <span className="tag">{cat.issues.length} issues</span>
                {!owned ? <span className="tag" style={{ color: 'var(--amber)', borderColor: 'rgba(232,155,60,0.4)' }}><Icons.lock size={10} /> {upgradePlan.name}</span> : null}
              </div>
              {owned ? (
                cat.issues.slice().sort((a, b) => sevRank[a.sev] - sevRank[b.sev]).map((iss, i) => {
                  const key = cat.id + i;
                  const isOpen = open === key;
                  return (
                    <div key={key} className="issue" style={{ flexDirection: 'column', gap: '0', cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : key)}>
                      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', width: '100%' }}>
                        <span className={'sev sev-' + iss.sev.toLowerCase()}>{iss.sev}</span>
                        <div style={{ flex: 1 }}>
                          <h4>{iss.title}</h4>
                          {!isOpen ? <p>{iss.why}</p> : null}
                        </div>
                        <span className="mono" style={{ color: 'var(--faint)', fontSize: '15px', flexShrink: 0 }}>{isOpen ? '\u2212' : '+'}</span>
                      </div>
                      {isOpen ? (
                        <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--line)', width: '100%', display: 'grid', gap: '12px' }}>
                          <div>
                            <div className="mono" style={{ fontSize: '11px', color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Why it matters</div>
                            <p style={{ fontSize: '14px', color: 'var(--muted)' }}>{iss.why}</p>
                          </div>
                          <div>
                            <div className="mono" style={{ fontSize: '11px', color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>How to fix it</div>
                            <p style={{ fontSize: '14px', color: 'var(--text)' }}>{iss.fix}</p>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <div style={{ position: 'relative' }}>
                  <div aria-hidden="true">
                    {cat.issues.slice(0, 2).map((iss, i) => (
                      <div key={i} className="issue issue-locked">
                        <span className={'sev sev-' + iss.sev.toLowerCase()}>{iss.sev}</span>
                        <div style={{ flex: 1 }}><h4>{iss.title}</h4><p>{iss.why}</p></div>
                      </div>
                    ))}
                  </div>
                  <div style={{ position: 'absolute', inset: '-4px', background: 'linear-gradient(180deg, rgba(6,13,27,0.35), rgba(6,13,27,0.9))', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '14px' }}>
                    <button className="btn btn-amber btn-sm" onClick={() => onUpgrade(cat.tier)}>
                      <Icons.lock size={13} /> Upgrade to {upgradePlan.name} &mdash; ${upgradePlan.price}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}



/* ===================== file5.js ===================== */
// ShopFlix AI — app shell: routing, state, tweaks
const { useState: useStateA, useEffect: useEffectA, useCallback: useCallbackA } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "heroVariant": "Radar",
  "accent": "#41c6ee",
  "gridTexture": true,
  "fastScan": false
}/*EDITMODE-END*/;

const LS = {
  get(k, d) { try { const v = localStorage.getItem('sfx_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('sfx_' + k, JSON.stringify(v)); } catch (e) {} },
};

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [route, setRoute] = useStateA(() => LS.get('route', 'landing'));
  const [storeUrl, setStoreUrl] = useStateA(() => LS.get('url', ''));
  const [planId, setPlanId] = useStateA(() => LS.get('plan', null));
  const [email, setEmail] = useStateA(() => LS.get('email', null));
  const [authFor, setAuthFor] = useStateA(null); // plan id pending auth
  const [toastMsg, setToastMsg] = useStateA(null);
  const [scan, setScan] = useStateA(null); // WIRING: live result from /api/web-scan

  const go = useCallbackA((r) => {
    setRoute(r); LS.set('route', r);
    window.scrollTo({ top: 0 });
  }, []);

  useEffectA(() => { LS.set('url', storeUrl); }, [storeUrl]);
  useEffectA(() => { LS.set('plan', planId); }, [planId]);
  useEffectA(() => { LS.set('email', email); }, [email]);

  const toast = (msg) => { setToastMsg(msg); setTimeout(() => setToastMsg(null), 2600); };

  const startScan = (url) => {
    setStoreUrl(url); setScan(null); go('scanning');
    fetch('/api/web-scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
      .then((r) => r.json())
      .then((d) => setScan(d || { ok: false, error: 'Scan failed. Please try again.' }))
      .catch(() => setScan({ ok: false, error: 'Network error. Please try again.' }));
  };
  const plan = PLANS.find((p) => p.id === planId) || PLANS[0];
  const pendingPlan = PLANS.find((p) => p.id === authFor);

  // landing plan CTA: scroll to scan box if no scan yet
  const landingPlanSelect = (id) => {
    const el = document.querySelector('[data-scanbox] input');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (el) setTimeout(() => el.focus(), 600);
    toast('Start by scanning your store \u2014 it\u2019s free');
  };

  const unlockPlan = (id) => {
    setAuthFor(id);
    if (email) {
      // already logged in -> straight to checkout
      setPlanId(id); LS.set('plan', id);
      setAuthFor(null);
      go('checkout');
    }
  };

  const handleAuthed = (em) => {
    setEmail(em);
    setPlanId(authFor);
    setAuthFor(null);
    go('checkout');
  };

  const upgradeFromReport = (tierId) => {
    setPlanId(tierId);
    go('checkout');
  };

  const rescan = () => { go('landing'); };

  return (
    <div style={{ '--accent': t.accent }} className={t.gridTexture ? '' : 'no-grid'}>
      <a id="top"></a>
      <Nav route={route} onHome={() => go('landing')} />
      {route === 'landing' ? <Landing t={t} onScan={startScan} onSelectPlan={landingPlanSelect} /> : null}
      {route === 'scanning' ? <ScanningScreen storeUrl={storeUrl} fast={t.fastScan} onDone={() => go('results')} /> : null}
      {route === 'results' ? <ResultsScreen storeUrl={storeUrl} onUnlock={unlockPlan} onRescan={rescan} data={scan} /> : null}
      {route === 'checkout' ? <CheckoutScreen plan={plan} storeUrl={storeUrl} email={email || 'merchant@gmail.com'} onPaid={() => go('report')} onBack={() => go('results')} /> : null}
      {route === 'report' ? <FullReport plan={plan} storeUrl={storeUrl} onUpgrade={upgradeFromReport} onRescan={rescan} toast={toast} /> : null}
      {route === 'landing' || route === 'report' ? <Footer /> : null}

      {pendingPlan && !email ? <AuthModal plan={pendingPlan} onClose={() => setAuthFor(null)} onAuthed={handleAuthed} /> : null}
      {toastMsg ? <div className="toast">{toastMsg}</div> : null}
    </div>
  );
}



export default App;
