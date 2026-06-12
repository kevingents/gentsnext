"use client";

import { useState } from "react";

export function Accordion({
  items,
}: {
  items: { title: string; content: React.ReactNode }[];
}) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="border-t border-line">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.title} className="border-b border-line">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between py-4 text-left font-sans text-sm font-medium"
            >
              {item.title}
              <span aria-hidden className="text-muted">
                {isOpen ? "–" : "+"}
              </span>
            </button>
            {isOpen ? <div className="pb-5">{item.content}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
