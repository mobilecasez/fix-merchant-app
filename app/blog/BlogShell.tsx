/** Server-rendered shell for /blog pages — site nav + footer + article styling.
 *  Self-contained styles (the marketing SPA's site.css isn't loaded on these routes). */
const SITE = "https://shopflixai.com";

const STYLES = `
:root{--bg:#060d1b;--bg2:#081326;--panel:#0d1a30;--line:rgba(141,180,230,.14);--line-strong:rgba(141,180,230,.22);--text:#e6edf6;--muted:#9fb2c9;--faint:#6b819c;--accent:#41c6ee;--amber:#e89b3c}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.7}
.bwrap{max-width:1100px;margin:0 auto;padding:0 28px}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.bnav{position:sticky;top:0;z-index:20;background:rgba(6,13,27,.86);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.bnav-in{display:flex;align-items:center;justify-content:space-between;height:64px}
.bbrand{display:flex;align-items:center;gap:11px;font-weight:700;font-size:17px;letter-spacing:-.01em;color:var(--text);white-space:nowrap}
.bbrand:hover{text-decoration:none}.bbrand img{width:34px;height:34px;border-radius:9px}.bbrand .ai{color:var(--accent)}
.bnav-links{display:flex;align-items:center;gap:24px;font-size:15px}.bnav-links a{color:var(--muted)}.bnav-links a:hover{color:var(--text);text-decoration:none}
.bbtn{border:1px solid var(--line-strong);border-radius:10px;padding:8px 14px;color:var(--text)!important;font-weight:600}.bbtn:hover{border-color:var(--accent);text-decoration:none}
.bbtn-amber{background:var(--amber);border:none;border-radius:10px;padding:10px 18px;color:#10233f!important;font-weight:700}.bbtn-amber:hover{text-decoration:none;filter:brightness(1.05)}
article{max-width:1100px;margin:0 auto;padding:40px 28px 88px}
.post-head{max-width:880px}
.post-grid{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:56px;align-items:start;margin-top:30px}
.post-grid.no-toc{grid-template-columns:minmax(0,1fr);max-width:840px;margin-left:auto;margin-right:auto}
.post-content{grid-column:1;grid-row:1;min-width:0}
.post-aside{grid-column:2;grid-row:1}
.post-aside .toc{position:sticky;top:84px;margin:0}
.post-meta{color:var(--muted);font-size:14.5px;margin:14px 0 0}
article h1{font-size:42px;line-height:1.12;letter-spacing:-.025em;margin:0;text-wrap:balance}
article h2{font-size:27px;margin:44px 0 14px;letter-spacing:-.015em;scroll-margin-top:84px}
article h3{font-size:20px;margin:30px 0 8px;scroll-margin-top:84px}
article p{color:#d8e2ef;font-size:18px;line-height:1.85;margin:18px 0}
article ul,article ol{color:#d8e2ef;font-size:18px;line-height:1.8;padding-left:26px;margin:18px 0}article li{margin:10px 0}
article strong{color:var(--text)}article code{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:14px}
article hr{border:0;border-top:1px solid var(--line);margin:36px 0}
article blockquote{margin:18px 0;padding:10px 18px;border-left:3px solid var(--accent);color:var(--text);background:var(--panel);border-radius:0 8px 8px 0}
.post-hero{display:block;width:100%;height:auto;aspect-ratio:1200/630;border-radius:16px;border:1px solid var(--line);margin:0 0 30px;background:var(--bg2)}
.post-fig{margin:34px 0}
.post-fig img{display:block;width:100%;height:auto;border-radius:14px;border:1px solid var(--line);background:var(--bg2)}
.post-fig figcaption{color:var(--faint);font-size:13.5px;line-height:1.5;margin-top:11px;text-align:center}
.toc{border:1px solid var(--line);background:var(--bg2);border-radius:12px;padding:16px 20px 14px;margin:26px 0 4px}
.toc-h{margin:0 0 8px!important;font-size:11.5px;text-transform:uppercase;letter-spacing:.09em;color:var(--faint);font-weight:700}
.toc ul{list-style:none;padding:0;margin:0}
.toc li{margin:7px 0;padding-left:14px;position:relative}
.toc li::before{content:"";position:absolute;left:0;top:11px;width:5px;height:5px;border-radius:50%;background:var(--line-strong)}
.toc a{color:var(--muted);font-size:14.5px}.toc a:hover{color:var(--accent);text-decoration:none}
.cta{margin-top:48px;padding:28px 24px;border:1px solid rgba(232,155,60,.35);background:rgba(232,155,60,.06);border-radius:14px;text-align:center}
.cta h3{margin:0 0 8px;font-size:20px;color:var(--text)}.cta p{margin:0 0 18px;color:var(--muted)}
.cta-btns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.related{margin-top:56px;border-top:1px solid var(--line);padding-top:30px}
.related>h2{font-size:13px!important;margin:0 0 18px!important;color:var(--faint);text-transform:uppercase;letter-spacing:.08em;font-weight:700}
.blist{max-width:1140px;margin:0 auto;padding:48px 28px 84px}
.blist h1{font-size:38px;letter-spacing:-.02em;margin:0 0 6px}
.blist .sub{color:var(--muted);margin:0 0 32px}
.pcard{display:block;border:1px solid var(--line);border-radius:14px;padding:22px 24px;margin-bottom:16px;background:var(--bg2);transition:border-color .15s}
.pcard:hover{border-color:var(--line-strong);text-decoration:none}
.pcard h2{font-size:20px;margin:0 0 6px;color:var(--text);letter-spacing:-.01em}
.pcard p{color:var(--muted);font-size:14.5px;margin:0 0 10px}
.pcard .meta{color:var(--faint);font-size:12.5px}
.pcard-media{padding:0;overflow:hidden}
.pcard-thumb{display:block;width:100%;height:auto;aspect-ratio:1200/630;object-fit:cover;background:var(--bg);border-bottom:1px solid var(--line)}
.pcard-body{padding:18px 22px 20px}
.pgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}
.related .pgrid{grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}
.comments{margin-top:60px;border-top:1px solid var(--line);padding-top:34px}
.comments-h{font-size:22px!important;margin:0 0 20px!important;color:var(--text)!important;letter-spacing:-.01em;scroll-margin-top:84px}
.comment-note{border-radius:10px;padding:12px 16px;font-size:15px;margin:0 0 22px}
.comment-note.ok{background:rgba(56,211,154,.12);border:1px solid rgba(56,211,154,.4);color:#9be7c6}
.comment-note.err{background:rgba(239,111,111,.1);border:1px solid rgba(239,111,111,.4);color:#f1a3a3}
.comment-empty{color:var(--muted);font-size:16px;margin:0 0 26px}
.comment-list{list-style:none;padding:0;margin:0 0 42px;display:flex;flex-direction:column;gap:18px}
.comment{display:flex;gap:14px}
.comment-av{flex:0 0 42px;width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:#08101f;background:linear-gradient(135deg,#41c6ee,#7fd9f4);font-size:18px}
.comment-main{flex:1;min-width:0;background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:14px 18px}
.comment-head{display:flex;align-items:baseline;gap:12px;margin-bottom:6px;flex-wrap:wrap}
.comment-name{font-weight:700;color:var(--text);font-size:15.5px}
a.comment-name:hover{color:var(--accent);text-decoration:none}
.comment-date{color:var(--faint);font-size:13px}
.comment-body{color:#d8e2ef!important;font-size:16px!important;line-height:1.7!important;margin:0!important;white-space:pre-wrap;overflow-wrap:anywhere}
.comment-form-h{font-size:19px;margin:0 0 16px;color:var(--text)}
.comment-form{display:flex;flex-direction:column;gap:16px;max-width:700px}
.cf-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.cf-field{display:flex;flex-direction:column;gap:6px}
.cf-field label{font-size:13.5px;font-weight:600;color:var(--muted)}
.cf-hint{font-weight:400;color:var(--faint)}
.comment-form input,.comment-form textarea{background:var(--bg);border:1px solid var(--line-strong);border-radius:10px;padding:11px 13px;color:var(--text);font-size:15px;font-family:inherit;width:100%}
.comment-form input:focus,.comment-form textarea:focus{outline:none;border-color:var(--accent)}
.comment-form textarea{resize:vertical;min-height:120px;line-height:1.6}
.cf-err{color:#f1a3a3;font-size:13px}
.cf-hp{position:absolute!important;left:-9999px!important;width:1px;height:1px;overflow:hidden}
.cf-actions{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:2px}
.cf-actions button{cursor:pointer;font-size:15px;font-family:inherit}
.cf-actions button:disabled{opacity:.6;cursor:default}
.cf-privacy{color:var(--faint);font-size:13px}.cf-privacy a{color:var(--muted)}
.footer{border-top:1px solid var(--line);background:var(--bg2);padding:60px 0 40px;margin-top:40px}
.footer-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1.2fr;gap:40px}
.footer .bbrand{margin-bottom:14px}.footer h5{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--faint);margin:0 0 14px}
.footer a{display:block;color:var(--muted);font-size:14px;margin-bottom:10px}.footer a:hover{color:var(--text);text-decoration:none}
.footer .blurb{color:var(--muted);font-size:14px;max-width:300px}.footer .copy{color:var(--faint);font-size:13px;margin-top:18px}
@media(max-width:1000px){.post-grid,.post-grid.no-toc{display:block;max-width:none}.post-aside .toc{position:static;margin:0 0 26px}.pgrid,.related .pgrid{grid-template-columns:1fr}}
@media(max-width:860px){.bnav-links a:not(.bbtn){display:none}.footer-grid{grid-template-columns:1fr 1fr}article h1{font-size:31px}.blist h1{font-size:27px}article h2{font-size:23px}article p,article ul,article ol{font-size:17px}.cf-row{grid-template-columns:1fr}}
@media(max-width:560px){.footer-grid{grid-template-columns:1fr}article{padding-left:20px;padding-right:20px}}
`;

