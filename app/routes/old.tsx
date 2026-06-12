import type { ActionFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../shopify.server";
import styles from "./_index/styles.module.css";

// Preserved previous website, viewable at /old after the homepage is redesigned.
export const loader = async () => {
  return { showForm: Boolean(login) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const shop = formData.get("shop");
  if (typeof shop !== "string" || !shop) {
    throw new Error("Shop parameter is required");
  }
  const url = new URL(request.url);
  url.searchParams.set("shop", shop);
  const newRequest = new Request(url.toString(), { method: request.method, headers: request.headers });
  return await login(newRequest);
};

export default function OldSite() {
  const { showForm } = useLoaderData<typeof loader>();
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>ShopFlix AI</h1>
        <p className={styles.text}>
          AI-powered product listing optimization for your Shopify store.
        </p>
        {showForm && (
          <Form className={styles.form} method="post">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Smart Product Import</strong>. Import products from Amazon, Walmart, and more with one click using AI-powered data extraction.
          </li>
          <li>
            <strong>AI-Powered Optimization</strong>. Automatically rewrite titles, descriptions, and tags to boost SEO and conversion rates.
          </li>
          <li>
            <strong>Error Detection &amp; Auto-Fix</strong>. Identify and fix product listing issues like missing images, descriptions, and barcodes.
          </li>
        </ul>
      </div>
    </div>
  );
}
