import type { BrowserContext } from 'playwright'
import type { VendorAdapter, WarrantyResult, WarrantyStatus } from '../types'

const SEARCH_URL = 'https://pcsupport.lenovo.com/us/en/warranty-lookup'

interface LenovoWarranty {
  Start?: string
  End?: string
  EndDate?: string
  Status?: number
  StatusV2?: string
  Name?: string
  Description?: string
  DeliveryType?: string
  WarrentyType?: string
}

interface DsWarranties {
  ProductName?: string
  Serial?: string
  BaseWarranties?: LenovoWarranty[]
  UpmaWarranties?: LenovoWarranty[]
  EntireWarrantyPeriod?: { Start?: number; End?: number }
  RemainingDays?: number
}

function base(serial: string, checkedAt: string, status: WarrantyStatus, extra?: Partial<WarrantyResult>): WarrantyResult {
  return { vendor: 'lenovo', serial, product: null, warrantyStart: null, warrantyEnd: null, status, serviceType: null, checkedAt, ...extra }
}

function tsToDate(ts: number | undefined): string | null {
  if (!ts) return null
  const d = new Date(ts)
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
}

function parseDate(str: string | null | undefined): string | null {
  if (!str) return null
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
}

export const adapter: VendorAdapter = {
  vendor: 'lenovo',
  requiresAuth: false,

  async lookup(serial: string, ctx: BrowserContext): Promise<WarrantyResult> {
    const checkedAt = new Date().toISOString()

    let page = ctx.pages().find(p => p.url().includes('pcsupport.lenovo.com'))
    const isNew = !page
    if (!page) page = await ctx.newPage()

    try {
      await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: isNew ? 30000 : 15000 })
      await page.waitForSelector('.button-placeholder__input', { timeout: 10000 })
      await new Promise(r => setTimeout(r, isNew ? 500 : 200))

      await page.fill('.button-placeholder__input', serial)
      await new Promise(r => setTimeout(r, 300))
      await page.click('button.basic-search__suffix-btn')

      // Wait for page to navigate away from warranty-lookup (to product warranty page)
      const deadline = Date.now() + 20000
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 500))
        const url = page.url()
        if (!url.includes('warranty-lookup')) break
      }

      // If still on warranty-lookup, serial was not found
      if (page.url().includes('warranty-lookup')) {
        const body = (await page.textContent('body') ?? '').toLowerCase()
        const notFound = body.includes('no result') || body.includes('not found') || body.includes('unable to find') || body.includes('invalid')
        return base(serial, checkedAt, notFound ? 'not_found' : 'vendor_error',
          notFound ? undefined : { error: 'No navigation after form submit' })
      }

      // Wait for ds_warranties to be populated
      const dsWarranties = await page.waitForFunction(
        () => (window as any).ds_warranties && (window as any).ds_warranties.EntireWarrantyPeriod !== undefined,
        { timeout: 15000 }
      ).then(() => page!.evaluate(() => (window as any).ds_warranties as DsWarranties))
        .catch(() => null)

      if (!dsWarranties) {
        return base(serial, checkedAt, 'vendor_error', { error: 'ds_warranties not populated' })
      }

      const allWarranties = [...(dsWarranties.BaseWarranties ?? []), ...(dsWarranties.UpmaWarranties ?? [])]

      if (allWarranties.length === 0 && !dsWarranties.EntireWarrantyPeriod?.End) {
        return base(serial, checkedAt, 'not_found', { product: dsWarranties.ProductName ?? null })
      }

      const warrantyEnd = tsToDate(dsWarranties.EntireWarrantyPeriod?.End) ??
        allWarranties.map(w => parseDate(w.End ?? w.EndDate)).filter(Boolean).sort().at(-1) ?? null
      const warrantyStart = tsToDate(dsWarranties.EntireWarrantyPeriod?.Start) ??
        parseDate(allWarranties[0]?.Start ?? null)

      if (!warrantyEnd) {
        return base(serial, checkedAt, 'not_found', { product: dsWarranties.ProductName ?? null })
      }

      const status: WarrantyStatus = (dsWarranties.RemainingDays ?? 0) > 0 ? 'active' :
        new Date(warrantyEnd) > new Date() ? 'active' : 'expired'

      // Use the highest-value warranty name as serviceType
      const latestWarranty = allWarranties
        .filter(w => parseDate(w.End ?? w.EndDate) === warrantyEnd)
        .at(0) ?? allWarranties.at(-1)

      return {
        vendor: 'lenovo',
        serial,
        product: dsWarranties.ProductName ?? null,
        warrantyStart,
        warrantyEnd,
        status,
        serviceType: latestWarranty?.Name ?? null,
        checkedAt,
      }

    } catch (err) {
      await page.close().catch(() => {})
      const msg = (err instanceof Error ? err.message : String(err)).split('\n')[0]
      const isRetryable = msg.toLowerCase().includes('timeout') || msg.includes('ERR_HTTP2') || msg.includes('ERR_CONNECTION')
      return base(serial, checkedAt, isRetryable ? 'rate_limited' : 'vendor_error', { error: msg })
    }
    // Page intentionally left open for reuse
  },
}
