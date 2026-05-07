import fs from 'fs'
import path from 'path'
import os from 'os'

const PROFILES_PATH = path.join(os.homedir(), '.warrantycheck', 'profiles.json')

export interface Profile {
  name: string
  file: string
  serialCol: string
  vendorCol: string | null
}

interface ProfilesFile {
  profiles: Profile[]
}

function read(): Profile[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8')) as ProfilesFile
    return Array.isArray(parsed.profiles) ? parsed.profiles : []
  } catch {
    return []
  }
}

function write(profiles: Profile[]): void {
  fs.mkdirSync(path.dirname(PROFILES_PATH), { recursive: true })
  fs.writeFileSync(PROFILES_PATH, JSON.stringify({ profiles }, null, 2))
}

export function loadProfiles(): Profile[] {
  return read()
}

export function saveProfile(profile: Profile): void {
  const profiles = read()
  const idx = profiles.findIndex(p => p.name === profile.name)
  if (idx !== -1) {
    profiles[idx] = profile
  } else {
    profiles.push(profile)
  }
  write(profiles)
}

export function removeProfile(name: string): void {
  write(read().filter(p => p.name !== name))
}

export function getProfile(name: string): Profile | null {
  return read().find(p => p.name === name) ?? null
}
