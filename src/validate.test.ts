import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateSerial } from './validate'

test('dell accepts valid 7-char serial', () => assert.ok(validateSerial('ABC1234', 'dell')))
test('dell accepts lowercase', () => assert.ok(validateSerial('abc1234', 'dell')))
test('dell rejects 6 chars', () => assert.ok(!validateSerial('ABC123', 'dell')))
test('dell rejects 8 chars', () => assert.ok(!validateSerial('ABC12345', 'dell')))
test('dell rejects special chars', () => assert.ok(!validateSerial('ABC-123', 'dell')))

test('hp accepts valid 10-char serial', () => assert.ok(validateSerial('5CD1234567', 'hp')))
test('hp rejects 9 chars', () => assert.ok(!validateSerial('5CD123456', 'hp')))
test('hp rejects 11 chars', () => assert.ok(!validateSerial('5CD12345678', 'hp')))

test('lenovo accepts 7-char serial', () => assert.ok(validateSerial('PF3XXXX', 'lenovo')))
test('lenovo accepts 12-char serial', () => assert.ok(validateSerial('PF3XXXXXXXXX', 'lenovo')))
test('lenovo rejects 6 chars', () => assert.ok(!validateSerial('PF3XXX', 'lenovo')))
test('lenovo rejects 13 chars', () => assert.ok(!validateSerial('PF3XXXXXXXXXX1', 'lenovo')))

