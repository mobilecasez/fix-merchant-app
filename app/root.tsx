import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  isRouteErrorResponse,
} from "@remix-run/react";
import { useEffect } from "react";

const CHUNK_RELOAD_KEY = "shopflix_reloaded_after_chunk_error";

export default function App() {
  // Clear the chunk-error reload guard once the app renders successfully, so a
  // future deploy in the same session can auto-recover again.
  useEffect(() => {
    try { sessionStorage.removeItem(CHUNK_RELOAD_KEY); } catch { /* no-op */ }
  }, []);

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <link rel="icon" href="/favicon.ico?v=2" sizes="any" />
        <link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png?v=2" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=2" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png?v=2" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=2" />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  // Auto-recover from stale-bundle errors after a deploy: when the client tries
  // to load a route chunk whose filename changed in a new deploy, the dynamic
  // import fails and bubbles to this root boundary. Reload ONCE (guarded against
  // loops) to fetch the fresh bundle, turning a scary error into a silent retry.
  useEffect(() => {
    if (isRouteErrorResponse(error)) return;
    if (typeof window === "undefined") return;
    const msg = (error instanceof Error ? `${error.message} ${error.name}` : String(error || "")).toLowerCase();
    const isChunkError = /dynamically imported module|loading chunk|importing a module script failed|module script failed|failed to fetch|chunkloaderror/.test(msg);
    if (!isChunkError) return;
    try {
      if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
        window.location.reload();
      }
    } catch { /* no-op */ }
  }, [error]);

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>ShopFlix AI - Error</title>
        <Meta />
        <Links />
      </head>
      <body style={{ fontFamily: "Inter, sans-serif", padding: "2rem", textAlign: "center" }}>
        <h1>{isRouteErrorResponse(error) ? `${error.status} - ${error.statusText}` : "Something went wrong"}</h1>
        <p>{isRouteErrorResponse(error) ? error.data : "An unexpected error occurred. Please try again."}</p>
        <a href="/" style={{ color: "#008060", textDecoration: "underline" }}>Go back to home</a>
        <Scripts />
      </body>
    </html>
  );
}
