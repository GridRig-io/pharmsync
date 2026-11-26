export type Role = 'admin' | 'pharmacist' | 'inventory_officer' | 'sales'
export type MedClass = 'otc' | 'pom' | 'controlled'
export type Ven = 'vital' | 'essential' | 'non_essential'
export type BatchStatus = 'available' | 'quarantine' | 'disposed'
export type QReason = 'expired' | 'damaged' | 'recalled' | 'returned' | 'suspect' | 'failed_check' | 'other'
export type PayMethod = 'cash' | 'card' | 'transfer' | 'ussd'

export interface Pharmacy {
  id: string; name: string; short_code: string | null; address: string | null; phone: string | null
  pcn_premises_no: string | null; timezone: string; currency: string
  min_shelf_life_days: number; expiry_warning_days: number; rx_valid_days: number; rx_repeat_valid_days: number
  fridge_min_c: number; fridge_max_c: number; room_max_c: number; receipt_footer: string | null
}
export interface Staff {
  id: string; pharmacy_id: string; full_name: string | null; email: string | null; role: Role
  pcn_reg_no: string | null; is_active: boolean; created_at: string
}
export interface Shelf { id: string; pharmacy_id: string; name: string; kind: 'shelf' | 'fridge' | 'store' | 'locked_cabinet' | 'quarantine' }
export interface Supplier {
  id: string; name: string; phone: string | null; email: string | null; accepts_returns: boolean
  return_window_days: number | null; notes: string | null
}
export interface Medicine {
  id: string; name: string; strength: string | null; form: string | null; brand: string | null; unit: string
  units_per_pack: number | null; barcode: string | null; nafdac_no: string | null; greenbook_verified: boolean
  class: MedClass; ven: Ven; lasa_note: string | null; reorder_level: number; max_level: number | null
  sell_price: number; cost_price: number | null; default_shelf_id: string | null; cold_chain: boolean
  notes: string | null; archived: boolean
}
export interface StockRow extends Medicine {
  shelf_name: string | null; on_hand: number; quarantined: number; nearest_expiry: string | null
  active_batches: number; stock_status: 'out' | 'low' | 'ok'
}
export interface BatchRow {
  id: string; medicine_id: string; batch_no: string; expiry_date: string; received_date: string
  supplier_id: string | null; shelf_id: string | null; cost_price: number | null; status: BatchStatus
  quarantine_reason: QReason | null; quarantine_note: string | null; quarantined_at: string | null
  quantity: number; receive_checks: Record<string, boolean> | null; created_at: string
  medicine_name: string; strength: string | null; form: string | null; unit: string; class: MedClass
  shelf_name: string | null; supplier_name: string | null; accepts_returns: boolean | null
  return_window_days: number | null; days_left: number
}
export interface RxItem {
  id: string; prescription_id: string; medicine_id: string; directions: string | null
  qty_prescribed: number; qty_dispensed: number; patient_name: string; prescriber_name: string
  prescriber_mdcn: string; date_written: string; is_repeat: boolean; signed_at: string; signed_by: string
  medicine_name: string; strength: string | null; unit: string; valid_until: string; remaining: number
}
export interface Sale {
  id: string; number: number; customer_name: string | null; status: 'paid' | 'void'; subtotal: number
  discount: number; total: number; payment_method: PayMethod; payment_ref: string | null
  amount_tendered: number | null; change_due: number | null; cashier_id: string | null; created_at: string
  voided_at: string | null; void_reason: string | null
}
export interface SaleItem {
  id: string; sale_id: string; medicine_id: string; batch_id: string; quantity: number
  unit_price: number; line_total: number; prescription_item_id: string | null
}
export interface TempLog {
  id: string; kind: 'fridge' | 'room'; shelf_id: string | null; reading_c: number; out_of_range: boolean
  action_taken: string | null; recorded_by: string | null; recorded_at: string
}
export interface Recall {
  id: string; medicine_id: string; batch_no: string | null; reason: string; reference: string | null
  status: 'open' | 'closed'; created_at: string; closed_at: string | null
}
export type CheckKey = 'fridge' | 'room' | 'controlled' | 'quarantine' | 'expiry'
