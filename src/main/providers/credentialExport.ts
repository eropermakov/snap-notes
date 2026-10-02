/**
 * Builds the .env text for "Export API keys". Pure function: the caller decides when it runs (only
 * after the user confirmed the warning and picked a file) and where the text goes.
 */
export interface ExportedCredential {
  env: string
  value: string
}

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/

function formatValue(value: string): string {
  if (/^[A-Za-z0-9_\-./:@+=,~%]*$/.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function buildEnvFile(credentials: ExportedCredential[], exportedAt = new Date()): string {
  const lines = [
    '# Snap Notes — exported API credentials',
    `# Exported ${exportedAt.toISOString()}`,
    '# WARNING: this file contains secret API credentials. Anyone with this file may use your accounts.',
    '# Do not commit it to Git, share it, or store it in synced/cloud folders.',
    ''
  ]
  for (const { env, value } of credentials) {
    if (!ENV_NAME.test(env)) continue
    // A value can never span lines: that would let one entry inject another.
    const clean = value.replace(/[\r\n]+/g, '').trim()
    if (!clean) continue
    lines.push(`${env}=${formatValue(clean)}`)
  }
  return `${lines.join('\n')}\n`
}
