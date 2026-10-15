import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Check } from 'lucide-react';
import { toDateKey } from '../../utils/dates';

interface DateRangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRange: { start: string; end: string };
  onApplyRange: (range: { start: string; end: string }) => void;
}

export const DateRangeModal: React.FC<DateRangeModalProps> = ({
  isOpen,
  onClose,
  currentRange,
  onApplyRange,
}) => {
  const [start, setStart] = useState(currentRange.start);
  const [end, setEnd] = useState(currentRange.end);
  const [error, setError] = useState('');

  // Keep state in sync with currentRange whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setStart(currentRange.start);
      setEnd(currentRange.end);
      setError('');
    }
  }, [isOpen, currentRange.start, currentRange.end]);

  const presets = [
    {
      label: 'Last 7 Days',
      getDates: () => {
        const e = new Date();
        const s = new Date();
        s.setDate(e.getDate() - 6);
        return { start: toDateKey(s), end: toDateKey(e) };
      },
    },
    {
      label: 'Last 14 Days',
      getDates: () => {
        const e = new Date();
        const s = new Date();
        s.setDate(e.getDate() - 13);
        return { start: toDateKey(s), end: toDateKey(e) };
      },
    },
    {
      label: 'This Month',
      getDates: () => {
        const now = new Date();
        const s = new Date(now.getFullYear(), now.getMonth(), 1);
        return { start: toDateKey(s), end: toDateKey(now) };
      },
    },
    {
      label: 'Last 30 Days',
      getDates: () => {
        const e = new Date();
        const s = new Date();
        s.setDate(e.getDate() - 29);
        return { start: toDateKey(s), end: toDateKey(e) };
      },
    },
    {
      label: 'Last 90 Days',
      getDates: () => {
        const e = new Date();
        const s = new Date();
        s.setDate(e.getDate() - 89);
        return { start: toDateKey(s), end: toDateKey(e) };
      },
    },
    {
      label: 'Year to Date',
      getDates: () => {
        const now = new Date();
        const s = new Date(now.getFullYear(), 0, 1);
        return { start: toDateKey(s), end: toDateKey(now) };
      },
    },
  ];

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!start || !end) {
      setError('Please select both a start and end date');
      return;
    }
    if (new Date(start) > new Date(end)) {
      setError('Start date cannot be after end date');
      return;
    }
    onApplyRange({ start, end });
    onClose();
  };

  const handleSelectPreset = (preset: (typeof presets)[0]) => {
    const dates = preset.getDates();
    setStart(dates.start);
    setEnd(dates.end);
    setError('');
    // Immediately apply and close for instant one-click preset selection
    onApplyRange(dates);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Select Custom Date Range">
      <form onSubmit={handleApply} className="flex flex-col gap-5">
        {/* Presets */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-md-on-surface-variant px-1">
            Quick Date Presets
          </span>
          <div className="grid grid-cols-3 gap-2">
            {presets.map((p) => (
              <button
                type="button"
                key={p.label}
                onClick={() => handleSelectPreset(p)}
                className="px-2.5 py-2.5 rounded-xl bg-md-surface-container text-xs font-semibold text-md-on-surface hover:bg-md-primary hover:text-white transition-all text-center shadow-xs active:scale-95"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Start Date & End Date Inputs */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-md-on-surface-variant px-1">
              Start Date (DD/MM/YYYY)
            </label>
            <div className="relative">
              <input
                type="date"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  if (error) setError('');
                }}
                className="w-full px-3 py-2 rounded-2xl bg-md-surface-container-high text-xs font-semibold text-md-on-surface border border-md-outline-variant/30 focus:outline-none focus:border-md-primary"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-md-on-surface-variant px-1">
              End Date (DD/MM/YYYY)
            </label>
            <div className="relative">
              <input
                type="date"
                value={end}
                onChange={(e) => {
                  setEnd(e.target.value);
                  if (error) setError('');
                }}
                className="w-full px-3 py-2 rounded-2xl bg-md-surface-container-high text-xs font-semibold text-md-on-surface border border-md-outline-variant/30 focus:outline-none focus:border-md-primary"
              />
            </div>
          </div>
        </div>

        {error && <span className="text-xs text-md-error px-1 font-medium">{error}</span>}

        {/* Buttons */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-md-outline-variant/20">
          <Button type="button" variant="text" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="filled" size="sm">
            <Check className="w-4 h-4 mr-1.5" />
            Apply Range
          </Button>
        </div>
      </form>
    </Modal>
  );
};
