import fs from 'fs'
import chalk from 'chalk'
import { readResultsCsv } from '../csv'
import { readXlsxResults } from '../xlsx'
import { loadProfiles, getProfile } from '../profiles'
import { warnIfStale, daysRemaining, print } from '../output'
import type { WarrantyResult } from '../types'

interface SummaryOptions {
  json?: boolean
  profile?: string
  all?: boolean
}

export async function summaryCommand(file: string | undefined, options: SummaryOptions): Promise<void> {
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
      print.info('No profiles saved.')
      return
    }

    type ProfileStats = { name: string; total: number; active: number; expiring: number; expired: number }
    const profileStats: ProfileStats[] = []
    const allResults: WarrantyResult[] = []

    for (const p of profiles) {
      if (!fs.existsSync(p.file)) {
        print.warn(`Profile '${p.name}': file not found — ${p.file}. Skipping.`)
        continue
      }
      let results: WarrantyResult[]
      try {
        results = await readXlsxResults(p.file, p.serialCol)
      } catch {
        print.warn(`Profile '${p.name}': failed to read file. Skipping.`)
        continue
      }
      allResults.push(...results)
      const active = results.filter(r => { const d = daysRemaining(r.warrantyEnd); return r.status === 'active' && d !== null && d > 90 }).length
      const expiring = results.filter(r => {
        if (r.status !== 'active' || !r.warrantyEnd) return false
        const d = daysRemaining(r.warrantyEnd)
        return d !== null && d >= 0 && d <= 90
      }).length
      const expired = results.filter(r => r.status === 'expired').length
      profileStats.push({ name: p.name, total: results.length, active, expiring, expired })
    }

    const totals = profileStats.reduce(
      (acc, s) => ({ total: acc.total + s.total, active: acc.active + s.active, expiring: acc.expiring + s.expiring, expired: acc.expired + s.expired }),
      { total: 0, active: 0, expiring: 0, expired: 0 }
    )

    warnIfStale(allResults)

    const allWithEnd = allResults.filter(r => r.status === 'active' && r.warrantyEnd)
    const nextExp = allWithEnd.length
      ? allWithEnd.reduce((min, r) => r.warrantyEnd! < min ? r.warrantyEnd! : min, allWithEnd[0].warrantyEnd!)
      : null

    if (options.json) {
      console.log(JSON.stringify({ profiles: profileStats, totals, nextExpiration: nextExp }, null, 2))
      return
    }

    console.log(chalk.bold('Fleet Summary — All Profiles'))
    console.log(chalk.dim('──────────────────────────────────────────'))
    const header = `${'Profile'.padEnd(16)} ${'Devices'.padStart(7)}  ${'Active'.padStart(6)}  ${'Expiring'.padStart(8)}  ${'Expired'.padStart(7)}`
    console.log(chalk.dim(header))
    for (const s of profileStats) {
      console.log(
        `${chalk.bold(s.name.padEnd(16))} ${String(s.total).padStart(7)}  ${chalk.green(String(s.active).padStart(6))}  ${chalk.yellow(String(s.expiring).padStart(8))}  ${chalk.red(String(s.expired).padStart(7))}`
      )
    }
    console.log(chalk.dim('──────────────────────────────────────────'))
    console.log(
      `${'Total'.padEnd(16)} ${String(totals.total).padStart(7)}  ${chalk.green(String(totals.active).padStart(6))}  ${chalk.yellow(String(totals.expiring).padStart(8))}  ${chalk.red(String(totals.expired).padStart(7))}`
    )
    if (nextExp) console.log(`\n${chalk.dim('Next expiration:')} ${nextExp}`)
    return
  }

  if (options.profile) {
    const p = getProfile(options.profile)
    if (!p) {
      print.error(`Profile '${options.profile}' not found. Run: warrantycheck profile list`)
      process.exit(1)
    }
    if (!fs.existsSync(p.file)) {
      print.error(`Profile file not found: ${p.file}`)
      process.exit(1)
    }
    const results = await readXlsxResults(p.file, p.serialCol)
    printSingleSummary(results, options)
    return
  }

  // file mode
  let results: WarrantyResult[]
  try {
    results = readResultsCsv(file!)
  } catch {
    print.error(`Cannot read results file: ${file}`)
    process.exit(1)
  }
  printSingleSummary(results, options)
}

function printSingleSummary(results: WarrantyResult[], options: { json?: boolean }): void {
  warnIfStale(results)

  const total = results.length
  const active = results.filter(r => r.status === 'active').length
  const expired = results.filter(r => r.status === 'expired').length
  const errors = total - active - expired

  const expiringSoon = results.filter(r => {
    if (r.status !== 'active' || !r.warrantyEnd) return false
    const days = daysRemaining(r.warrantyEnd)
    return days !== null && days <= 90
  }).length

  const byVendor: Record<string, { active: number; expired: number; other: number }> = {}
  for (const r of results) {
    if (!byVendor[r.vendor]) byVendor[r.vendor] = { active: 0, expired: 0, other: 0 }
    if (r.status === 'active') byVendor[r.vendor].active++
    else if (r.status === 'expired') byVendor[r.vendor].expired++
    else byVendor[r.vendor].other++
  }

  if (options.json) {
    console.log(JSON.stringify({ total, active, expired, errors, expiringSoon, byVendor }, null, 2))
    return
  }

  console.log(chalk.bold('Fleet Warranty Summary'))
  console.log(`${chalk.dim('Total devices:')} ${chalk.bold(String(total))}`)
  console.log(`  ${chalk.green(`✓ Active:  ${active}`)}`)
  console.log(`  ${chalk.red(`✗ Expired: ${expired}`)}`)
  if (errors) console.log(`  ${chalk.yellow(`⚠ Errors:  ${errors}`)}`)
  if (expiringSoon) console.log(`  ${chalk.yellow(`⚡ Expiring within 90 days: ${expiringSoon}`)}`)

  if (Object.keys(byVendor).length > 1) {
    console.log(chalk.dim('\nBy vendor:'))
    for (const [vendor, stats] of Object.entries(byVendor)) {
      const otherNote = stats.other ? chalk.dim(`, errors: ${stats.other}`) : ''
      console.log(
        `  ${chalk.bold(vendor.padEnd(8))}` +
        ` ${chalk.green(`active: ${stats.active}`)}` +
        `  ${chalk.red(`expired: ${stats.expired}`)}` +
        otherNote
      )
    }
  }
}