function Nav() {
  return (
    <nav className="bnav"><div className="bwrap bnav-in">
      <a className="bbrand" href={`${SITE}/`}><img src={`${SITE}/web-assets/logo.png`} alt="ShopFlix AI logo" /><span>ShopFlix<span className="ai"> AI</span></span></a>
      <div className="bnav-links">
        <a href={`${SITE}/#how`}>How it works</a>
        <a href={`${SITE}/#plans`}>Pricing</a>
        <a href="/blog">Blog</a>
        <a className="bbtn-amber" href={`${SITE}/`}>Scan your store free</a>
      </div>
    </div></nav>
  );
}

function Footer() {
  return (
    <footer className="footer"><div className="bwrap footer-grid">
      <div>
        <a className="bbrand" href={`${SITE}/`}><img src={`${SITE}/web-assets/logo.png`} alt="ShopFlix AI logo" /><span>ShopFlix<span className="ai"> AI</span></span></a>
        <p className="blurb">We scan your Shopify store the way Google&rsquo;s review does &mdash; so you get approved, stay approved, and sell more.</p>
      </div>
      <div><h5>Product</h5>
        <a href={`${SITE}/#how`}>How it works</a>
        <a href={`${SITE}/#checks`}>What we check</a>
        <a href={`${SITE}/#plans`}>Pricing</a>
        <a href="/blog">Blog</a>
        <a href="https://apps.shopify.com/shopflix-ai" target="_blank" rel="noopener">Shopify app</a>
      </div>
      <div><h5>Legal</h5>
        <a href="/privacy-policy.html">Privacy policy</a>
        <a href="/terms-of-service.html">Terms of service</a>
        <a href="/refund-policy.html">Refund policy</a>
      </div>
      <div><h5>Contact</h5>
        <a href="mailto:support@shopflixai.com">support@shopflixai.com</a>
        <p className="copy">&copy; 2026 ShopFlix AI by zSellr Enterprises LLP.<br />All rights reserved.</p>
      </div>
    </div></footer>
  );
}

export function BlogShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <Nav />
      {children}
      <Footer />
    </>
  );
}
