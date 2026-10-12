/** Preserve the recorded quantity, qualifier and denomination without summing resources. */
export function fundingAmountLabel(value: Record<string, unknown>): string {
  const text = (item: unknown) => typeof item === 'string' ? item : '';
  const qualifier = value.qualifier === 'up_to' ? 'Up to ' : value.qualifier === 'approximate' ? 'Approximately ' : '';
  if (value.amount == null) return text(value.amount_text) || 'Amount not disclosed';
  return `${qualifier}${text(value.currency)} ${text(value.amount)}${value.unit !== 'currency' ? ` ${text(value.unit)}` : ''}`.trim();
}
