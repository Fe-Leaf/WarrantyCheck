import fs from 'fs'
import path from 'path'
import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'
import type { WarrantyResult } from './types'

const COLUMNS = [
  'serial', 'vendor', 'product', 'warrantyStart', 'warrantyEnd',
  'status', 'serviceType', 'checkedAt', 'error',
]

export function readCsv(filePath: string): Array<{ serial: string; vendor?: string }> {
  return parse(fs.readFileSync(filePath, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  })
}

export function readResultsCsv(filePath: string): WarrantyResult[] {
  return parse(fs.readFileSync(filePath, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  })
}

export function readExistingSerials(filePath: string): Set<string> {
  try {
    return new Set(
      readResultsCsv(filePath)
        .filter(r => r.status !== 'rate_limited')
        .map(r => r.serial.toLowerCase())
    )
  } catch {
    return new Set()
  }
}

export function rewriteCsvOrdered(filePath: string, serialOrder: Map<string, number>): void {
  const seen = new Map<string, WarrantyResult>()
  for (const r of readResultsCsv(filePath)) seen.set(r.serial.toLowerCase(), r)
  const rows = [...seen.values()]
  rows.sort((a, b) => {
    const ai = serialOrder.get(a.serial.toLowerCase()) ?? Infinity
    const bi = serialOrder.get(b.serial.toLowerCase()) ?? Infinity
    return ai - bi
  })
  const csv = stringify(rows.map(r => ({
    serial: r.serial,
    vendor: r.vendor,
    product: r.product ?? '',
    warrantyStart: r.warrantyStart ?? '',
    warrantyEnd: r.warrantyEnd ?? '',
    status: r.status,
    serviceType: r.serviceType ?? '',
    checkedAt: r.checkedAt,
    error: r.error ?? '',
  })), { columns: COLUMNS, header: true })
  fs.writeFileSync(filePath, csv)
}

export function appendCsvRow(filePath: string, result: WarrantyResult): void {
  const row = {
    serial: result.serial,
    vendor: result.vendor,
    product: result.product ?? '',
    warrantyStart: result.warrantyStart ?? '',
    warrantyEnd: result.warrantyEnd ?? '',
    status: result.status,
    serviceType: result.serviceType ?? '',
    checkedAt: result.checkedAt,
    error: result.error ?? '',
  }
  const needsHeader = !fs.existsSync(filePath)
  if (needsHeader) {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true })
  }
  fs.appendFileSync(filePath, stringify([row], { columns: COLUMNS, header: needsHeader }))
}
