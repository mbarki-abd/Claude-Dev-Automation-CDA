import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './pages/Dashboard';
import { Tasks } from './pages/Tasks';
import { Settings } from './pages/Settings';
import { Logs } from './pages/Logs';
import { Terminal } from './pages/Terminal';
import { Proposals } from './pages/Proposals';
import { CLIAuth } from './pages/CLIAuth';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="terminal" element={<Terminal />} />
          <Route path="logs" element={<Logs />} />
          <Route path="proposals" element={<Proposals />} />
          <Route path="cli-auth" element={<CLIAuth />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
