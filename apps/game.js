import { config } from '../lib/config.js'
import { narrateStep, checkEndCondition, generateSummary } from '../lib/llm.js'
import * as scenario from '../lib/scenario.js'
import * as state from '../lib/state.js'

// Bot 全局对象由 TRSS-Yunzai 运行时注入，延迟获取
function getBot () {
  if (global.Bot) return global.Bot
  return null
}

function replyToGroup (groupId, msg) {
  const Bot = getBot()
  if (Bot?.pickGroup) {
    return Bot.pickGroup(String(groupId)).sendMsg(msg)
  }
  console.warn('[play_QQ] Bot 不可用，无法发送群消息到:', groupId)
}

async function sendPrivateMsg (userId, msg) {
  const Bot = getBot()
  if (Bot?.pickUser) {
    try {
      await Bot.pickUser(String(userId)).sendMsg(msg)
      return true
    } catch (e) {
      console.error(`[play_QQ] 私聊发送失败 user=${userId}:`, e.message)
      return false
    }
  }
  return false
}

export class GameApp extends plugin {
  constructor () {
    super({
      name: 'play_QQ:game',
      dsc: 'QQ群情景演绎游戏 — 报名/分配/进程/结束',
      event: 'message',
      priority: 100,
      rule: [
        // Registration
        { reg: '^/start$|^#开始游戏$', fnc: 'startRegistration' },
        { reg: '^(加一|\\+1|报名|参与)$', fnc: 'joinRegistration' },
        { reg: '^/cancel$|^#取消游戏$', fnc: 'cancelGame' },

        // Admin
        { reg: '^/end$|^#结束游戏$', fnc: 'forceEndGame' },
        { reg: '^#状态$', fnc: 'showGameStatus' },

        // Help
        { reg: '^#游戏help$|^#游戏帮助$', fnc: 'showGameHelp' },

        // Scenario management
        { reg: '^#情景列表$', fnc: 'listScenarios' },
        { reg: '^#查看情景\\s*(\\S+)?$', fnc: 'viewScenario' },
        { reg: '^#加载情景\\s+(\\S+)$', fnc: 'loadScenarioForGame' },

        // Retry identity
        { reg: '^查看身份$', fnc: 'retryShowIdentity' },

        // Catch-all for game interactions (low priority)
        { reg: '.*', fnc: 'onGameInteraction', priority: 500 },
      ],
    })

  }

  // ========== 报名阶段 ==========

  async startRegistration () {
    if (!this.e.isGroup) return this.e.reply('请在群内使用此命令')

    const groupId = String(this.e.group_id)

    if (!config.allowSameGroup && state.hasActiveGame(groupId)) {
      return this.e.reply('本群已有游戏在进行中，请等待当前游戏结束')
    }

    const gameScenario = scenario.getDefaultScenario()
    if (!gameScenario) {
      return this.e.reply('暂无可用情景脚本，请联系管理员配置')
    }

    const game = state.getOrCreateGame(groupId, this.e.group_name || '', gameScenario)
    state.setPhase(groupId, 'REGISTERING')
    if (config.debugMode) console.log(`[play_QQ] 群${groupId} 开始报名: ${gameScenario.name}`)

    const timeoutMs = (config.registrationTimeout || 60) * 1000
    const timerId = setTimeout(() => this.autoLockRegistration(groupId), timeoutMs)
    state.storeTimer(groupId, timerId)

    const msg = [
      `【${gameScenario.name}】报名开始！`,
      `简介: ${gameScenario.description}`,
      `人数要求: ${gameScenario.min_players}-${gameScenario.max_players} 人`,
      `报名时间: ${config.registrationTimeout || 60} 秒`,
      '',
      '发送 "加一" 或 "+1" 参与报名',
      '发送 "/cancel" 取消游戏',
    ].join('\n')
    await this.e.reply(msg)
  }

