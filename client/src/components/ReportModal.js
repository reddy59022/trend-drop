import React, { useState } from 'react';
import { reportListing } from '../services/api';

const ReportModal = ({ isOpen, onClose, listingId }) => {
  const [reason, setReason] = useState('Inappropriate');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await reportListing({ listingId, reason, description });
      setSuccess(true);
      setTimeout(() => {
        onClose();
        setSuccess(false);
        setReason('Inappropriate');
        setDescription('');
      }, 2000);
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 9999,
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 12, width: '90%', maxWidth: 400,
        padding: 24,
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', fontSize: 18 }}>Report Listing</h3>
        {success ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 10 }}>✓</div>
            <p style={{ color: '#2ecc71', fontWeight: 600 }}>Report submitted successfully</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 14 }}>Reason</label>
              <select value={reason} onChange={e => setReason(e.target.value)} style={{
                width: '100%', padding: 10, border: '1px solid #ddd', borderRadius: 8, fontSize: 14,
              }}>
                <option>Inappropriate</option>
                <option>Counterfeit</option>
                <option>Spam</option>
                <option>Wrong category</option>
                <option>Other</option>
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 14 }}>Description (optional)</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)}
                maxLength={500} rows={4} placeholder="Add more details..."
                style={{
                  width: '100%', padding: 10, border: '1px solid #ddd', borderRadius: 8,
                  fontSize: 14, resize: 'vertical',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={onClose} style={{
                flex: 1, padding: 10, border: '1px solid #ddd', borderRadius: 8,
                background: '#fff', cursor: 'pointer', fontWeight: 600,
              }}>Cancel</button>
              <button type="submit" disabled={submitting} style={{
                flex: 1, padding: 10, border: 'none', borderRadius: 8,
                background: '#e74c3c', color: '#fff', cursor: 'pointer',
                fontWeight: 600, opacity: submitting ? 0.6 : 1,
              }}>
                {submitting ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ReportModal;