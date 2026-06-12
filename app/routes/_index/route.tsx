import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { ClientOnly } from "../../components/ClientOnly";
// @ts-ignore - generated JSX design bundle (see app/website/site.jsx)
import SiteApp from "../../website/site.jsx";
import siteStyles from "../../website/site.css?url";

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: siteStyles },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  // Preserve the Shopify install entry point: ?shop=... goes to the embedded app.
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return null;
};

export default function Index() {
  return (
    <div id="root">
      <ClientOnly>
        <SiteApp />
      </ClientOnly>
    </div>
  );
}
