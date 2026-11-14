import { useState } from 'react'
import { Link, Route, Routes, useMatch } from 'react-router-dom'

import Overview from './views/Overview'
import HitSandboxView from './views/hit-sandbox'
import HitBatchListView from './views/hit-sandbox/batches'
import HitBatchDetailView from './views/hit-sandbox/batches/HitBatchDetailView'
import ChannelView from './views/channel'
import CampaignView from './views/campaign'
import TouchpointView from './views/touchpoint'
import AttributionView from './views/attribution'
import RoiView from './views/roi'
import ConversionView from './views/conversion'
import UserpathView from './views/userpath'
import RetentionView from './views/retention'
import EventdefView from './views/eventdef'
import ProfileView from './views/profile'
import HeatmapView from './views/heatmap'
import BenchmarkView from './views/benchmark'
import AuditcheckView from './views/auditcheck'
import AbgroupView from './views/abgroup'
import DatavizView from './views/dataviz'
import SentimentView from './views/sentiment'
import LifecycleView from './views/lifecycle'
import OpsalertView from './views/opsalert'

const navItems = [{ label: "运营概览", path: "/" }, { label: "命中沙盘", path: "/hit-sandbox" }, { label: "渠道管理", path: "/channel" }, { label: "投放活动", path: "/campaign" }, { label: "触点追踪", path: "/touchpoint" }, { label: "归因分析", path: "/attribution" }, { label: "ROI评估", path: "/roi" }, { label: "转化漏斗", path: "/conversion" }, { label: "用户路径", path: "/userpath" }, { label: "留存分析", path: "/retention" }, { label: "事件定义", path: "/eventdef" }, { label: "用户画像", path: "/profile" }, { label: "热力分析", path: "/heatmap" }, { label: "竞品对标", path: "/benchmark" }, { label: "数据审计", path: "/auditcheck" }, { label: "分流配置", path: "/abgroup" }, { label: "可视化配置", path: "/dataviz" }, { label: "舆情分析", path: "/sentiment" }, { label: "生命周期", path: "/lifecycle" }, { label: "运营预警", path: "/opsalert" }]

// 侧栏高亮跟随地址：React Router 的 Link 不会自动加 router-link-active 类。
function NavItem({ label, path }: { label: string; path: string }) {
  const active = useMatch(path)
  return (
    <Link to={path} className={`nav-item${active ? ' router-link-active' : ''}`}>
      {label}
    </Link>
  )
}

export default function App() {
  const [operator] = useState('值班管理员')

  return (
    <div className="app-shell">
      <aside className="app-side">
        <h1 className="app-title">数据产品运营与归因分析平台</h1>
        <nav className="nav-list">
          {navItems.map((item) => (
            <NavItem key={item.path} label={item.label} path={item.path} />
          ))}
        </nav>
      </aside>
      <main className="app-main">
        <header className="app-head">
          <span className="head-desc">面向数据产品运营、渠道归因、用户行为分析、ROI评估、转化优化与数据应用监控的数据分析工程平台。</span>
          <span className="head-user">当前值班：{operator}</span>
        </header>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/hit-sandbox" element={<HitSandboxView />} />
          <Route path="/hit-sandbox/batches" element={<HitBatchListView />} />
          <Route path="/hit-sandbox/batches/:batchNo" element={<HitBatchDetailView />} />
          <Route path="/channel" element={<ChannelView />} />
          <Route path="/campaign" element={<CampaignView />} />
          <Route path="/touchpoint" element={<TouchpointView />} />
          <Route path="/attribution" element={<AttributionView />} />
          <Route path="/roi" element={<RoiView />} />
          <Route path="/conversion" element={<ConversionView />} />
          <Route path="/userpath" element={<UserpathView />} />
          <Route path="/retention" element={<RetentionView />} />
          <Route path="/eventdef" element={<EventdefView />} />
          <Route path="/profile" element={<ProfileView />} />
          <Route path="/heatmap" element={<HeatmapView />} />
          <Route path="/benchmark" element={<BenchmarkView />} />
          <Route path="/auditcheck" element={<AuditcheckView />} />
          <Route path="/abgroup" element={<AbgroupView />} />
          <Route path="/dataviz" element={<DatavizView />} />
          <Route path="/sentiment" element={<SentimentView />} />
          <Route path="/lifecycle" element={<LifecycleView />} />
          <Route path="/opsalert" element={<OpsalertView />} />
        </Routes>
      </main>
    </div>
  )
}