  async joinRegistration () {
    if (!this.e.isGroup) return

    const groupId = String(this.e.group_id)
    const game = state.getGame(groupId)
    if (!game || game.phase !== 'REGISTERING') return

    const userId = String(this.e.user_id)
    const userName = this.e.sender?.card || this.e.sender?.nickname || `用户${userId}`

    if (state.hasPlayer(groupId, userId)) {
      return this.e.reply('你已经报名过了~')
    }

    state.addPlayer(groupId, userId, userName)
    const count = state.getPlayerCount(groupId)

    if (count >= game.scenario.max_players) {
      state.clearGameTimers(groupId)
      await this.e.reply(`${userName} 报名成功！人数已满 (${count}/${game.scenario.max_players})，即将分配身份...`)
      await this.assignRoles(groupId)
    } else {
      await this.e.reply(`${userName} 报名成功！(${count}/${game.scenario.max_players})`)
    }
  }

  async autoLockRegistration (groupId) {
    const game = state.getGame(groupId)
    if (!game || game.phase !== 'REGISTERING') return

    state.clearGameTimers(groupId)

    if (game.players.length < game.scenario.min_players) {
      replyToGroup(groupId, `报名截止，人数不足 ${game.scenario.min_players} 人，游戏取消。`)
      state.deleteGame(groupId)
      return
    }

    replyToGroup(groupId, `报名截止！共 ${game.players.length} 人参与，正在分配身份...`)
    await this.assignRoles(groupId)
  }

  async cancelGame () {
    if (!this.e.isGroup) return

    const groupId = String(this.e.group_id)
    const game = state.getGame(groupId)

    if (!game || game.phase === 'IDLE' || game.phase === 'ENDED') {
      return this.e.reply('没有正在进行的游戏')
    }

    if (!this.e.isMaster) {
      return this.e.reply('只有管理员可以取消游戏')
    }

    state.deleteGame(groupId)
    await this.e.reply('游戏已取消')
    return true
  }

  // ========== 身份分配 ==========

  async assignRoles (groupId) {
    const game = state.getGame(groupId)
    if (!game) return

    state.setPhase(groupId, 'ASSIGNING')
    state.assignRoles(groupId)

    // 通过私聊发放身份
    let dmSuccess = 0
    for (const player of game.players) {
      const role = state.getPlayerRole(groupId, player.userId)
      const msg = [
        '【身份卡】',
        `游戏: ${game.scenario.name}`,
        `你的身份: ${role}`,
        '',
        '请牢记你的身份，等待主持人的引导。',
        '游戏过程中请注意查看群消息和私聊指令。',
      ].join('\n')

      const sent = await sendPrivateMsg(player.userId, msg)
      if (sent) {
        dmSuccess++
      } else {
        replyToGroup(groupId, `@${player.userName} 无法发送私聊。请先向机器人发送任意私聊消息（开启临时会话），然后在群里回复"查看身份"重试。`)
      }
    }

    replyToGroup(groupId, [
      `身份已发放完毕！(${dmSuccess}/${game.players.length} 人已收到私聊)`,
      `共 ${game.players.length} 位玩家，游戏即将开始...`,
    ].join('\n'))

    // 短暂延迟后开始游戏
    await new Promise(r => setTimeout(r, 3000))
    state.setPhase(groupId, 'IN_GAME')
    if (config.debugMode) console.log(`[play_QQ] 群${groupId} 游戏开始: ${game.players.length}人, 角色:`, game.roleMap)

    // 启动游戏循环（异步执行，不阻塞当前消息处理）
    this.runGameLoop(groupId)
  }

  // ========== 游戏循环 ==========

