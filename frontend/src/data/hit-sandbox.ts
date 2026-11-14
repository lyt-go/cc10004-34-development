import type { EntryRow } from './types'

/**
 * 命中沙盘的分层模型、方案对接关系和试算引擎。
 * 这里只做纯计算：不读写 localStorage，正式落库在 local-service.ts 里完成。
 */

export type LayerDef = {
  key: string
  name: string
  interval: string
  population: number
}

export type OverlapDef = {
  higher: string
  lower: string
  count: number
  reason: string
  sampleUsers: string[]
}

export type Blueprint = {
  profileCode: string
  layers: LayerDef[]
  overlaps: OverlapDef[]
  coverage: number
}

export type PlanGroupDef = {
  key: string
  label: string
  defaultRatio: number
}

export type WhitelistAssignment = {
  layerKey: string
  groupKey: string
  score?: number
  alsoMatches?: string[]
  boundary?: 'lower' | 'upper'
}

export type PlanBinding = {
  profileCode: string
  planCode: string
  layerKeys: string[]
  groups: PlanGroupDef[]
  whitelistAssignments: Record<string, WhitelistAssignment>
}

// 画像分层模型：只登记示例数据需要的画像，未登记的画像仍可查看定义，但不做命中试算。
export const PROFILE_BLUEPRINTS: Blueprint[] = [
  {
    profileCode: 'PROF-0001',
    coverage: 400000,
    layers: [
      { key: 'first', name: '一线', interval: '城市等级=一线', population: 120000 },
      { key: 'newline', name: '新一线', interval: '城市等级=新一线', population: 150000 },
      { key: 'other', name: '其他', interval: '城市等级=其他', population: 130000 },
    ],
    overlaps: [],
  },
  {
    profileCode: 'PROF-0002',
    coverage: 250000,
    layers: [
      { key: 'new', name: '新客', interval: '注册≤7天且未首单', population: 90000 },
      { key: 'potential', name: '潜力新客', interval: '注册≤30天且已浏览未下单', population: 85000 },
      { key: 'silent', name: '沉默新客', interval: '注册≤90天且30天无访问', population: 75000 },
    ],
    overlaps: [],
  },
  {
    profileCode: 'PROF-0003',
    coverage: 254700,
    layers: [
      { key: 'high', name: '高活跃', interval: '活跃分 ≥80', population: 52000 },
      { key: 'medium', name: '中活跃', interval: '活跃分 60–80（含两端）', population: 78000 },
      { key: 'low', name: '低活跃', interval: '活跃分 30–60（含两端）', population: 81000 },
      { key: 'silent', name: '静默', interval: '活跃分 <30', population: 49000 },
    ],
    // 分层区间相邻且都含边界：按「高阶优先」只归入高阶层，低阶层扣掉重叠人数。
    overlaps: [
      {
        higher: 'high',
        lower: 'medium',
        count: 3200,
        reason: '活跃分=80 同时落在高活跃（≥80）与中活跃（60–80 含 80）',
        sampleUsers: ['U1001', 'U1002', 'U1003'],
      },
      {
        higher: 'medium',
        lower: 'low',
        count: 2100,
        reason: '活跃分=60 同时落在中活跃（60–80 含 60）与低活跃（30–60 含 60）',
        sampleUsers: ['U1004', 'U1005'],
      },
    ],
  },
  {
    profileCode: 'PROF-0004',
    coverage: 120000,
    layers: [
      { key: 'search', name: '搜索', interval: '历史渠道=搜索', population: 48000 },
      { key: 'feed', name: '信息流', interval: '历史渠道=信息流', population: 52000 },
      { key: 'private', name: '私域', interval: '历史渠道=私域', population: 20000 },
    ],
    overlaps: [],
  },
]

