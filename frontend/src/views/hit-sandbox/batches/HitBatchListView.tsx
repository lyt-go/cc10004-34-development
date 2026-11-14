import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { listBatches } from '@/api/hit-service'

function num(value: number): string {
  return value.toLocaleString('zh-CN')
}

export default function HitBatchListView() {
  const [tick, setTick] = useState(0)
  const batches = useMemo(() => listBatches(), [tick])

  const refresh = useCallback(() => setTick((value) => value + 1), [])
  useEffect(() => {
    // 批次只追加：进入页面就按存档重新读，返回或刷新后仍是同一份结果。
    refresh()
  }, [refresh])

  const pending = batches.filter((batch) => batch.status === '待复核')
  const profiles = new Set(batches.map((batch) => batch.profileCode)).size
  const plans = new Set(batches.map((batch) => batch.planCode)).size

  return (
    <section className="page" data-module="hit-batches">
      <header className="page-head">
        <div>
          <h2>命中批次台账</h2>
          <p className="page-desc">
            正式提交后生成的批次不可变。画像换版只会新增「待复核」批次，旧批次的内容与命中结果保持原样。
          </p>
        </div>
        <div className="page-actions">
          <Link className="btn" to="/hit-sandbox">
            返回命中沙盘
          </Link>
          <button className="btn" type="button" onClick={refresh}>
            重新读取存档
          </button>
        </div>
      </header>

      <div className="stat-row">
        <article className="stat-card">
          <span className="stat-label">批次总数</span>
          <strong className="stat-value">{batches.length}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">待复核批次</span>
          <strong className="stat-value">{pending.length}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">涉及画像 / 方案</span>
          <strong className="stat-value">
            {profiles} / {plans}
          </strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">已生效命中人数</span>
          <strong className="stat-value">
            {num(
              batches
                .filter((batch) => batch.status === '已生效')
                .reduce((sum, batch) => sum + batch.result.hitTotal, 0),
            )}
          </strong>
        </article>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>批次号</th>
            <th>画像 / 版本</th>
            <th>分流方案</th>
            <th>来源</th>
            <th>换版前批次</th>
            <th>状态</th>
            <th>命中人数</th>
            <th>白名单</th>
            <th>提交时间</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.batchNo}>
              <td>
                <Link className="inline-link" to={`/hit-sandbox/batches/${batch.batchNo}`}>
                  {batch.batchNo}
                </Link>
              </td>
              <td>
                {batch.profileCode} <span className="cell-sub">{batch.profileVersion}</span>
              </td>
              <td>
                {batch.planCode} <span className="cell-sub">{batch.planName}</span>
              </td>
              <td>{batch.source}</td>
              <td>{batch.previousBatchNo ?? '—'}</td>
              <td>
                <span className={batch.status === '待复核' ? 'tag pending' : 'tag ok'}>
                  {batch.status}
                </span>
              </td>
              <td>{num(batch.result.hitTotal)}</td>
              <td>{num(batch.result.whitelistTotal)}</td>
              <td>{new Date(batch.createdAt).toLocaleString('zh-CN')}</td>
            </tr>
          ))}
          {batches.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={9}>
                还没有命中批次，先到命中沙盘正式提交一次
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="page-foot">
        <span>共 {batches.length} 个批次 · 按提交时间倒序</span>
      </footer>
    </section>
  )
}
