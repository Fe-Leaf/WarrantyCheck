import type { BrowserContext } from 'playwright'

export type Vendor = 'dell' | 'hp' | 'lenovo'

export type WarrantyStatus =
  | 'active'
  | 'expired'
  | 'not_found'
  | 'rate_limited'
  | 'vendor_error'
  | 'invalid_serial'

export interface WarrantyResult {
  vendor: Vendor
  serial: string
  product: string | null
  warrantyStart: string | null  // YYYY-MM-DD
  warrantyEnd: string | null    // YYYY-MM-DD
  status: WarrantyStatus
  serviceType: string | null
  checkedAt: string             // ISO 8601
  error?: string
}

export interface VendorAdapter {
  vendor: Vendor
  requiresAuth: boolean
  requiresBrowser?: boolean  // false = pure API, no browser launched
  lookup(serial: string, ctx: BrowserContext | null): Promise<WarrantyResult>
}

export interface Config {
  delay: number
  dellClientId?: string
  dellClientSecret?: string
}

export type OutputMode = 'table' | 'json' | 'quiet'
