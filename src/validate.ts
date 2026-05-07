import type { Vendor } from './types'

const PATTERNS: Record<Vendor, RegExp> = {
  dell:   /^[A-Z0-9]{7}$/i,
  hp:     /^[A-Z0-9]{10}$/i,
  lenovo: /^[A-Z0-9]{7,12}$/i,
}

// Known HP serial prefixes (3-char alpha + digits format)
const HP_PREFIXES = /^(?:CND|5CD|6CG|MXL|CNF|TRF|SGH|XAR|VNB|GRW|3CP|JPE|CNX|CZC)/i

// Known Lenovo serial prefixes
const LENOVO_PREFIXES = /^(?:PF|R9|MP|PC|LR|YM|MJ|S[0-9])/i

export function validateSerial(serial: string, vendor: Vendor): boolean {
  return PATTERNS[vendor].test(serial.trim())
}

export function detectVendor(serial: string): Vendor | null {
  const s = serial.trim()
  const len = s.length
  if (len === 7 && PATTERNS.dell.test(s)) return 'dell'
  if ((len === 8 || len === 9) && PATTERNS.lenovo.test(s)) return 'lenovo'
  if (len === 10 && HP_PREFIXES.test(s)) return 'hp'
  if ((len === 11 || len === 12) && LENOVO_PREFIXES.test(s)) return 'lenovo'
  return null
}
