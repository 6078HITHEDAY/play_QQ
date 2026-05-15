import { config } from './config.js'

const STYLE_PROMPTS = {
  humorous: '你需要用生动有趣的语言推进剧情，保持轻松氛围。每次回复控制在200字以内，适合群聊阅读。',
  serious: '你需要用正式、严谨的语言推进剧情，保持庄重氛围。每次回复控制在200字以内。',
  concise: '你需要用简洁明快的语言推进剧情，每句话尽量不超过30字，追求高效沟通。',
}

const SYS_JUDGE = '你是游戏规则判定器。根据提供的游戏状态判断结束条件是否满足。只回答"是"或"否"，不要有任何其他内容。'

const SYS_SUMMARIZER = '你是一个游戏解说员。请根据游戏过程和身份分配，为这场游戏写一段精彩的总结回顾。用轻松幽默的语气，回顾关键转折点和精彩瞬间。控制在300字以内。'

async function _doCall (systemPrompt, userMessage, options = {}) {
  const apiKey = config.llmApiKey
  if (!apiKey) throw new Error('未配置 LLM API Key，请在 .env 或锅巴面板中设置')

  // 自定义 URL 优先
  let baseUrl = config.llmBaseUrl || 'https://api.openai.com/v1'
  if (config.llmBaseUrl === '__custom__') {
    if (!config.llmCustomBaseUrl) {
      throw new Error('已选择自定义 API 地址但未填写，请在锅巴面板中填写"自定义 API 地址"')
    }
    baseUrl = config.llmCustomBaseUrl
  }

  const model = options.model || config.llmModel || 'gpt-3.5-turbo'
  const timeout = (config.llmTimeout || 30) * 1000

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: options.temperature ?? config.llmTemperature ?? 0.7,
    max_tokens: options.maxTokens ?? config.llmMaxTokens ?? 2000,
  }

  let response
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    })
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new Error(`LLM 请求超时 (${timeout / 1000}秒)，可尝试调大超时时间或检查网络`)
    }
    throw new Error(`LLM 网络请求失败: ${e.message}`)
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new Error(`LLM API 错误 (${response.status}): ${errBody.slice(0, 200)}`)
  }

  const data = await response.json()
  if (!data.choices || !data.choices[0]) {
    throw new Error('LLM 返回数据异常: ' + JSON.stringify(data).slice(0, 200))
  }
  const content = data.choices[0].message?.content
  if (!content && content !== '') {
    throw new Error('LLM 返回空内容，请尝试更换模型或检查 API 配置')
  }
  return content || ''
}

export async function callLLM (systemPrompt, userMessage, options = {}) {
  const maxRetry = config.llmRetry ?? 1
  let lastError

  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      return await _doCall(systemPrompt, userMessage, options)
    } catch (e) {
      lastError = e
      if (attempt < maxRetry) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
  }

  throw lastError
}

function getSysNarrator () {
  const style = STYLE_PROMPTS[config.narratorStyle] || STYLE_PROMPTS.humorous
  return `你是${config.gameMasterName || '主持人'}，正在主持一个QQ群情景演绎游戏。${style}`
}

export async function narrateStep (scenarioName, stepPrompt, context) {
  const userMessage = [
    `游戏: ${scenarioName}`,
    `当前步骤指令: ${stepPrompt}`,
    context || '',
  ].filter(Boolean).join('\n')

  return callLLM(getSysNarrator(), userMessage)
}

export async function checkEndCondition (condition, gameState) {
  const alivePlayerObjects = gameState.players
    .filter(p => gameState.alivePlayers.has(p.userId))

  const alivePlayers = alivePlayerObjects
    .map(p => `${p.userName}(${gameState.roleMap[p.userId]})`)

  const roleDist = {}
  for (const p of alivePlayerObjects) {
    const role = gameState.roleMap[p.userId]
    roleDist[role] = (roleDist[role] || 0) + 1
  }

  const prompt = [
    `结束条件: ${condition}`,
    `存活玩家(${alivePlayers.length}人): ${alivePlayers.join(', ')}`,
    `角色分布: ${JSON.stringify(roleDist)}`,
    '请判断结束条件是否满足，只回答"是"或"否"。',
  ].join('\n')

  const result = await callLLM(SYS_JUDGE, prompt, { temperature: 0.1, maxTokens: 10 })
  return result.trim().includes('是')
}

export async function generateSummary (scenario, stepHistory, roleMap, players) {
  const replay = stepHistory
    .map((s, i) => `第${i + 1}步 [${s.stepId}]: ${s.output}`)
    .join('\n')

  const roleReveal = players
    .map(p => `${p.userName}: ${roleMap[p.userId]}`)
    .join('\n')

  const prompt = [
    `游戏剧本: ${scenario.name}`,
    `游戏过程:\n${replay}`,
    `\n所有玩家身份:\n${roleReveal}`,
    '\n请为这场游戏写一段精彩的总结回顾。',
  ].join('\n')

  return callLLM(SYS_SUMMARIZER, prompt)
}
