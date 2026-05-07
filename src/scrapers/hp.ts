import type { BrowserContext, Response } from 'playwright'
import type { VendorAdapter, WarrantyResult, WarrantyStatus } from '../types'

const SEARCH_URL = 'https://support.hp.com/us-en/check-warranty'

interface HpWarrantyData {
  warrantyStartDate?: string
  warrantyEndDate?: string
  hardwareCarePackEndDate?: string
  status?: string
  state?: string
  serviceType?: string
  warrantyTypeDescription?: string
  entitlements?: Array<{ warrantyStartDate?: string; warrantyEndDate?: string }>
}

interface HpSearchVerify {
  description?: string
  productName?: string
}

function parseDate(str: string | null | undefined): string | null {
  if (!str) return null
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
}

function latestDate(dates: (string | null | undefined)[]): string | null {
  return dates
    .map(parseDate)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1) ?? null
}

function base(serial: string, checkedAt: string, status: WarrantyStatus, extra?: Partial<WarrantyResult>): WarrantyResult {
  return { vendor: 'hp', serial, product: null, warrantyStart: null, warrantyEnd: null, status, serviceType: null, checkedAt, ...extra }
}

export const adapter: VendorAdapter = {
  vendor: 'hp',
  requiresAuth: false,

  async lookup(serial: string, ctx: BrowserContext): Promise<WarrantyResult> {
    const checkedAt = new Date().toISOString()

    let page = ctx.pages().find(p => p.url().includes('support.hp.com'))
    const isNew = !page
    if (!page) page = await ctx.newPage()

    const state: { warranty: HpWarrantyData | null; product: string | null } = {
      warranty: null,
      product: null,
    }

    const onResponse = async (res: Response) => {
      const url = res.url()
      if (url.includes('wcc-services/profile/devices/warranty/specs') && res.status() === 200) {
        try {
          const json = await res.json() as { data?: { devices?: Array<{ warranty?: { data?: HpWarrantyData } }> } }
          const data = json?.data?.devices?.[0]?.warranty?.data
          if (data) state.warranty = data
        } catch {}
      }
      if (url.includes('wcc-services/searchresult') && res.status() === 200) {
        try {
          const json = await res.json() as { data?: { verifyResponse?: { data?: HpSearchVerify } } }
          const d = json?.data?.verifyResponse?.data
          if (d) state.product = d.description ?? d.productName ?? null
        } catch {}
      }
    }

    page.on('response', onResponse)

    try {
      await page.goto(SEARCH_URL, {
        waitUntil: 'domcontentloaded',
        timeout: isNew ? 30000 : 15000,
      })
      await page.waitForSelector('#inputtextpfinder', { timeout: 10000 })
      await new Promise(r => setTimeout(r, isNew ? 500 : 200))

      await page.fill('#inputtextpfinder', serial)
      await new Promise(r => setTimeout(r, 300))
      await page.click('#FindMyProduct')

      const deadline = Date.now() + 30000
      while (!state.warranty && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 500))
      }

      page.off('response', onResponse)

      if (!state.warranty) {
        const body = (await page.textContent('body') ?? '').toLowerCase()
        const notFound = body.includes('not found') || body.includes('unable to match') || body.includes('not registered')
        return base(serial, checkedAt, notFound ? 'not_found' : 'vendor_error',
          notFound ? undefined : { error: 'No warranty data received' })
      }

      const w = state.warranty

      // statusCode 4 / state UN = unknown/not found in HP database
      if (w.state === 'UN') {
        return base(serial, checkedAt, 'not_found')
      }

      // Use latest end date across top-level and all entitlements
      const candidateEnds = [
        w.warrantyEndDate,
        w.hardwareCarePackEndDate,
        ...(w.entitlements ?? []).map(e => e.warrantyEndDate),
      ]
      const warrantyEnd = latestDate(candidateEnds)
      const warrantyStart = parseDate(w.warrantyStartDate)

      if (!warrantyEnd) {
        return base(serial, checkedAt, 'not_found', { product: state.product })
      }

      const status: WarrantyStatus =
        w.state === 'IW' ? 'active' :
        w.state === 'OW' ? 'expired' :
        new Date(warrantyEnd) > new Date() ? 'active' : 'expired'

      return {
        vendor: 'hp',
        serial,
        product: state.product,
        warrantyStart,
        warrantyEnd,
        status,
        serviceType: w.warrantyTypeDescription ?? w.serviceType ?? null,
        checkedAt,
      }

    } catch (err) {
      page.off('response', onResponse)
      await page.close().catch(() => {})
      const msg = (err instanceof Error ? err.message : String(err)).split('\n')[0]
      return base(serial, checkedAt, msg.toLowerCase().includes('timeout') ? 'rate_limited' : 'vendor_error', { error: msg })
    }
    // Page intentionally left open for reuse
  },
}
