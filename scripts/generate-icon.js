const fs = require('fs')
const path = require('path')
const sharp = require('sharp')
const pngToIcoModule = require('png-to-ico')
const pngToIco = pngToIcoModule.default || pngToIcoModule

const svgPath = path.join(__dirname, 'icon.svg')
const buildDir = path.join(__dirname, '..', 'build')
const resourcesDir = path.join(__dirname, '..', 'resources')

async function main() {
  fs.mkdirSync(buildDir, { recursive: true })
  fs.mkdirSync(resourcesDir, { recursive: true })

  const svg = fs.readFileSync(svgPath)
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngBuffers = []

  for (const size of sizes) {
    const buf = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer()
    pngBuffers.push(buf)
    if (size === 256) {
      fs.writeFileSync(path.join(resourcesDir, 'icon.png'), buf)
    }
  }

  const icoBuffer = await pngToIco(pngBuffers)
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer)

  console.log('Icon generated: build/icon.ico, resources/icon.png')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
