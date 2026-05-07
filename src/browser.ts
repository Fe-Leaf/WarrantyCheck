import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser, BrowserContext, Cookie } from 'playwright'

chromium.use(StealthPlugin())

export async function launchBrowser(headless = true): Promise<Browser> {
  return chromium.launch({ headless }) as Promise<Browser>
}

export async function newContext(browser: Browser, cookies?: Cookie[]): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  })
  if (cookies?.length) await ctx.addCookies(cookies)
  return ctx
}

export async function closeBrowser(browser: Browser): Promise<void> {
  await browser.close()
}
