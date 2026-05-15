import { readFileSync, existsSync, watch } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const defaults = {
  cooldown: 10,
  dailyLimit: 50,

  // === LLM 连接 ===
  llmApiKey: '',
  llmBaseUrl: 'https://api.openai.com/v1',
  llmModel: 'gpt-3.5-turbo',

  // === LLM 参数 ===
  llmTemperature: 0.8,
  llmMaxTokens: 2000,
  llmTimeout: 30,
  llmRetry: 1,
  narratorStyle: 'humorous',
  gameMasterName: '主持人',

  // === Game ===
  currentScenario: '',
  registrationTimeout: 60,
  gameStepTimeout: 120,
  cleanupDelay: 30,

  // === 高级 ===
  debugMode: false,
  allowSameGroup: false,
}

const PREFIX = 'play_QQ.'

const originalDefaults = { ...defaults }
const userFields = [
  'cooldown', 'dailyLimit',
  'llmApiKey', 'llmBaseUrl', 'llmModel',
  'llmTemperature', 'llmMaxTokens', 'llmTimeout', 'llmRetry',
  'narratorStyle', 'gameMasterName',
  'currentScenario', 'registrationTimeout', 'gameStepTimeout', 'cleanupDelay',
  'debugMode', 'allowSameGroup',
]

function loadEnvFile () {
  const envPath = resolve(__dirname, '..', '.env')
  if (!existsSync(envPath)) return {}
  const content = readFileSync(envPath, 'utf-8')
  const env = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (value) env[key] = value
  }
  return env
}

function loadUserConfig () {
  for (const k of userFields) {
    defaults[k] = originalDefaults[k]
  }

  // .env 覆盖
  const env = loadEnvFile()
  if (env.LLM_API_KEY) defaults.llmApiKey = env.LLM_API_KEY
  if (env.LLM_BASE_URL) defaults.llmBaseUrl = env.LLM_BASE_URL
  if (env.LLM_MODEL) defaults.llmModel = env.LLM_MODEL
  if (env.LLM_TEMPERATURE) defaults.llmTemperature = parseFloat(env.LLM_TEMPERATURE)
  if (env.LLM_MAX_TOKENS) defaults.llmMaxTokens = parseInt(env.LLM_MAX_TOKENS)
  if (env.LLM_TIMEOUT) defaults.llmTimeout = parseInt(env.LLM_TIMEOUT)
  if (env.LLM_RETRY) defaults.llmRetry = parseInt(env.LLM_RETRY)
  if (env.NARRATOR_STYLE) defaults.narratorStyle = env.NARRATOR_STYLE
  if (env.GAME_MASTER_NAME) defaults.gameMasterName = env.GAME_MASTER_NAME
  if (env.CURRENT_SCENARIO) defaults.currentScenario = env.CURRENT_SCENARIO
  if (env.CLEANUP_DELAY) defaults.cleanupDelay = parseInt(env.CLEANUP_DELAY)
  if (env.DEBUG_MODE) defaults.debugMode = env.DEBUG_MODE === 'true'
  if (env.ALLOW_SAME_GROUP) defaults.allowSameGroup = env.ALLOW_SAME_GROUP === 'true'

  // config.json 覆盖（锅巴面板保存的配置）
  const candidates = [
    resolve(__dirname, '..', 'config.json'),
    resolve(__dirname, '..', '..', '..', 'data', 'guoba', 'play_QQ', 'config.json'),
  ]

  for (const p of candidates) {
    if (!existsSync(p)) continue
    try {
      const raw = readFileSync(p, 'utf-8')
      const user = JSON.parse(raw)

      const get = (key) => user[PREFIX + key] !== undefined ? user[PREFIX + key] : user[key]

      for (const k of userFields) {
        const v = get(k)
        if (v !== undefined) defaults[k] = v
      }

      console.log('[play_QQ] 已加载配置文件:', p)
      break
    } catch (e) {
      console.warn('[play_QQ] 配置文件读取失败:', p, e.message)
    }
  }
}

loadUserConfig()

// 监听配置文件变化，锅巴保存后自动重载
const primaryCfg = resolve(__dirname, '..', 'config.json')
if (existsSync(primaryCfg)) {
  watch(primaryCfg, () => setTimeout(loadUserConfig, 1000))
} else {
  const pluginDir = resolve(__dirname, '..')
  const dirWatcher = watch(pluginDir, (_, filename) => {
    if (filename === 'config.json' && existsSync(primaryCfg)) {
      setTimeout(loadUserConfig, 1000)
      watch(primaryCfg, () => setTimeout(loadUserConfig, 1000))
      dirWatcher.close()
    }
  })
}

export const config = defaults
