import fs from 'fs'
import chalk from 'chalk'
import ExcelJS from 'exceljs'
import { MultiBar, Presets } from 'cli-progress'
import { readCsv, appendCsvRow, readExistingSerials, rewriteCsvOrdered } from '../csv'
import { writeXlsxResults } from '../xlsx'
import { loadProfiles, getProfile } from '../profiles'
import { validateSerial, detectVendor } from '../validate'
import { loadSession, getSessionAgeDays } from '../session'
import { launchBrowser, newContext, closeBrowser } from '../browser'
import { getAdapter } from '../scrapers/index'
import { colorStatus, printBulkSummary, print } from '../output'
import { loadConfig } from '../config'
import type { Vendor, WarrantyResult } from '../types'

const VALID_VENDORS = new Set<string>(['dell', 'hp', 'lenovo'])

interface BulkOptions {
  output: string
  json?: boolean
  delay?: string
  vendor?: string
  headless?: boolean
  serialCol?: string
  vendorCol?: string
  profile?: string
  all?: boolean
}

interface ProfileLike {
  name: string
  file: string
  serialCol: string
  vendorCol: string | null
}

export async function bulkCommand(file: string | undefined, options: BulkOptions): Promise<void> {
  const sourceCount = [file, options.profile, options.all].filter(Boolean).length
  if (sourceCount === 0) {
    print.error('Provide a file, --profile <name>, or --all')
    process.exit(1)
  }
  if (sourceCount > 1) {
    print.error('Provide exactly one of: file, --profile, or --all')
    process.exit(1)
  }

  if (options.all) {
    const profiles = loadProfiles()
    if (!profiles.length) {
      print.info('No profiles saved. Add one with: warrantycheck profile add')
      return
    }
    let completed = 0
    let skipped = 0
    for (const p of profiles) {
      console.log(chalk.bold(`\n→ Profile: ${p.name}`))
      const result = await runXlsxBulk(p, options)
      if (result.skipped) skipped++
      else completed++
    }
    console.log(`\n${chalk.bold('All profiles:')} ${completed} completed, ${skipped} skipped`)
    return
  }

  if (options.profile) {
    const p = getProfile(options.profile)
    if (!p) {
      print.error(`Profile '${options.profile}' not found. Run: warrantycheck profile list`)
      process.exit(1)
    }
    await runXlsxBulk(p, options)
    return
  }

  if (file!.endsWith('.xlsx')) {
    if (!options.serialCol) {
      print.error('--serial-col <name> is required when using an xlsx file')
      process.exit(1)
    }
    await runXlsxBulk({ name: file!, file: file!, serialCol: options.serialCol, vendorCol: options.vendorCol ?? null }, options)
    return
  }

  // CSV mode
  await runCsvBulk(file!, options)
}