  async runGameLoop (groupId) {
    const game = state.getGame(groupId)
    if (!game) return

    // 发送开场白
    const intro = [
      `===== ${game.scenario.name} 正式开始 =====`,
      `玩家名单: ${game.players.map(p => p.userName).join('、')}`,
      '',
      '我是本局主持人，请各位听从引导，祝游戏愉快！',
    ].join('\n')
    replyToGroup(groupId, intro)

    // 初始化步骤
    state.setPhase(groupId, 'IN_GAME')

    while (true) {
      const g = state.getGame(groupId)
      if (!g || g.phase === 'ENDED') return

      const step = state.advanceStep(groupId)
      if (!step) {
        // 所有步骤完成
        replyToGroup(groupId, '所有游戏步骤已完成！')
        await this.endGame(groupId)
        return
      }

      try {
        const context = this.buildStepContext(g)
        const narrative = await narrateStep(g.scenario.name, step.prompt, context)

        // 记录历史
        g.stepHistory.push({
          stepId: step.step,
          output: narrative,
          timestamp: Date.now(),
        })

        if (config.debugMode) console.log(`[play_QQ] 群${groupId} 步骤${g.currentStepIndex + 1}/${g.scenario.game_process.length}: ${step.step}`)

        // 群内播报叙事
        replyToGroup(groupId, narrative)

        // 处理交互步骤
        if (step.type === 'vote' || step.type === 'multi_vote') {
          await this.waitForInteraction(groupId, step)
          await this.processVoteResult(groupId)
        } else if (step.type === 'discuss') {
          await this.waitForInteraction(groupId, step)
        } else if (step.type === 'choose') {
          await this.waitForInteraction(groupId, step)
        }
        // narrate 类型：自动推进

        // 检查结束条件
        if (g.scenario.end_condition) {
          try {
            const ended = await checkEndCondition(g.scenario.end_condition, g)
            if (ended) {
              replyToGroup(groupId, '触发结束条件，游戏即将结束...')
              await this.endGame(groupId)
              return
            }
          } catch (e) {
            console.error('[play_QQ] 结束条件判定失败:', e.message)
            // 不中断游戏
          }
        }
      } catch (e) {
        console.error('[play_QQ] 步骤执行失败:', e.message)
        replyToGroup(groupId, `[主持人] 步骤执行异常: ${e.message}，继续下一步...`)
      }
    }
  }

  buildStepContext (game) {
    const parts = []
    parts.push(`存活玩家: ${state.getAlivePlayerNames(game.groupId).join('、')}`)
    if (game.stepHistory.length > 0) {
      const last = game.stepHistory[game.stepHistory.length - 1]
      parts.push(`上一步: ${last.output.slice(0, 200)}`)
    }
    if (game.metadata.lastResult) {
      parts.push(`上一步结果: ${game.metadata.lastResult}`)
    }
    return parts.join('\n')
  }

  // ========== 交互等待 ==========

  async waitForInteraction (groupId, step) {
    const game = state.getGame(groupId)
    if (!game) return

    const timeoutMs = (step.timeout || config.gameStepTimeout || 60) * 1000

    state.setPendingAction(groupId, {
      type: step.type,
      targetRole: step.targetRole || null,
      expiresAt: Date.now() + timeoutMs,
    })

    // 等待超时或所有投票完成
    await new Promise(resolve => {
      state.setInteractionResolve(groupId, resolve)

      const timerId = setTimeout(() => {
        const g = state.getGame(groupId)
        if (g && g.pendingAction) g.pendingAction.resolved = true
        state.resolveInteraction(groupId)
      }, timeoutMs)

      state.storeTimer(groupId, timerId)
    })

    const g = state.getGame(groupId)
    if (!g || !g.pendingAction) return

    const voteCount = Object.keys(g.pendingAction.votes).length
    if (voteCount > 0) {
      replyToGroup(groupId, `互动时间结束，共收到 ${voteCount} 条投票/选择`)
    }
  }

  async processVoteResult (groupId) {
    const game = state.getGame(groupId)
    if (!game || !game.pendingAction) return

    const tally = state.tallyVotes(groupId)
    const entries = Object.entries(tally)

    if (entries.length === 0) {
      game.metadata.lastResult = '无人投票，本轮流局'
      replyToGroup(groupId, '无人投票，本轮流局')
      state.clearPendingAction(groupId)
      return
    }

    // 找最高票
    entries.sort((a, b) => b[1] - a[1])
    const maxVotes = entries[0][1]
    const topTargets = entries.filter(([, c]) => c === maxVotes)

    let eliminatedId
    if (topTargets.length === 1) {
      eliminatedId = topTargets[0][0]
    } else {
      // 平票：随机选一个
      eliminatedId = topTargets[Math.floor(Math.random() * topTargets.length)][0]
    }

    const eliminated = game.players.find(p => p.userId === eliminatedId)
    if (eliminated) {
      state.eliminatePlayer(groupId, eliminatedId)
      game.metadata.lastResult = `${eliminated.userName} 被投票处决`
      game.metadata.lastEliminated = eliminated.userName
      replyToGroup(groupId, [
        `投票结果: ${eliminated.userName} 被处决`,
        `各角色票数: ${entries.map(([id, c]) => {
          const p = game.players.find(pl => pl.userId === id)
          return `${p?.userName || id}: ${c}票`
        }).join(', ')}`,
      ].join('\n'))
    }

    state.clearPendingAction(groupId)
  }

