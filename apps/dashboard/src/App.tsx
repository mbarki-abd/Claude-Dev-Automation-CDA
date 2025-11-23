import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './pages/Dashboard';
import { Tasks } from './pages/Tasks';

function TerminalPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Terminal</h1>
      <p className="text-muted-foreground">Live terminal output will appear here when tasks are running.</p>
      <div className="mt-6 rounded-lg border border-border bg-black p-4 h-[500px] font-mono text-sm text-green-400">
        <p>$ claude-dev-automation ready...</p>
        <p>$ Waiting for task execution...</p>
        <p className="animate-pulse">_</p>
      </div>
    </div>
  );
}

function ProposalsPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Proposals</h1>
      <p className="text-muted-foreground">Pending proposals requiring your approval will appear here.</p>
      <div className="mt-6 text-center py-12 text-muted-foreground">
        No pending proposals
      </div>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Settings</h1>
      <div className="space-y-6 max-w-2xl">
        <section className="rounded-lg border border-border p-6">
          <h2 className="text-lg font-semibold mb-4">Microsoft Planner</h2>
          <p className="text-sm text-muted-foreground mb-4">Connect to Microsoft Planner to sync tasks automatically.</p>
          <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
            Connect Planner
          </button>
        </section>

        <section className="rounded-lg border border-border p-6">
          <h2 className="text-lg font-semibold mb-4">API Keys</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Anthropic API Key</label>
              <input
                type="password"
                placeholder="sk-ant-..."
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">GitHub Token</label>
              <input
                type="password"
                placeholder="ghp_..."
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Hetzner API Token</label>
              <input
                type="password"
                placeholder="..."
                className="w-full px-3 py-2 rounded-lg border border-border bg-background"
              />
            </div>
          </div>
          <button className="mt-4 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
            Save Settings
          </button>
        </section>

        <section className="rounded-lg border border-border p-6">
          <h2 className="text-lg font-semibold mb-4">MCP Servers</h2>
          <p className="text-sm text-muted-foreground mb-4">Configure Model Context Protocol servers for enhanced capabilities.</p>
          <div className="space-y-2">
            {['github', 'filesystem', 'docker', 'kubernetes'].map((server) => (
              <label key={server} className="flex items-center gap-3">
                <input type="checkbox" className="rounded" />
                <span className="capitalize">{server}</span>
              </label>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="terminal" element={<TerminalPage />} />
          <Route path="proposals" element={<ProposalsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
