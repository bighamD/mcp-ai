export type ResponseFormat = "markdown" | "json";

export function moneyFromCents(value: number | null | undefined): string {
  const cents = Number(value ?? 0);
  return `¥${(cents / 100).toFixed(2)}`;
}

export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function boolMeta(total: number, offset: number, count: number) {
  const nextOffset = offset + count;
  return {
    has_more: total > nextOffset,
    next_offset: total > nextOffset ? nextOffset : null,
  };
}

