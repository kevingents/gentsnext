import { NextResponse } from "next/server";
import { logout } from "@/lib/account";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export async function POST() {
  await logout();
  return NextResponse.redirect(`${getSiteUrl()}/`, { status: 303 });
}
