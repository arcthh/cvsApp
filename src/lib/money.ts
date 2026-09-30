export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
export function toCents(value: string | number): number {
  const text = String(value).trim();
  if (!/^\d+(\.\d{0,2})?$/.test(text))
    throw new Error("Enter a nonnegative amount with at most two decimals.");
  const [whole, fraction = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 100_000_000)
    throw new Error("Amount is too large.");
  return result;
}
export const inputMoney = (cents: number) => (cents / 100).toFixed(2);
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const uid = () => crypto.randomUUID();

export function dateAfterDays(days: number): string {
  const date = new Date(`${today()}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
