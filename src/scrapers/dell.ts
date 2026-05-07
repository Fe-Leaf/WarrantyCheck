import type { BrowserContext, Response } from 'playwright'
import type { VendorAdapter, WarrantyResult, WarrantyStatus } from '../types'
import { saveSession } from '../session'
import { loadConfig } from '../config'

// --- TechDirect API ---
const TOKEN_URL        = 'https://apigtwb2c.us.dell.com/auth/oauth/v2/token'
const ENTITLEMENTS_URL = 'https://apigtwb2c.us.dell.com/PROD/sbil/eapi/v5/asset-entitlements'

function getCredentials(): { clientId: string; clientSecret: string } | null {
  const config = loadConfig()
  const clientId = config.dellClientId
  const clientSecret = config.dellClientSecret
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

interface DellToken { access_token: string; expires_at: number }
interface DellEntitlement { startDate?: string; endDate?: string; serviceLevelDescription?: string }
interface DellAsset { productLineDescription?: string; shipDate?: string; entitlements?: DellEntitlement[] }

let cachedToken: DellToken | null = null

async function getToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires_at) return cachedToken.access_token
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  })
  if (!res.ok) throw new Error(`Dell auth failed: ${res.status}`)
  const data = await res.json() as { access_token: string; expires_in: number }
  cachedToken = { access_token: data.access_token, expires_at: Date.now() + (data.expires_in - 60) * 1000 }
  return cachedToken.access_token
}

