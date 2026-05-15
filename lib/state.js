class GameState {
  constructor (groupId, groupName, scenario) {
    this.groupId = groupId
    this.groupName = groupName
    this.scenario = scenario
    this.phase = 'IDLE'
    this.players = []
    this.roleMap = {}
    this.alivePlayers = new Set()
    this.currentStepIndex = -1
    this.stepHistory = []
    this.pendingAction = null
    this.timerIds = []
    this._interactionResolve = null
    this.metadata = {}
    this.createdAt = Date.now()
    this.updatedAt = Date.now()
  }

  toJSON () {
    return {
      groupId: this.groupId,
      groupName: this.groupName,
      scenario: this.scenario,
      phase: this.phase,
      players: this.players,
      roleMap: this.roleMap,
      alivePlayers: [...this.alivePlayers],
      currentStepIndex: this.currentStepIndex,
      stepHistory: this.stepHistory,
      pendingAction: this.pendingAction ? { ...this.pendingAction } : null,
      metadata: this.metadata,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    }
  }

  static fromJSON (data) {
    const state = new GameState(data.groupId, data.groupName, data.scenario)
    state.phase = data.phase || 'IDLE'
    state.players = data.players || []
    state.roleMap = data.roleMap || {}
    state.alivePlayers = new Set(data.alivePlayers || [])
    state.currentStepIndex = data.currentStepIndex ?? -1
    state.stepHistory = data.stepHistory || []
    state.pendingAction = data.pendingAction || null
    state.metadata = data.metadata || {}
    state.timerIds = []
    state._interactionResolve = null
    state.createdAt = data.createdAt || Date.now()
    state.updatedAt = data.updatedAt || Date.now()
    return state
  }

  touch () {
    this.updatedAt = Date.now()
  }
}

// === 内存存储 ===
const games = new Map()

export function getGame (groupId) {
  return games.get(String(groupId)) || null
}

export function getOrCreateGame (groupId, groupName, scenario) {
  const key = String(groupId)
  if (games.has(key)) return games.get(key)
  const game = new GameState(key, groupName, scenario)
  games.set(key, game)
  return game
}

export function deleteGame (groupId) {
  const key = String(groupId)
  const game = games.get(key)
  if (game) {
    clearGameTimers(key)
    resolveInteraction(key)
  }
  games.delete(key)
}

export function hasGameInProgress (groupId) {
  const game = getGame(groupId)
  if (!game) return false
  return game.phase !== 'IDLE' && game.phase !== 'ENDED'
}

export function hasActiveGame (groupId) {
  const game = getGame(groupId)
  if (!game) return false
  return game.phase !== 'IDLE'
}

// === 阶段管理 ===
export function setPhase (groupId, phase) {
  const game = getGame(groupId)
  if (game) {
    game.phase = phase
    game.touch()
  }
}

// === 玩家管理 ===
export function addPlayer (groupId, userId, userName) {
  const game = getGame(groupId)
  if (!game) return false
  const key = String(userId)
  if (game.players.some(p => p.userId === key)) return false
  game.players.push({ userId: key, userName })
  game.alivePlayers.add(key)
  game.touch()
  return true
}

export function removePlayer (groupId, userId) {
  const game = getGame(groupId)
  if (!game) return false
  const key = String(userId)
  game.players = game.players.filter(p => p.userId !== key)
  game.alivePlayers.delete(key)
  game.touch()
  return true
}

export function hasPlayer (groupId, userId) {
  const game = getGame(groupId)
  if (!game) return false
  return game.players.some(p => p.userId === String(userId))
}

export function getPlayerCount (groupId) {
  const game = getGame(groupId)
  return game ? game.players.length : 0
}

export function getAlivePlayers (groupId) {
  const game = getGame(groupId)
  if (!game) return []
  return game.players.filter(p => game.alivePlayers.has(p.userId))
}

export function getAlivePlayerNames (groupId) {
  return getAlivePlayers(groupId).map(p => p.userName)
}

