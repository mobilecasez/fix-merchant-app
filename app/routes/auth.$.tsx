import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { authenticate, login } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  
  // 1. If we are already authenticated, go straight to the app
  // This prevents the "{}" dead end if a user loops back here by mistake.
  if (url.pathname === "/auth/login") {
    try {
      const { session } = await authenticate.admin(request);
      if (session) {
        return redirect(`/app?shop=${shop || session.shop}`);
      }
    } catch (error) {
      // If authenticate throws (meaning not auth'd), that's fine, we proceed to login logic
    }

    // 2. If we have a 'shop' param, allow the standard login helper to do its job
    if (shop) {
      return await login(request);
    }

    // 3. Fallback: If no shop param and not auth'd, return a basic UI
    // This prevents the raw JSON "{}" response if the params are missing.
    return json({ showForm: true });
  }
  
  // For all other auth paths, use authenticate.admin()
  await authenticate.admin(request);

  return null;
};

// 4. Ensure there is a Default Export (Component)
// If the loader returns JSON, this ensures we see a Form, not "{}"
export default function AuthLogin() {
  // Simple HTML-only component to avoid any client-side hydration issues
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <title>Sign In</title>
      </head>
      <body style={{ padding: "50px", textAlign: "center", fontFamily: "system-ui" }}>
        <h1>Sign In</h1>
        <p>Please enter your shop domain to continue.</p>
        <form method="post" action="/auth/login">
          <input 
            type="text" 
            name="shop" 
            placeholder="my-shop.myshopify.com" 
            style={{ padding: "10px", marginRight: "10px" }} 
          />
          <button type="submit" style={{ padding: "10px 20px" }}>
            Log In
          </button>
        </form>
      </body>
    </html>
  );
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const shop = formData.get("shop") as string;
  
  // Simple validation to ensure 'myshopify.com' is present
  const cleanShop = shop?.replace("https://", "").replace("http://", "");
  
  if (cleanShop) {
    return await login(request); 
  }
  
  return json({ error: "Invalid Shop Domain" });
};
