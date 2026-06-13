/** Beoordelingsdata uit Judge.me (rating + review_widget_data metafields). */
export type ProductRating = {
  value: number; // 0–5
  count: number;
};

export function parseRating(attrs: Record<string, unknown>): ProductRating | null {
  const rating = attrs?.rating;
  const widget = attrs?.review_widget_data;
  let value = 0;
  let count = 0;
  if (typeof rating === "string" && rating.includes("value")) {
    try {
      const j = JSON.parse(rating);
      value = parseFloat(String(j.value || "0"));
    } catch {
      /* leeg */
    }
  }
  if (typeof widget === "string" && widget.includes("number_of_reviews")) {
    try {
      const j = JSON.parse(widget);
      count = Number(j.number_of_reviews) || 0;
      if (!value && j.average_rating) value = parseFloat(String(j.average_rating || "0"));
    } catch {
      /* leeg */
    }
  }
  if (!count || !value || value <= 0) return null;
  return { value, count };
}