  // ========== 交互处理 ==========

  async onGameInteraction () {
    if (!this.e.isGroup) return

    const groupId = String(this.e.group_id)
    const game = state.getGame(groupId)

    if (!game || !game.pendingAction || game.pendingAction.resolved) return

    const userId = String(this.e.user_id)

    if (!state.hasPlayer(groupId, userId)) return

    // 检查角色限制
    if (game.pendingAction.targetRole) {
      const playerRole = state.getPlayerRole(groupId, userId)
      if (playerRole !== game.pendingAction.targetRole) return
    }

    const paType = game.pendingAction.type

    if (paType === 'vote' || paType === 'multi_vote') {
      const target = this.parseVoteTarget(game)
      if (!target) {
        if (this._ambiguousNames) {
          const names = this._ambiguousNames; this._ambiguousNames = null
          return this.e.reply(`找到多个匹配: ${names.join('、')}，请使用编号或@指定`)
        }
        return this.e.reply('请指定投票目标：@用户 或回复存活玩家编号')
      }
      this._ambiguousNames = null
      if (target === userId) {
        return this.e.reply('不能投票给自己！')
      }
      if (!game.alivePlayers.has(target)) {
        return this.e.reply('该玩家已出局，请选择其他目标')
      }

      const recorded = state.recordVote(groupId, userId, target)
      if (!recorded) {
        return this.e.reply('你已经投过票了！')
      }

      const targetPlayer = game.players.find(p => p.userId === target)
      await this.e.reply(`投票已记录: ${targetPlayer?.userName || target}`)

      // 检查是否所有有资格的人都投票了
      const eligible = state.getEligibleVoters(groupId, game.pendingAction.targetRole)
      const voted = Object.keys(game.pendingAction.votes).length
      if (voted >= eligible.length) {
        game.pendingAction.resolved = true
        state.clearGameTimers(groupId)
        state.resolveInteraction(groupId)
      }
    } else if (paType === 'choose') {
      const target = this.parseVoteTarget(game)
      if (!target) {
        if (this._ambiguousNames) {
          const names = this._ambiguousNames; this._ambiguousNames = null
          return this.e.reply(`找到多个匹配: ${names.join('、')}，请使用编号回复`)
        }
        return this.e.reply('请回复目标玩家的编号')
      }
      this._ambiguousNames = null
      state.recordVote(groupId, userId, target)
      game.pendingAction.resolved = true
      state.clearGameTimers(groupId)
      state.resolveInteraction(groupId)
      await this.e.reply('选择已记录')
    } else if (paType === 'discuss') {
      // 讨论阶段：记录参与即可，不需要特殊处理
      game.pendingAction.votes[userId] = 'discussed'
    }
  }

  parseVoteTarget (game) {
    // @ 提及
    if (this.e.at && this.e.at.length > 0) {
      return String(this.e.at[0])
    }

    // 数字编号
    const msg = (this.e.msg || '').trim()
    const numMatch = msg.match(/^(\d+)$/)
    if (numMatch) {
      const idx = parseInt(numMatch[1]) - 1
      const alive = state.getAlivePlayers(game.groupId)
      if (idx >= 0 && idx < alive.length) {
        return alive[idx].userId
      }
    }

    // 按名字精确匹配优先
    const alive = state.getAlivePlayers(game.groupId)
    const exact = alive.find(p => msg === p.userName)
    if (exact) return exact.userId

    // 模糊匹配
    const fuzzy = alive.filter(p =>
      msg.includes(p.userName) || p.userName.includes(msg)
    )
    if (fuzzy.length === 1) return fuzzy[0].userId
    if (fuzzy.length > 1) {
      this._ambiguousNames = fuzzy.map(p => p.userName)
      return null // 调用方应提示歧义
    }

    return null
  }

