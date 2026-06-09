import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");

  if (!productId) return json({ images: [], vendor: '' });

  const response = await admin.graphql(
    `#graphql
      query getProductImages($id: ID!) {
        product(id: $id) {
          vendor
          images(first: 30) {
            nodes {
              id
              url
              altText
            }
          }
        }
      }`,
    { variables: { id: productId } }
  );

  const data = await response.json();
  const product = data.data?.product;

  return json({
    vendor: product?.vendor || '',
    images: product?.images?.nodes || [],
  });
}
