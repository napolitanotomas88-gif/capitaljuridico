// node scripts/bajar-produccion.mjs <dpl_id> <carpeta>  — baja el código fuente de un deploy de Vercel (token del CLI)
// Sirve para publicar un cambio encima de lo que está en producción sin arrastrar trabajo sin publicar de esta carpeta.
import fs from 'fs'; import path from 'path'
const tok = process.env.VERCEL_TOKEN?.trim()
if (!tok) throw new Error('Falta VERCEL_TOKEN autorizado; no se leen credenciales de otras aplicaciones')
const [dpl, out] = process.argv.slice(2)
if (!dpl || !out) { console.error('uso: node scripts/bajar-produccion.mjs <dpl_id> <carpeta>'); process.exit(1) }
const get = async (u) => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + tok } })
    if (r.ok) return Buffer.from(await r.arrayBuffer())
    if (i === 3) throw new Error(`${r.status} ${u}`)
    await new Promise((s) => setTimeout(s, 1000 * (i + 1)))
  }
}
const tree = JSON.parse(await get(`https://api.vercel.com/v6/deployments/${dpl}/files`))
const files = []
const walk = (ns, b) => { for (const n of ns) { const p = b ? `${b}/${n.name}` : n.name; if (n.type === 'directory') walk(n.children || [], p); else if (n.type === 'file') files.push([p, n.uid]) } }
walk(tree, '')
const src = files.filter(([p]) => p.startsWith('src/'))
let i = 0
await Promise.all(Array.from({ length: 10 }, async () => {
  while (i < src.length) {
    const [p, u] = src[i++]
    const d = path.join(out, p.slice(4))
    fs.mkdirSync(path.dirname(d), { recursive: true })
    let data = await get(`https://api.vercel.com/v8/deployments/${dpl}/files/${u}`)
    try { const j = JSON.parse(data); if (j && typeof j === 'object' && Object.keys(j).length === 1 && typeof j.data === 'string') data = Buffer.from(j.data, 'base64') } catch { /* archivo no JSON */ }
    fs.writeFileSync(d, data)
  }
}))
console.log(`${src.length} archivos en ${out}`)
