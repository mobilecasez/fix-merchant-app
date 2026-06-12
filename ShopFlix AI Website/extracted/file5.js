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

  const go = useCallbackA((r) => {
    setRoute(r); LS.set('route', r);
    window.scrollTo({ top: 0 });
  }, []);

  useEffectA(() => { LS.set('url', storeUrl); }, [storeUrl]);
  useEffectA(() => { LS.set('plan', planId); }, [planId]);
  useEffectA(() => { LS.set('email', email); }, [email]);

  const toast = (msg) => { setToastMsg(msg); setTimeout(() => setToastMsg(null), 2600); };

  const startScan = (url) => { setStoreUrl(url); go('scanning'); };
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
      {route === 'results' ? <ResultsScreen storeUrl={storeUrl} onUnlock={unlockPlan} onRescan={rescan} /> : null}
      {route === 'checkout' ? <CheckoutScreen plan={plan} storeUrl={storeUrl} email={email || 'merchant@gmail.com'} onPaid={() => go('report')} onBack={() => go('results')} /> : null}
      {route === 'report' ? <FullReport plan={plan} storeUrl={storeUrl} onUpgrade={upgradeFromReport} onRescan={rescan} toast={toast} /> : null}
      {route === 'landing' || route === 'report' ? <Footer /> : null}

      {pendingPlan && !email ? <AuthModal plan={pendingPlan} onClose={() => setAuthFor(null)} onAuthed={handleAuthed} /> : null}
      {toastMsg ? <div className="toast">{toastMsg}</div> : null}

      <TweaksPanel>
        <TweakSection label="Hero" />
        <TweakRadio label="Variant" value={t.heroVariant} options={['Radar', 'Split', 'Command']} onChange={(v) => setTweak('heroVariant', v)} />
        <TweakSection label="Theme" />
        <TweakColor label="Accent" value={t.accent} options={['#41c6ee', '#e89b3c', '#34d399', '#8b9cf8']} onChange={(v) => setTweak('accent', v)} />
        <TweakToggle label="Grid texture" value={t.gridTexture} onChange={(v) => setTweak('gridTexture', v)} />
        <TweakSection label="Demo" />
        <TweakToggle label="Fast scan animation" value={t.fastScan} onChange={(v) => setTweak('fastScan', v)} />
        <TweakButton label="Reset demo flow" onClick={() => {
          LS.set('route', 'landing'); LS.set('email', null); LS.set('plan', null);
          setEmail(null); setPlanId(null); setRoute('landing'); window.scrollTo({ top: 0 });
        }} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
