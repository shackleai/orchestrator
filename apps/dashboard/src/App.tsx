import { Routes, Route } from 'react-router-dom'
import { DashboardLayout } from './layouts/DashboardLayout'
import { OverviewPage } from './pages/overview'
import { AgentsPage } from './pages/agents'
import { AgentDetailPage } from './pages/agent-detail'
import { TasksPage } from './pages/tasks'
import { KanbanPage } from './pages/kanban'
import { ActivityPage } from './pages/activity'
import { CostsPage } from './pages/costs'
import { OrgChartPage } from './pages/org-chart'
import { SettingsPage } from './pages/settings'

export function App() {
  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="agents/:id" element={<AgentDetailPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="board" element={<KanbanPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="costs" element={<CostsPage />} />
        <Route path="org-chart" element={<OrgChartPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
