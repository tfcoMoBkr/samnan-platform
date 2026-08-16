// ─── Invoicing / collection state ───
// Recorded on a payment when it is collected. Shared by the payments tab, the
// projects list filter and the dashboard summary so all three always agree on
// the labels, the colours and what each state means.

export const BILLING_STATES = ['collected', 'invoiced', 'both'] as const
export type BillingState = typeof BILLING_STATES[number]

export const BILLING_LABELS: Record<string, string> = {
  collected: 'تم التحصيل',
  invoiced: 'تم الفوترة',
  both: 'تم التحصيل والفوترة',
}

/** Chip styling — border/background/text, matching the payment cards. */
export const BILLING_CHIP: Record<string, string> = {
  collected: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  invoiced: 'bg-blue-50 text-blue-700 border-blue-100',
  both: 'bg-purple-50 text-purple-700 border-purple-100',
}

/** Solid styling for the selected state of a filter chip. */
export const BILLING_CHIP_ACTIVE: Record<string, string> = {
  collected: 'bg-emerald-600 border-emerald-600 text-white',
  invoiced: 'bg-blue-600 border-blue-600 text-white',
  both: 'bg-purple-600 border-purple-600 text-white',
}

export function isBillingState(v: unknown): v is BillingState {
  return v === 'collected' || v === 'invoiced' || v === 'both'
}

/**
 * Exact match only. Per the client, the three states are independent buckets:
 * «تم التحصيل والفوترة» is its own selection and must NOT also appear under
 * «تم التحصيل» or «تم الفوترة», so each filter shows precisely what was
 * recorded on the payment and the counts never overlap.
 */
export function matchesBilling(paymentStatus: string | null | undefined, filter: BillingState): boolean {
  return !!paymentStatus && paymentStatus === filter
}