// 分流方案与画像的对接关系：一条方案可以服务多张画像，但每个画像只认自己那份分层和名单。
export const PLAN_BINDINGS: PlanBinding[] = [
  {
    profileCode: 'PROF-0001',
    planCode: 'ABGR-0001',
    layerKeys: ['first', 'newline', 'other'],
    groups: [
      { key: 'control', label: '对照组', defaultRatio: 50 },
      { key: 'experiment', label: '实验组', defaultRatio: 50 },
    ],
    whitelistAssignments: {
      U4001: { layerKey: 'first', groupKey: 'experiment' },
      U4002: { layerKey: 'first', groupKey: 'experiment' },
      U4003: { layerKey: 'newline', groupKey: 'control' },
    },
  },
  {
    profileCode: 'PROF-0002',
    planCode: 'ABGR-0002',
    layerKeys: ['new', 'potential', 'silent'],
    groups: [
      { key: 'control', label: '对照组', defaultRatio: 40 },
      { key: 'experiment', label: '实验组', defaultRatio: 60 },
    ],
    whitelistAssignments: {
      U3001: { layerKey: 'new', groupKey: 'experiment' },
      U3002: { layerKey: 'new', groupKey: 'control' },
      U3003: { layerKey: 'potential', groupKey: 'experiment' },
    },
  },
  {
    profileCode: 'PROF-0003',
    planCode: 'ABGR-0003',
    layerKeys: ['high', 'medium', 'low', 'silent'],
    groups: [
      { key: 'control', label: '对照组', defaultRatio: 10 },
      { key: 'groupA', label: '实验组A', defaultRatio: 30 },
      { key: 'groupB', label: '实验组B', defaultRatio: 60 },
    ],
    whitelistAssignments: {
      U1001: { layerKey: 'high', groupKey: 'control', score: 80, alsoMatches: ['medium'], boundary: 'lower' },
      U1002: { layerKey: 'high', groupKey: 'groupA', score: 92 },
      U1003: { layerKey: 'high', groupKey: 'groupB', score: 88 },
      U1004: { layerKey: 'medium', groupKey: 'control', score: 60, alsoMatches: ['low'], boundary: 'lower' },
      U1005: { layerKey: 'medium', groupKey: 'groupB', score: 75 },
    },
  },
]

export function getBlueprint(profileCode: string): Blueprint | undefined {
  return PROFILE_BLUEPRINTS.find((item) => item.profileCode === profileCode)
}

export function getBinding(profileCode: string, planCode: string): PlanBinding | undefined {
  return PLAN_BINDINGS.find(
    (item) => item.profileCode === profileCode && item.planCode === planCode,
  )
}

export function bindingsForProfile(profileCode: string): PlanBinding[] {
  return PLAN_BINDINGS.filter((item) => item.profileCode === profileCode)
}

/** 解析方案行里的「白名单用户」字段，逗号 / 分号 / 空白分隔。 */
export function splitWhitelist(value: unknown): string[] {
  const text = String(value ?? '').trim()
  if (!text) {
    return []
  }
  return Array.from(new Set(text.split(/[,，;；\s]+/).filter(Boolean)))
}

/** 方案行里登记了比例就以行为准，没有才用沙盘默认值，避免两处各写一套。 */
export function planGroups(binding: PlanBinding, planRow?: EntryRow): PlanGroupDef[] {
  const ratio = parseRatios(planRow?.['分流比例'])
  if (ratio.length === binding.groups.length) {
    return binding.groups.map((group, index) => ({
      ...group,
      defaultRatio: ratio[index],
    }))
  }
  return binding.groups
}

/** 支持「对照组 10% / 实验组A 30% / 实验组B 60%」这类写法；解析失败返回空数组。 */
export function parseRatios(value: unknown): number[] {
  const matches = String(value ?? '').match(/\d+(?:\.\d+)?\s*%/g)
  if (!matches) {
    return []
  }
  return matches.map((token) => Number(token.replace('%', '').trim()))
}

export function ratioTotal(groups: PlanGroupDef[]): number {
  return Math.round(groups.reduce((sum, group) => sum + group.defaultRatio, 0) * 100) / 100
}

/** 重叠人群只计入高阶层，低阶层扣掉重叠人数，保证一人只落一层。 */
export function effectiveLayers(blueprint: Blueprint): LayerDef[] {
  const deducted = new Map<string, number>()
  for (const overlap of blueprint.overlaps) {
    deducted.set(overlap.lower, (deducted.get(overlap.lower) ?? 0) + overlap.count)
  }
  return blueprint.layers.map((layer) => ({
    ...layer,
    population: Math.max(0, layer.population - (deducted.get(layer.key) ?? 0)),
  }))
}