async function apiLookup(serial: string): Promise<WarrantyResult | null> {
  const creds = getCredentials()
  if (!creds) return null
  try {
    const token = await getToken(creds.clientId, creds.clientSecret)
    const res = await fetch(`${ENTITLEMENTS_URL}?servicetags=${encodeURIComponent(serial)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    // 401/403/429 → fall back to scraper
    if (res.status === 401 || res.status === 403 || res.status === 429) return null
    if (!res.ok) return null

    const assets = await res.json() as DellAsset[]
    const asset = assets?.[0]
    if (!asset?.entitlements?.length) return null

    const best = asset.entitlements
      .filter(e => e.endDate)
      .sort((a, b) => (a.endDate! > b.endDate! ? 1 : -1))
      .at(-1)

    const warrantyEnd = parseDate(best?.endDate)
    if (!warrantyEnd) return null

    const warrantyStart = parseDate(best?.startDate ?? asset.shipDate)
    const checkedAt = new Date().toISOString()
    return {
      vendor: 'dell', serial,
      product: asset.productLineDescription ?? null,
      warrantyStart, warrantyEnd,
      status: new Date(warrantyEnd) > new Date() ? 'active' : 'expired',
      serviceType: best?.serviceLevelDescription ?? null,
      checkedAt,
    }
  } catch {
    return null
  }
}

// --- Playwright scraper fallback ---
const SEARCH_URL = 'https://www.dell.com/support/contractservices/en-us'

interface DellWarrantyResponse {
  warrantyDisplayName?: string
  warrantyStartDate?: string
  warrantyEndDate?: string
  warrantyStartDateUtc?: string | null
  warrantyEndDateUtc?: string | null
  onSupport?: boolean
}

async function browserApiLookup(page: Awaited<ReturnType<BrowserContext['newPage']>>, serial: string): Promise<DellWarrantyResponse | null> {
  return page.evaluate(async (tag: string) => {
    const encRes = await fetch(`/support/components/detectproduct/encvalue/${tag}?appname=warranty`)
    if (!encRes.ok) return null
    const encValue = await encRes.text()
    const wRes = await fetch('/support/contractservices/en-us/entitlement/contractservicesapi/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetFormat: 'servicetag', assetId: encValue, appName: 'home' }),
    })
    if (!wRes.ok) return null
    return wRes.json()
  }, serial)
}

async function scraperLookup(serial: string, ctx: BrowserContext): Promise<WarrantyResult> {
  const checkedAt = new Date().toISOString()
  let page = ctx.pages().find(p => p.url().includes('contractservices'))
  const isNew = !page
  if (!page) page = await ctx.newPage()

  const state: { warranty: DellWarrantyResponse | null; product: string | null } = { warranty: null, product: null }

  try {
    if (!isNew) {
      const data = await browserApiLookup(page, serial)
      if (!data) return base(serial, checkedAt, 'vendor_error', { error: 'Direct fetch failed' })
      state.warranty = data
    } else {
      const hasCookies = (await ctx.cookies()).length > 0
      if (hasCookies) {
        await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
        const data = await browserApiLookup(page, serial)
        if (!data) return base(serial, checkedAt, 'vendor_error', { error: 'Direct fetch failed' })
        state.warranty = data
        const cookies = await ctx.cookies()
        if (cookies.length) saveSession('dell', cookies)
      } else {
        const onResponse = async (res: Response) => {
          const url = res.url()
          if (url.includes('contractservicesapi/v1') && res.status() === 200) {
            try { state.warranty = await res.json() as DellWarrantyResponse } catch {}
          }
          if (url.includes('getrvps') && res.status() === 200) {
            try {
              const d = await res.json() as { RecentlyViewedList?: Array<{ ServiceTag: string; ProductName: string }> }
              const match = (d?.RecentlyViewedList ?? []).find(p => p.ServiceTag?.toUpperCase() === serial.toUpperCase())
              if (match) state.product = match.ProductName ?? null
            } catch {}
          }
        }
        page.on('response', onResponse)
        await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await page.waitForSelector('#homemfe-dropdown-input', { timeout: 10000 })
        await new Promise(r => setTimeout(r, 800))
        await page.fill('#homemfe-dropdown-input', serial)
        await new Promise(r => setTimeout(r, 400))
        await page.evaluate(() => {
          const btn = document.querySelector<HTMLButtonElement>('#btnSubmit')
          btn?.click()
        })
        const deadline = Date.now() + 65000
        while (!state.warranty && Date.now() < deadline) await new Promise(r => setTimeout(r, 1000))
        if (state.warranty && !state.product) {
          const productDeadline = Date.now() + 3000
          while (!state.product && Date.now() < productDeadline) await new Promise(r => setTimeout(r, 500))
        }
        page.off('response', onResponse)
        const cookies = await ctx.cookies()
        if (cookies.length) saveSession('dell', cookies)
      }
    }

    if (!state.warranty) {
      const body = (await page.textContent('body') ?? '').toLowerCase()
      const notFound = body.includes('not found') || body.includes('no results') || body.includes('unable to find')
      return base(serial, checkedAt, notFound ? 'not_found' : 'vendor_error',
        notFound ? undefined : { error: 'No warranty data received' })
    }

    const w = state.warranty
    const warrantyEnd = parseDate(w.warrantyEndDateUtc ?? w.warrantyEndDate)
    const warrantyStart = parseDate(w.warrantyStartDateUtc ?? w.warrantyStartDate)
    if (!warrantyEnd) return base(serial, checkedAt, 'not_found', { product: state.product })

    const status: WarrantyStatus =
      w.onSupport === true ? 'active' :
      w.onSupport === false ? 'expired' :
      new Date(warrantyEnd) > new Date() ? 'active' : 'expired'

    return {
      vendor: 'dell', serial,
      product: state.product,
      warrantyStart, warrantyEnd, status,
      serviceType: w.warrantyDisplayName ?? null,
      checkedAt,
    }
  } catch (err) {
    await page.close().catch(() => {})
    const msg = (err instanceof Error ? err.message : String(err)).split('\n')[0]
    return base(serial, checkedAt, msg.toLowerCase().includes('timeout') ? 'rate_limited' : 'vendor_error', { error: msg })
  }
}

// --- Shared helpers ---
function parseDate(str: string | null | undefined): string | null {
  if (!str) return null
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
}

function base(serial: string, checkedAt: string, status: WarrantyStatus, extra?: Partial<WarrantyResult>): WarrantyResult {
  return { vendor: 'dell', serial, product: null, warrantyStart: null, warrantyEnd: null, status, serviceType: null, checkedAt, ...extra }
}

// --- Adapter ---
export const adapter: VendorAdapter = {
  vendor: 'dell',
  requiresAuth: false,
  requiresBrowser: true,

  async lookup(serial: string, ctx: BrowserContext | null): Promise<WarrantyResult> {
    const result = await apiLookup(serial)
    if (result) return result
    return scraperLookup(serial, ctx!)
  },
}
