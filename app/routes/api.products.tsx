// app/routes/api.products.tsx

import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';

const MAX_PRODUCTS_PER_PAGE = 250;

interface Product {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
}

const fetchAllProductsRecursively = async (admin: any, cursor: string | null = null): Promise<Product[]> => {
  const response = await admin.graphql(
    `#graphql
      query allProducts($first: Int!, $cursor: String) {
        products(first: $first, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            title
            handle
            descriptionHtml
          }
        }
      }`,
    {
      variables: {
        first: MAX_PRODUCTS_PER_PAGE,
        cursor: cursor,
      },
    },
  );

  const data = await response.json();

  if (data.errors) {
    console.error("GraphQL Errors:", data.errors);
    throw new Error("Failed to fetch products from Shopify.");
  }

  const products = data.data.products.nodes;
  const pageInfo = data.data.products.pageInfo;

  if (pageInfo.hasNextPage) {
    const nextProducts = await fetchAllProductsRecursively(admin, pageInfo.endCursor);
    return [...products, ...nextProducts];
  } else {
    return products;
  }
};

export async function loader({ request }: { request: Request }) {
  const { session, admin } = await authenticate.admin(request);

  if (!session) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const allProducts = await fetchAllProductsRecursively(admin);
    return json({ products: allProducts });
  } catch (error: any) {
    console.error("Error fetching products:", error);
    return json({ error: 'Failed to fetch products', details: error.message }, { status: 500 });
  }
}
