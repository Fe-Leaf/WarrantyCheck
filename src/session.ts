import fs from 'fs'
import path from 'path'
import os from 'os'
import type { Cookie } from 'playwright'
import type { Vendor } from './types'

const SESSION_DIR = path.join(os.homedir(), '.warrantycheck', 'sessions')

interface SessionFile {
  savedAt: string
  cookies: Cookie[]
}

function sessionPath(vendor: Vendor): string {
  return path.join(SESSION_DIR, `${vendor}.json`)
}

export function loadSession(vendor: Vendor): Cookie[] | null {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionPath(vendor), 'utf8'))
    // Handle both old format (plain Cookie[]) and new format ({ savedAt, cookies })
    if (Array.isArray(raw)) return raw
    return (raw as SessionFile).cookies
  } catch {
    return null
  }
}

export function saveSession(vendor: Vendor, cookies: Cookie[]): void {
  fs.mkdirSync(SESSION_DIR, { recursive: true })
  const file: SessionFile = { savedAt: new Date().toISOString(), cookies }
  fs.writeFileSync(sessionPath(vendor), JSON.stringify(file, null, 2))
}

export function clearSession(vendor: Vendor): void {
  try { fs.unlinkSync(sessionPath(vendor)) } catch { /* already gone */ }
}

export function getSessionAgeDays(vendor: Vendor): number | null {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionPath(vendor), 'utf8'))
    if (Array.isArray(raw)) return null  // old format, no timestamp
    const savedAt = new Date((raw as SessionFile).savedAt)
    return Math.floor((Date.now() - savedAt.getTime()) / 86_400_000)
  } catch {
    return null
  }
}
