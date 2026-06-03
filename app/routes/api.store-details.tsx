import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/** GET — return saved store details for this shop */
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.appSettings.findUnique({ where: { shop: session.shop } });
  return json({ storeDetails: (settings?.storeDetails as Record<string, string>) || {} });
}

/** POST — save store details for this shop */
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const body = await request.json();
  const storeDetails = body.storeDetails || {};

  await prisma.appSettings.upsert({
    where: { shop: session.shop },
    create: { shop: session.shop, storeDetails },
    update: { storeDetails },
  });

  return json({ success: true });
}
