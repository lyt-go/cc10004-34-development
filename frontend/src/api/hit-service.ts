import { listEntries } from '@/api/local-service'
import { saveRows } from '@/data/local-store'
import {
  bindingsForProfile,
  effectiveLayers,
  getBinding,
  getBlueprint,
  planGroups,
  ratioTotal,
  simulate,
  splitWhitelist,
} from '@/data/hit-sandbox'
import type {
  Blueprint,
  LayerDef,
  OverlapDef,
  PlanBinding,
  SandboxResult,
} from '@/data/hit-sandbox'
import {
  appendBatch,
  findBatch,
  markBatchReviewed,
  readBatches,
  readProfileOverrides,
  readSandboxDraft,
  removeSandboxDraft,
  resolveFirstBatch,
  saveProfileOverride,
  saveSandboxDraft,
} from '@/data/hit-store'
import type {
  HitBatch,
  HitLayerRequeue,
  ProfileOverride,
  SandboxDraft,
} from '@/data/hit-store'
import type { EntryRow } from '@/data/types'

/**
 * 命中沙盘的业务入口：选画像、圈方案、试算预览、正式提交、批次复核、画像换版重新排队。
 * 页面只调用这里，不直接碰 localStorage，也不自己算命中。
 */

const LOCK_KEY = 'data-product-ops:hit-submit-lock'

export const PREVIEW_HINT =
  '沙盘试算只读：改比例、改名单、反复预览都不会写入批次，也不占用任何实验名额；只有正式提交生成批次后才按批次占用名额。'

export type SandboxProfile = {
  code: string
  name: string
  status: string
  version: string
  dimensions: string
  metrics: string
  intervals: string
  cycle: string
  coverage: number
  coverageText: string
  hasBlueprint: boolean
  /** 非空表示不能展开试算（草稿未定稿 / 已作废仅存档 / 没有分层模型）。 */
  previewBlockedReason: string
  /** 非空表示不能正式提交（未发布 / 方案未生效等）。 */
  submitBlockedReason: string
  boundPlans: string[]
}

export type SandboxPlan = {
  code: string
  name: string
  status: string
  type: string
  ratios: string
  groups: { key: string; label: string; ratio: number }[]
  whitelistText: string
  whitelist: string[]
  page: string
  mutual: string
  previewBlockedReason: string
  submitBlockedReason: string
}

export type SandboxView = {
  profile: SandboxProfile
  plan: SandboxPlan
  binding: PlanBinding | null
  blueprint: Blueprint | null
  result: SandboxResult | null
  layers: LayerDef[]
  overlaps: OverlapDef[]
  ratioTotal: number
  canPreview: boolean
  canSubmit: boolean
  blockReason: string
  notes: string[]
  previewHint: string
}

export type SubmitOutcome = {
  ok: boolean
  message: string
  batchNo?: string
  conflictBatchNo?: string
}

export type RequeueOutcome = {
  ok: boolean
  message: string
  batchNo?: string
}

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

function profileRows(): EntryRow[] {
  return listEntries('profile').items
}

function planRows(): EntryRow[] {
  return listEntries('abgroup').items
}

function findRow(rows: EntryRow[], field: string, code: string): EntryRow | undefined {
  return rows.find((row) => text(row[field]) === code)
}

function rowSnapshot(row: EntryRow, fields: string[]): Record<string, string> {
  const snapshot: Record<string, string> = {}
  for (const field of fields) {
    snapshot[field] = text(row[field])
  }
  return snapshot
}

