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

Object.assign(window, { AuthModal, CheckoutScreen, FullReport });
