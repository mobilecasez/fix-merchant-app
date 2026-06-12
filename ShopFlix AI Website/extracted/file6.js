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

Object.assign(window, { Icons, PLANS, ScanBox, Nav, Footer, PlanCard, cleanUrl, validUrl });