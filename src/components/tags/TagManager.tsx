import React, { useState } from 'react';
import { Plus, Archive, RotateCcw, Trash2, Edit2, Tag as TagIcon, CheckCircle2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Tag } from '../../types/tag';
import { Button } from '../ui/Button';
import { TagFormModal } from './TagFormModal';
import { formatFriendlyDate } from '../../utils/dates';
import { clsx } from 'clsx';

export const TagManager: React.FC = () => {
  const { tags, sessions, archiveTag, unarchiveTag, deleteTag } = useApp();
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tagToEdit, setTagToEdit] = useState<Tag | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const activeTags = tags.filter((t) => !t.isArchived);
  const archivedTags = tags.filter((t) => t.isArchived);

  // Count sessions per tag
  const getSessionCountForTag = (tagId: string) => {
    return sessions.filter((s) => s.tagId === tagId && s.sessionType === 'WORK').length;
  };

  const handleEdit = (tag: Tag) => {
    setTagToEdit(tag);
    setIsModalOpen(true);
  };

  const handleCreateNew = () => {
    setTagToEdit(null);
    setIsModalOpen(true);
  };

  const currentList = activeTab === 'active' ? activeTags : archivedTags;

  return (
    <div className="w-full max-w-4xl mx-auto py-6 px-4 flex flex-col gap-6">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2">
        <div>
          <h2 className="text-2xl font-bold text-md-on-surface">Tags</h2>
          <p className="text-xs text-md-on-surface-variant mt-0.5">
            Organize focus sessions into projects, clients, or learning domains.
          </p>
        </div>
        <Button onClick={handleCreateNew} variant="filled" className="shadow-xs">
          <Plus className="w-4 h-4 mr-1.5" />
          <span>New Tag</span>
        </Button>
      </div>

      {/* Tabs: Active vs Archived */}
      <div className="flex items-center gap-2 border-b border-md-outline-variant/30 pb-1">
        <button
          onClick={() => setActiveTab('active')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition-all -mb-[5px]',
            activeTab === 'active'
              ? 'border-md-primary text-md-primary'
              : 'border-transparent text-md-on-surface-variant hover:text-md-on-surface'
          )}
        >
          <span>Active Tags</span>
          <span className="px-2 py-0.5 rounded-full text-xs bg-md-primary-container text-md-on-primary-container">
            {activeTags.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('archived')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition-all -mb-[5px]',
            activeTab === 'archived'
              ? 'border-md-primary text-md-primary'
              : 'border-transparent text-md-on-surface-variant hover:text-md-on-surface'
          )}
        >
          <span>Archived Tags</span>
          <span className="px-2 py-0.5 rounded-full text-xs bg-md-surface-container-high text-md-on-surface-variant">
            {archivedTags.length}
          </span>
        </button>
      </div>

      {/* Tags Grid / List */}
      {currentList.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-md-surface-container-low rounded-3xl border border-dashed border-md-outline-variant/40 text-center">
          <TagIcon className="w-12 h-12 text-md-outline/60 mb-3" />
          <h3 className="text-base font-bold text-md-on-surface">
            {activeTab === 'active' ? 'No active tags yet' : 'No archived tags'}
          </h3>
          <p className="text-xs text-md-on-surface-variant max-w-sm mt-1 mb-4">
            {activeTab === 'active'
              ? 'Create tags to organize and track focus time across different activities.'
              : 'Archived tags are soft-deleted from selector dropdowns but preserve historical analytics.'}
          </p>
          {activeTab === 'active' && (
            <Button onClick={handleCreateNew} variant="tonal" size="sm">
              <Plus className="w-4 h-4 mr-1" />
              Create First Tag
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {currentList.map((tag) => {
            const count = getSessionCountForTag(tag.id);
            const isDeleting = deleteConfirmId === tag.id;

            return (
              <div
                key={tag.id}
                className="flex items-center justify-between p-4 bg-md-surface-container-low border border-md-outline-variant/30 rounded-3xl shadow-xs hover:shadow-elevation-1 transition-all"
              >
                {/* Left Tag Meta */}
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className="w-5 h-5 rounded-full shrink-0 shadow-xs"
                    style={{ backgroundColor: tag.color }}
                  />
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-md-on-surface truncate">
                      {tag.name}
                    </h4>
                    <div className="flex items-center gap-2 text-xs text-md-on-surface-variant mt-0.5">
                      <span>{count} session{count === 1 ? '' : 's'}</span>
                      <span>•</span>
                      <span>{formatFriendlyDate(tag.createdAt)}</span>
                    </div>
                  </div>
                </div>

                {/* Right Actions */}
                <div className="flex items-center gap-1 shrink-0 ml-3">
                  {activeTab === 'active' ? (
                    <>
                      <button
                        onClick={() => handleEdit(tag)}
                        className="p-2 rounded-full text-md-on-surface-variant hover:bg-md-surface-container hover:text-md-on-surface transition-colors"
                        title="Edit Tag"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => archiveTag(tag.id)}
                        className="p-2 rounded-full text-md-on-surface-variant hover:bg-md-surface-container hover:text-md-primary transition-colors"
                        title="Archive Tag (Soft Delete)"
                      >
                        <Archive className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      {isDeleting ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => deleteTag(tag.id)}
                            className="px-2.5 py-1 rounded-full text-xs font-semibold bg-md-error text-md-on-error hover:bg-red-700 transition-colors"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="px-2 py-1 rounded-full text-xs text-md-on-surface-variant hover:bg-md-surface-container"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => unarchiveTag(tag.id)}
                            className="p-2 rounded-full text-md-on-surface-variant hover:bg-md-surface-container hover:text-md-primary transition-colors"
                            title="Restore Tag"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(tag.id)}
                            className="p-2 rounded-full text-md-on-surface-variant hover:bg-md-error-container hover:text-md-error transition-colors"
                            title="Permanently Delete Tag"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info Card on Archiving */}
      <div className="p-4 bg-md-surface-container rounded-2xl border border-md-outline-variant/20 text-xs text-md-on-surface-variant flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 text-md-primary shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-md-on-surface block mb-0.5">
            Archival Preservation
          </span>
          Archived tags are safely removed from the active session picker, but your historical sessions, logs, and total focus statistics will always retain full attribution.
        </div>
      </div>

      {/* Modal */}
      <TagFormModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setTagToEdit(null);
        }}
        tagToEdit={tagToEdit}
      />
    </div>
  );
};
