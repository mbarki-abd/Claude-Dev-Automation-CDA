import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ListTodo, CheckCircle, XCircle, Clock, Play } from 'lucide-react';
import { useTaskStore } from '../stores/taskStore';
import { TaskCard } from '../components/tasks/TaskCard';

export function Dashboard() {
  const { tasks, stats, fetchTasks, fetchStats, executeTask, cancelTask } = useTaskStore();

  useEffect(() => {
    fetchTasks();
    fetchStats();
  }, [fetchTasks, fetchStats]);

  const recentTasks = tasks.slice(0, 5);
  const runningTasks = tasks.filter((t) => t.status === 'executing');

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your development automation</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Total Tasks"
          value={stats?.total || 0}
          icon={ListTodo}
          color="text-blue-500"
        />
        <StatCard
          title="Running"
          value={stats?.byStatus?.executing || 0}
          icon={Play}
          color="text-green-500"
        />
        <StatCard
          title="Completed"
          value={stats?.byStatus?.completed || 0}
          icon={CheckCircle}
          color="text-emerald-500"
        />
        <StatCard
          title="Failed"
          value={stats?.byStatus?.failed || 0}
          icon={XCircle}
          color="text-red-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Running Tasks */}
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Activity className="h-5 w-5 text-green-500" />
              Running Tasks
            </h2>
            <Link to="/terminal" className="text-sm text-primary hover:underline">
              View Terminal
            </Link>
          </div>
          {runningTasks.length === 0 ? (
            <p className="text-muted-foreground text-sm">No tasks currently running</p>
          ) : (
            <div className="space-y-3">
              {runningTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onCancel={cancelTask}
                />
              ))}
            </div>
          )}
        </div>

        {/* Recent Tasks */}
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-500" />
              Recent Tasks
            </h2>
            <Link to="/tasks" className="text-sm text-primary hover:underline">
              View All
            </Link>
          </div>
          {recentTasks.length === 0 ? (
            <p className="text-muted-foreground text-sm">No tasks yet</p>
          ) : (
            <div className="space-y-3">
              {recentTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onExecute={executeTask}
                  onCancel={cancelTask}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Task Type Distribution */}
      {stats?.byType && Object.keys(stats.byType).length > 0 && (
        <div className="mt-6 rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold mb-4">Tasks by Type</h2>
          <div className="flex flex-wrap gap-4">
            {Object.entries(stats.byType).map(([type, count]) => (
              <div key={type} className="flex items-center gap-2">
                <span className="px-2 py-1 rounded bg-secondary text-secondary-foreground text-sm font-medium">
                  {type}
                </span>
                <span className="text-muted-foreground">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  color,
}: {
  title: string;
  value: number;
  icon: typeof Activity;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        <Icon className={`h-8 w-8 ${color}`} />
      </div>
    </div>
  );
}