async function runXlsxBulk(profile: ProfileLike, options: BulkOptions): Promise<{ checked: number; skipped: boolean }> {
  if (!fs.existsSync(profile.file)) {
    print.warn(`File not found for '${profile.name}': ${profile.file}. Skipping.`)
    return { checked: 0, skipped: true }
  }

  if (options.output && options.output !== 'warranty-results.csv') {
    print.warn('--output is ignored when writing back to xlsx files. Results are written to the source file.')
  }

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(profile.file)
  const ws = wb.worksheets[0]

  // Scan up to the first 10 rows to find the header row (Pages exports add a table-name row before headers)
  let headerRowNum = 0
  const headers: Record<string, number> = {}
  const target = profile.serialCol.toLowerCase()
  ws.eachRow((row, rowNum) => {
    if (headerRowNum || rowNum > 10) return
    const candidate: Record<string, number> = {}
    row.eachCell((cell, col) => { candidate[String(cell.value ?? '').toLowerCase()] = col })
    if (candidate[target]) { Object.assign(headers, candidate); headerRowNum = rowNum }
  })

  const serialColIdx = headers[target]
  if (!serialColIdx) {
    const cols = Object.keys(headers).join(', ')
    print.error(`Serial column "${profile.serialCol}" not found. Available: ${cols}`)
    process.exit(1)
  }
  const vendorColIdx = profile.vendorCol ? headers[profile.vendorCol.toLowerCase()] : undefined
  const rawRows: Array<{ serial: string; vendor?: string }> = []
  ws.eachRow((row, rowNum) => {
    if (rowNum <= headerRowNum) return
    const serial = String(row.getCell(serialColIdx).value ?? '').trim()
    if (!serial) return
    const vendor = vendorColIdx ? String(row.getCell(vendorColIdx).value ?? '').trim() : undefined
    rawRows.push({ serial, vendor: vendor || undefined })
  })

  const config = loadConfig()
  const delay = options.delay !== undefined ? parseInt(options.delay, 10) : config.delay
  const headless = options.headless !== false
  const forcedVendor = options.vendor?.toLowerCase() as Vendor | undefined

  const toProcess: Array<{ serial: string; vendor: Vendor }> = []
  const xlsxResults: WarrantyResult[] = []

  for (const row of rawRows) {
    const serial = row.serial
    const rowVendor = row.vendor?.toLowerCase()
    const vendorStr = forcedVendor ?? (rowVendor && VALID_VENDORS.has(rowVendor) ? rowVendor as Vendor : null)
    const vendor: Vendor | null = vendorStr ?? detectVendor(serial)

    if (!vendor || !validateSerial(serial, vendor)) {
      xlsxResults.push({
        vendor: vendor ?? 'dell', serial, product: null, warrantyStart: null, warrantyEnd: null,
        status: 'invalid_serial', serviceType: null, checkedAt: new Date().toISOString(),
        error: vendor ? undefined : 'Cannot auto-detect vendor',
      })
      continue
    }

    toProcess.push({ serial, vendor })
  }


  if (!toProcess.length) {
    print.info('No serials to process.')
    if (xlsxResults.length) await writeXlsxResults(profile.file, profile.serialCol, xlsxResults)
    return { checked: 0, skipped: false }
  }

  const byVendor = new Map<Vendor, string[]>()
  for (const { serial, vendor } of toProcess) {
    if (!byVendor.has(vendor)) byVendor.set(vendor, [])
    byVendor.get(vendor)!.push(serial)
  }

  if (!options.json) {
    const vendorSummary = [...byVendor.entries()].map(([v, s]) => `${v}: ${s.length}`).join(', ')
    console.log(chalk.bold(`\n→ Checking ${toProcess.length} serial${toProcess.length !== 1 ? 's' : ''} (${vendorSummary})`))
  }

  const startTime = Date.now()

  const multibar = options.json ? null : new MultiBar({
    clearOnComplete: false,
    hideCursor: true,
    format: '[{vendor}] {bar} {value}/{total} | {serial} → {status}',
  }, Presets.shades_grey)

  await Promise.allSettled([...byVendor.entries()].map(async ([vendor, serials]) => {
    const adapter = getAdapter(vendor)
    const cookies = loadSession(vendor) ?? undefined
    const needsBrowser = adapter.requiresBrowser !== false
    const browser = needsBrowser ? await launchBrowser(headless) : null
    const ctx = needsBrowser ? await newContext(browser!, cookies) : null
    const bar = multibar?.create(serials.length, 0, { vendor: vendor.padEnd(6), serial: '...', status: '' })

    try {
      for (let i = 0; i < serials.length; i++) {
        const serial = serials[i]
        bar?.update(i + 1, { vendor: vendor.padEnd(6), serial, status: chalk.dim('checking...') })
        let result = await adapter.lookup(serial, ctx)

        if (result.status === 'rate_limited') {
          await new Promise(r => setTimeout(r, delay * 2))
          result = await adapter.lookup(serial, ctx)
        }

        xlsxResults.push(result)

        bar?.update(i + 1, {
          vendor: vendor.padEnd(6),
          serial: result.serial,
          status: colorStatus(result.status),
        })

        if (i < serials.length - 1) await new Promise(r => setTimeout(r, delay))
      }
    } finally {
      if (browser) await closeBrowser(browser)
    }
  }))

  multibar?.stop()

  await writeXlsxResults(profile.file, profile.serialCol, xlsxResults)
  printBulkSummary(xlsxResults, Date.now() - startTime)
  console.log(`\nResults written back to: ${profile.file}`)
  return { checked: xlsxResults.length, skipped: false }
}

