import { config } from './config.js'

const timers = new Map()
const dailyCount = new Map()

function todayKey () {
  const now = new Date()
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
}

function safeNum (val, fallback) {
  const n = Number(val)
  return Number.isFinite(n) ? n : fallback
}

export function checkCooldown (userId) {
  const cd = safeNum(config.cooldown, 10)
  const now = Date.now()
  const last = timers.get(userId)
  if (last && now - last < cd * 1000) {
    const remain = Math.ceil((cd * 1000 - (now - last)) / 1000)
    return { allowed: false, remain }
  }
  timers.set(userId, now)
  return { allowed: true, remain: 0 }
}

export function checkDailyLimit (userId) {
  const limit = safeNum(config.dailyLimit, 50)
  if (limit === 0) return { allowed: true, used: 0, limit: 0 }
  const key = `${userId}_${todayKey()}`
  const used = dailyCount.get(key) || 0
  if (used >= limit) return { allowed: false, used, limit }
  dailyCount.set(key, used + 1)
  return { allowed: true, used: used + 1, limit }
}
