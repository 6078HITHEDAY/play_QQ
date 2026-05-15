import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCENARIO_PATH = resolve(__dirname, '..', 'data', 'scenarios.json')
const DATA_DIR = resolve(__dirname, '..', 'data')

const REQUIRED_FIELDS = ['id', 'name', 'min_players', 'max_players', 'roles', 'game_process']
const STEP_REQUIRED_FIELDS = ['step', 'prompt']

function ensureDataDir () {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
}

function writeDefaultScenarios () {
  const defaults = [
    {
      id: 'werewolf',
      name: '狼人杀',
      description: '经典狼人杀，狼人、预言家、女巫、村民',
      min_players: 6,
      max_players: 12,
      roles: ['狼人×2', '预言家', '女巫', '猎人', '守卫', '村民×6'],
      game_process: [
        { step: 'night_wolf', type: 'multi_vote', targetRole: '狼人', prompt: '天黑请闭眼。狼人请睁眼，选择今晚要击杀的玩家（私聊回复编号）。', timeout: 60 },
        { step: 'night_seer', type: 'choose', targetRole: '预言家', prompt: '预言家请睁眼，选择要查验身份的玩家（私聊回复编号）。', timeout: 30 },
        { step: 'night_witch', type: 'choose', targetRole: '女巫', prompt: '女巫请睁眼，今晚{dead_players}被杀。是否使用解药或毒药？（私聊回复编号）', timeout: 30 },
        { step: 'day_announce', type: 'narrate', prompt: '天亮了，昨晚{result}。请各位玩家在群里讨论并找出狼人。', timeout: 0 },
        { step: 'day_discuss', type: 'discuss', prompt: '讨论时间，请大家自由发言分析。', timeout: 120 },
        { step: 'vote', type: 'vote', prompt: '现在开始投票处决，请 @你要投票的玩家。', timeout: 60 },
        { step: 'day_result', type: 'narrate', prompt: '投票结果：{result}。', timeout: 0 },
      ],
      end_condition: '狼人全部出局 或 存活狼人数量 >= 存活好人数量',
      end_prompt: '游戏结束！{winner}获胜！\n{summary}',
    },
    {
      id: 'simple_mystery',
      name: '简易推理',
      description: '侦探破案，投票找出真凶',
      min_players: 3,
      max_players: 8,
      roles: ['侦探', '嫌疑人×7'],
      game_process: [
        { step: 'intro', type: 'narrate', prompt: '欢迎来到推理之夜！今晚的案件背景：{scenario_intro}。各位嫌疑人请准备好自己的不在场证明，侦探请仔细观察。', timeout: 0 },
        { step: 'investigate', type: 'choose', targetRole: '侦探', prompt: '侦探，请选择要审问的嫌疑人（私聊回复编号）。', timeout: 60 },
        { step: 'discuss', type: 'discuss', prompt: '请大家在群里讨论案情，分享线索和不在场证明。', timeout: 120 },
        { step: 'vote', type: 'vote', prompt: '现在投票，选出你认为的凶手！请 @你要指认的玩家。', timeout: 60 },
      ],
      end_condition: '投票完成',
      end_prompt: '真相大白！{result}\n{summary}',
    },
  ]
  writeFileSync(SCENARIO_PATH, JSON.stringify(defaults, null, 2), 'utf-8')
  console.log('[play_QQ] 已创建默认情景脚本')
}

export function validateScenario (obj) {
  const errors = []
  for (const field of REQUIRED_FIELDS) {
    if (!(field in obj)) errors.push(`缺少必填字段: ${field}`)
  }
  if (obj.roles && !Array.isArray(obj.roles)) errors.push('roles 必须是数组')
  if (obj.game_process && !Array.isArray(obj.game_process)) errors.push('game_process 必须是数组')
  if (obj.game_process) {
    obj.game_process.forEach((step, i) => {
      for (const f of STEP_REQUIRED_FIELDS) {
        if (!(f in step)) errors.push(`game_process[${i}] 缺少: ${f}`)
      }
    })
  }
  if (obj.min_players > obj.max_players) errors.push('min_players 不能大于 max_players')
  return { valid: errors.length === 0, errors }
}

export function loadScenarios () {
  ensureDataDir()
  if (!existsSync(SCENARIO_PATH)) {
    writeDefaultScenarios()
  }
  try {
    const raw = readFileSync(SCENARIO_PATH, 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch (e) {
    console.error('[play_QQ] 加载情景脚本失败:', e.message)
    return []
  }
}

export function getScenario (id) {
  return loadScenarios().find(s => s.id === id) || null
}

export function getDefaultScenario () {
  const scenarios = loadScenarios()
  if (scenarios.length === 0) return null
  if (config.currentScenario) {
    const found = scenarios.find(s => s.id === config.currentScenario)
    if (found) return found
  }
  return scenarios[0]
}

export function saveScenarios (scenarios) {
  ensureDataDir()
  writeFileSync(SCENARIO_PATH, JSON.stringify(scenarios, null, 2), 'utf-8')
  return true
}

export function addScenario (scenario) {
  const scenarios = loadScenarios()
  if (scenarios.some(s => s.id === scenario.id)) {
    return { success: false, error: `情景 ID "${scenario.id}" 已存在` }
  }
  const validation = validateScenario(scenario)
  if (!validation.valid) {
    return { success: false, error: '校验失败: ' + validation.errors.join('; ') }
  }
  scenarios.push(scenario)
  saveScenarios(scenarios)
  return { success: true }
}

export function updateScenario (id, updates) {
  const scenarios = loadScenarios()
  const idx = scenarios.findIndex(s => s.id === id)
  if (idx === -1) return { success: false, error: `未找到情景: ${id}` }
  scenarios[idx] = { ...scenarios[idx], ...updates }
  saveScenarios(scenarios)
  return { success: true }
}

export function removeScenario (id) {
  const scenarios = loadScenarios()
  const filtered = scenarios.filter(s => s.id !== id)
  if (filtered.length === scenarios.length) {
    return { success: false, error: `未找到情景: ${id}` }
  }
  saveScenarios(filtered)
  return { success: true }
}

export function listScenarioSummaries () {
  return loadScenarios().map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    players: `${s.min_players}-${s.max_players}`,
    steps: s.game_process.length,
  }))
}
