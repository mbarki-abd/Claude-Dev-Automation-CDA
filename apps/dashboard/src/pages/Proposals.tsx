import { useEffect, useState } from 'react';
import { MessageSquare, Check, X, Clock, AlertTriangle, ThumbsUp, ThumbsDown, ChevronDown, ChevronUp } from 'lucide-react';
import { useProposalStore } from '../stores/proposalStore';
import type { Proposal, ProposalOption } from '@cda/shared';

const typeColors: Record<string, string> = {
  implementation: 'bg-blue-500/10 text-blue-500',
  architecture: 'bg-purple-500/10 text-purple-500',
  dependency: 'bg-orange-500/10 text-orange-500',
  deployment: 'bg-green-500/10 text-green-500',
  blocker: 'bg-red-500/10 text-red-500',
  error: 'bg-red-500/10 text-red-500',
  cost: 'bg-yellow-500/10 text-yellow-500',
};

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-500',
  approved: 'bg-green-500/10 text-green-500',
  rejected: 'bg-red-500/10 text-red-500',
  expired: 'bg-gray-500/10 text-gray-500',
};

const StatusIcon = ({ status }: { status: string }) => {
  switch (status) {
    case 'pending':
      return <Clock className="h-4 w-4" />;
    case 'approved':
      return <Check className="h-4 w-4" />;
    case 'rejected':
      return <X className="h-4 w-4" />;
    case 'expired':
      return <AlertTriangle className="h-4 w-4" />;
    default:
      return null;
  }
};

function ProposalCard({
  proposal,
  onApprove,
  onReject,
}: {
  proposal: Proposal;
  onApprove: (id: string, optionId: string) => void;
  onReject: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string>(
    proposal.recommendation || proposal.options[0]?.id || ''
  );

  const isPending = proposal.status === 'pending';

  return (
    <div className="rounded-lg border border-border bg-card">
      <div
        className="p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColors[proposal.type] || 'bg-gray-500/10 text-gray-500'}`}>
                {proposal.type}
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1 ${statusColors[proposal.status]}`}>
                <StatusIcon status={proposal.status} />
                {proposal.status}
              </span>
            </div>
            <h3 className="font-semibold text-foreground">{proposal.title}</h3>
            {proposal.description && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                {proposal.description}
              </p>
            )}
          </div>
          <button className="p-1 text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </button>
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
          <span>{proposal.options.length} options</span>
          <span>Created: {new Date(proposal.createdAt).toLocaleString()}</span>
          {proposal.recommendation && (
            <span className="text-green-500">Has recommendation</span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border p-4">
          <h4 className="font-medium mb-3">Options</h4>
          <div className="space-y-3">
            {proposal.options.map((option) => (
              <OptionCard
                key={option.id}
                option={option}
                isSelected={selectedOption === option.id}
                isRecommended={proposal.recommendation === option.id}
                onSelect={() => isPending && setSelectedOption(option.id)}
                disabled={!isPending}
              />
            ))}
          </div>

          {isPending && (
            <div className="flex gap-2 mt-4 pt-4 border-t border-border">
              <button
                onClick={() => onApprove(proposal.id, selectedOption)}
                disabled={!selectedOption}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ThumbsUp className="h-4 w-4" />
                Approve Selected
              </button>
              <button
                onClick={() => onReject(proposal.id)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                <ThumbsDown className="h-4 w-4" />
                Reject
              </button>
            </div>
          )}

          {!isPending && proposal.resolution && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground">
                <strong>Resolution:</strong> {proposal.resolution}
              </p>
              {proposal.resolvedAt && (
                <p className="text-xs text-muted-foreground mt-1">
                  Resolved: {new Date(proposal.resolvedAt).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OptionCard({
  option,
  isSelected,
  isRecommended,
  onSelect,
  disabled,
}: {
  option: ProposalOption;
  isSelected: boolean;
  isRecommended: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <div
      onClick={onSelect}
      className={`p-3 rounded-lg border transition-colors ${
        disabled
          ? 'cursor-default'
          : 'cursor-pointer hover:border-primary/50'
      } ${
        isSelected
          ? 'border-primary bg-primary/5'
          : 'border-border'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{option.name}</span>
            {isRecommended && (
              <span className="px-2 py-0.5 rounded text-xs bg-green-500/10 text-green-500">
                Recommended
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{option.description}</p>
        </div>
        {!disabled && (
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
            isSelected ? 'border-primary bg-primary' : 'border-muted-foreground'
          }`}>
            {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 mt-3">
        {option.pros.length > 0 && (
          <div>
            <p className="text-xs font-medium text-green-500 mb-1">Pros</p>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {option.pros.map((pro, i) => (
                <li key={i} className="flex items-start gap-1">
                  <span className="text-green-500">+</span>
                  {pro}
                </li>
              ))}
            </ul>
          </div>
        )}
        {option.cons.length > 0 && (
          <div>
            <p className="text-xs font-medium text-red-500 mb-1">Cons</p>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {option.cons.map((con, i) => (
                <li key={i} className="flex items-start gap-1">
                  <span className="text-red-500">-</span>
                  {con}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function Proposals() {
  const {
    proposals,
    pendingProposals,
    isLoading,
    error,
    pagination,
    filters,
    fetchProposals,
    fetchPendingProposals,
    approveProposal,
    rejectProposal,
    setFilters,
    setPage,
    clearError,
  } = useProposalStore();

  const [activeTab, setActiveTab] = useState<'pending' | 'all'>('pending');

  useEffect(() => {
    fetchPendingProposals();
    fetchProposals();
  }, [fetchPendingProposals, fetchProposals]);

  const handleApprove = async (id: string, optionId: string) => {
    try {
      await approveProposal(id, optionId);
    } catch {
      // Error is handled in store
    }
  };

  const handleReject = async (id: string) => {
    try {
      await rejectProposal(id);
    } catch {
      // Error is handled in store
    }
  };

  const displayedProposals = activeTab === 'pending' ? pendingProposals : proposals;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <MessageSquare className="h-6 w-6" />
          Proposals
        </h1>
        <p className="text-muted-foreground">
          Review and approve proposals from Claude Code executions
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center justify-between">
          <span className="text-red-500">{error}</span>
          <button onClick={clearError} className="text-red-500 hover:text-red-400">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex items-center gap-4 mb-6">
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'pending'
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            Pending ({pendingProposals.length})
          </button>
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            All ({pagination.total})
          </button>
        </div>

        {activeTab === 'all' && (
          <select
            value={filters.status || ''}
            onChange={(e) => setFilters({ ...filters, status: e.target.value || undefined })}
            className="px-3 py-2 rounded-lg border border-border bg-card text-sm"
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="expired">Expired</option>
          </select>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : displayedProposals.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No {activeTab === 'pending' ? 'pending ' : ''}proposals</p>
          {activeTab === 'pending' && (
            <p className="text-sm mt-2">
              Proposals will appear here when Claude Code needs your input during task execution
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {displayedProposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}
        </div>
      )}

      {activeTab === 'all' && pagination.total > pagination.limit && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage(pagination.page - 1)}
            disabled={pagination.page === 1}
            className="px-3 py-1 rounded border border-border disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-muted-foreground">
            Page {pagination.page} of {Math.ceil(pagination.total / pagination.limit)}
          </span>
          <button
            onClick={() => setPage(pagination.page + 1)}
            disabled={pagination.page >= Math.ceil(pagination.total / pagination.limit)}
            className="px-3 py-1 rounded border border-border disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
