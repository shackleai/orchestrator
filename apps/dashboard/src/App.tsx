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
import { TaskDetailPage } from './pages/task-detail'
import { DesignGuidePage } from './pages/design-guide'

export function App() {
  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="agents/:id" element={<AgentDetailPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="tasks/:id" element={<TaskDetailPage />} />
        <Route path="board" element={<KanbanPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="costs" element={<CostsPage />} />
        <Route path="org-chart" element={<OrgChartPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="design-guide" element={<DesignGuidePage />} />
      </Route>
    </Routes>
  )
}
