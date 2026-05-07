import { test } from 'node:test'
import assert from 'node:assert/strict'
import chalk from 'chalk'
import { daysRemaining, formatResult, formatResults } from './output'
import type { WarrantyResult } from './types'

chalk.level = 0

const base: WarrantyResult = {
  vendor: 'dell',
  serial: 'ABC1234',
  product: 'Latitude 5540',
  warrantyStart: '2023-06-15',
  warrantyEnd: '2099-06-15',
  status: 'active',
  serviceType: 'ProSupport NBD',
  checkedAt: '2026-05-01T12:00:00.000Z',
}

// daysRemaining
test('daysRemaining null input returns null', () => assert.equal(daysRemaining(null), null))
test('daysRemaining future date returns positive', () => {
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0]
  assert.ok((daysRemaining(future) ?? 0) > 0)
})
test('daysRemaining past date returns negative', () => {
  assert.ok((daysRemaining('2020-01-01') ?? 0) < 0)
})

// formatResult — quiet mode
test('quiet mode returns warrantyEnd', () => assert.equal(formatResult(base, 'quiet'), '2099-06-15'))
test('quiet mode returns status when no warrantyEnd', () => {
  assert.equal(formatResult({ ...base, warrantyEnd: null }, 'quiet'), 'active')
})

// formatResult — json mode
test('json mode produces valid JSON', () => {
  const parsed = JSON.parse(formatResult(base, 'json'))
  assert.equal(parsed.serial, 'ABC1234')
  assert.equal(parsed.vendor, 'dell')
})
test('json mode includes all fields', () => {
  const parsed = JSON.parse(formatResult(base, 'json'))
  for (const key of ['vendor','serial','product','warrantyStart','warrantyEnd','status','serviceType','checkedAt']) {
    assert.ok(key in parsed, `missing key: ${key}`)
  }
})

// formatResult — table mode
test('table mode contains serial', () => assert.ok(formatResult(base, 'table').includes('ABC1234')))
test('table mode contains uppercased vendor', () => assert.ok(formatResult(base, 'table').includes('DELL')))
test('table mode contains product', () => assert.ok(formatResult(base, 'table').includes('Latitude 5540')))
test('table mode contains service type', () => assert.ok(formatResult(base, 'table').includes('ProSupport NBD')))
test('table mode shows error line when error present', () => {
  assert.ok(formatResult({ ...base, status: 'vendor_error', error: 'timeout' }, 'table').includes('timeout'))
})
test('table mode omits error line when no error', () => {
  assert.ok(!formatResult(base, 'table').includes('Error:'))
})

// formatResults
test('json array mode produces array', () => {
  const parsed = JSON.parse(formatResults([base, { ...base, serial: 'DEF5678' }], 'json'))
  assert.equal(parsed.length, 2)
})
test('table mode separates multiple results with blank line', () => {
  const out = formatResults([base, { ...base, serial: 'DEF5678' }], 'table')
  assert.ok(out.includes('\n\n'))
})
