import { adapter as dellAdapter } from './dell'
import { adapter as hpAdapter } from './hp'
import { adapter as lenovoAdapter } from './lenovo'
import type { Vendor, VendorAdapter } from '../types'

export const SUPPORTED_VENDORS: Array<{ vendor: Vendor; requiresAuth: boolean; description: string }> = [
  { vendor: 'dell',   requiresAuth: false, description: 'Dell service tag lookup' },
  { vendor: 'hp',     requiresAuth: false, description: 'HP serial number lookup' },
  { vendor: 'lenovo', requiresAuth: false, description: 'Lenovo serial number lookup' },
]

const ADAPTERS: Record<Vendor, VendorAdapter> = {
  dell:   dellAdapter,
  hp:     hpAdapter,
  lenovo: lenovoAdapter,
}

export function getAdapter(vendor: Vendor): VendorAdapter {
  return ADAPTERS[vendor]
}