export type LayerGroupCount = {
  allocated: number
  whitelistCount: number
  total: number
}

export type LayerPlan = {
  layerKey: string
  layerName: string
  interval: string
  /** 折扣重叠后实际参与本层分流的人数。 */
  population: number
  /** 本层白名单人数。 */
  whitelistCount: number
  groupCounts: Record<string, LayerGroupCount>
}

export type GroupResult = {
  groupKey: string
  label: string
  ratio: number
  /** 名单外用户按比例分到的名额。 */
  allocated: number
  whitelistCount: number
  total: number
}

export type RemovedWhitelist = {
  user: string
  layerKey: string
  layerName: string
  reason: string
}

export type SandboxResult = {
  profileCode: string
  planCode: string
  layers: LayerPlan[]
  groups: GroupResult[]
  whitelistTotal: number
  hitTotal: number
  removedWhitelists: RemovedWhitelist[]
  notes: string[]
}

export type SandboxInput = {
  blueprint: Blueprint
  binding: PlanBinding
  planRow?: EntryRow
  /** 沙盘里可改的比例；不传则用方案默认比例。 */
  ratios?: Record<string, number>
  /** 沙盘里可改的白名单；不传则用方案行里的名单。 */
  whitelist: string[]
}

/**
 * 试算口径（排期沙盘约定）：
 * 1. 画像分层区间相邻且含边界，重叠人群按「高阶优先」只落一层，低阶层扣掉重叠人数；
 * 2. 每层全量人数按分组比例切分，普通用户名额先按比例取整、余数补足到本层人数；
 * 3. 白名单优先且锁定分组，占本组名额；某组名单超员时从其他组可让出的普通名额里回收；
 * 4. 空白名单 = 全部按比例分配；未登记归属或不在分层内的名单用户不计入命中，并在预览里列出。
 */