  // ========== 结束阶段 ==========

  async forceEndGame () {
    if (!this.e.isGroup) return

    const groupId = String(this.e.group_id)
    const game = state.getGame(groupId)

    if (!game || game.phase === 'IDLE') {
      return this.e.reply('没有正在进行的游戏')
    }

    if (!this.e.isMaster) {
      return this.e.reply('只有管理员可以强制结束游戏')
    }

    game.phase = 'ENDED'
    state.clearPendingAction(groupId)
    state.resolveInteraction(groupId)

    await this.e.reply('游戏已强制结束，正在生成总结...')
    await this.endGame(groupId)
    return true
  }

  async endGame (groupId) {
    const game = state.getGame(groupId)
    if (!game) return

    state.setPhase(groupId, 'ENDED')
    if (config.debugMode) console.log(`[play_QQ] 群${groupId} 游戏结束, 存活: ${game.alivePlayers.size}/${game.players.length}`)
    state.clearGameTimers(groupId)
    state.clearPendingAction(groupId)

    try {
      const summary = await generateSummary(
        game.scenario,
        game.stepHistory,
        game.roleMap,
        game.players
      )

      const roleReveal = game.players
        .map(p => `${p.userName}: ${game.roleMap[p.userId]}`)
        .join('\n')

      const msg = [
        '===== 游戏结束 =====',
        '',
        summary,
        '',
        '【身份揭晓】',
        roleReveal,
      ].join('\n')
      replyToGroup(groupId, msg)
    } catch (e) {
      console.error('[play_QQ] 生成总结失败:', e.message)

      const roleReveal = game.players
        .map(p => `${p.userName}: ${game.roleMap[p.userId]}`)
        .join('\n')

      replyToGroup(groupId, [
        '游戏结束！',
        '',
        '【身份揭晓】',
        roleReveal,
        '',
        `(总结生成失败: ${e.message})`,
      ].join('\n'))
    }

    // 30秒后自动清理（仅当游戏仍处于 ENDED 状态时清理）
    const cleanupTimer = setTimeout(() => {
      const g = state.getGame(groupId)
      if (g && g.phase === 'ENDED') {
        state.deleteGame(groupId)
      }
    }, (config.cleanupDelay ?? 30) * 1000)
    state.storeTimer(groupId, cleanupTimer)
  }

  // ========== 情景管理 ==========

  async listScenarios () {
    const summaries = scenario.listScenarioSummaries()
    if (summaries.length === 0) {
      return this.e.reply('暂无可用情景脚本')
    }

    const current = config.currentScenario || (summaries[0] ? summaries[0].id : '')

    const lines = ['【可用情景列表】', '']
    for (const s of summaries) {
      const marker = s.id === current ? ' *' : ''
      lines.push(`${marker} ${s.id} — ${s.name}`)
      lines.push(`   人数: ${s.players} | 步骤: ${s.steps} | ${s.description}`)
    }
    lines.push('', '带 * 的为当前默认情景')
    lines.push('发送 "#加载情景 <id>" 切换情景')

    await this.e.reply(lines.join('\n'))
  }

