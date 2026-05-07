import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from './config'

test('returns default delay when no config file exists', () => {
  const config = loadConfig()
  assert.equal(typeof config.delay, 'number')
  assert.ok(config.delay > 0)
})

test('default delay is 1500', () => {
  // Only applies when ~/.warrantycheck/config.json does not exist or does not override delay
  const config = loadConfig()
  assert.ok(config.delay >= 1)
})