function effectiveBlueprint(profileCode: string): Blueprint | null {
  const base = getBlueprint(profileCode)
  if (!base) {
    return null
  }
  const override = readProfileOverrides()[profileCode]
  const profileRow = findRow(profileRows(), '画像编号', profileCode)
  const rowVersion = text(profileRow?.['画像版本'])
  // 画像模块被重置或回退过版本时，以模块里的记录为准，覆盖数据自动失效，
  // 避免页面显示 V3.2 而分层还是换版后的状态。
  if (!override || (rowVersion && override.version !== rowVersion)) {
    return base
  }
  return {
    profileCode: base.profileCode,
    coverage: effectiveLayers({
      profileCode: base.profileCode,
      coverage: base.coverage,
      layers: override.layers,
      overlaps: override.overlaps,
    }).reduce((sum, layer) => sum + layer.population, 0),
    layers: override.layers,
    overlaps: override.overlaps,
  }
}

function planStatusBlock(status: string): { preview: string; submit: string } {
  if (status === '已生效') {
    return { preview: '', submit: '' }
  }
  if (status === '方案评审中') {
    return { preview: '', submit: '分流方案评审中：沙盘可试算，方案生效后才能正式提交' }
  }
  if (status === '已下线') {
    return {
      preview: '分流方案已下线：只能查看历史批次，不再展开新的试算',
      submit: '分流方案已下线，不能提交新批次',
    }
  }
  return {
    preview: '分流方案还是草稿：定稿并进入评审后才能展开试算',
    submit: '分流方案还是草稿，不能提交批次',
  }
}

function profileStatusBlock(status: string): { preview: string; submit: string } {
  if (status === '已发布') {
    return { preview: '', submit: '' }
  }
  if (status === '画像评审中') {
    return { preview: '', submit: '画像评审中：可先试算，评审发布后才能正式提交' }
  }
  if (status === '已作废') {
    return {
      preview: '画像已作废：仅保留定义与历史批次供查看，不再展开新的试算',
      submit: '画像已作废，不能新建命中批次',
    }
  }
  return {
    preview: '画像还是草稿：定稿并进入评审后才能展开试算',
    submit: '画像还是草稿，不能提交批次',
  }
}

export function listSandboxProfiles(): SandboxProfile[] {
  return profileRows()
    .map((row) => {
      const code = text(row['画像编号'])
      const blueprint = effectiveBlueprint(code)
      const status = text(row.status)
      const block = profileStatusBlock(status)
      const previewBlockedReason = !blueprint
        ? '该画像没有登记分层模型，只能查看定义，不能试算'
        : block.preview
      return {
        code,
        name: text(row['画像名称']),
        status,
        version: text(row['画像版本']),
        dimensions: text(row['统计维度']),
        metrics: text(row['聚合指标']),
        intervals: text(row['分层区间']),
        cycle: text(row['更新周期']),
        coverage: blueprint
          ? effectiveLayers(blueprint).reduce((sum, layer) => sum + layer.population, 0)
          : Number(text(row['覆盖用户量'])) || 0,
        coverageText: text(row['覆盖用户量']),
        hasBlueprint: Boolean(blueprint),
        previewBlockedReason,
        submitBlockedReason: previewBlockedReason || block.submit,
        boundPlans: bindingsForProfile(code).map((binding) => binding.planCode),
      }
    })
    .sort((a, b) => {
      // 已发布排前面，作废排最后，排期人员先看到能用的画像。
      const weight = (status: string) =>
        status === '已发布' ? 0 : status === '已作废' ? 3 : status === '画像评审中' ? 1 : 2
      return weight(a.status) - weight(b.status) || a.code.localeCompare(b.code)
    })
}

export function listSandboxPlans(profileCode: string): SandboxPlan[] {
  const rows = planRows()
  return bindingsForProfile(profileCode)
    .map((binding) => {
      const row = findRow(rows, '方案编号', binding.planCode)
      if (!row) {
        return null
      }
      const status = text(row.status)
      const block = planStatusBlock(status)
      return {
        code: text(row['方案编号']),
        name: text(row['方案名称']),
        status,
        type: text(row['分流类型']),
        ratios: text(row['分流比例']),
        groups: planGroups(binding, row).map((group) => ({
          key: group.key,
          label: group.label,
          ratio: group.defaultRatio,
        })),
        whitelistText: text(row['白名单用户']),
        whitelist: splitWhitelist(row['白名单用户']),
        page: text(row['生效页面']),
        mutual: text(row['互斥规则']),
        previewBlockedReason: block.preview,
        submitBlockedReason: block.preview || block.submit,
      }
    })
    .filter((item): item is SandboxPlan => item !== null)
}

