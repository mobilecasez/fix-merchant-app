import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
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
  const data = useLoaderData<typeof loader>();

  return (
    <div style={{ 
      display: "flex", 
      justifyContent: "center", 
      alignItems: "center", 
      height: "100vh", 
      fontFamily: "system-ui, -apple-system, sans-serif" 
    }}>
      {/* 🔥 THE CRASH FIX 🔥 
         This script runs before Remix hydration. If history.state is missing
         (which happens after a hard redirect), it creates a fake one. 
         This stops the "null is not an object" error.
      */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            if (!window.history.state) {
              window.history.replaceState({ key: "default" }, "");
            }
          `,
        }}
      />

      <div style={{ width: "300px", textAlign: "center" }}>
        <h1 style={{ fontSize: "20px", marginBottom: "20px" }}>Welcome Back</h1>
        
        {/* We use a standard HTML <form> instead of Remix <Form> to avoid client-side routing issues here */}
        <form method="post">
          <label style={{ display: "block", marginBottom: "10px", textAlign: "left" }}>
            Shop Domain
            <input 
              type="text" 
              name="shop" 
              placeholder="example.myshopify.com"
              required
              style={{ 
                width: "100%", 
                padding: "8px", 
                marginTop: "5px",
                border: "1px solid #ccc",
                borderRadius: "4px"
              }}
            />
          </label>
          
          <button 
            type="submit"
            style={{
              width: "100%",
              padding: "10px",
              backgroundColor: "#008060",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold"
            }}
          >
            Log In
          </button>
        </form>

        {data && 'error' in data && (
           <p style={{ color: "red", marginTop: "10px" }}>{data.error}</p>
        )}
      </div>
    </div>
  );
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const shop = formData.get("shop") as string;
  
  if (typeof shop === "string" && shop.length > 0) {
    return await login(request); 
  }
  
  return json({ error: "Invalid Shop Domain" });
};
