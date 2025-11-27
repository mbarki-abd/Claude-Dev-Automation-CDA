import { useState, useEffect } from 'react';
import {
  Users as UsersIcon,
  Plus,
  Search,
  MoreVertical,
  Edit2,
  Trash2,
  Key,
  Terminal,
  Cloud,
  Shield,
  CheckCircle,
  XCircle,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { userService, CreateUserData, UpdateUserData, UserCredential, ClaudeAuthStatus, UnixAccountResult } from '../services/users';
import { User } from '../services/auth';
import { clsx } from 'clsx';

export function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const data = await userService.getAll();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.fullName && u.fullName.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleDelete = async (user: User) => {
    if (!confirm(`Are you sure you want to delete user ${user.username}?`)) return;
    try {
      await userService.delete(user.id);
      setUsers(users.filter((u) => u.id !== user.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  const isAdmin = currentUser?.role === 'admin';

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <UsersIcon className="h-6 w-6" />
            User Management
          </h1>
          <p className="text-muted-foreground">Manage users, permissions, and credentials</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add User
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {error}
          <button onClick={() => setError('')} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {searchQuery ? 'No users found matching your search' : 'No users yet'}
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">User</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">Role</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">Unix Account</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-muted-foreground">Last Login</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  isAdmin={isAdmin}
                  onEdit={() => {
                    setSelectedUser(user);
                    setShowEditModal(true);
                  }}
                  onDelete={() => handleDelete(user)}
                  onViewDetails={() => {
                    setSelectedUser(user);
                    setShowDetailsModal(true);
                  }}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreateModal && (
        <CreateUserModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(newUser) => {
            setUsers([...users, newUser]);
            setShowCreateModal(false);
          }}
        />
      )}

      {showEditModal && selectedUser && (
        <EditUserModal
          user={selectedUser}
          onClose={() => {
            setShowEditModal(false);
            setSelectedUser(null);
          }}
          onUpdated={(updatedUser) => {
            setUsers(users.map((u) => (u.id === updatedUser.id ? updatedUser : u)));
            setShowEditModal(false);
            setSelectedUser(null);
          }}
        />
      )}

      {showDetailsModal && selectedUser && (
        <UserDetailsModal
          user={selectedUser}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedUser(null);
          }}
          onUpdated={(updatedUser) => {
            setUsers(users.map((u) => (u.id === updatedUser.id ? updatedUser : u)));
          }}
        />
      )}
    </div>
  );
}

