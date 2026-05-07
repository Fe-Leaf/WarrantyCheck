import { validateSerial, detectVendor } from '../validate'
import { loadSession, getSessionAgeDays } from '../session'
import { launchBrowser, newContext, closeBrowser } from '../browser'
import { getAdapter } from '../scrapers/index'
import { formatResult, print } from '../output'
import { loadConfig } from '../config'
import type { Vendor, OutputMode, WarrantyResult } from '../types'

const SPIN_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']
const LOOKUP_LIMIT = 10
const VALID_VENDORS = new Set<string>(['dell', 'hp', 'lenovo'])

interface LookupOptions {
  vendor?: string
  json?: boolean
  quiet?: boolean
  headless?: boolean
}

export async function lookupCommand(serials: string[], options: LookupOptions): Promise<void> {
  if (serials.length > LOOKUP_LIMIT) {
    print.error(`lookup supports up to ${LOOKUP_LIMIT} serials. Use "bulk" for larger batches.`)
    process.exit(1)
  }

  const mode: OutputMode = options.json ? 'json' : options.quiet ? 'quiet' : 'table'
  const headless = options.headless !== false
  const config = loadConfig()

  if (options.vendor && !VALID_VENDORS.has(options.vendor.toLowerCase())) {
    print.error(`Unknown vendor: ${options.vendor}. Supported: dell, hp, lenovo`)
    process.exit(1)
  }
  const forcedVendor = options.vendor?.toLowerCase() as Vendor | undefined

  // Validate all serials and resolve vendors before launching any browser
  const resolved: Array<{ serial: string; vendor: Vendor }> = []
  for (const serial of serials) {
    const vendor: Vendor | null = forcedVendor ?? detectVendor(serial)
    if (!vendor) {
      print.error(`Cannot auto-detect vendor for "${serial}". Use --vendor <dell|hp|lenovo>`)
      process.exit(1)
    }
    if (!validateSerial(serial, vendor)) {
      print.error(`Invalid ${vendor} serial format: "${serial}"`)
      process.exit(1)
    }
    resolved.push({ serial, vendor })
  }

  // Auth and staleness checks per vendor (once each)
  const checkedVendors = new Set<Vendor>()
  for (const { vendor } of resolved) {
    if (checkedVendors.has(vendor)) continue
    checkedVendors.add(vendor)
    const cookies = loadSession(vendor)
    const sessionAge = cookies ? getSessionAgeDays(vendor) : null
    if (sessionAge !== null && sessionAge > 1) {
      print.info(`${vendor} session cache is ${sessionAge} day(s) old — first lookup may be slower.`)
    }
  }

  // Group by vendor so each vendor reuses one browser context
  const byVendor = new Map<Vendor, string[]>()
  for (const { serial, vendor } of resolved) {
    if (!byVendor.has(vendor)) byVendor.set(vendor, [])
    byVendor.get(vendor)!.push(serial)
  }

  const results: WarrantyResult[] = []
  const showSpinner = process.stderr.isTTY && mode !== 'quiet'

  for (const [vendor, vendorSerials] of byVendor) {
    const adapter = getAdapter(vendor)
    const cookies = loadSession(vendor)
    const needsBrowser = adapter.requiresBrowser !== false
    const browser = needsBrowser ? await launchBrowser(headless) : null
    const ctx = needsBrowser ? await newContext(browser!, cookies ?? undefined) : null

    try {
      for (let i = 0; i < vendorSerials.length; i++) {
        const serial = vendorSerials[i]
        let spinIdx = 0
        const spinner = showSpinner
          ? setInterval(() => {
              process.stderr.write(`\r${SPIN_FRAMES[spinIdx++ % SPIN_FRAMES.length]} Checking ${serial}...`)
            }, 100)
          : null

        try {
          let result = await adapter.lookup(serial, ctx)
          if (result.status === 'rate_limited') {
            await new Promise(r => setTimeout(r, config.delay * 2))
            result = await adapter.lookup(serial, ctx)
          }
          if (spinner) { clearInterval(spinner); process.stderr.write('\r\x1b[K') }
          results.push(result)
        } catch (err) {
          if (spinner) { clearInterval(spinner); process.stderr.write('\r\x1b[K') }
          throw err
        }

        if (i < vendorSerials.length - 1) await new Promise(r => setTimeout(r, config.delay))
      }
    } finally {
      if (browser) await closeBrowser(browser)
    }
  }

  if (mode === 'json') {
    console.log(results.length === 1 ? JSON.stringify(results[0], null, 2) : JSON.stringify(results, null, 2))
  } else {
    for (const result of results) console.log(formatResult(result, mode))
  }

  const anyBad = results.some(r => r.status !== 'active' && r.status !== 'expired')
  if (anyBad) process.exit(1)
}
