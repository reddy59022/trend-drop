import React, { useState } from 'react';
import { FaTimes, FaSpinner, FaFlag, FaUpload, FaExclamationTriangle } from 'react-icons/fa';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';

const reportReasons = [
  { value: 'inappropriate', label: 'Inappropriate Content', icon: '🚫' },
  { value: 'counterfeit', label: 'Counterfeit Item', icon: '⚠️' },
  { value: 'misleading', label: 'Misleading Description', icon: '📝' },
  { value: 'prohibited', label: 'Prohibited Item', icon: '🚨' },
  { value: 'spam', label: 'Spam', icon: '📧' },
  { value: 'other', label: 'Other', icon: '💬' },
];

const ReportModal = ({ listing, isOpen, onClose, onReportSubmitted }) => {
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen || !listing) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) {
      toast.error('Please login to report');
      return;
    }
    if (!reason) {
      toast.error('Please select a reason');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/reports', {
        listingId: listing._id,
        reason,
        description: description.trim(),
      });
      toast.success('Report submitted. We will review it shortly.');
      onReportSubmitted?.();
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2><FaFlag style={{ marginRight: 8, color: 'var(--td-error)' }} /> Report Listing</h2>
          <button className="modal-close" onClick={onClose}><FaTimes /></button>
        </div>

        <div className="modal-body">
          <div style={{ 
            background: 'rgba(255, 23, 68, 0.06)', 
            borderRadius: 'var(--td-radius-sm)', 
            padding: 12, 
            marginBottom: 16,
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            fontSize: 13,
            color: 'var(--td-text-secondary)',
          }}>
            <FaExclamationTriangle color="var(--td-error)" style={{ marginTop: 2, flexShrink: 0 }} />
            <span>Reports are reviewed by our team. False reports may result in account restrictions.</span>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Reason for Report</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                {reportReasons.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    className={`btn btn-sm ${reason === r.value ? 'btn-danger' : 'btn-outline'}`}
                    onClick={() => setReason(r.value)}
                    style={{ justifyContent: 'flex-start', gap: 8 }}
                  >
                    <span>{r.icon}</span> {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label">Additional Details</label>
              <textarea
                className="form-input"
                placeholder="Provide any additional information..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
                rows={4}
              />
              <div className="form-hint" style={{ textAlign: 'right' }}>{description.length}/1000</div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button type="button" className="btn btn-outline btn-block" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-danger btn-block" disabled={submitting || !reason}>
                {submitting ? <><FaSpinner className="spinner-sm" /> Submitting...</> : 'Submit Report'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ReportModal;