import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('profile')
const columns = [
  "画像编号",
  "画像名称",
  "统计维度",
  "聚合指标",
  "分层区间",
  "更新周期",
  "覆盖用户量",
  "画像版本"
]
const actions = [
  "提交画像评审",
  "发布画像",
  "作废画像"
]
const statuses = [
  "草稿",
  "画像评审中",
  "已发布",
  "已作废"
]
const stats = [
  {
    "label": "画像定义总数",
    "status": ""
  },
  {
    "label": "已发布画像",
    "status": "已发布"
  },
  {
    "label": "画像评审中",
    "status": "画像评审中"
  }
]

export default function ProfileView() {
  const [rows, setRows] = useState<EntryRow[]>([])
  const [total, setTotal] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const filterFields = useMemo(() => columns.slice(0, 3), [])

  const reload = useCallback(() => {
    setErrorMessage('')
    try {
      const payload = listEntries(meta.key, filters)
      setRows(payload.items)
      setTotal(payload.total)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '用户画像列表读取失败')
    }
  }, [filters])

  useEffect(() => {
    reload()
  }, [reload])

  function runAction(action: string, row: EntryRow) {
    setErrorMessage('')
    const result = applyAction(meta.key, Number(row.id), action)
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    reload()
  }

  return (
    <section className="page" data-module="profile">
      <header className="page-head">
        <div>
          <h2>用户画像管理</h2>
          <p className="page-desc">定义用户或业务对象的画像标签和维度，提供多层次聚合视图。</p>
        </div>
        <div className="page-actions">
          <Link className="btn" to="/hit-sandbox">
            进入命中沙盘
          </Link>
          <button className="btn primary" type="button" onClick={() => setErrorMessage('画像定义登记入口尚未接入审批流')}>
            登记画像定义
          </button>
          <button className="btn" type="button" onClick={() => downloadEntries(meta.key)}>
            导出用户画像清单
          </button>
        </div>
      </header>

      <div className="stat-row">
        {stats.map((item) => (
          <article key={item.label} className="stat-card">
            <span className="stat-label">{item.label}</span>
            <strong className="stat-value">
              {item.status === ''
                ? total
                : rows.filter((row) => String(row.status) === item.status).length}
            </strong>
          </article>
        ))}
      </div>

      <p className="status-legend">
        {statuses.map((status: string) => (
          <span key={status} className="legend-item">
            {status}：{rows.filter((row) => String(row.status) === status).length}
          </span>
        ))}
      </p>

      <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); reload() }}>
        {filterFields.map((field) => (
          <label key={field} className="filter-item">
            <span>{field}</span>
            <input
              value={filters[field] ?? ''}
              placeholder={`按${field}检索`}
              onChange={(event) => setFilters((prev) => ({ ...prev, [field]: event.target.value }))}
            />
          </label>
        ))}
        <button className="btn" type="submit">查询</button>
        <button className="btn ghost" type="button" onClick={() => setFilters({})}>重置条件</button>
      </form>

      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              {columns.map((column) => <td key={column}>{row[column] ?? '—'}</td>)}
              <td>{row.status}</td>
              <td className="row-actions">
                {actions.map((action) => (
                  <button key={action} className="link" type="button" onClick={() => runAction(action, row)}>
                    {action}
                  </button>
                ))}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={columns.length + 2}>暂无用户画像数据，可先登记画像定义</td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="page-foot">
        <span>共 {total} 条用户画像记录</span>
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>
    </section>
  )
}
