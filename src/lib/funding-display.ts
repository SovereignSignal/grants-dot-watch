import { classificationLabel } from './program-classification';

/** Preserve every recorded digit, qualifier and denomination without summing resources. */
export function fundingAmountLabel(value: Record<string, unknown>): string {
  const text = (item: unknown) => typeof item === 'string' ? item : '';
  const qualifier = value.qualifier === 'up_to' ? 'Up to ' : value.qualifier === 'approximate' ? 'Approximately ' : '';
  if (value.amount == null) return text(value.amount_text) || 'Amount not disclosed';
  const [whole, fraction] = text(value.amount).split('.');
  const amount = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : `.${fraction}`);
  const currency = text(value.currency) || (value.unit === 'currency' ? 'Currency not recorded:' : '');
  return `${qualifier}${currency} ${amount}${value.unit !== 'currency' ? ` ${text(value.unit)}` : ''}`.trim();
}

/** Reader labels for stored enums; unknown intake never becomes an open call. */
export function fundingLabel(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'Not recorded';
  const labels: Record<string, string> = {
    no_unsolicited: 'Unsolicited applications not accepted', nomination: 'By nomination',
    rolling: 'Rolling intake', rounds: 'Round-based intake', closed: 'Closed to applications',
    unknown: 'Not established', primary_supported: 'Supported by a primary source',
    recipient_reported: 'Reported by the recipient', disputed: 'Disputed evidence',
    'program-terms': 'Program terms', 'process-metrics': 'Selection and process data',
  };
  return labels[value] || classificationLabel(value.replaceAll('-', ' '));
}
