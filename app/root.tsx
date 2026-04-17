import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  isRouteErrorResponse,
} from "@remix-run/react";

export default function App() {
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
        <link rel="icon" type="image/svg+xml" href="/logo-ai-modern-alt.svg" />
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
