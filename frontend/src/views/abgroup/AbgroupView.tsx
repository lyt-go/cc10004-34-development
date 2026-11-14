import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('abgroup')
const columns = [
  "方案编号",
  "方案名称",
  "分流类型",
  "分流比例",
  "分组标识",
  "互斥规则",
  "生效页面",
  "白名单用户"
]
const actions = [
  "提交方案评审",
  "生效方案",
  "下线方案"
]
const statuses = [
  "草稿",
  "方案评审中",
  "已生效",
  "已下线"
]
const stats = [
  {
    "label": "分流方案总数",
    "value": 0
  },
  {
    "label": "已生效方案",
    "value": 0
  },
  {
    "label": "方案评审中",
    "value": 0
  }
]

export default function AbgroupView() {
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
      setErrorMessage(error instanceof Error ? error.message : '分流配置列表读取失败')
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
    <section className="page" data-module="abgroup">
      <header className="page-head">
        <div>
          <h2>分流配置管理</h2>
          <p className="page-desc">管理数据产品的流量分流配置，支持A/B实验、灰度发布和分层分流。</p>
        </div>
        <div className="page-actions">
          <Link className="btn" to="/hit-sandbox">
            进入命中沙盘
          </Link>
          <button className="btn primary" type="button" onClick={() => setErrorMessage('分流方案登记入口尚未接入审批流')}>
            登记分流方案
          </button>
          <button className="btn" type="button" onClick={() => downloadEntries(meta.key)}>
            导出分流配置清单
          </button>
        </div>
      </header>

      <div className="stat-row">
        {stats.map((item) => (
          <article key={item.label} className="stat-card">
            <span className="stat-label">{item.label}</span>
            <strong className="stat-value">{item.value}</strong>
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
              <td className="empty-state" colSpan={columns.length + 2}>暂无分流配置数据，可先登记分流方案</td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="page-foot">
        <span>共 {total} 条分流配置记录</span>
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>
    </section>
  )
}