export function simulate(input: SandboxInput): SandboxResult {
  const notes: string[] = []
  const groups = planGroups(input.binding, input.planRow).map((group) => ({
    ...group,
    defaultRatio: Math.max(0, input.ratios?.[group.key] ?? group.defaultRatio),
  }))
  const sum = groups.reduce((acc, group) => acc + group.defaultRatio, 0)
  const totalRatio = ratioTotal(groups)

  if (groups.some((group) => (input.ratios?.[group.key] ?? 0) < 0)) {
    notes.push('分组比例不能为负数，已按 0 处理')
  }
  if (totalRatio === 0) {
    notes.push('分组比例合计为 0%，本批次不会产生普通用户命中，只保留白名单')
  } else if (Math.abs(totalRatio - 100) > 0.01) {
    notes.push(`分组比例合计为 ${totalRatio}%，与 100% 不一致，按各组合计占比折算`)
  }

  const layers = effectiveLayers(input.blueprint)
  const whitelistPerLayerGroup = new Map<string, number>()
  const layerWhitelist = new Map<string, number>()
  const removedWhitelists: RemovedWhitelist[] = []
  const whitelistUsers = Array.from(new Set(input.whitelist.map((user) => user.trim()).filter(Boolean)))
  const layerByKey = new Map(layers.map((layer) => [layer.key, layer]))
  const groupKeys = new Set(groups.map((group) => group.key))

  for (const user of whitelistUsers) {
    const assignment = input.binding.whitelistAssignments[user]
    const layer = assignment ? layerByKey.get(assignment.layerKey) : undefined
    if (!assignment || !layer || !groupKeys.has(assignment.groupKey)) {
      removedWhitelists.push({
        user,
        layerKey: assignment?.layerKey ?? '',
        layerName: layer?.name ?? '—',
        reason: !assignment
          ? '未在本方案登记归属分层，未计入命中'
          : !layer
            ? '归属分层不在本方案对接的分层范围内，未计入命中'
            : '所属分组未在本方案登记，未计入命中',
      })
      continue
    }
    const key = `${assignment.layerKey}:${assignment.groupKey}`
    whitelistPerLayerGroup.set(key, (whitelistPerLayerGroup.get(key) ?? 0) + 1)
    layerWhitelist.set(assignment.layerKey, (layerWhitelist.get(assignment.layerKey) ?? 0) + 1)
    if (assignment.boundary === 'lower') {
      notes.push(
        `白名单 ${user} 落在「${layer.name}」边界（同时满足 ${[layer.name, ...(assignment.alsoMatches ?? [])].join(' 与 ')}），已按高阶优先只计一次`,
      )
    }
  }

  const layerPlans: LayerPlan[] = layers.map((layer) => {
    const population = layer.population
    const whitelistCount = layerWhitelist.get(layer.key) ?? 0
    const whitelistByGroup = groups.map(
      (group) => whitelistPerLayerGroup.get(`${layer.key}:${group.key}`) ?? 0,
    )
    // 比例合计为 0 时不分配普通名额，只保留白名单。
    const exact = groups.map((group) =>
      sum === 0 ? 0 : (population * group.defaultRatio) / sum,
    )
    const allocated = exact.map((value) => Math.floor(value))
    let assigned = allocated.reduce((acc, value) => acc + value, 0)
    const remainders = exact
      .map((value, index) => ({ index, rest: value - allocated[index] }))
      .sort((a, b) => b.rest - a.rest)
    for (let i = 0; i < remainders.length && assigned < population && sum > 0; i += 1) {
      allocated[remainders[i].index] += 1
      assigned += 1
    }

    // 白名单锁定分组：组内名单超员时从其他组可让出的普通名额回收。
    const totals = allocated.map((value, index) => Math.max(value, whitelistByGroup[index]))
    let overflow = totals.reduce((acc, value) => acc + value, 0) - population
    while (overflow > 0) {
      let donor = -1
      let donorRoom = 0
      for (let i = 0; i < groups.length; i += 1) {
        const room = totals[i] - whitelistByGroup[i]
        if (room > donorRoom) {
          donor = i
          donorRoom = room
        }
      }
      if (donor < 0) {
        // 全层都是白名单，没有可回收的普通名额，超出的名单单独记账。
        notes.push(`「${layer.name}」层白名单 ${whitelistCount} 人超过本层人数 ${population} 人，名单全部保留`)
        break
      }
      totals[donor] -= 1
      overflow -= 1
    }

    const groupCounts: Record<string, LayerGroupCount> = {}
    groups.forEach((group, index) => {
      groupCounts[group.key] = {
        allocated: totals[index] - whitelistByGroup[index],
        whitelistCount: whitelistByGroup[index],
        total: totals[index],
      }
    })
    return {
      layerKey: layer.key,
      layerName: layer.name,
      interval: layer.interval,
      population,
      whitelistCount,
      groupCounts,
    }
  })

  const groupResults: GroupResult[] = groups.map((group) => ({
    groupKey: group.key,
    label: group.label,
    ratio: group.defaultRatio,
    allocated: 0,
    whitelistCount: 0,
    total: 0,
  }))
  const groupIndex = new Map(groupResults.map((group) => [group.groupKey, group]))
  for (const layer of layerPlans) {
    for (const group of groups) {
      const count = layer.groupCounts[group.key]
      const target = groupIndex.get(group.key)
      if (!count || !target) {
        continue
      }
      target.allocated += count.allocated
      target.whitelistCount += count.whitelistCount
      target.total += count.total
    }
  }

  const whitelistTotal = groupResults.reduce((acc, group) => acc + group.whitelistCount, 0)
  const hitTotal = groupResults.reduce((acc, group) => acc + group.total, 0)

  if (whitelistUsers.length === 0) {
    notes.push('白名单为空：本批次全部名额按比例分给普通用户')
  } else if (removedWhitelists.length > 0) {
    notes.push(`有 ${removedWhitelists.length} 个白名单用户未计入命中，已在预览中列出`)
  }
  if (input.binding.layerKeys.length === 0) {
    notes.push('方案没有圈定任何分层，本批次不会产生命中')
  }

  return {
    profileCode: input.binding.profileCode,
    planCode: input.binding.planCode,
    layers: layerPlans,
    groups: groupResults,
    whitelistTotal,
    hitTotal,
    removedWhitelists,
    notes,
  }
}
