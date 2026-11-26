// Generates PWA icons from public/favicon.svg
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
const svg = readFileSync('public/favicon.svg')
const out = [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]
for (const [name, size] of out) await sharp(svg, { density: 600 }).resize(size, size).png().toFile(`public/${name}`)
const inner = await sharp(svg, { density: 600 }).resize(360, 360).png().toBuffer()
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0B6B53' } })
  .composite([{ input: inner, top: 76, left: 76 }]).png().toFile('public/icon-maskable-512.png')
console.log('icons ok')
