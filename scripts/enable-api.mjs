import { google } from 'googleapis'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
const env = {}
readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split('\n').forEach(line => {
  const [k, ...v] = line.split('='); if (k && v.length) env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '')
})
const auth = new google.auth.JWT({
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g,'\n'),
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
})
try {
  const project = env.GOOGLE_CLOUD_PROJECT?.trim()
  if (!project || !/^[A-Za-z0-9-]+$/.test(project)) throw new Error('Falta GOOGLE_CLOUD_PROJECT válido')
  const { token } = await auth.getAccessToken()
  const res = await fetch(`https://serviceusage.googleapis.com/v1/projects/${project}/services/analyticsdata.googleapis.com:enable`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  const body = await res.json()
  if (res.ok) console.log('✅ API habilitada por el service account:', JSON.stringify(body).slice(0,200))
  else console.log('❌', res.status, JSON.stringify(body.error?.message || body).slice(0,300))
} catch(e) { console.log('❌', e.message.slice(0,300)) }
