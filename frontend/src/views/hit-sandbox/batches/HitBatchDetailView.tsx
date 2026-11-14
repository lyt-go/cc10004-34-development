import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import {
  currentProfileLayers,
  getBatch,
  nextVersionText,
  planSnapshotFields,
  profileSnapshotFields,
  requeueForProfileVersion,
  reviewBatch,
} from '@/api/hit-service'

const OPERATOR = '值班管理员'

function num(value: number): string {
  return value.toLocaleString('zh-CN')
}

function stamp(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '—'
}

type EditForm = Record<string, { population: string; interval: string }>

export default function HitBatchDetailView() {
  const { batchNo = '' } = useParams()
  const [tick, setTick] = useState(0)
  const batch = useMemo(() => getBatch(batchNo), [batchNo, tick])
  const [newVersion, setNewVersion] = useState('')
  const [edits, setEdits] = useState<EditForm>({})
  const [message, setMessage] = useState('')
  const [tone, setTone] = useState<'ok' | 'error'>('ok')
  const [newBatchNo, setNewBatchNo] = useState<string | null>(null)

  const refresh = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    refresh()
  }, [refresh, batchNo])

  useEffect(() => {
    if (!batch) {
      return
    }
    setNewVersion(nextVersionText(batch.profileVersion))
    // 编辑框以当前生效的画像分层为准（含之前的换版），保证「没改的层沿用上一批次」。
    const next: EditForm = {}
    for (const layer of currentProfileLayers(batch.profileCode)) {
      next[layer.key] = {
        population: String(layer.population),
        interval: layer.interval,
      }
    }
    setEdits(next)
    setMessage('')
    setNewBatchNo(null)
  }, [batch?.batchNo])

  if (!batch) {
    return (
      <section className="page" data-module="hit-batch-detail">
        <header className="page-head">
          <div>
            <h2>命中批次 {batchNo}</h2>
            <p className="page-desc">批次不存在，可能已被清理或地址有误。</p>
          </div>
          <Link className="btn" to="/hit-sandbox/batches">
            返回批次台账
          </Link>
        </header>
      </section>
    )
  }

  function handleReview() {
    const result = reviewBatch(batch!.batchNo)
    setTone(result.ok ? 'ok' : 'error')
    setMessage(result.message)
    if (result.ok) {
      refresh()
    }
  }

  function handleRequeue() {
    const payload = Object.fromEntries(
      Object.entries(edits).map(([key, value]) => [
        key,
        {
          population: Number(value.population),
          interval: value.interval,
        },
      ]),
    )
    const result = requeueForProfileVersion({
      profileCode: batch!.profileCode,
      planCode: batch!.planCode,
      newVersion,
      operator: OPERATOR,
      edits: payload,
    })
    setTone(result.ok ? 'ok' : 'error')
    setMessage(result.message)
    setNewBatchNo(result.batchNo ?? null)
    if (result.ok) {
      refresh()
    }
  }

  const profileFields = profileSnapshotFields()
  const planFields = planSnapshotFields()

  return (
    <section className="page" data-module="hit-batch-detail">
      <header className="page-head">
        <div>
          <h2>命中批次 {batch.batchNo}</h2>
          <p className="page-desc">
            批次内容在提交时冻结：画像与方案字段都取提交那一刻的快照，之后画像换版也不会改动本批次。
          </p>
        </div>
        <div className="page-actions">
          <Link className="btn" to="/hit-sandbox/batches">
            返回批次台账
          </Link>
          <Link className="btn" to={`/hit-sandbox?profile=${batch.profileCode}&plan=${batch.planCode}`}>
            在沙盘里对照
          </Link>
        </div>
      </header>

      <div className="stat-row">
        <article className="stat-card">
          <span className="stat-label">批次状态</span>
          <strong className="stat-value">
            <span className={batch.status === '待复核' ? 'tag pending' : 'tag ok'}>{batch.status}</span>
          </strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">来源</span>
          <strong className="stat-value small">{batch.source}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">命中人数</span>
          <strong className="stat-value">{num(batch.result.hitTotal)}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">白名单人数</span>
          <strong className="stat-value">{num(batch.result.whitelistTotal)}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">提交时间</span>
          <strong className="stat-value small">{stamp(batch.createdAt)}</strong>
        </article>
      </div>

      {message && (
        <p className={`result-banner ${tone === 'ok' ? 'ok' : 'error'}`}>
          {message}
          {newBatchNo && (
            <Link className="inline-link" to={`/hit-sandbox/batches/${newBatchNo}`}>
              查看新批次 {newBatchNo}
            </Link>
          )}
        </p>
      )}

      <div className="compare-row">
        <article className="compare-card">
          <header className="compare-head">
            <h3>画像快照 · {batch.profileCode}</h3>
            <span className="tag ok">绑定版本 {batch.profileVersion}</span>
          </header>
          <dl className="kv">
            {profileFields.map((field) => (
              <div key={field} className="kv-row">
                <dt>{field}</dt>
                <dd>{batch.profileSnapshot[field] || '—'}</dd>
              </div>
            ))}
            <div className="kv-row">
              <dt>提交时画像状态</dt>
              <dd>{batch.profileStatus}</dd>
            </div>
          </dl>
        </article>

        <article className="compare-card">
          <header className="compare-head">
            <h3>方案快照 · {batch.planCode}</h3>
            <span className="tag ok">提交时状态 {batch.planStatus}</span>
          </header>
          <dl className="kv">
            {planFields.map((field) => (
              <div key={field} className="kv-row">
                <dt>{field}</dt>
                <dd>{batch.planSnapshot[field] || '—'}</dd>
              </div>
            ))}
            <div className="kv-row">
              <dt>本次采用比例</dt>
              <dd>
                {Object.entries(batch.ratios)
                  .map(([key, value]) => `${key} ${value}%`)
                  .join(' / ')}
                （合计 {batch.ratioTotal}%）
              </dd>
            </div>
            <div className="kv-row">
              <dt>本次白名单</dt>
              <dd>{batch.whitelist.length > 0 ? batch.whitelist.join('、') : '（空）'}</dd>
            </div>
          </dl>
        </article>
      </div>

      <article className="panel">
        <header className="panel-head">
          <h3>分层命中明细（冻结）</h3>
          <span className="panel-note">
            覆盖用户量 {num(batch.coverage)} 人 · 命中率{' '}
            {batch.coverage > 0 ? `${Math.round((batch.result.hitTotal / batch.coverage) * 1000) / 10}%` : '—'}
          </span>
        </header>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>分层</th>
                <th>分层区间</th>
                <th>分层人数</th>
                <th>白名单</th>
                {batch.result.groups.map((group) => (
                  <th key={group.groupKey}>{group.label}</th>
                ))}
                <th>合计命中</th>
                <th>换版处置</th>
              </tr>
            </thead>
            <tbody>
              {batch.result.layers.map((layer) => {
                const requeue = batch.layerRequeue.find((item) => item.layerKey === layer.layerKey)
                return (
                  <tr key={layer.layerKey}>
                    <td>{layer.layerName}</td>
                    <td>{layer.interval}</td>
                    <td>{num(layer.population)}</td>
                    <td>{num(layer.whitelistCount)}</td>
                    {batch.result.groups.map((group) => (
                      <td key={group.groupKey}>{num(layer.groupCounts[group.groupKey]?.total ?? 0)}</td>
                    ))}
                    <td>
                      {num(
                        batch.result.groups.reduce(
                          (sum, group) => sum + (layer.groupCounts[group.groupKey]?.total ?? 0),
                          0,
                        ),
                      )}
                    </td>
                    <td>
                      {requeue ? (
                        <span className={requeue.state === '重新排队' ? 'tag pending' : 'tag'}>
                          {requeue.state}
                        </span>
                      ) : (
                        '—'
                      )}
                      {requeue && <span className="cell-sub">{requeue.reason}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {batch.result.notes.length > 0 && (
          <ul className="notes-list">
            {batch.result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </article>

      <article className="panel">
        <header className="panel-head">
          <h3>边界层级与名单处置</h3>
        </header>
        {batch.overlaps.length === 0 && <p className="hint-line">该画像没有边界重叠人群。</p>}
        {batch.overlaps.map((overlap) => (
          <p key={`${overlap.higher}-${overlap.lower}`} className="overlap-line">
            <strong>
              {overlap.higher} / {overlap.lower}
            </strong>
            ：{num(overlap.count)} 人只计入高阶；{overlap.reason}
          </p>
        ))}
        {batch.result.removedWhitelists.length === 0 ? (
          <p className="hint-line">白名单全部落在方案分层内。</p>
        ) : (
          <ul className="warn-list">
            {batch.result.removedWhitelists.map((item) => (
              <li key={item.user}>
                {item.user}：{item.reason}
              </li>
            ))}
          </ul>
        )}
      </article>

      {batch.status === '待复核' && (
        <article className="panel action-panel">
          <header className="panel-head">
            <h3>复核此批次</h3>
          </header>
          <p className="hint-line">
            复核只改变批次状态，命中人数与快照保持提交时的原样；复核后的批次同样不能被新的换版覆盖。
          </p>
          <button className="btn primary" type="button" onClick={handleReview}>
            复核通过并生效
          </button>
        </article>
      )}

      <article className="panel">
        <header className="panel-head">
          <h3>画像换版 → 生成新的待复核批次</h3>
          <span className="panel-note">只让分层人数或区间发生变化的分层重新排队</span>
        </header>
        <div className="requeue-form">
          <label className="filter-item">
            <span>新画像版本</span>
            <input value={newVersion} onChange={(event) => setNewVersion(event.target.value)} />
          </label>
          <table className="data-table">
            <thead>
              <tr>
                <th>分层</th>
                <th>分层人数</th>
                <th>分层区间</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(edits).map(([layerKey, value]) => {
                const layer = batch.result.layers.find((item) => item.layerKey === layerKey)
                return (
                  <tr key={layerKey}>
                    <td>{layer?.layerName ?? layerKey}</td>
                    <td>
                      <input
                        className="mini-input"
                        type="number"
                        min={0}
                        value={value.population}
                        onChange={(event) =>
                          setEdits((prev) => ({
                            ...prev,
                            [layerKey]: { ...prev[layerKey], population: event.target.value },
                          }))
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="mini-input wide"
                        value={value.interval}
                        onChange={(event) =>
                          setEdits((prev) => ({
                            ...prev,
                            [layerKey]: { ...prev[layerKey], interval: event.target.value },
                          }))
                        }
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="panel-actions">
            <button className="btn primary" type="button" onClick={handleRequeue}>
              换版并生成待复核批次
            </button>
          </div>
          <p className="hint-line">
            换版会同步画像记录里的版本号、分层区间与覆盖用户量；旧批次 {batch.batchNo} 不变，仍按原样查看。
          </p>
        </div>
      </article>

      <footer className="page-foot">
        <span>
          批次号 {batch.batchNo} · 请求号 {batch.requestId} · 提交人 {batch.operatedBy}
        </span>
        <span>最近读取：{new Date().toLocaleTimeString('zh-CN')}</span>
      </footer>
    </section>
  )
}