export type SandboxInput = {
  profileCode: string
  planCode: string
  ratios?: Record<string, number>
  whitelistText?: string
}

/**
 * 展开沙盘：画像定义 + 分流方案 + 分层人群 + 白名单 + 比例 + 命中结果。
 * 只读，不落库。传了 ratios / whitelistText 就按排期人员改过的口径试算。
 */
export function buildSandbox(input: SandboxInput): SandboxView | null {
  const profileRow = findRow(profileRows(), '画像编号', input.profileCode)
  const planRow = findRow(planRows(), '方案编号', input.planCode)
  const profile = listSandboxProfiles().find((item) => item.code === input.profileCode)
  const plan = listSandboxPlans(input.profileCode).find((item) => item.code === input.planCode)
  if (!profileRow || !planRow || !profile || !plan) {
    return null
  }

  const blueprint = effectiveBlueprint(input.profileCode)
  const binding = getBinding(input.profileCode, input.planCode)
  const notes: string[] = []
  let result: SandboxResult | null = null
  let ratioSum = 0

  const canPreview =
    Boolean(blueprint && binding) &&
    !profile.previewBlockedReason &&
    !plan.previewBlockedReason

  if (canPreview && blueprint && binding) {
    const whitelistText = input.whitelistText ?? plan.whitelistText
    const whitelist = splitWhitelist(whitelistText)
    result = simulate({
      blueprint,
      binding,
      planRow,
      ratios: input.ratios,
      whitelist,
    })
    ratioSum = ratioTotal(
      planGroups(binding, planRow).map((group) => ({
        ...group,
        defaultRatio: input.ratios?.[group.key] ?? group.defaultRatio,
      })),
    )
    notes.push(...result.notes)
    if (whitelist.length > 0) {
      notes.push(`本次试算采用 ${whitelist.length} 个白名单用户，名单优先占本组名额`)
    }
  } else if (!blueprint) {
    notes.push('该画像没有登记分层模型，只能查看定义，无法展开命中沙盘')
  } else if (!binding) {
    notes.push('该分流方案没有与所选画像建立对接关系，无法展开命中沙盘')
  } else {
    notes.push(profile.previewBlockedReason || plan.previewBlockedReason)
  }

  const blockReason = profile.submitBlockedReason || plan.submitBlockedReason
  const noHits = result !== null && result.hitTotal === 0
  // 同一方案在同一画像版本下以首个完整批次为准：这里只做提示，真正提交时由锁内校验给出冲突结论。
  const sameVersionBatch = existingForVersion(
    input.profileCode,
    input.planCode,
    profile.version,
  )
  const canSubmit = canPreview && result !== null && result.hitTotal > 0 && !blockReason
  if (noHits && !blockReason) {
    notes.push('本次试算命中为 0，空的命中批次不能提交')
  }
  if (sameVersionBatch) {
    notes.push(
      `画像 ${profile.version} 下已有完整批次 ${sameVersionBatch.batchNo}，同版本再次提交会以该批次号为准并提示冲突；需要新的命中结果请走画像换版重新排队`,
    )
  }

  return {
    profile,
    plan,
    binding: binding ?? null,
    blueprint,
    result,
    layers: blueprint ? effectiveLayers(blueprint) : [],
    overlaps: blueprint?.overlaps ?? [],
    ratioTotal: ratioSum,
    canPreview,
    canSubmit,
    blockReason: canSubmit ? '' : blockReason || (noHits ? '命中为 0，不能提交' : ''),
    notes: Array.from(new Set(notes)),
    previewHint: PREVIEW_HINT,
  }
}

export function draftKey(profileCode: string, planCode: string): string {
  return `${profileCode}::${planCode}`
}

