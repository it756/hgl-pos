export function formatAmount(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatZmw(value: number): string {
  return `ZMW ${formatAmount(value)}`;
}
