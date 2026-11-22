import React from 'react';
import { Cloud, GitMerge, Trash2, AlertTriangle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useData } from '../../context/DataContext';

/**
 * One-time reconciliation prompt shown when local guest data meets an existing
 * populated cloud account on sign-in (Decision 1A).
 */
export const GuestReconciliationModal: React.FC = () => {
  const { pendingGuestReconciliation } = useData();

  if (!pendingGuestReconciliation) {
    return null;
  }

  const { summary, isResolving, error, resolve } = pendingGuestReconciliation;
  const items: string[] = [];
  if (summary.sessionsCount > 0) {
    items.push(
      `${summary.sessionsCount} focus ${summary.sessionsCount === 1 ? 'session' : 'sessions'}`
    );
  }
  if (summary.coffeeCount > 0) {
    items.push(
      `${summary.coffeeCount} coffee ${summary.coffeeCount === 1 ? 'cup' : 'cups'}`
    );
  }
  if (summary.customTagsCount > 0) {
    items.push(
      `${summary.customTagsCount} custom or edited ${summary.customTagsCount === 1 ? 'tag' : 'tags'}`
    );
  }
  if (summary.hasCustomSettings || summary.hasCustomProfile) {
    items.push('local preferences');
  }

  return (
    <Modal
      isOpen={true}
      onClose={() => {}}
      dismissible={false}
      title="Local Guest Data Found"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-md-primary-container text-md-on-primary-container flex items-center justify-center shrink-0">
            <Cloud className="w-5 h-5" />
          </div>
          <p className="text-xs text-md-on-surface-variant leading-relaxed">
            You have local data on this device from before signing in, and your cloud account
            already contains saved history. Choose how you would like to continue:
          </p>
        </div>

        {items.length > 0 && (
          <div className="p-3 rounded-2xl bg-md-surface-container text-xs text-md-on-surface flex flex-col gap-1">
            <span className="font-semibold text-md-on-surface-variant">Found on this device:</span>
            {items.map((item) => (
              <span key={item}>• {item}</span>
            ))}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-2xl bg-md-error/10 border border-md-error/20 text-md-error text-xs font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-2 border-t border-md-outline-variant/20">
          <Button
            variant="filled"
            className="w-full justify-center"
            disabled={isResolving}
            onClick={() => void resolve('merge')}
          >
            <GitMerge className="w-4 h-4 mr-2" />
            <span>{isResolving ? 'Syncing...' : 'Merge into your account'}</span>
          </Button>
          <Button
            variant="outlined"
            className="w-full justify-center"
            disabled={isResolving}
            onClick={() => void resolve('discard')}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            <span>Use cloud data only (discard local)</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
};
