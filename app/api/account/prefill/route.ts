import { NextResponse } from "next/server";
import { getSessionCustomer, getCustomerAddresses } from "@/lib/account";

export const dynamic = "force-dynamic";

/** Checkout-prefill: gegevens + opgeslagen adressen van de ingelogde klant. */
export async function GET() {
  const c = await getSessionCustomer();
  if (!c) return NextResponse.json({ loggedIn: false });

  const addresses = await getCustomerAddresses(c.id);
  return NextResponse.json({
    loggedIn: true,
    email: c.email,
    firstName: c.firstName,
    lastName: c.lastName,
    phone: c.phone,
    defaultAddressId: addresses[0]?.id ?? null,
    addresses: addresses.map((a) => ({
      id: a.id,
      label: a.label,
      firstName: a.firstName,
      lastName: a.lastName,
      street: a.street,
      houseNumber: a.houseNumber,
      postalCode: a.postalCode,
      city: a.city,
    })),
  });
}
