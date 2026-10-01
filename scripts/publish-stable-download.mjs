// Uploads the freshly built installer to the GitHub release a second time under a
// version-free name, so this link always serves the newest version:
//   https://github.com/eropermakov/snap-notes/releases/latest/download/Snap-Notes-Setup.exe
// electron-updater ignores the extra asset (it only reads latest.yml).
//
// Usage: node scripts/publish-stable-download.mjs   (needs GH_TOKEN, runs after `electron-builder --publish`)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const OWNER = 'eropermakov'
const REPO = 'snap-notes'
const STABLE_NAME = 'Snap-Notes-Setup.exe'

const token = process.env.GH_TOKEN
if (!token) {
  console.error('GH_TOKEN is not set')
  process.exit(1)
}

const { version, build } = JSON.parse(readFileSync('package.json', 'utf8'))
const installer = join(build.directories.output, `${build.productName} Setup ${version}.exe`)
const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' }

async function api(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...headers, ...init.headers } })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} → ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

const release = await api(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/v${version}`)

const existing = release.assets.find((a) => a.name === STABLE_NAME)
if (existing) {
  await api(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${existing.id}`, { method: 'DELETE' })
  console.log(`removed old ${STABLE_NAME}`)
}

const body = readFileSync(installer)
const uploadUrl = release.upload_url.replace(/\{.*\}$/, '') + `?name=${encodeURIComponent(STABLE_NAME)}`
const asset = await api(uploadUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length) },
  body
})
console.log(`uploaded ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB) to v${version}`)
