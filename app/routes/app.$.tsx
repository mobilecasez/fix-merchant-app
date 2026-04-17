import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Catch-all route for unknown /app/* paths — redirect to app home
  return redirect("/app");
};