export function loadDraft(profileCode: string, planCode: string): SandboxDraft | null {
  return readSandboxDraft(draftKey(profileCode, planCode))
}

export function rememberDraft(
  profileCode: string,
  planCode: string,
  ratios: Record<string, number>,
  whitelistText: string,
  bumpCount = false,
): SandboxDraft {
  const key = draftKey(profileCode, planCode)
  const previous = readSandboxDraft(key)
  const draft: SandboxDraft = {
    key,
    profileCode,
    planCode,
    ratios,
    whitelist: whitelistText,
    previewCount: (previous?.previewCount ?? 0) + (bumpCount ? 1 : 0),
    updatedAt: new Date().toISOString(),
  }
  saveSandboxDraft(draft)
  return draft
}

export function clearDraft(profileCode: string, planCode: string): void {
  removeSandboxDraft(draftKey(profileCode, planCode))
}

export function defaultRatios(plan: SandboxPlan): Record<string, number> {
  const ratios: Record<string, number> = {}
  for (const group of plan.groups) {
    ratios[group.key] = group.ratio
  }
  return ratios
}

type LockPayload = { token: string; expires: number }

function readLock(): LockPayload | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const raw = window.localStorage.getItem(LOCK_KEY)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as LockPayload
    return parsed && typeof parsed.token === 'string' ? parsed : null
  } catch {
    return null
  }
}

function acquireLock(token: string): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return true
  }
  const current = readLock()
  if (current && current.expires > Date.now()) {
    return false
  }
  window.localStorage.setItem(LOCK_KEY, JSON.stringify({ token, expires: Date.now() + 3000 }))
  return true
}

function releaseLock(token: string): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  if (readLock()?.token === token) {
    window.localStorage.removeItem(LOCK_KEY)
  }
}

function pad(value: number, size = 3): string {
  return String(value).padStart(size, '0')
}

