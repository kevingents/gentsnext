import { getSessionCustomer, exportMyData } from "@/lib/account";

export const dynamic = "force-dynamic";

/** AVG-inzage: de ingelogde klant downloadt al zijn gegevens als JSON. */
export async function GET() {
  const customer = await getSessionCustomer();
  if (!customer) return new Response("Niet ingelogd", { status: 401 });

  const data = await exportMyData(customer.id, customer.email);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="gents-mijn-gegevens-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
