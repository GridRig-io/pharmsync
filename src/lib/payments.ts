/**
 * Payment terminal: left open on purpose.
 *
 * Today every method is recorded by hand: cash with change, and for card,
 * transfer and USSD the cashier types the reference shown on the POS slip or
 * the bank alert. When a terminal is chosen (for example Moniepoint or the
 * Paystack Terminal API), add a provider here that pushes the amount to the
 * terminal and resolves with its reference, then set ACTIVE_PROVIDER.
 */
import type { PayMethod } from './types'

export interface PaymentResult { reference: string | null }
export interface PaymentProvider {
  id: string
  label: string
  /** Connected devices show a green dot on the till. */
  connected: boolean
  /** Push the amount to the terminal and wait for approval. */
  charge?: (amount: number, method: PayMethod) => Promise<PaymentResult>
}

export const manualProvider: PaymentProvider = { id: 'manual', label: 'No terminal connected', connected: false }
export const ACTIVE_PROVIDER: PaymentProvider = manualProvider

export const METHOD_HINT: Record<PayMethod, string> = {
  cash: 'Count the change',
  card: 'Enter the POS slip reference',
  transfer: 'Check the alert, enter the reference',
  ussd: 'Check the alert, enter the reference',
}