async function runCsvBulk(input: string, options: BulkOptions): Promise<void> {
  if (options.vendor && !VALID_VENDORS.has(options.vendor.toLowerCase())) {
    print.error(`Unknown vendor: ${options.vendor}. Supported: dell, hp, lenovo`)
    process.exit(1)
  }

  let rows: Array<{ serial: string; vendor?: string }>
  try {
    rows = readCsv(input)
  } catch {
    print.error(`Cannot read input file: ${input}`)
    process.exit(1)
  }

  if (!rows.length || !Object.prototype.hasOwnProperty.call(rows[0], 'serial')) {
    print.error('Input CSV must have a "serial" column')
    process.exit(1)
  }

  const config = loadConfig()
  const delay = options.delay !== undefined ? parseInt(options.delay, 10) : config.delay
  const headless = options.headless !== false
  const outputPath = options.output
  const forcedVendor = options.vendor?.toLowerCase() as Vendor | undefined

  const inputOrder = new Map<string, number>()
  rows.forEach((r, i) => { if (r.serial?.trim()) inputOrder.set(r.serial.trim().toLowerCase(), i) })

  const existingSerials = options.json ? new Set<string>() : readExistingSerials(outputPath)
  const immediateResults: WarrantyResult[] = []
  const toProcess: Array<{ serial: string; vendor: Vendor }> = []

  for (const row of rows) {
    const serial = row.serial?.trim()
    if (!serial || existingSerials.has(serial.toLowerCase())) continue

    const rowVendor = row.vendor?.trim().toLowerCase()
    const vendorStr = forcedVendor ?? (rowVendor && VALID_VENDORS.has(rowVendor) ? rowVendor as Vendor : null)
    const vendor: Vendor | null = vendorStr ?? detectVendor(serial)

    if (!vendor || !validateSerial(serial, vendor)) {
      const r: WarrantyResult = {
        vendor: vendor ?? 'dell', serial, product: null, warrantyStart: null, warrantyEnd: null,
        status: 'invalid_serial', serviceType: null, checkedAt: new Date().toISOString(),
        error: vendor ? undefined : 'Cannot auto-detect vendor',
      }
      if (!options.json) appendCsvRow(outputPath, r)
      immediateResults.push(r)
      continue
    }

    toProcess.push({ serial, vendor })
  }

  for (const vendor of new Set(toProcess.map(r => r.vendor))) {
    const age = loadSession(vendor) ? getSessionAgeDays(vendor) : null
    if (age === null) continue
    if (age > 1) {
      print.info(`${vendor} session cache is ${age} day(s) old — first lookup may be slower.`)
    }
  }

  if (!toProcess.length) {
    print.info('No serials to process.')
    if (immediateResults.length) printBulkSummary(immediateResults, 0)
    return
  }

  const byVendor = new Map<Vendor, string[]>()
  for (const { serial, vendor } of toProcess) {
    if (!byVendor.has(vendor)) byVendor.set(vendor, [])
    byVendor.get(vendor)!.push(serial)
  }

  if (!options.json) {
    const vendorSummary = [...byVendor.entries()].map(([v, s]) => `${v}: ${s.length}`).join(', ')
    console.log(chalk.bold(`\n→ Checking ${toProcess.length} serial${toProcess.length !== 1 ? 's' : ''} (${vendorSummary})`))
  }

  const startTime = Date.now()
  const runResults: WarrantyResult[] = []

  const multibar = options.json ? null : new MultiBar({
    clearOnComplete: false,
    hideCursor: true,
    format: '[{vendor}] {bar} {value}/{total} | {serial} → {status}',
  }, Presets.shades_grey)

  await Promise.allSettled([...byVendor.entries()].map(async ([vendor, serials]) => {
    const adapter = getAdapter(vendor)
    const cookies = loadSession(vendor) ?? undefined
    const needsBrowser = adapter.requiresBrowser !== false
    const browser = needsBrowser ? await launchBrowser(headless) : null
    const ctx = needsBrowser ? await newContext(browser!, cookies) : null
    const bar = multibar?.create(serials.length, 0, { vendor: vendor.padEnd(6), serial: '...', status: '' })

    try {
      for (let i = 0; i < serials.length; i++) {
        const serial = serials[i]
        bar?.update(i + 1, { vendor: vendor.padEnd(6), serial, status: chalk.dim('checking...') })
        let result = await adapter.lookup(serial, ctx)

        if (result.status === 'rate_limited') {
          await new Promise(r => setTimeout(r, delay * 2))
          result = await adapter.lookup(serial, ctx)
        }

        if (!options.json) appendCsvRow(outputPath, result)
        runResults.push(result)

        bar?.update(i + 1, {
          vendor: vendor.padEnd(6),
          serial: result.serial,
          status: colorStatus(result.status),
        })

        if (i < serials.length - 1) await new Promise(r => setTimeout(r, delay))
      }
    } finally {
      if (browser) await closeBrowser(browser)
    }
  }))

  multibar?.stop()

  const allResults = [...immediateResults, ...runResults]

  if (options.json) {
    console.log(JSON.stringify(allResults, null, 2))
  } else {
    rewriteCsvOrdered(outputPath, inputOrder)
    printBulkSummary(allResults, Date.now() - startTime)
    console.log(`\nResults written to: ${outputPath}`)
  }
}
