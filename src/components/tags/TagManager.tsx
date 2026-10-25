import React, { useState } from 'react';
import { Plus, Archive, RotateCcw, Trash2, Edit2, Tag as TagIcon } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Tag } from '../../types/tag';
import { Button } from '../ui/Button';
import { TagFormModal } from './TagFormModal';
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
      <div className="flex flex-row sm:flex-row items-center justify-between gap-4 pb-2">
        <div>
          <h2 className="text-2xl font-bold text-md-on-surface">Tags</h2>
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
            'flex items-center gap-2 min-h-[48px] md:min-h-0 px-5 py-2.5 md:px-4 md:py-2 text-sm font-semibold border-b-2 transition-all -mb-[5px]',
            activeTab === 'active'
              ? 'border-md-primary text-md-primary'
              : 'border-transparent text-md-on-surface-variant hover:text-md-on-surface'
          )}
        >
          <span>Active</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-md-surface-container font-medium">
            {activeTags.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('archived')}
          className={clsx(
            'flex items-center gap-2 min-h-[48px] md:min-h-0 px-5 py-2.5 md:px-4 md:py-2 text-sm font-semibold border-b-2 transition-all -mb-[5px]',
            activeTab === 'archived'
              ? 'border-md-primary text-md-primary'
              : 'border-transparent text-md-on-surface-variant hover:text-md-on-surface'
          )}
        >
          <span>Archived</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-md-surface-container font-medium">
            {archivedTags.length}
          </span>
        </button>
      </div>

      {/* Tags List */}
      {currentList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed border-md-outline-variant/40 rounded-3xl p-6">
          <div className="w-12 h-12 rounded-2xl bg-md-surface-container flex items-center justify-center text-md-outline mb-3">
            {activeTab === 'active' ? <TagIcon className="w-6 h-6" /> : <Archive className="w-6 h-6" />}
          </div>
          <h3 className="text-base font-bold text-md-on-surface">
            {activeTab === 'active' ? 'No active tags yet' : 'No archived tags'}
          </h3>
          <p className="text-xs text-md-on-surface-variant max-w-sm mt-1 mb-4">
            {activeTab === 'active'
              ? 'Create tags to organize and track focus time across different activities.'
              : 'Archived tags are hidden from the timer while keeping your stats intact. You can delete or restore them here.'}
          </p>
          {activeTab === 'active' && (
            <Button onClick={handleCreateNew} variant="tonal" size="sm">
              <Plus className="w-4 h-4 mr-1.5" />
              <span>Create First Tag</span>
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {currentList.map((tag) => {
            const count = getSessionCountForTag(tag.id);
            return (
              <div
                key={tag.id}
                className="group p-4 rounded-3xl bg-md-surface-container-low border border-md-outline-variant/30 hover:border-md-primary/40 transition-all flex items-center justify-between shadow-xs hover:shadow-elevation-1"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-xs"
                    style={{ backgroundColor: `${tag.color}25`, border: `1.5px solid ${tag.color}` }}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                  </div>

                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-md-on-surface truncate">
                      {tag.name}
                    </h4>
                    <p className="text-[11px] text-md-on-surface-variant">
                      {count} focus session{count === 1 ? '' : 's'} logged
                    </p>
                  </div>
                </div>

                {/* Actions: Active tags can only be Edited or Archived. Deletion is reserved for Archived tags. */}
                <div className="flex items-center gap-1">
                  {activeTab === 'active' ? (
                    <>
                      <button
                        onClick={() => handleEdit(tag)}
                        className="w-11 h-11 md:w-auto md:h-auto md:p-2 flex items-center justify-center rounded-xl text-md-on-surface-variant hover:text-md-primary hover:bg-md-surface-container transition-colors"
                        title="Edit Tag"
                      >
                        <Edit2 className="w-5 h-5 md:w-4 md:h-4" />
                      </button>

                      <button
                        onClick={() => archiveTag(tag.id)}
                        className="w-11 h-11 md:w-auto md:h-auto md:p-2 flex items-center justify-center rounded-xl text-md-on-surface-variant hover:text-amber-600 hover:bg-amber-500/10 transition-colors"
                        title="Archive Tag (Move to archived list before deleting)"
                      >
                        <Archive className="w-5 h-5 md:w-4 md:h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => unarchiveTag(tag.id)}
                        className="w-11 h-11 md:w-auto md:h-auto md:p-2 flex items-center justify-center rounded-xl text-md-on-surface-variant hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors"
                        title="Restore Tag"
                      >
                        <RotateCcw className="w-5 h-5 md:w-4 md:h-4" />
                      </button>

                      <button
                        onClick={() => setDeleteConfirmId(tag.id)}
                        className="w-11 h-11 md:w-auto md:h-auto md:p-2 flex items-center justify-center rounded-xl text-md-on-surface-variant hover:text-md-error hover:bg-md-error/10 transition-colors"
                        title="Delete Tag Permanently"
                      >
                        <Trash2 className="w-5 h-5 md:w-4 md:h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-md-surface-container-lowest p-6 rounded-3xl max-w-sm w-full border border-md-outline-variant/30 shadow-elevation-3">
            <h3 className="text-base font-bold text-md-on-surface mb-2">Delete Tag Permanently?</h3>
            <p className="text-xs text-md-on-surface-variant mb-5 leading-relaxed">
              This will permanently delete this tag. Completed sessions associated with this tag will become "Unassigned".
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="text"
                size="sm"
                onClick={() => setDeleteConfirmId(null)}
              >
                Cancel
              </Button>
              <Button
                variant="filled"
                size="sm"
                className="bg-md-error text-white hover:bg-red-700"
                onClick={async () => {
                  await deleteTag(deleteConfirmId);
                  setDeleteConfirmId(null);
                }}
              >
                Delete Tag
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Tag Modal */}
      <TagFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        tagToEdit={tagToEdit}
      />
    </div>
  );
};
