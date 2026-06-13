"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track, bindFlushHandlers } from "@/lib/track-client";

/** Mount in de layout: registreert pageviews en zet de flush-handlers op. */
export function Tracker() {
  const pathname = usePathname();
  useEffect(() => {
    bindFlushHandlers();
  }, []);
  useEffect(() => {
    track("pageview", { path: pathname });
  }, [pathname]);
  return null;
}
