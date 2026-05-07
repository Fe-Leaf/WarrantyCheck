import fs from 'fs'
import ExcelJS from 'exceljs'
import type { WarrantyResult, WarrantyStatus } from './types'

const WARRANTY_COLS = [
  'Warranty Status',
  'Warranty Start',
  'Warranty End',
  'Days Left',
  'Service Type',
  'Last Checked',
] as const

const VALID_STATUSES = new Set<string>([
  'active', 'expired', 'not_found', 'rate_limited', 'vendor_error', 'invalid_serial',
])

function cellStr(cell: ExcelJS.Cell): string {
  const v = cell.value
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map(rt => rt.text).join('')
    if ('hyperlink' in v) return (v as ExcelJS.CellHyperlinkValue).text
    if ('result' in v) return String((v as ExcelJS.CellFormulaValue).result ?? '')
  }
  return String(v)
}

// Scans the first 10 rows for the one containing serialCol (case-insensitive).
// Returns the row number and a lowercase-keyed column index map.
function findHeaderRow(sheet: ExcelJS.Worksheet, serialCol: string): { rowNum: number; map: Map<string, number> } {
  const target = serialCol.toLowerCase()
  let rowNum = 0
  let map = new Map<string, number>()
  sheet.eachRow((row, rn) => {
    if (rowNum || rn > 10) return
    const candidate = new Map<string, number>()
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const val = cellStr(cell).trim()
      if (val) candidate.set(val.toLowerCase(), col)
    })
    if (candidate.has(target)) { map = candidate; rowNum = rn }
  })
  return { rowNum, map }
}

export async function readXlsxResults(filePath: string, serialCol: string): Promise<WarrantyResult[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.readFile(filePath)
  } catch (err) {
    throw new Error(`Cannot read xlsx file: ${filePath} — ${(err as Error).message}`)
  }

  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error(`No worksheets found in: ${filePath}`)

  const { rowNum: headerRowNum, map: headerMap } = findHeaderRow(sheet, serialCol)

  if (!headerRowNum) {
    const available = [...headerMap.keys()].join(', ')
    throw new Error(`Column "${serialCol}" not found in the first 10 rows`)
  }

  const serialColIdx = headerMap.get(serialCol.toLowerCase())!
  const statusColIdx = headerMap.get('warranty status')
  const startColIdx = headerMap.get('warranty start')
  const endColIdx = headerMap.get('warranty end')
  const serviceColIdx = headerMap.get('service type')
  const checkedColIdx = headerMap.get('last checked')
  const vendorColIdx = headerMap.get('vendor')

  const results: WarrantyResult[] = []

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRowNum) return

    const serial = cellStr(row.getCell(serialColIdx)).trim()
    if (!serial) return

    const rawStatus = statusColIdx ? cellStr(row.getCell(statusColIdx)).trim().toLowerCase() : ''
    if (!rawStatus) return

    const status: WarrantyStatus = VALID_STATUSES.has(rawStatus)
      ? (rawStatus as WarrantyStatus)
      : 'vendor_error'

    const rawVendor = vendorColIdx ? cellStr(row.getCell(vendorColIdx)).trim().toLowerCase() : ''
    const vendor = (['dell', 'hp', 'lenovo'].includes(rawVendor)
      ? rawVendor
      : 'dell') as WarrantyResult['vendor']

    results.push({
      vendor,
      serial,
      product: null,
      warrantyStart: startColIdx ? cellStr(row.getCell(startColIdx)).trim() || null : null,
      warrantyEnd: endColIdx ? cellStr(row.getCell(endColIdx)).trim() || null : null,
      status,
      serviceType: serviceColIdx ? cellStr(row.getCell(serviceColIdx)).trim() || null : null,
      checkedAt: checkedColIdx ? cellStr(row.getCell(checkedColIdx)).trim() || new Date().toISOString() : new Date().toISOString(),
    })
  })

  return results
}

export async function writeXlsxResults(filePath: string, serialCol: string, results: WarrantyResult[]): Promise<void> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.readFile(filePath)
  } catch (err) {
    throw new Error(`Cannot read xlsx file: ${filePath} — ${(err as Error).message}`)
  }

  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error(`No worksheets found in: ${filePath}`)

  const { rowNum: headerRowNum, map: headerMap } = findHeaderRow(sheet, serialCol)

  if (!headerRowNum) {
    throw new Error(`Column "${serialCol}" not found in the first 10 rows`)
  }

  // Ensure all warranty columns exist in the header, appending any missing ones
  const headerRow = sheet.getRow(headerRowNum)
  let nextCol = headerRow.cellCount + 1
  for (const colName of WARRANTY_COLS) {
    if (!headerMap.has(colName.toLowerCase())) {
      headerRow.getCell(nextCol).value = colName
      headerMap.set(colName.toLowerCase(), nextCol)
      nextCol++
    }
  }
  headerRow.commit()

  const bySerial = new Map<string, WarrantyResult>()
  for (const r of results) {
    bySerial.set(r.serial.toLowerCase(), r)
  }

  const serialColIdx = headerMap.get(serialCol.toLowerCase())!

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRowNum) return

    const serial = cellStr(row.getCell(serialColIdx)).trim()
    if (!serial) return

    const result = bySerial.get(serial.toLowerCase())
    if (!result) return

    const daysLeft = result.warrantyEnd
      ? Math.floor((new Date(result.warrantyEnd).getTime() - Date.now()) / 86_400_000)
      : ''

    row.getCell(headerMap.get('warranty status')!).value = result.status
    row.getCell(headerMap.get('warranty start')!).value = result.warrantyStart ?? ''
    row.getCell(headerMap.get('warranty end')!).value = result.warrantyEnd ?? ''
    row.getCell(headerMap.get('days left')!).value = daysLeft === '' ? '' : daysLeft
    row.getCell(headerMap.get('service type')!).value = result.serviceType ?? ''
    row.getCell(headerMap.get('last checked')!).value = result.checkedAt
    row.commit()
  })

  try {
    await workbook.xlsx.writeFile(filePath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EBUSY' || code === 'EACCES') {
      throw new Error('File is locked — close it in other programs and try again')
    }
    throw err
  }
}
