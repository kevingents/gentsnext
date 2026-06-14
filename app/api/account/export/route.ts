import { getSessionCustomer } from "@/lib/account";
import { exportOrders, exportCustomers } from "@/lib/reports";

export const dynamic = "force-dynamic";

/**
 * Admin-only CSV-export van orders of klanten. Respecteert dezelfde filters als
 * het overzicht (q/status/channel/from/to). Excel-vriendelijk (BOM + puntkomma).
 */
export async function GET(req: Request) {
  const customer = await getSessionCustomer();
  if (!customer?.isAdmin) return new Response("Geen toegang", { status: 403 });

  const url = new URL(req.url);
  const type = url.searchParams.get("type") === "customers" ? "customers" : "orders";
  const stamp = new Date().toISOString().slice(0, 10);

  let csv: string;
  let name: string;
  if (type === "customers") {
    csv = await exportCustomers({ search: url.searchParams.get("q") || undefined });
    name = `klanten-${stamp}.csv`;
  } else {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    csv = await exportOrders({
      search: url.searchParams.get("q") || undefined,
      status: url.searchParams.get("status") || undefined,
      channel: (url.searchParams.get("channel") as "online" | "import" | "") || "",
      from: from ? new Date(from + "T00:00:00") : undefined,
      to: to ? new Date(to + "T23:59:59") : undefined,
    });
    name = `orders-${stamp}.csv`;
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
