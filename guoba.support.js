import { writeFileSync, existsSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const configPath = resolve(__dirname, 'config.json')

const PREFIX = 'play_QQ.'

const defaults = {
  // 频率限制
  cooldown: 10,
  dailyLimit: 50,

  // LLM 连接
  llmApiKey: '',
  llmBaseUrl: 'https://api.openai.com/v1',
  llmCustomBaseUrl: '',
  llmModel: 'gpt-3.5-turbo',

  // LLM 参数
  llmTemperature: 0.8,
  llmMaxTokens: 2000,
  llmTimeout: 30,
  llmRetry: 1,
  narratorStyle: 'humorous',
  gameMasterName: '主持人',

  // 游戏设置
  currentScenario: '',
  registrationTimeout: 60,
  gameStepTimeout: 120,
  cleanupDelay: 30,

  // 高级
  debugMode: false,
  allowSameGroup: false,
}

const userFields = Object.keys(defaults)

let _cache = null
function readConfig () {
  if (_cache) return _cache
  try {
    if (existsSync(configPath)) {
      const saved = JSON.parse(readFileSync(configPath, 'utf-8'))
      const merged = { ...defaults }
      for (const k of userFields) {
        const v = saved[PREFIX + k] !== undefined ? saved[PREFIX + k] : saved[k]
        if (v !== undefined) merged[k] = v
      }
      _cache = merged
      return _cache
    }
  } catch (_) {}
  _cache = { ...defaults }
  return _cache
}

function clearCache () {
  _cache = null
}

function getScenarioOptions () {
  try {
    const scenarioPath = resolve(__dirname, 'data', 'scenarios.json')
    if (!existsSync(scenarioPath)) return [{ value: '', label: '暂无情景（启动机器人后自动生成）' }]
    const data = JSON.parse(readFileSync(scenarioPath, 'utf-8'))
    if (!Array.isArray(data) || data.length === 0) return [{ value: '', label: '暂无情景' }]
    return data.map(s => ({
      value: s.id,
      label: `${s.name}（${s.min_players}-${s.max_players}人）`,
    }))
  } catch (e) {
    return [{ value: '', label: '情景加载失败，请检查 data/scenarios.json' }]
  }
}

export function supportGuoba () {
  return {
    pluginInfo: {
      name: 'play_QQ',
      title: '情景演绎游戏',
      description: 'QQ群情景演绎游戏 — 狼人杀、推理、自定义剧本，AI主持',
      author: '@myxcat',
      link: 'https://github.com/myflycat/play_QQ',
      isV3: true,
      isV2: false,
      showInMenu: 'auto',
      icon: 'mdi:theater',
      iconColor: '#1976d2',
    },

    configInfo: {
      schemas: [
        // ======== 一、频率限制 ========
        {
          label: '频率限制',
          component: 'SOFT_GROUP_BEGIN',
        },
        {
          field: 'cooldown',
          label: '命令间隔 (秒)',
          bottomHelpMessage: '同一用户两次命令间的最小间隔',
          component: 'InputNumber',
          componentProps: { min: 1, max: 120, placeholder: '10' },
        },
        {
          field: 'dailyLimit',
          label: '每日限额',
          bottomHelpMessage: '每用户每天最大调用次数。设为 0 则不限制',
          component: 'InputNumber',
          componentProps: { min: 0, max: 500, placeholder: '50' },
        },

        // ======== 二、LLM 连接 ========
        {
          label: 'LLM 连接',
          component: 'SOFT_GROUP_BEGIN',
        },
        {
          field: 'llmApiKey',
          label: 'API Key',
          bottomHelpMessage: 'OpenAI 兼容格式的 API 密钥（sk-... 开头）',
          component: 'InputPassword',
          componentProps: { placeholder: 'sk-...' },
        },
        {
          field: 'llmBaseUrl',
          label: 'API 地址',
          bottomHelpMessage: '选择 API 提供商，选"自定义"时请在下方填写地址',
          component: 'Select',
          componentProps: {
            options: [
              { value: 'https://api.openai.com/v1', label: 'OpenAI' },
              { value: 'https://api.deepseek.com/v1', label: 'DeepSeek' },
              { value: 'https://dashscope.aliyuncs.com/compatible-mode/v1', label: '通义千问' },
              { value: 'https://open.bigmodel.cn/api/paas/v4', label: '智谱 GLM' },
              { value: 'https://api.moonshot.cn/v1', label: 'Moonshot' },
              { value: '__custom__', label: '自定义...' },
            ],
          },
        },
        {
          field: 'llmCustomBaseUrl',
          label: '自定义 API 地址',
          bottomHelpMessage: '当上方选择"自定义"时，在此填写完整的 API 地址',
          component: 'Input',
          componentProps: { placeholder: 'https://your-api.example.com/v1' },
        },
        {
          field: 'llmModel',
          label: '模型',
          bottomHelpMessage: '选择模型，注意需与 API 提供商匹配',
          component: 'Select',
          componentProps: {
            options: [
              { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
              { value: 'gpt-4o', label: 'GPT-4o' },
              { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
              { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
              { value: 'gpt-4.1', label: 'GPT-4.1' },
              { value: 'deepseek-chat', label: 'DeepSeek Chat (V3)' },
              { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)' },
              { value: 'qwen-turbo', label: '通义千问 Turbo' },
              { value: 'qwen-plus', label: '通义千问 Plus' },
              { value: 'qwen-max', label: '通义千问 Max' },
              { value: 'glm-4-flash', label: 'GLM-4 Flash' },
              { value: 'glm-4', label: 'GLM-4' },
              { value: 'moonshot-v1-8k', label: 'Moonshot v1 (8K)' },
            ],
          },
        },

        // ======== 三、LLM 参数 ========
        {
          label: 'LLM 参数',
          component: 'SOFT_GROUP_BEGIN',
        },
        {
          field: 'llmTemperature',
          label: '创意度 (Temperature)',
          bottomHelpMessage: '0=严谨，1=更有创意，推荐 0.7-0.9',
          component: 'InputNumber',
          componentProps: { min: 0, max: 2, step: 0.1, placeholder: '0.8' },
        },
        {
          field: 'llmMaxTokens',
          label: '最大输出长度 (Tokens)',
          bottomHelpMessage: '单次 AI 回复的最大长度',
          component: 'InputNumber',
          componentProps: { min: 50, max: 8192, placeholder: '2000' },
        },
        {
          field: 'llmTimeout',
          label: '请求超时 (秒)',
          bottomHelpMessage: 'LLM API 调用超时时间，网络差时可适当调大',
          component: 'InputNumber',
          componentProps: { min: 10, max: 120, placeholder: '30' },
        },
        {
          field: 'llmRetry',
          label: '失败重试次数',
          bottomHelpMessage: 'API 调用失败后的自动重试次数，设为 0 则不重试',
          component: 'InputNumber',
          componentProps: { min: 0, max: 5, placeholder: '1' },
        },
        {
          field: 'narratorStyle',
          label: '叙事风格',
          bottomHelpMessage: '主持人的语言风格偏好',
          component: 'Select',
          componentProps: {
            options: [
              { value: 'humorous', label: '幽默风趣' },
              { value: 'serious', label: '严肃正式' },
              { value: 'concise', label: '简洁明快' },
            ],
          },
        },
        {
          field: 'gameMasterName',
          label: '主持人名称',
          bottomHelpMessage: 'AI 主持人在游戏中的称呼，如"法官"、"DM"',
          component: 'Input',
          componentProps: { placeholder: '主持人' },
        },

        // ======== 四、游戏设置 ========
        {
          label: '游戏设置',
          component: 'SOFT_GROUP_BEGIN',
        },
        {
          field: 'currentScenario',
          label: '默认情景',
          bottomHelpMessage: '发送 /start 时默认启动的游戏情景',
          component: 'Select',
          componentProps: {
            options: getScenarioOptions(),
            placeholder: '自动选择第一个',
          },
        },
        {
          field: 'registrationTimeout',
          label: '报名超时 (秒)',
          bottomHelpMessage: '超过此时间后自动锁定报名名单',
          component: 'InputNumber',
          componentProps: { min: 10, max: 300, placeholder: '60' },
        },
        {
          field: 'gameStepTimeout',
          label: '步骤超时 (秒)',
          bottomHelpMessage: '投票、讨论等互动环节的最大等待时间',
          component: 'InputNumber',
          componentProps: { min: 10, max: 600, placeholder: '120' },
        },
        {
          field: 'cleanupDelay',
          label: '清理延迟 (秒)',
          bottomHelpMessage: '游戏结束后保留状态供查看的时长，之后自动清理',
          component: 'InputNumber',
          componentProps: { min: 0, max: 300, placeholder: '30' },
        },

        // ======== 五、高级 ========
        {
          label: '高级',
          component: 'SOFT_GROUP_BEGIN',
        },
        {
          field: 'debugMode',
          label: '调试模式',
          bottomHelpMessage: '开启后在控制台输出详细游戏日志，排查问题时使用',
          component: 'Switch',
        },
        {
          field: 'allowSameGroup',
          label: '允许同群多场',
          bottomHelpMessage: '开启后同一群可同时进行多场游戏（实验性，可能不稳定）',
          component: 'Switch',
        },
      ],

      getConfigData () {
        return readConfig()
      },

      setConfigData (data, { Result }) {
        try {
          writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf-8')
          clearCache()
          return Result.ok({}, '保存成功，配置即刻生效~')
        } catch (e) {
          return Result.error({}, '保存失败: ' + e.message)
        }
      },
    },
  }
}
