/* ShopFlix AI — Price Radar visit pixel. Injected as a storefront script tag; records a
   product-page view so Price Radar can show per-product sessions on any plan. No cookies,
   no PII — just shop domain + product id. */
(function () {
  try {
    var shop = (window.Shopify && window.Shopify.shop) || "";
    var meta = (window.ShopifyAnalytics && window.ShopifyAnalytics.meta) || {};
    var pid = meta.product && meta.product.id;
    if (!shop || !pid) return; // only fire on product pages
    var url = "https://shopflixai-production.up.railway.app/api/track-visit";
    var payload = JSON.stringify({ shop: shop, productId: String(pid) });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, payload); // simple POST, no CORS preflight, survives unload
    } else {
      fetch(url, { method: "POST", body: payload, keepalive: true, headers: { "Content-Type": "text/plain" } });
    }
  } catch (e) { /* never break the storefront */ }
})();
