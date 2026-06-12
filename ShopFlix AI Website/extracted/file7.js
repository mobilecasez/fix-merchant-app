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

Object.assign(window, { Landing });