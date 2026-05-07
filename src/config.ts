import fs from 'fs'
import path from 'path'
import os from 'os'
import type { Config } from './types'

const CONFIG_PATH = path.join(os.homedir(), '.warrantycheck', 'config.json')
const DEFAULTS: Config = { delay: 1500 }

export function loadConfig(): Config {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveConfig(updates: Partial<Config>): void {
  const merged = { ...loadConfig(), ...updates }
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2))
}
