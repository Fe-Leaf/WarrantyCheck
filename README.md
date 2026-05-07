# WarrantyCheck

CLI tool for checking device warranty status across Dell, HP, and Lenovo. Supports single lookups, bulk CSV/XLSX processing, expiration tracking, fleet summaries, and HTML reports.

Free and open source.

Built by IronLeaf.

Need a custom CLI? [Email me](mailto:ironleaf-dev@zohomail.com).

---

## Installation

```bash
npm install -g warrantycheck
```

Chromium is installed automatically on first install via the `postinstall` hook.

**Requirements:** Node.js 18+

---

## Commands

### Single lookup

```bash
warrantycheck lookup <serial>
warrantycheck lookup <serial> --vendor dell
warrantycheck lookup <serial> --json
warrantycheck lookup <serial> --quiet        # expiration date only
```

Vendor is auto-detected from the serial format if `--vendor` is omitted.

---

### Bulk lookup

```bash
warrantycheck bulk devices.csv
warrantycheck bulk devices.csv --output results.csv
warrantycheck bulk devices.csv --json

# XLSX write-back — results written back into the source file
warrantycheck bulk devices.xlsx --serial-col "Service Tag"
warrantycheck bulk devices.xlsx --serial-col "Serial Number" --vendor-col "Vendor"

# Resume support — already-completed serials are skipped automatically
# Rate-limited serials are retried on the next run
```

CSV input format:
```
serial,vendor
ABC1234,dell
5CD9876543,hp
PF3XXXXXX,lenovo
```

The `vendor` column is optional — vendor is auto-detected per row if omitted.

---

### Expiring devices

```bash
warrantycheck expiring results.csv              # default 90-day window
warrantycheck expiring results.csv --days 30
warrantycheck expiring results.csv --json
warrantycheck expiring results.csv --output expiring.csv
```

---

### Fleet summary

```bash
warrantycheck summary results.csv
warrantycheck summary results.csv --json
```

Shows total, active, expiring (≤90 days), and expired counts by vendor.

---

### Client profiles

Profiles store a pointer to an XLSX file so you don't have to retype paths and column names.

```bash
warrantycheck profile add --name acme --file /path/to/acme.xlsx --serial-col "Service Tag"
warrantycheck profile list
warrantycheck profile edit --name acme --file /new/path.xlsx
warrantycheck profile remove --name acme

# Run bulk/summary/expiring against a profile
warrantycheck bulk --profile acme
warrantycheck bulk --all
warrantycheck summary --profile acme
warrantycheck expiring --profile acme --days 60
```

---

### HTML report

Generates a self-contained HTML file with a color-coded device table, vendor breakdown, and summary stats.

```bash
warrantycheck report results.csv --output report.html
warrantycheck report --profile acme --output acme-report.html
warrantycheck report --all --output all-clients.html
```

---

### Dell API credentials

By default, warrantycheck uses browser-based lookups. If you have Dell TechDirect API credentials, you can supply them for faster, more reliable Dell lookups:

```bash
warrantycheck config set --dell-client-id <id> --dell-client-secret <secret>
warrantycheck config show
```

---

## Supported Vendors

| Vendor | Serial format | Example |
|--------|--------------|---------|
| Dell   | 7 chars (alphanumeric) | `ABC1234` |
| HP     | 10 chars (alphanumeric) | `5CD9876543` |
| Lenovo | 7–12 chars (alphanumeric) | `PF3XXXXXX` |

---

## Global flags

```
--no-color      Disable colored output
--no-headless   Show browser window (debug)
--help          Show help for any command
--version       Show version
```

---

## Custom Work

IronLeaf builds developer tools and automation for infrastructure teams. If you need something that doesn't exist yet — a custom CLI, an n8n node, an MCP server, an API integration, or a workflow that ties your stack together — I'm available for hire.

→ [Email me](ironleaf-dev@zohomail.com)