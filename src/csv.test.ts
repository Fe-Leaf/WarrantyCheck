import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { appendCsvRow, readExistingSerials, readResultsCsv, readCsv } from './csv'
import type { WarrantyResult } from './types'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-test-'))
const CSV_PATH = path.join(TMP, 'results.csv')
const INPUT_PATH = path.join(TMP, 'input.csv')

after(() => fs.rmSync(TMP, { recursive: true, force: true }))

const row1: WarrantyResult = {
  vendor: 'dell', serial: 'ABC1234', product: 'Latitude 5540',
  warrantyStart: '2023-06-15', warrantyEnd: '2025-06-15',
  status: 'expired', serviceType: 'ProSupport NBD',
  checkedAt: '2026-05-01T12:00:00.000Z',
}
const row2: WarrantyResult = { ...row1, serial: 'DEF5678', status: 'active', warrantyEnd: '2028-01-01' }

// appendCsvRow
test('creates file with header on first write', () => {
  appendCsvRow(CSV_PATH, row1)
  const content = fs.readFileSync(CSV_PATH, 'utf8')
  assert.ok(content.startsWith('serial,vendor'))
  assert.ok(content.includes('ABC1234'))
})
test('appends second row without repeating header', () => {
  appendCsvRow(CSV_PATH, row2)
  const content = fs.readFileSync(CSV_PATH, 'utf8')
  assert.equal((content.match(/serial,vendor/g) ?? []).length, 1)
  assert.ok(content.includes('DEF5678'))
})

// readResultsCsv
test('reads correct number of rows', () => {
  assert.equal(readResultsCsv(CSV_PATH).length, 2)
})
test('reads correct field values', () => {
  const rows = readResultsCsv(CSV_PATH)
  assert.equal(rows[0].serial, 'ABC1234')
  assert.equal(rows[0].status, 'expired')
  assert.equal(rows[1].serial, 'DEF5678')
})

// readExistingSerials
test('returns lowercase set of serials', () => {
  const s = readExistingSerials(CSV_PATH)
  assert.ok(s.has('abc1234'))
  assert.ok(s.has('def5678'))
  assert.ok(!s.has('ABC1234'))
})
test('returns empty set for nonexistent file', () => {
  assert.equal(readExistingSerials('/no/such/file.csv').size, 0)
})

// readCsv (input format)
test('reads input csv with serial and vendor columns', () => {
  fs.writeFileSync(INPUT_PATH, 'serial,vendor\nABC1234,dell\n5CD9876543,hp\n')
  const rows = readCsv(INPUT_PATH)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].serial, 'ABC1234')
  assert.equal(rows[0].vendor, 'dell')
})
test('reads input csv with serial column only', () => {
  fs.writeFileSync(INPUT_PATH, 'serial\nABC1234\nDEF5678\n')
  const rows = readCsv(INPUT_PATH)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].vendor, undefined)
})
