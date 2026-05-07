import chalk from 'chalk'
import type { OutputMode, Vendor, WarrantyResult } from './types'

const STATUS_COLOR: Record<string, chalk.Chalk> = {
  active:         chalk.green,
  expired:        chalk.red,
  not_found:      chalk.yellow,
  rate_limited:   chalk.yellow,
  vendor_error:   chalk.red,
  invalid_serial: chalk.gray,
}

export function colorStatus(status: string): string {
  return (STATUS_COLOR[status] ?? chalk.white)(status.toUpperCase())
}

export const print = {
  error:   (msg: string) => console.error(chalk.bold.red(`✗  ${msg}`)),
  warn:    (msg: string) => console.error(chalk.yellow(`⚠  ${msg}`)),
  success: (msg: string) => console.log(chalk.green(`✓  ${msg}`)),
  info:    (msg: string) => console.log(chalk.cyan(`ℹ  ${msg}`)),
}

export function daysRemaining(warrantyEnd: string | null): number | null {
  if (!warrantyEnd) return null
  return Math.floor((new Date(warrantyEnd).getTime() - Date.now()) / 86_400_000)
}

function colorDays(days: number | null): string {
  if (days === null) return chalk.dim('N/A')
  if (days <= 0)  return chalk.red(String(days))
  if (days <= 90) return chalk.yellow(String(days))
  return chalk.green(String(days))
}

const VENDOR_COLOR: Record<string, chalk.Chalk> = {
  dell:   chalk.blue,
  hp:     chalk.cyan,
  lenovo: chalk.magenta,
  apple:  chalk.white,
}

function colorVendor(vendor: string): string {
  return (VENDOR_COLOR[vendor] ?? chalk.white)(vendor.toUpperCase())
}

const label = (s: string) => chalk.dim(s)

export function formatResult(result: WarrantyResult, mode: OutputMode): string {
  if (mode === 'json') return JSON.stringify(result, null, 2)
  if (mode === 'quiet') return result.warrantyEnd ?? result.status

  const days = daysRemaining(result.warrantyEnd)

  return [
    `${label('Vendor:      ')} ${colorVendor(result.vendor)}`,
    `${label('Serial:      ')} ${chalk.bold(result.serial)}`,
    `${label('Product:     ')} ${result.product ?? chalk.dim('Unknown')}`,
    `${label('Start Date:  ')} ${result.warrantyStart ?? chalk.dim('N/A')}`,
    `${label('End Date:    ')} ${result.warrantyEnd ?? chalk.dim('N/A')}`,
    `${label('Status:      ')} ${colorStatus(result.status)}`,
    `${label('Days Left:   ')} ${colorDays(days)}`,
    `${label('Service Type:')} ${result.serviceType ?? chalk.dim('N/A')}`,
    result.error ? `${label('Error:       ')} ${chalk.dim(result.error)}` : '',
  ].filter(Boolean).join('\n')
}

export function formatResults(results: WarrantyResult[], mode: OutputMode): string {
  if (mode === 'json') return JSON.stringify(results, null, 2)
  return results.map(r => formatResult(r, 'table')).join('\n\n')
}

export function printProgress(current: number, total: number, result: WarrantyResult, vendor: Vendor): void {
  const tag = `[${vendor.padEnd(6)}]`
  const status = colorStatus(result.status)
  console.log(`${chalk.dim(tag)} ${current}/${total} | ${result.serial} → ${status} (${result.warrantyEnd ?? 'N/A'})`)
}

export function printBulkSummary(results: WarrantyResult[], elapsedMs: number): void {
  const succeeded = results.filter(r => r.status === 'active' || r.status === 'expired').length
  const failed = results.length - succeeded
  const active = results.filter(r => r.status === 'active').length
  const expired = results.filter(r => r.status === 'expired').length

  const byError: Record<string, number> = {}
  for (const r of results) {
    if (r.status !== 'active' && r.status !== 'expired') {
      byError[r.status] = (byError[r.status] ?? 0) + 1
    }
  }

  console.log(`\nChecked ${results.length} devices in ${(elapsedMs / 1000).toFixed(1)}s`)
  console.log(`  ${chalk.green(`✓ ${succeeded} succeeded`)}  (${active} active, ${expired} expired)`)
  if (failed) {
    console.log(`  ${chalk.red(`✗ ${failed} failed`)}`)
    for (const [status, count] of Object.entries(byError)) {
      console.log(`    ${chalk.dim(String(count))} ${colorStatus(status)}`)
    }
  }
}

export function warnIfStale(results: WarrantyResult[]): void {
  if (!results.length) return
  const oldest = results.reduce((min, r) =>
    r.checkedAt < min ? r.checkedAt : min, results[0].checkedAt)
  const ageDays = Math.floor((Date.now() - new Date(oldest).getTime()) / 86_400_000)
  if (ageDays > 30) {
    console.warn(chalk.yellow(`⚠ Data may be stale — oldest check was ${ageDays} days ago. Re-run bulk to refresh.\n`))
  }
}
