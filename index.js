import fs from 'node:fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const files = (await fs.readdir(join(__dirname, 'apps')))
  .filter(f => f.endsWith('.js'))

const ret = await Promise.allSettled(
  files.map(f => import(`./apps/${f}`))
)

export const apps = {}

for (const i in files) {
  const name = files[i].replace('.js', '')
  if (ret[i].status !== 'fulfilled') {
    console.error(`[play_QQ] 载入 ${name} 失败:`, ret[i].reason)
    continue
  }
  const mod = ret[i].value
  for (const key of Object.keys(mod)) {
    if (typeof mod[key] === 'function' && mod[key].prototype) {
      apps[name] = mod[key]
      break
    }
  }
}

console.log(`[play_QQ] QQ 插件已加载，${Object.keys(apps).length} 个应用`)
