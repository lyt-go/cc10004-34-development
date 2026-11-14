import type { OverlapDef, SandboxResult } from './hit-sandbox'

/**
 * 命中批次与沙盘草稿的本地持久化。
 * 批次只追加不修改（复核状态除外）：画像换版产生的新批次用 previousBatchNo 指向旧批次，
 * 旧批次的内容原样保留，刷新、返回、重新进入都按存档读取。
 *
 * 这里每次调用都直接读 localStorage，不做模块级缓存：两个标签页同时提交时，
 * 后手也能看到先手刚写入的批次，从而给出冲突提示而不是各写一份。
 */

export type HitBatchStatus = '已生效' | '待复核'
export type HitBatchSource = '正式提交' | '画像换版重新排队'
export type HitLayerRequeue = {
  layerKey: string
  layerName: string
  state: '重新排队' | '沿用'
  reason: string
}

export type HitBatch = {
  batchNo: string
  requestId: string
  profileCode: string
  profileName: string
  profileVersion: string
  profileStatus: string
  planCode: string
  planName: string
  planStatus: string
  source: HitBatchSource
  status: HitBatchStatus
  createdAt: string
  operatedBy: string
  previousBatchNo: string | null
  signature: string
  ratios: Record<string, number>
  whitelist: string[]
  /** 提交时的画像 / 方案字段快照，之后模块里的记录再变也不影响本批次。 */
  profileSnapshot: Record<string, string>
  planSnapshot: Record<string, string>
  coverage: number
  ratioTotal: number
  overlaps: OverlapDef[]
  layerRequeue: HitLayerRequeue[]
  result: SandboxResult
  reviewedAt: string | null
}

export type SandboxDraft = {
  key: string
  profileCode: string
  planCode: string
  ratios: Record<string, number>
  whitelist: string
  previewCount: number
  updatedAt: string
}

/**
 * 画像换版用到的分层覆盖：正式系统里由画像任务回写，
 * 前端示例数据用这里模拟「只改分层区间和人数」的一次换版。
 */
export type ProfileOverride = {
  profileCode: string
  version: string
  layers: { key: string; name: string; interval: string; population: number }[]
  overlaps: {
    higher: string
    lower: string
    count: number
    reason: string
    sampleUsers: string[]
  }[]
}

const BATCH_KEY = 'data-product-ops:hit-batches'
const DRAFT_KEY = 'data-product-ops:hit-sandbox-drafts'
const OVERRIDE_KEY = 'data-product-ops:profile-overrides'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return clone(fallback)
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

export function readBatches(): HitBatch[] {
  const stored = readJson<HitBatch[]>(BATCH_KEY, [])
  return Array.isArray(stored) ? stored : []
}

export function findBatch(batchNo: string): HitBatch | null {
  return readBatches().find((item) => item.batchNo === batchNo) ?? null
}

export function batchesFor(profileCode: string, planCode: string): HitBatch[] {
  return readBatches().filter(
    (item) => item.profileCode === profileCode && item.planCode === planCode,
  )
}

export function appendBatch(batch: HitBatch): void {
  writeJson(BATCH_KEY, [...readBatches(), batch])
}

/**
 * 只撤销本次请求自己刚写入、但在并发竞争里落败的那条批次；
 * 胜出批次的编号由所有参与者按同一规则（最小批次号）选出，所以两边结论一致。
 */
export function removeOwnBatch(batchNo: string, requestId: string): void {
  const next = readBatches().filter(
    (batch) => !(batch.batchNo === batchNo && batch.requestId === requestId),
  )
  writeJson(BATCH_KEY, next)
}

/**
 * 并发提交的判定：同一画像 + 方案 + 版本只保留批次号最小的一条（批次号相同再按请求号排）。
 * 自己不是胜者时撤掉自己刚写的那条并返回胜者批次号；是胜者则返回 null。
 * 所有参与者读的是同一份存档、用同一规则排序，因此两边给出的结论一致。
 */
export function resolveFirstBatch(input: {
  profileCode: string
  planCode: string
  profileVersion: string
  batchNo: string
  requestId: string
}): string | null {
  const candidates = readBatches()
    .filter(
      (batch) =>
        batch.profileCode === input.profileCode &&
        batch.planCode === input.planCode &&
        batch.profileVersion === input.profileVersion,
    )
    .sort((a, b) => a.batchNo.localeCompare(b.batchNo) || a.requestId.localeCompare(b.requestId))
  const winner = candidates[0]
  if (!winner || winner.requestId === input.requestId) {
    return null
  }
  removeOwnBatch(input.batchNo, input.requestId)
  return winner.batchNo
}

/** 只允许更新复核状态和复核时间，命中结果与快照保持不可变。 */
export function markBatchReviewed(batchNo: string, reviewedAt: string): boolean {
  const batches = readBatches()
  const index = batches.findIndex((item) => item.batchNo === batchNo)
  if (index < 0) {
    return false
  }
  batches[index] = { ...batches[index], status: '已生效', reviewedAt }
  writeJson(BATCH_KEY, batches)
  return true
}

export function readDrafts(): Record<string, SandboxDraft> {
  const stored = readJson<Record<string, SandboxDraft>>(DRAFT_KEY, {})
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
}

export function readSandboxDraft(key: string): SandboxDraft | null {
  return readDrafts()[key] ?? null
}

export function saveSandboxDraft(draft: SandboxDraft): void {
  writeJson(DRAFT_KEY, { ...readDrafts(), [draft.key]: draft })
}

export function removeSandboxDraft(key: string): void {
  const next = readDrafts()
  delete next[key]
  writeJson(DRAFT_KEY, next)
}

export function readProfileOverrides(): Record<string, ProfileOverride> {
  const stored = readJson<Record<string, ProfileOverride>>(OVERRIDE_KEY, {})
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
}

export function saveProfileOverride(override: ProfileOverride): void {
  writeJson(OVERRIDE_KEY, { ...readProfileOverrides(), [override.profileCode]: override })
}