function UserRow({
  user,
  isAdmin,
  onEdit,
  onDelete,
  onViewDetails,
}: {
  user: User;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onViewDetails: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
            {user.fullName ? user.fullName[0].toUpperCase() : user.username[0].toUpperCase()}
          </div>
          <div>
            <div className="font-medium text-foreground">{user.fullName || user.username}</div>
            <div className="text-sm text-muted-foreground">{user.email}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span
          className={clsx(
            'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium',
            user.role === 'admin' && 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
            user.role === 'user' && 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
            user.role === 'viewer' && 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
          )}
        >
          <Shield className="h-3 w-3" />
          {user.role}
        </span>
      </td>
      <td className="px-4 py-3">
        <span
          className={clsx(
            'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium',
            user.status === 'active' && 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
            user.status === 'inactive' && 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
            user.status === 'suspended' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          )}
        >
          {user.status === 'active' ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {user.status}
        </span>
      </td>
      <td className="px-4 py-3">
        {user.unixUsername ? (
          <span className="inline-flex items-center gap-1 text-sm text-foreground">
            <Terminal className="h-3 w-3" />
            {user.unixUsername}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Not created</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : 'Never'}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 rounded hover:bg-muted"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 mt-1 w-48 rounded-md border border-border bg-card shadow-lg z-20">
                <button
                  onClick={() => {
                    setShowMenu(false);
                    onViewDetails();
                  }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-muted flex items-center gap-2"
                >
                  <Key className="h-4 w-4" />
                  View Details
                </button>
                {isAdmin && (
                  <>
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        onEdit();
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-muted flex items-center gap-2"
                    >
                      <Edit2 className="h-4 w-4" />
                      Edit User
                    </button>
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        onDelete();
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete User
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (user: User) => void;
}) {
  const [formData, setFormData] = useState<CreateUserData>({
    email: '',
    username: '',
    password: '',
    fullName: '',
    role: 'user',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const user = await userService.create(formData);
      onCreated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
        <h2 className="text-lg font-semibold mb-4">Create New User</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 rounded-md border border-input bg-background"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Username</label>
            <input
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              className="w-full px-3 py-2 rounded-md border border-input bg-background"
              required
              pattern="[a-zA-Z0-9_-]+"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Full Name</label>
            <input
              type="text"
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              className="w-full px-3 py-2 rounded-md border border-input bg-background"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-3 py-2 rounded-md border border-input bg-background"
              required
              minLength={8}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Role</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as 'admin' | 'user' | 'viewer' })}
              className="w-full px-3 py-2 rounded-md border border-input bg-background"
            >
              <option value="viewer">Viewer</option>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md border border-input hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isLoading ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditUserModal({
  user,
  onClose,
  onUpdated,
}: {
  user: User;
  onClose: () => void;
  onUpdated: (user: User) => void;
}) {
  const [formData, setFormData] = useState<UpdateUserData>({
    email: user.email,
    username: user.username,
    fullName: user.fullName || '',
    role: user.role,
    status: user.status,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const updatedUser = await userService.update(user.id, formData);
      onUpdated(updatedUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
        <h2 className="text-lg font-semibold mb-4">Edit User</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 rounded-md border border-input bg-background"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Username</label>
            <input
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              className="w-full px-3 py-2 rounded-md border border-input bg-background"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Full Name</label>
            <input
              type="text"
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              className="w-full px-3 py-2 rounded-md border border-input bg-background"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Role</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as 'admin' | 'user' | 'viewer' })}
              className="w-full px-3 py-2 rounded-md border border-input bg-background"
            >
              <option value="viewer">Viewer</option>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Status</label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'inactive' | 'suspended' })}
              className="w-full px-3 py-2 rounded-md border border-input bg-background"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md border border-input hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isLoading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function UserDetailsModal({
  user,
  onClose,
  onUpdated,
}: {
  user: User;
  onClose: () => void;
  onUpdated: (user: User) => void;
}) {
  const [activeTab, setActiveTab] = useState<'info' | 'unix' | 'credentials' | 'claude'>('info');
  const [unixAccount, setUnixAccount] = useState<UnixAccountResult | null>(null);
  const [credentials, setCredentials] = useState<UserCredential[]>([]);
  const [claudeAuth, setClaudeAuth] = useState<ClaudeAuthStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    setIsLoading(true);
    setError('');
    try {
      if (activeTab === 'unix') {
        const data = await userService.getUnixAccount(user.id);
        setUnixAccount(data);
      } else if (activeTab === 'credentials') {
        const data = await userService.getCredentials(user.id);
        setCredentials(data);
      } else if (activeTab === 'claude') {
        const data = await userService.getClaudeAuth(user.id);
        setClaudeAuth(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateUnixAccount = async () => {
    setIsLoading(true);
    setError('');
    try {
      const result = await userService.createUnixAccount(user.id);
      setUnixAccount(result);
      onUpdated({ ...user, unixUsername: result.unixUsername, unixUid: result.unixUid, homeDirectory: result.homeDirectory });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Unix account');
    } finally {
      setIsLoading(false);
    }
  };

  const tabs = [
    { id: 'info', label: 'Info', icon: UsersIcon },
    { id: 'unix', label: 'Unix Account', icon: Terminal },
    { id: 'credentials', label: 'Cloud Credentials', icon: Cloud },
    { id: 'claude', label: 'Claude Auth', icon: Key },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-lg max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">User Details: {user.username}</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <XCircle className="h-5 w-5" />
            </button>
          </div>
          <div className="flex gap-2 mt-4">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  activeTab === tab.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6 overflow-auto flex-1">
          {error && (
            <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}

          {activeTab === 'info' && (
            <div className="space-y-4">
              <InfoRow label="Email" value={user.email} />
              <InfoRow label="Username" value={user.username} />
              <InfoRow label="Full Name" value={user.fullName || '-'} />
              <InfoRow label="Role" value={user.role} />
              <InfoRow label="Status" value={user.status} />
              <InfoRow label="Timezone" value={user.timezone || 'UTC'} />
              <InfoRow label="Created" value={new Date(user.createdAt).toLocaleString()} />
              <InfoRow label="Last Login" value={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'} />
            </div>
          )}

          {activeTab === 'unix' && (
            <div className="space-y-4">
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : unixAccount || user.unixUsername ? (
                <>
                  <InfoRow label="Unix Username" value={unixAccount?.unixUsername || user.unixUsername || '-'} />
                  <InfoRow label="UID" value={String(unixAccount?.unixUid || user.unixUid || '-')} />
                  <InfoRow label="GID" value={String(unixAccount?.unixGid || '-')} />
                  <InfoRow label="Home Directory" value={unixAccount?.homeDirectory || user.homeDirectory || '-'} />
                </>
              ) : (
                <div className="text-center py-8">
                  <Terminal className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-4">No Unix account created yet</p>
                  <button
                    onClick={handleCreateUnixAccount}
                    disabled={isLoading}
                    className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    Create Unix Account
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'credentials' && (
            <div className="space-y-4">
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : credentials.length === 0 ? (
                <div className="text-center py-8">
                  <Cloud className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No cloud credentials configured</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {credentials.map((cred) => (
                    <div key={cred.id} className="p-4 rounded-lg border border-border">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">{cred.provider}</div>
                          <div className="text-sm text-muted-foreground">{cred.credentialType}</div>
                        </div>
                        <span
                          className={clsx(
                            'px-2 py-1 rounded-md text-xs font-medium',
                            cred.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                          )}
                        >
                          {cred.status}
                        </span>
                      </div>
                      {cred.lastUsedAt && (
                        <div className="text-xs text-muted-foreground mt-2">
                          Last used: {new Date(cred.lastUsedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'claude' && (
            <div className="space-y-4">
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : claudeAuth && claudeAuth.status !== 'inactive' ? (
                <>
                  <InfoRow label="Auth Method" value={claudeAuth.authMethod || '-'} />
                  <InfoRow label="Status" value={claudeAuth.status} />
                  {claudeAuth.expiresAt && (
                    <InfoRow label="Expires" value={new Date(claudeAuth.expiresAt).toLocaleString()} />
                  )}
                  {claudeAuth.lastUsedAt && (
                    <InfoRow label="Last Used" value={new Date(claudeAuth.lastUsedAt).toLocaleString()} />
                  )}
                </>
              ) : (
                <div className="text-center py-8">
                  <Key className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No Claude authentication configured</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
