import path from 'path'
import fs from 'fs'
import { readXlsxResults } from '../xlsx'
import { readResultsCsv } from '../csv'
import { loadProfiles, getProfile } from '../profiles'
import { daysRemaining, print } from '../output'
import type { WarrantyResult } from '../types'

export async function reportCommand(
  file: string | undefined,
  options: { output: string; profile?: string; all?: boolean }
): Promise<void> {
  if (!options.output) {
    print.error('--output <path> is required')
    process.exit(1)
  }

  const sourceCount = [file, options.profile, options.all].filter(Boolean).length
  if (sourceCount === 0) {
    print.error('Provide a file, --profile <name>, or --all')
    process.exit(1)
  }
  if (sourceCount > 1) {
    print.error('Provide exactly one of: file, --profile, or --all')
    process.exit(1)
  }

  const sections: Array<{ name: string; results: WarrantyResult[] }> = []

  if (options.all) {
    const profiles = loadProfiles()
    for (const p of profiles) {
      if (!fs.existsSync(p.file)) {
        print.warn(`Profile '${p.name}': file not found — ${p.file}. Skipping.`)
        continue
      }
      try {
        const results = await readXlsxResults(p.file, p.serialCol)
        sections.push({ name: p.name, results })
      } catch {
        print.warn(`Profile '${p.name}': failed to read file. Skipping.`)
      }
    }
  } else if (options.profile) {
    const p = getProfile(options.profile)
    if (!p) {
      print.error(`Profile '${options.profile}' not found. Run: warrantycheck profile list`)
      process.exit(1)
    }
    if (!fs.existsSync(p.file)) {
      print.error(`Profile file not found: ${p.file}`)
      process.exit(1)
    }
    const results = await readXlsxResults(p.file, p.serialCol)
    sections.push({ name: p.name, results })
  } else if (file) {
    let results: WarrantyResult[]
    try {
      results = readResultsCsv(file)
    } catch {
      print.error(`Cannot read file: ${file}`)
      process.exit(1)
    }
    sections.push({ name: path.basename(file), results })
  }

  if (!sections.length) {
    print.error('No data to report.')
    process.exit(1)
  }

  const html = generateReport(sections, new Date().toLocaleString())
  fs.writeFileSync(options.output, html)
  print.success(`Report written to ${options.output}`)
}

function generateReport(sections: Array<{ name: string; results: WarrantyResult[] }>, generatedAt: string): string {
  const sectionsHtml = sections.map(({ name, results }) => {
    const total = results.length
    const activeResults = results.filter(r => { const d = daysRemaining(r.warrantyEnd); return r.status === 'active' && d !== null && d > 90 })
    const expiringResults = results.filter(r => {
      if (r.status !== 'active' || !r.warrantyEnd) return false
      const d = daysRemaining(r.warrantyEnd)
      return d !== null && d >= 0 && d <= 90
    })
    const expiredResults = results.filter(r => r.status === 'expired')

    const statsHtml = `
    <div class="stats">
      <div class="stat-box"><div class="num">${total}</div><div class="label">Total</div></div>
      <div class="stat-box"><div class="num">${activeResults.length}</div><div class="label">Active</div></div>
      <div class="stat-box"><div class="num">${expiringResults.length}</div><div class="label">Expiring ≤90d</div></div>
      <div class="stat-box"><div class="num">${expiredResults.length}</div><div class="label">Expired</div></div>
    </div>`

    const rows = results.map(r => {
      const days = daysRemaining(r.warrantyEnd)
      let rowClass = ''
      if (r.status === 'active' && days !== null && days > 90) rowClass = 'active'
      else if (r.status === 'active' && days !== null && days <= 90) rowClass = 'expiring'
      else if (r.status === 'expired') rowClass = 'expired'
      return `<tr class="${rowClass}">
        <td>${escapeHtml(r.serial)}</td>
        <td>${escapeHtml(r.vendor)}</td>
        <td>${escapeHtml(r.product ?? '')}</td>
        <td>${escapeHtml(r.warrantyEnd ?? '')}</td>
        <td>${days !== null ? String(days) : ''}</td>
        <td>${escapeHtml(r.status)}</td>
        <td>${escapeHtml(r.serviceType ?? '')}</td>
        <td>${r.checkedAt ? escapeHtml(new Date(r.checkedAt).toLocaleDateString()) : ''}</td>
      </tr>`
    }).join('\n')

    return `
  <section>
    <h2>${escapeHtml(name)}</h2>
    ${statsHtml}
    <table>
      <thead>
        <tr>
          <th>Serial</th><th>Vendor</th><th>Product</th><th>Warranty End</th>
          <th>Days Left</th><th>Status</th><th>Service Type</th><th>Last Checked</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </section>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Warranty Report</title>
  <style>
    body { font-family: sans-serif; max-width: 1100px; margin: auto; padding: 20px; color: #222; }
    h1 { margin-bottom: 4px; }
    p.generated { color: #777; font-size: 0.85em; margin-top: 0; }
    .stats { display: flex; gap: 24px; margin: 16px 0; }
    .stat-box { border: 1px solid #ddd; border-radius: 6px; padding: 12px 20px; text-align: center; }
    .stat-box .num { font-size: 2em; font-weight: bold; }
    .stat-box .label { font-size: 0.8em; color: #777; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th { background: #f5f5f5; text-align: left; padding: 8px 12px; font-size: 0.85em; border-bottom: 2px solid #ddd; }
    td { padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 0.9em; }
    tr.active { background: #f0fff4; }
    tr.expiring { background: #fffbeb; }
    tr.expired { background: #fff5f5; }
    footer { margin-top: 40px; text-align: center; color: #aaa; font-size: 0.8em; }
  </style>
</head>
<body>
  <h1>Warranty Report</h1>
  <p class="generated">Generated: ${generatedAt} — WarrantyCheck</p>
  ${sectionsHtml}
  <footer>Generated by WarrantyCheck — ironleaf.dev</footer>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