  async viewScenario () {
    const id = (this.e.msg.match(/#查看情景\s*(\S+)/)?.[1] || '').trim()
    if (!id) return this.e.reply('请指定情景ID，如: #查看情景 werewolf')

    const s = scenario.getScenario(id)
    if (!s) return this.e.reply(`未找到情景: ${id}`)

    const lines = [
      `【${s.name}】(${s.id})`,
      `描述: ${s.description}`,
      `人数: ${s.min_players}-${s.max_players}`,
      `角色: ${s.roles.join(', ')}`,
      '',
      '游戏流程:',
    ]
    for (const step of s.game_process) {
      lines.push(`  ${step.step} [${step.type}] ${step.prompt.slice(0, 50)}...`)
    }
    if (s.end_condition) lines.push(`\n结束条件: ${s.end_condition}`)

    await this.e.reply(lines.join('\n'))
  }

  async loadScenarioForGame () {
    if (!this.e.isMaster) {
      return this.e.reply('只有管理员可以切换情景')
    }

    const id = (this.e.msg.match(/#加载情景\s+(\S+)/)?.[1] || '').trim()
    const s = scenario.getScenario(id)
    if (!s) return this.e.reply(`未找到情景: ${id}`)

    config.currentScenario = id
    await this.e.reply(`已切换默认情景为: ${s.name} (${id})，即刻生效`)
  }

  // ========== 帮助 ==========

  async showGameHelp () {
    const help = [
      '===== 情景演绎游戏 =====',
      '',
      '【游戏流程】',
      '/start 或 #开始游戏   — 发起报名',
      '加一 / +1 / 报名      — 参与报名',
      '/cancel 或 #取消游戏  — 取消报名/游戏（管理员）',
      '/end 或 #结束游戏     — 强制结束（管理员）',
      '查看身份               — 重新获取身份私聊',
      '#状态                  — 查看当前游戏状态',
      '',
      '【游戏中】',
      '@用户名                — 投票给某人',
      '数字                   — 选择第N个玩家',
      '',
      '【情景管理】',
      '#情景列表              — 查看可用情景',
      '#查看情景 <id>         — 查看情景详情',
      '#加载情景 <id>         — 切换默认情景（管理员）',
      '',
      '#游戏help              — 显示本帮助',
      '=========================',
    ].join('\n')
    await this.e.reply(help)
  }

  async retryShowIdentity () {
    if (!this.e.isGroup) return

    const groupId = String(this.e.group_id)
    const game = state.getGame(groupId)
    const userId = String(this.e.user_id)

    if (!game || !state.hasPlayer(groupId, userId)) {
      return this.e.reply('你不在本局游戏中，无需查看身份')
    }

    const role = state.getPlayerRole(groupId, userId)
    const msg = [
      '【身份卡】',
      `游戏: ${game.scenario.name}`,
      `你的身份: ${role}`,
      '',
      '请牢记你的身份，等待主持人的引导。',
    ].join('\n')

    const sent = await sendPrivateMsg(userId, msg)
    if (sent) {
      await this.e.reply('身份已通过私聊重新发送，请查收~')
    } else {
      await this.e.reply('仍然无法发送私聊。请确认已向机器人发送过任意私聊消息以开启临时会话。')
    }
  }

  // ========== 状态查询 ==========

  async showGameStatus () {
    if (!this.e.isGroup) return

    const groupId = String(this.e.group_id)
    const game = state.getGame(groupId)

    if (!game || game.phase === 'IDLE') {
      return this.e.reply('本群暂无游戏')
    }

    if (game.phase === 'ENDED') {
      return this.e.reply('本群游戏已结束，等待清理中')
    }

    const phaseNames = {
      REGISTERING: '报名中',
      ASSIGNING: '分配身份中',
      IN_GAME: '游戏进行中',
      ENDED: '已结束',
    }

    const lines = [
      `【${game.scenario.name}】`,
      `状态: ${phaseNames[game.phase] || game.phase}`,
      `阶段: ${game.phase}`,
    ]

    if (game.phase === 'REGISTERING') {
      lines.push(`已报名: ${game.players.length}/${game.scenario.max_players}`)
      lines.push(`报名玩家: ${game.players.map(p => p.userName).join('、')}`)
    }

    if (game.phase === 'IN_GAME') {
      lines.push(`当前步骤: ${game.currentStepIndex + 1}/${game.scenario.game_process.length}`)
      lines.push(`存活玩家: ${game.alivePlayers.size}/${game.players.length}`)
      if (game.pendingAction) {
        lines.push(`等待互动: ${game.pendingAction.type}`)
        lines.push(`已响应: ${Object.keys(game.pendingAction.votes).length}`)
      }
    }

    await this.e.reply(lines.join('\n'))
  }
}
