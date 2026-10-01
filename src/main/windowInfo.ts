import { execFile } from 'child_process'

export interface ForegroundWindowInfo {
  appName?: string
  windowTitle?: string
}

/**
 * Reads the foreground window's title and the owning app's product name via documented Win32 calls
 * (GetForegroundWindow / GetWindowText / GetWindowThreadProcessId) in a short-lived PowerShell.
 * Must be started when the hotkey fires, before the selection overlay takes focus. Best-effort:
 * resolves to {} on any failure or after the timeout. The result is stored locally with the note
 * and never sent to an AI provider.
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class SnapFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}
'@
$h = [SnapFg]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 1024
[void][SnapFg]::GetWindowText($h, $sb, 1024)
$procId = [uint32]0
[void][SnapFg]::GetWindowThreadProcessId($h, [ref]$procId)
$name = ''
try {
  $p = Get-Process -Id $procId
  $name = $p.MainModule.FileVersionInfo.FileDescription
  if (-not $name) { $name = $p.ProcessName }
} catch {}
@{ title = $sb.ToString(); app = $name } | ConvertTo-Json -Compress
`

const TIMEOUT_MS = 4000

export function readForegroundWindow(): Promise<ForegroundWindowInfo> {
  if (process.platform !== 'win32') return Promise.resolve({})
  return new Promise((resolve) => {
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: TIMEOUT_MS, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => {
        if (err) return resolve({})
        try {
          const parsed = JSON.parse(stdout.trim()) as { title?: unknown; app?: unknown }
          const clean = (v: unknown): string | undefined =>
            typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300) : undefined
          resolve({ ...(clean(parsed.app) ? { appName: clean(parsed.app) } : {}), ...(clean(parsed.title) ? { windowTitle: clean(parsed.title) } : {}) })
        } catch {
          resolve({})
        }
      }
    )
  })
}