// === 角色管理 ===
export function assignRoles (groupId) {
  const game = getGame(groupId)
  if (!game) return false

  // 解析 "狼人×2" 格式
  const roles = []
  for (const entry of game.scenario.roles) {
    const match = entry.match(/^(.+?)×(\d+)$/)
    if (match) {
      for (let i = 0; i < parseInt(match[2]); i++) roles.push(match[1])
    } else {
      roles.push(entry)
    }
  }

  // Fisher-Yates 洗牌
  const shuffled = [...roles]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  // 分配角色
  game.roleMap = {}
  for (let i = 0; i < game.players.length; i++) {
    game.roleMap[game.players[i].userId] = shuffled[i] || '村民'
  }

  game.touch()
  return true
}

export function getPlayerRole (groupId, userId) {
  const game = getGame(groupId)
  if (!game) return null
  return game.roleMap[String(userId)] || null
}

// === 游戏步骤 ===
export function advanceStep (groupId) {
  const game = getGame(groupId)
  if (!game) return null
  game.currentStepIndex++
  game.touch()
  if (game.currentStepIndex >= game.scenario.game_process.length) return null
  return game.scenario.game_process[game.currentStepIndex]
}

export function getCurrentStep (groupId) {
  const game = getGame(groupId)
  if (!game || game.currentStepIndex < 0) return null
  if (game.currentStepIndex >= game.scenario.game_process.length) return null
  return game.scenario.game_process[game.currentStepIndex]
}

export function isLastStep (groupId) {
  const game = getGame(groupId)
  if (!game) return true
  return game.currentStepIndex >= game.scenario.game_process.length - 1
}

// === 交互管理 ===
export function setPendingAction (groupId, action) {
  const game = getGame(groupId)
  if (!game) return
  game.pendingAction = {
    ...action,
    resolved: false,
    votes: {},
    choices: {},
  }
  game.touch()
}

export function clearPendingAction (groupId) {
  const game = getGame(groupId)
  if (game) {
    game.pendingAction = null
    game.touch()
  }
}

export function setInteractionResolve (groupId, resolveFn) {
  const game = getGame(groupId)
  if (game) game._interactionResolve = resolveFn
}

export function resolveInteraction (groupId) {
  const game = getGame(groupId)
  if (game && game._interactionResolve) {
    const resolve = game._interactionResolve
    game._interactionResolve = null
    resolve()
  }
}

// === 计时器 ===
export function storeTimer (groupId, timerId) {
  const game = getGame(groupId)
  if (game) game.timerIds.push(timerId)
}

export function clearGameTimers (groupId) {
  const game = getGame(groupId)
  if (game) {
    for (const id of game.timerIds) clearTimeout(id)
    game.timerIds = []
  }
}

// === 投票 ===
export function recordVote (groupId, voterId, targetId) {
  const game = getGame(groupId)
  if (!game || !game.pendingAction) return false
  if (game.pendingAction.votes[voterId]) return false
  game.pendingAction.votes[voterId] = targetId
  game.touch()
  return true
}

export function tallyVotes (groupId) {
  const game = getGame(groupId)
  if (!game || !game.pendingAction) return {}

  const tally = {}
  for (const targetId of Object.values(game.pendingAction.votes)) {
    tally[targetId] = (tally[targetId] || 0) + 1
  }
  return tally
}

export function getEligibleVoters (groupId, targetRole) {
  const game = getGame(groupId)
  if (!game) return []
  if (targetRole) {
    return game.players.filter(p =>
      game.alivePlayers.has(p.userId) && game.roleMap[p.userId] === targetRole
    )
  }
  return game.players.filter(p => game.alivePlayers.has(p.userId))
}

// === 淘汰 ===
export function eliminatePlayer (groupId, userId) {
  const game = getGame(groupId)
  if (!game) return false
  game.alivePlayers.delete(String(userId))
  game.touch()
  return true
}
