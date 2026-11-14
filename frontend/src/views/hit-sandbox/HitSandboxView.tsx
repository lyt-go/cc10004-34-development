import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import {
  PREVIEW_HINT,
  buildSandbox,
  clearDraft,
  defaultRatios,
  draftKey,
  listBatches,
  listSandboxPlans,
  listSandboxProfiles,
  loadDraft,
  quotaSummary,
  rememberDraft,
  submitHitBatch,
} from '@/api/hit-service'
import type { SandboxProfile } from '@/api/hit-service'

const OPERATOR = '值班管理员'

function statusClass(status: string): string {
  if (status === '已发布' || status === '已生效') {
    return 'tag ok'
  }
  if (status === '已作废' || status === '已下线') {
    return 'tag dead'
  }
  return 'tag pending'
}

function num(value: number): string {
  return value.toLocaleString('zh-CN')
}

export default function HitSandboxView() {
  // 地址栏是选择状态的唯一来源：刷新、浏览器返回、重新进入都会回到同一个画像和方案。
  const [searchParams, setSearchParams] = useSearchParams()
  const profiles = useMemo(() => listSandboxProfiles(), [])
  const requestedProfile = searchParams.get('profile') ?? ''
  const profileCode = profiles.some((item) => item.code === requestedProfile)
    ? requestedProfile
    : ''
  const plans = useMemo(
    () => (profileCode ? listSandboxPlans(profileCode) : []),
    [profileCode],
  )
  const requestedPlan = searchParams.get('plan') ?? ''
  const planCode = plans.some((item) => item.code === requestedPlan)
    ? requestedPlan
    : plans[0]?.code ?? ''

  const [ratios, setRatios] = useState<Record<string, number>>({})
  const [whitelistText, setWhitelistText] = useState('')
  const [previewCount, setPreviewCount] = useState(0)
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'ok' | 'error'>('ok')
  const [submittedBatch, setSubmittedBatch] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  const select = useCallback(
    (nextProfile: string, nextPlan: string) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (nextProfile) {
            next.set('profile', nextProfile)
          } else {
            next.delete('profile')
          }
          if (nextPlan) {
            next.set('plan', nextPlan)
          } else {
            next.delete('plan')
          }
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  // 自动补全的分层 / 方案也写回地址栏，链接可以直接分享给排期同事。
  useEffect(() => {
    if (profileCode && planCode && (requestedProfile !== profileCode || requestedPlan !== planCode)) {
      select(profileCode, planCode)
    }
  }, [profileCode, planCode, requestedProfile, requestedPlan, select])

  // 切换画像 / 方案时恢复该组合自己的草稿；没有草稿就用方案默认口径。
  useEffect(() => {
    if (!profileCode || !planCode) {
      setRatios({})
      setWhitelistText('')
      setPreviewCount(0)
      return
    }
    const plan = listSandboxPlans(profileCode).find((item) => item.code === planCode)
    if (!plan) {
      return
    }
    const draft = loadDraft(profileCode, planCode)
    setRatios(draft?.ratios ?? defaultRatios(plan))
    setWhitelistText(draft?.whitelist ?? plan.whitelistText)
    setPreviewCount(draft?.previewCount ?? 0)
    setSubmittedBatch(null)
    setMessage('')
  }, [profileCode, planCode])

  const sandbox = useMemo(() => {
    if (!profileCode || !planCode) {
      return null
    }
    return buildSandbox({ profileCode, planCode, ratios, whitelistText })
  }, [profileCode, planCode, ratios, whitelistText, refreshTick])

  const quota = useMemo(
    () => (planCode ? quotaSummary(planCode) : null),
    [planCode, refreshTick],
  )
  const batches = useMemo(
    () => (profileCode && planCode ? listBatches({ profileCode, planCode }) : []),
    [profileCode, planCode, refreshTick],
  )
  const selectedProfile: SandboxProfile | undefined = profiles.find(
    (item) => item.code === profileCode,
  )

  function updateRatio(key: string, value: string) {
    const parsed = Number(value)
    const next = { ...ratios, [key]: Number.isFinite(parsed) ? parsed : 0 }
    setRatios(next)
    // 改动即落草稿（不增加试算次数）：刷新或返回后仍是改过的口径，但依然不占名额。
    if (sandbox?.canPreview) {
      rememberDraft(profileCode, planCode, next, whitelistText)
    }
  }

  function runPreview() {
    if (!sandbox || !planCode) {
      return
    }
    rememberDraft(profileCode, planCode, ratios, whitelistText, true)
    setPreviewCount((count) => count + 1)
    setRefreshTick((tick) => tick + 1)
    setMessageTone('ok')
    setMessage(
      `已试算并保存草稿：命中 ${num(sandbox.result?.hitTotal ?? 0)} 人。预览不写批次、不占用实验名额。`,
    )
  }

  function submit() {
    if (!sandbox || !planCode) {
      return
    }
    const result = submitHitBatch({
      profileCode,
      planCode,
      ratios,
      whitelistText,
      operator: OPERATOR,
      requestId: `${draftKey(profileCode, planCode)}::${Date.now()}::${Math.random().toString(36).slice(2, 8)}`,
    })
    setMessageTone(result.ok ? 'ok' : 'error')
    setMessage(result.message)
    if (result.ok && result.batchNo) {
      setSubmittedBatch(result.batchNo)
      setPreviewCount(0)
      setRatios(defaultRatios(sandbox.plan))
      setWhitelistText(sandbox.plan.whitelistText)
    }
    setRefreshTick((tick) => tick + 1)
  }

  function restoreDefaults() {
    if (!sandbox) {
      return
    }
    setRatios(defaultRatios(sandbox.plan))
    setWhitelistText(sandbox.plan.whitelistText)
    clearDraft(profileCode, planCode)
    setPreviewCount(0)
    setRefreshTick((tick) => tick + 1)
    setMessageTone('ok')
    setMessage('已恢复方案默认比例与白名单，草稿已清除')
  }

  return (
    <section className="page" data-module="hit-sandbox">
      <header className="page-head">
        <div>
          <h2>投放命中沙盘</h2>
          <p className="page-desc">
            先选画像定义，再圈定分流方案。沙盘同时展开分层人群、白名单用户、各层分流比例和最终命中结果；
            预览可以反复试算但不占实验名额，正式提交才生成不可变批次。
          </p>
        </div>
        <div className="page-actions">
          <Link className="btn" to="/hit-sandbox/batches">
            查看命中批次
          </Link>
        </div>
      </header>

      <div className="sandbox-steps">
        <section className="sandbox-step">
          <h3 className="step-title">第一步 · 选择画像定义</h3>
          <div className="profile-picker">
            {profiles.map((item) => (
              <button
                key={item.code}
                type="button"
                className={`profile-chip ${profileCode === item.code ? 'active' : ''}`}
                onClick={() => select(item.code, '')}
              >
                <span className="chip-head">
                  <strong>{item.code}</strong>
                  <span className={statusClass(item.status)}>{item.status}</span>
                </span>
                <span className="chip-name">{item.name}</span>
                <span className="chip-meta">
                  {item.version} · 覆盖 {item.coverageText || num(item.coverage)} 人
                </span>
                {item.previewBlockedReason && (
                  <span className="chip-block">{item.previewBlockedReason}</span>
                )}
              </button>
            ))}
          </div>
          <p className="hint-line">
            已发布画像可直接提交；评审中画像可先试算、发布后才能提交；作废画像只保留定义和历史批次供查看。
          </p>
        </section>

        <section className="sandbox-step">
          <h3 className="step-title">第二步 · 圈定分流方案</h3>
          {plans.length === 0 && (
            <p className="empty-state inline">
              {profileCode
                ? '该画像还没有对接任何分流方案，先在分流配置里建立对接关系'
                : '先选择一张画像定义'}
            </p>
          )}
          <div className="plan-picker">
            {plans.map((item) => (
              <button
                key={item.code}
                type="button"
                className={`plan-chip ${planCode === item.code ? 'active' : ''}`}
                onClick={() => select(profileCode, item.code)}
              >
                <span className="chip-head">
                  <strong>{item.code}</strong>
                  <span className={statusClass(item.status)}>{item.status}</span>
                </span>
                <span className="chip-name">{item.name}</span>
                <span className="chip-meta">
                  {item.type} · {item.ratios || '未登记比例'}
                </span>
                {item.previewBlockedReason && (
                  <span className="chip-block">{item.previewBlockedReason}</span>
                )}
              </button>
            ))}
          </div>
        </section>
      </div>

      {!sandbox && (
        <p className="empty-state panel">
          选择画像定义和分流方案后，沙盘会同时展开分层人群、白名单、比例与命中结果。
        </p>
      )}

      {sandbox && (
        <>
          <div className="compare-row">
            <article className="compare-card">
              <header className="compare-head">
                <h3>画像 {sandbox.profile.code}</h3>
                <span className={statusClass(sandbox.profile.status)}>{sandbox.profile.status}</span>
              </header>
              <dl className="kv">
                <dt>画像名称</dt>
                <dd>{sandbox.profile.name}</dd>
                <dt>统计维度</dt>
                <dd>{sandbox.profile.dimensions}</dd>
                <dt>聚合指标</dt>
                <dd>{sandbox.profile.metrics}</dd>
                <dt>分层区间</dt>
                <dd>{sandbox.profile.intervals}</dd>
                <dt>更新周期</dt>
                <dd>{sandbox.profile.cycle}</dd>
                <dt>覆盖用户量</dt>
                <dd>
                  {num(sandbox.profile.coverage)} 人
                  {sandbox.profile.coverageText &&
                    sandbox.profile.coverageText !== String(sandbox.profile.coverage) &&
                    `（画像登记 ${sandbox.profile.coverageText}）`}
                </dd>
                <dt>画像版本</dt>
                <dd>{sandbox.profile.version}</dd>
              </dl>
            </article>

            <article className="compare-card">
              <header className="compare-head">
                <h3>分流 {sandbox.plan.code}</h3>
                <span className={statusClass(sandbox.plan.status)}>{sandbox.plan.status}</span>
              </header>
              <dl className="kv">
                <dt>方案名称</dt>
                <dd>{sandbox.plan.name}</dd>
                <dt>分流类型</dt>
                <dd>{sandbox.plan.type}</dd>
                <dt>分流比例</dt>
                <dd>{sandbox.plan.ratios}</dd>
                <dt>分组标识</dt>
                <dd>{sandbox.plan.groups.map((group) => group.key).join(' / ')}</dd>
                <dt>白名单用户</dt>
                <dd>{sandbox.plan.whitelistText || '（空）'}</dd>
                <dt>生效页面</dt>
                <dd>{sandbox.plan.page}</dd>
                <dt>互斥规则</dt>
                <dd>{sandbox.plan.mutual}</dd>
              </dl>
            </article>
          </div>

          <div className="sandbox-grid">
            <article className="panel">
              <header className="panel-head">
                <h3>各层分流比例</h3>
                <span className="panel-note">
                  比例合计 {sandbox.ratioTotal}%
                  {sandbox.ratioTotal !== 100 && <em className="warn"> · 不等于 100%，按占比折算</em>}
                </span>
              </header>
              <div className="ratio-inputs">
                {sandbox.plan.groups.map((group) => (
                  <label key={group.key} className="ratio-item">
                    <span>{group.label}</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={ratios[group.key] ?? group.ratio}
                      onChange={(event) => updateRatio(group.key, event.target.value)}
                    />
                    <span className="ratio-unit">%</span>
                  </label>
                ))}
              </div>
              <label className="whitelist-field">
                <span>白名单用户（逗号分隔，留空表示不用名单）</span>
                <textarea
                  rows={2}
                  value={whitelistText}
                  onChange={(event) => {
                    setWhitelistText(event.target.value)
                    if (sandbox.canPreview) {
                      rememberDraft(profileCode, planCode, ratios, event.target.value)
                    }
                  }}
                  placeholder="例如 U1001,U1002"
                />
              </label>
              <div className="panel-actions">
                <button className="btn" type="button" onClick={restoreDefaults}>
                  恢复方案默认
                </button>
                <button className="btn" type="button" onClick={runPreview} disabled={!sandbox.canPreview}>
                  试算并保存草稿
                </button>
              </div>
              <p className="hint-line">{PREVIEW_HINT}</p>
              {!sandbox.canPreview && (
                <p className="error-text">{sandbox.blockReason || '当前画像 / 方案不允许试算'}</p>
              )}
            </article>

            <article className="panel">
              <header className="panel-head">
                <h3>名单与名额</h3>
                <span className="panel-note">试算 {previewCount} 次 · 预览不占名额</span>
              </header>
              <dl className="kv compact">
                <dt>已生效批次命中（按画像取最新）</dt>
                <dd>
                  {num(quota?.committed ?? 0)} 人
                  {quota?.committedBatch && (
                    <Link className="inline-link" to={`/hit-sandbox/batches/${quota.committedBatch}`}>
                      （{quota.committedBatch}）
                    </Link>
                  )}
                </dd>
                <dt>待复核批次占用</dt>
                <dd>
                  {num(quota?.pending ?? 0)} 人
                  {quota?.pendingBatch && (
                    <Link className="inline-link" to={`/hit-sandbox/batches/${quota.pendingBatch}`}>
                      （{quota.pendingBatch}）
                    </Link>
                  )}
                </dd>
                <dt>本方案批次总数</dt>
                <dd>{quota?.batchCount ?? 0} 个</dd>
                <dt>本次试算命中</dt>
                <dd className="strong">{num(sandbox.result?.hitTotal ?? 0)} 人</dd>
                <dt>其中白名单</dt>
                <dd>{num(sandbox.result?.whitelistTotal ?? 0)} 人</dd>
              </dl>
              <div className="panel-actions">
                <button
                  className="btn primary"
                  type="button"
                  onClick={submit}
                  disabled={!sandbox.canSubmit}
                  title={sandbox.blockReason || '提交后生成不可变批次'}
                >
                  正式提交并生成批次
                </button>
              </div>
              {!sandbox.canSubmit && sandbox.blockReason && (
                <p className="hint-line">暂不能提交：{sandbox.blockReason}</p>
              )}
              <p className="hint-line">
                两路同时提交时以首个完整批次号为准，后一路提示冲突，不会重复占用名额。
              </p>
            </article>
          </div>

          {message && (
            <p className={`result-banner ${messageTone === 'ok' ? 'ok' : 'error'}`}>
              {message}
              {submittedBatch && (
                <Link className="inline-link" to={`/hit-sandbox/batches/${submittedBatch}`}>
                  查看批次 {submittedBatch}
                </Link>
              )}
            </p>
          )}

          {sandbox.result && (
            <>
              <article className="panel">
                <header className="panel-head">
                  <h3>分层人群与命中结果</h3>
                  <span className="panel-note">
                    边界重叠按高阶优先，一人只落一层；白名单锁定分组并优先占名额
                  </span>
                </header>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>分层</th>
                        <th>分层区间</th>
                        <th>分层人数</th>
                        <th>白名单人数</th>
                        {sandbox.plan.groups.map((group) => (
                          <th key={group.key}>{group.label}命中</th>
                        ))}
                        <th>合计命中</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sandbox.result.layers.map((layer) => {
                        const total = sandbox.plan.groups.reduce(
                          (sum, group) => sum + (layer.groupCounts[group.key]?.total ?? 0),
                          0,
                        )
                        return (
                          <tr key={layer.layerKey}>
                            <td>{layer.layerName}</td>
                            <td>{layer.interval}</td>
                            <td>{num(layer.population)}</td>
                            <td>{num(layer.whitelistCount)}</td>
                            {sandbox.plan.groups.map((group) => (
                              <td key={group.key}>{num(layer.groupCounts[group.key]?.total ?? 0)}</td>
                            ))}
                            <td>
                              {num(total)}
                              <span className="cell-sub">
                                {layer.population > 0
                                  ? `${Math.round((total / layer.population) * 1000) / 10}%`
                                  : '—'}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </article>

              <div className="sandbox-grid">
                <article className="panel">
                  <header className="panel-head">
                    <h3>分组命中汇总</h3>
                  </header>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>分组</th>
                        <th>比例</th>
                        <th>名单外命中</th>
                        <th>白名单</th>
                        <th>合计</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sandbox.result.groups.map((group) => (
                        <tr key={group.groupKey}>
                          <td>{group.label}</td>
                          <td>{group.ratio}%</td>
                          <td>{num(group.allocated)}</td>
                          <td>{num(group.whitelistCount)}</td>
                          <td>{num(group.total)}</td>
                        </tr>
                      ))}
                      <tr className="sum-row">
                        <td>合计</td>
                        <td>{sandbox.ratioTotal}%</td>
                        <td>{num(sandbox.result.groups.reduce((sum, g) => sum + g.allocated, 0))}</td>
                        <td>{num(sandbox.result.whitelistTotal)}</td>
                        <td>{num(sandbox.result.hitTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                </article>

                <article className="panel">
                  <header className="panel-head">
                    <h3>重叠层级与名单异常</h3>
                  </header>
                  {sandbox.overlaps.length === 0 && (
                    <p className="hint-line">该画像没有登记边界重叠人群。</p>
                  )}
                  {sandbox.overlaps.map((overlap) => (
                    <p key={`${overlap.higher}-${overlap.lower}`} className="overlap-line">
                      <strong>
                        {overlap.higher} / {overlap.lower}
                      </strong>
                      ：{num(overlap.count)} 人，{overlap.reason}；样例 {overlap.sampleUsers.join('、')}，
                      只计入高阶「{overlap.higher}」。
                    </p>
                  ))}
                  {sandbox.result.removedWhitelists.length === 0 ? (
                    <p className="hint-line">白名单用户全部落在本方案分层内。</p>
                  ) : (
                    <ul className="warn-list">
                      {sandbox.result.removedWhitelists.map((item) => (
                        <li key={item.user}>
                          {item.user}：{item.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              </div>

              {sandbox.notes.length > 0 && (
                <article className="panel notes-panel">
                  <h3>沙盘口径说明</h3>
                  <ul>
                    {sandbox.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </article>
              )}
            </>
          )}

          <article className="panel">
            <header className="panel-head">
              <h3>本画像 / 方案的历史批次</h3>
              <Link className="inline-link" to="/hit-sandbox/batches">
                全部批次
              </Link>
            </header>
            <table className="data-table">
              <thead>
                <tr>
                  <th>批次号</th>
                  <th>画像版本</th>
                  <th>来源</th>
                  <th>状态</th>
                  <th>命中人数</th>
                  <th>提交时间</th>
                </tr>
              </thead>
              <tbody>
                {batches.length === 0 && (
                  <tr>
                    <td className="empty-state" colSpan={6}>
                      还没有正式提交的批次；预览不计入批次
                    </td>
                  </tr>
                )}
                {batches.map((batch) => (
                  <tr key={batch.batchNo}>
                    <td>
                      <Link className="inline-link" to={`/hit-sandbox/batches/${batch.batchNo}`}>
                        {batch.batchNo}
                      </Link>
                    </td>
                    <td>{batch.profileVersion}</td>
                    <td>{batch.source}</td>
                    <td>
                      <span className={statusClass(batch.status === '已生效' ? '已生效' : '评审中')}>
                        {batch.status}
                      </span>
                    </td>
                    <td>{num(batch.result.hitTotal)}</td>
                    <td>{new Date(batch.createdAt).toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </>
      )}

      <footer className="page-foot">
        <span>
          沙盘试算、草稿与批次都存在本机浏览器里
          {selectedProfile ? ` · 当前画像 ${selectedProfile.code}` : ''}
        </span>
      </footer>
    </section>
  )
}