function dateStamp(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1, 2)}${pad(date.getDate(), 2)}`
}

function nextBatchNo(now: Date): string {
  const prefix = `HIT-${dateStamp(now)}-`
  const used = new Set(readBatches().map((batch) => batch.batchNo))
  const maxSeq = readBatches()
    .filter((batch) => batch.batchNo.startsWith(prefix))
    .reduce((max, batch) => {
      const seq = Number(batch.batchNo.split('-').pop())
      return Number.isFinite(seq) ? Math.max(max, seq) : max
    }, 0)
  let seq = maxSeq + 1
  while (used.has(`${prefix}${pad(seq)}`)) {
    seq += 1
  }
  return `${prefix}${pad(seq)}`
}

function signatureOf(
  profileCode: string,
  planCode: string,
  version: string,
  ratios: Record<string, number>,
  whitelist: string[],
): string {
  const ratioPart = Object.keys(ratios)
    .sort()
    .map((key) => `${key}=${ratios[key]}`)
    .join(',')
  return [profileCode, planCode, version, ratioPart, [...whitelist].sort().join(',')].join('|')
}

function existingForVersion(
  profileCode: string,
  planCode: string,
  version: string,
): HitBatch | null {
  return (
    readBatches().find(
      (batch) =>
        batch.profileCode === profileCode &&
        batch.planCode === planCode &&
        batch.profileVersion === version,
    ) ?? null
  )
}

export function profileSnapshotFields(): string[] {
  return [
    '画像编号',
    '画像名称',
    '统计维度',
    '聚合指标',
    '分层区间',
    '更新周期',
    '覆盖用户量',
    '画像版本',
  ]
}

export function planSnapshotFields(): string[] {
  return [
    '方案编号',
    '方案名称',
    '分流类型',
    '分流比例',
    '分组标识',
    '互斥规则',
    '生效页面',
    '白名单用户',
  ]
}

export type SubmitInput = {
  profileCode: string
  planCode: string
  ratios: Record<string, number>
  whitelistText: string
  operator: string
  requestId: string
}

export function submitHitBatch(input: SubmitInput): SubmitOutcome {
  const view = buildSandbox({
    profileCode: input.profileCode,
    planCode: input.planCode,
    ratios: input.ratios,
    whitelistText: input.whitelistText,
  })
  if (!view) {
    return { ok: false, message: '画像或分流方案不存在，无法提交' }
  }
  if (!view.blueprint || !view.binding) {
    return { ok: false, message: '所选画像与分流方案没有对接关系，无法提交' }
  }
  if (!view.canSubmit || !view.result) {
    return { ok: false, message: view.blockReason || '当前沙盘不允许提交' }
  }

  // 重复点击：同一个请求号直接回放已生成的批次，不重复占名额。
  const duplicated = readBatches().find((batch) => batch.requestId === input.requestId)
  if (duplicated) {
    return {
      ok: true,
      message: `本次提交已生成批次 ${duplicated.batchNo}，重复请求按原批次处理，未重复占用名额`,
      batchNo: duplicated.batchNo,
    }
  }

  if (!acquireLock(input.requestId)) {
    return {
      ok: false,
      message: '另一路提交正在生成批次，本次请求按冲突处理，请刷新后查看首个完整批次',
    }
  }

  try {
    // 锁内重新读一遍：两个标签页同时提交时，后手看到的是先手刚写入的批次。
    const first = existingForVersion(input.profileCode, input.planCode, view.profile.version)
    if (first) {
      return {
        ok: false,
        conflictBatchNo: first.batchNo,
        message: `冲突：方案 ${input.planCode} 在画像 ${view.profile.code} ${view.profile.version} 下已有完整批次 ${first.batchNo}，以首个批次号为准，本次提交未执行`,
      }
    }
    const now = new Date()
    const profileRow = findRow(profileRows(), '画像编号', input.profileCode)
    const planRow = findRow(planRows(), '方案编号', input.planCode)
    const batch: HitBatch = {
      batchNo: nextBatchNo(now),
      requestId: input.requestId,
      profileCode: view.profile.code,
      profileName: view.profile.name,
      profileVersion: view.profile.version,
      profileStatus: view.profile.status,
      planCode: view.plan.code,
      planName: view.plan.name,
      planStatus: view.plan.status,
      source: '正式提交',
      status: '已生效',
      createdAt: now.toISOString(),
      operatedBy: input.operator,
      previousBatchNo: null,
      signature: signatureOf(
        view.profile.code,
        view.plan.code,
        view.profile.version,
        input.ratios,
        splitWhitelist(input.whitelistText),
      ),
      ratios: { ...input.ratios },
      whitelist: splitWhitelist(input.whitelistText),
      planSnapshot: planRow ? rowSnapshot(planRow, planSnapshotFields()) : {},
      profileSnapshot: profileRow ? rowSnapshot(profileRow, profileSnapshotFields()) : {},
      coverage: view.profile.coverage,
      ratioTotal: view.ratioTotal,
      overlaps: view.overlaps,
      layerRequeue: view.layers.map((layer) => ({
        layerKey: layer.key,
        layerName: layer.name,
        state: '重新排队',
        reason: '首次提交，整层全量参与试算',
      })),
      result: view.result,
      reviewedAt: now.toISOString(),
    }
    appendBatch(batch)
    // 两路几乎同时写进来时，按批次号最小的一条为「首个完整批次」，落败的一路撤销自己的写入。
    const winner = resolveFirstBatch({
      profileCode: batch.profileCode,
      planCode: batch.planCode,
      profileVersion: batch.profileVersion,
      batchNo: batch.batchNo,
      requestId: batch.requestId,
    })
    if (winner) {
      return {
        ok: false,
        conflictBatchNo: winner,
        message: `冲突：另一路提交先完成，已生成批次 ${winner}；以首个完整批次号为准，本次写入已撤销`,
      }
    }
    clearDraft(input.profileCode, input.planCode)
    return {
      ok: true,
      message: `批次 ${batch.batchNo} 已生成并生效，命中结果绑定画像 ${view.profile.version}`,
      batchNo: batch.batchNo,
    }
  } finally {
    releaseLock(input.requestId)
  }
}

export function listBatches(filter?: { profileCode?: string; planCode?: string }): HitBatch[] {
  // 批次号按日期 + 序号递增，同一时刻的先后用批次号兜底，保证「首个」判定稳定。
  return readBatches()
    .filter(
      (batch) =>
        (!filter?.profileCode || batch.profileCode === filter.profileCode) &&
        (!filter?.planCode || batch.planCode === filter.planCode),
    )
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.batchNo.localeCompare(a.batchNo),
    )
}

export function getBatch(batchNo: string): HitBatch | null {
  return findBatch(batchNo)
}

export function reviewBatch(batchNo: string): { ok: boolean; message: string } {
  const batch = findBatch(batchNo)
  if (!batch) {
    return { ok: false, message: `没有找到批次 ${batchNo}` }
  }
  if (batch.status !== '待复核') {
    return { ok: false, message: `批次 ${batchNo} 当前是「${batch.status}」，不需要复核` }
  }
  const ok = markBatchReviewed(batchNo, new Date().toISOString())
  return ok
    ? { ok: true, message: `批次 ${batchNo} 已复核生效，命中结果保持提交时的原样` }
    : { ok: false, message: `批次 ${batchNo} 复核失败` }
}

export type RequeueInput = {
  profileCode: string
  planCode: string
  newVersion: string
  operator: string
  edits: Record<string, { population?: number; interval?: string }>
}

/**
 * 画像换版：只重算区间/人数发生变化的分层，其余分层沿用上一批次的命中结果，
 * 生成一个新的「待复核」批次；旧批次内容不动，仍按原样查看。
 */
export function requeueForProfileVersion(input: RequeueInput): RequeueOutcome {
  const latest = listBatches({ profileCode: input.profileCode, planCode: input.planCode })[0]
  if (!latest) {
    return { ok: false, message: '还没有已提交的批次，先正式提交一次再换版' }
  }
  const base = getBlueprint(input.profileCode)
  const binding = getBinding(input.profileCode, input.planCode)
  const profileRow = findRow(profileRows(), '画像编号', input.profileCode)
  const planRow = findRow(planRows(), '方案编号', input.planCode)
  if (!base || !binding || !profileRow || !planRow) {
    return { ok: false, message: '画像或方案的对接待补全，无法重新排队' }
  }

  const current = effectiveBlueprint(input.profileCode) ?? base
  const editedLayers = current.layers.map((layer) => ({
    ...layer,
    population: input.edits[layer.key]?.population ?? layer.population,
    interval: input.edits[layer.key]?.interval ?? layer.interval,
  }))
  const newBlueprint: Blueprint = {
    profileCode: base.profileCode,
    // 覆盖用户量按去重后的分层人数合计，与沙盘里展示的口径一致。
    coverage: effectiveLayers({ ...base, layers: editedLayers, overlaps: current.overlaps }).reduce(
      (sum, layer) => sum + layer.population,
      0,
    ),
    layers: editedLayers,
    overlaps: current.overlaps,
  }
  const previousEffective = new Map(effectiveLayers(current).map((layer) => [layer.key, layer]))
  const nextEffective = effectiveLayers(newBlueprint)
  const affected = new Set<string>()
  const reasons = new Map<string, string>()

  for (const layer of nextEffective) {
    const before = previousEffective.get(layer.key)
    if (!before) {
      affected.add(layer.key)
      reasons.set(layer.key, '新增分层，需要重新排队')
      continue
    }
    if (before.population !== layer.population) {
      affected.add(layer.key)
      reasons.set(
        layer.key,
        `本层人数 ${before.population.toLocaleString('zh-CN')} → ${layer.population.toLocaleString('zh-CN')}`,
      )
    }
    if (before.interval !== layer.interval) {
      affected.add(layer.key)
      const prefix = reasons.get(layer.key)
      reasons.set(
        layer.key,
        `${prefix ? `${prefix}；` : ''}分层区间改为「${layer.interval}」`,
      )
    }
  }
  for (const layer of previousEffective.values()) {
    if (!nextEffective.some((item) => item.key === layer.key)) {
      affected.add(layer.key)
      reasons.set(layer.key, '该分层已从画像中移除，相关命中作废重排')
    }
  }

  if (affected.size === 0) {
    return {
      ok: false,
      message: '分层人数与区间都没有变化，无需重新排队；请先修改画像分层',
    }
  }

  const version = input.newVersion.trim()
  if (!version) {
    return { ok: false, message: '换版必须填写新的画像版本号' }
  }
  if (version === latest.profileVersion) {
    return { ok: false, message: `版本号仍是 ${version}，请填写新的版本号` }
  }
  const conflict = existingForVersion(input.profileCode, input.planCode, version)
  if (conflict) {
    return {
      ok: false,
      message: `冲突：方案 ${input.planCode} 在画像 ${input.profileCode} ${version} 下已有批次 ${conflict.batchNo}，以首个完整批次号为准`,
    }
  }

  const simulated = simulate({
    blueprint: newBlueprint,
    binding,
    planRow,
    ratios: latest.ratios,
    whitelist: latest.whitelist,
  })

  // 未受影响的分层沿用上一批次的命中，只把受影响分层替换成新试算结果。
  const previousLayerMap = new Map(latest.result.layers.map((layer) => [layer.layerKey, layer]))
  const mergedLayers = simulated.layers.map((layer) => {
    if (affected.has(layer.layerKey)) {
      return layer
    }
    const previous = previousLayerMap.get(layer.layerKey)
    return previous ? { ...previous } : layer
  })

  const groupMap = new Map(
    simulated.groups.map((group) => [
      group.groupKey,
      { ...group, allocated: 0, whitelistCount: 0, total: 0 },
    ]),
  )
  for (const layer of mergedLayers) {
    for (const [groupKey, counts] of Object.entries(layer.groupCounts)) {
      const target = groupMap.get(groupKey)
      if (!target) {
        continue
      }
      target.allocated += counts.allocated
      target.whitelistCount += counts.whitelistCount
      target.total += counts.total
    }
  }
  const groups = Array.from(groupMap.values())
  const result: SandboxResult = {
    ...simulated,
    layers: mergedLayers,
    groups,
    whitelistTotal: groups.reduce((sum, group) => sum + group.whitelistCount, 0),
    hitTotal: groups.reduce((sum, group) => sum + group.total, 0),
    notes: [
      ...simulated.notes,
      `本次换版影响 ${affected.size} 个分层，其余分层沿用批次 ${latest.batchNo} 的命中结果`,
    ],
  }

  const layerRequeue: HitLayerRequeue[] = mergedLayers.map((layer) => ({
    layerKey: layer.layerKey,
    layerName: layer.layerName,
    state: affected.has(layer.layerKey) ? '重新排队' : '沿用',
    reason: affected.has(layer.layerKey)
      ? reasons.get(layer.layerKey) ?? '分层发生变化'
      : `沿用批次 ${latest.batchNo} 的命中，不重新排队`,
  }))

  // 画像模块同步换版字段，页面与批次快照对得上。
  const nextProfileRow: EntryRow = {
    ...profileRow,
    id: Number(profileRow.id),
    '画像版本': version,
    '分层区间': newBlueprint.layers.map((layer) => `${layer.name} ${layer.interval}`).join(' / '),
    '覆盖用户量': String(newBlueprint.coverage),
  }
  saveRows(
    'profile',
    profileRows().map((row) =>
      Number(row.id) === Number(profileRow.id) ? nextProfileRow : row,
    ),
  )
  const override: ProfileOverride = {
    profileCode: input.profileCode,
    version,
    layers: newBlueprint.layers,
    overlaps: newBlueprint.overlaps,
  }
  saveProfileOverride(override)

  const now = new Date()
  const batch: HitBatch = {
    batchNo: nextBatchNo(now),
    requestId: `requeue-${input.profileCode}-${input.planCode}-${version}-${now.getTime()}`,
    profileCode: input.profileCode,
    profileName: text(profileRow['画像名称']),
    profileVersion: version,
    profileStatus: text(profileRow.status),
    planCode: input.planCode,
    planName: text(planRow['方案名称']),
    planStatus: text(planRow.status),
    source: '画像换版重新排队',
    status: '待复核',
    createdAt: now.toISOString(),
    operatedBy: input.operator,
    previousBatchNo: latest.batchNo,
    signature: signatureOf(
      input.profileCode,
      input.planCode,
      version,
      latest.ratios,
      latest.whitelist,
    ),
    ratios: { ...latest.ratios },
    whitelist: [...latest.whitelist],
    planSnapshot: rowSnapshot(planRow, planSnapshotFields()),
    profileSnapshot: rowSnapshot(nextProfileRow, profileSnapshotFields()),
    coverage: newBlueprint.coverage,
    ratioTotal: ratioTotal(
      latest.ratios
        ? planGroups(binding, planRow).map((group) => ({
            ...group,
            defaultRatio: latest.ratios[group.key] ?? group.defaultRatio,
          }))
        : planGroups(binding, planRow),
    ),
    overlaps: newBlueprint.overlaps,
    layerRequeue,
    result,
    reviewedAt: null,
  }
  appendBatch(batch)

  return {
    ok: true,
    message: `画像换版到 ${version}：${affected.size} 个分层重新排队，生成待复核批次 ${batch.batchNo}；旧批次 ${latest.batchNo} 保持原样`,
    batchNo: batch.batchNo,
  }
}

export function nextVersionText(version: string): string {
  const match = version.match(/^(.*?)(\d+)$/)
  if (!match) {
    return `${version}.1`
  }
  return `${match[1]}${Number(match[2]) + 1}`
}

/**
 * 换版编辑框的初始值：取当前生效的分层（含上一次换版的覆盖），
 * 排期人员只改真正要变的那几层，没改的层会沿用上一批次。
 */
export function currentProfileLayers(
  profileCode: string,
): { key: string; name: string; interval: string; population: number }[] {
  const blueprint = effectiveBlueprint(profileCode)
  return blueprint ? effectiveLayers(blueprint) : []
}

/**
 * 名额口径：批次是整层快照而不是增量，所以按「每个画像最近一个已生效批次」和
 * 「最近一个待复核批次」的命中人数汇总，不把同一画像的多个历史批次叠加。
 * 预览次数单独统计，与名额无关。
 */
export function quotaSummary(planCode: string): {
  committed: number
  pending: number
  batchCount: number
  committedBatch: string | null
  pendingBatch: string | null
} {
  const batches = listBatches({ planCode })
  const latest = new Map<string, { committed?: HitBatch; pending?: HitBatch }>()
  for (const batch of batches) {
    const entry = latest.get(batch.profileCode) ?? {}
    if (batch.status === '已生效' && !entry.committed) {
      entry.committed = batch
    }
    if (batch.status === '待复核' && !entry.pending) {
      entry.pending = batch
    }
    latest.set(batch.profileCode, entry)
  }
  const committed = Array.from(latest.values())
    .map((entry) => entry.committed)
    .filter((batch): batch is HitBatch => Boolean(batch))
  const pending = Array.from(latest.values())
    .map((entry) => entry.pending)
    .filter((batch): batch is HitBatch => Boolean(batch))
  return {
    committed: committed.reduce((sum, batch) => sum + batch.result.hitTotal, 0),
    pending: pending.reduce((sum, batch) => sum + batch.result.hitTotal, 0),
    batchCount: batches.length,
    committedBatch: committed[0]?.batchNo ?? null,
    pendingBatch: pending[0]?.batchNo ?? null,
  }
}
