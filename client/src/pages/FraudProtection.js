import React, { useState, useEffect } from 'react';
import { getFraudSettings, checkFraud, flagFraud } from '../services/api';

const RISK_COLORS = {
  low: { color: 'var(--td-success)', bg: 'rgba(34,197,94,0.1)' },
  medium: { color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  high: { color: 'var(--td-error)', bg: 'rgba(239,68,68,0.1)' },
};

const FraudProtection = () => {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ listingId: '', amount: '' });
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [flagForm, setFlagForm] = useState({ transactionId: '', reason: 'manual_review', notes: '' });
  const [flagResult, setFlagResult] = useState(null);
  const [flagging, setFlagging] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await getFraudSettings();
      setSettings(res.data);
    } catch (e) {
      console.error('Failed to fetch fraud settings:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleCheck = async () => {
    if (!form.listingId || !form.amount) {
      setError('Listing ID and amount are required');
      return;
    }
    setChecking(true);
    setError('');
    setResult(null);
    try {
      const res = await checkFraud({
        listingId: form.listingId,
        amount: parseFloat(form.amount),
        userAgent: navigator.userAgent,
      });
      setResult(res.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Fraud check failed');
    } finally {
      setChecking(false);
    }
  };

  const handleFlag = async () => {
    if (!flagForm.transactionId) {
      setError('Transaction ID is required to flag');
      return;
    }
    setFlagging(true);
    setError('');
    setFlagResult(null);
    try {
      const res = await flagFraud(flagForm);
      setFlagResult(res.data);
      setFlagForm({ transactionId: '', reason: 'manual_review', notes: '' });
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to flag transaction');
    } finally {
      setFlagging(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container" style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  const riskColors = result ? RISK_COLORS[result.riskLevel] || RISK_COLORS.low : null;

  return (
    <div className="page-container" style={{ maxWidth: 900, margin: '0 auto', padding: 'var(--td-space-lg)' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>🛡️ Fraud Protection</h1>
      <p style={{ color: 'var(--td-text-secondary)', marginBottom: 24 }}>
        Enterprise-grade transaction risk scoring to protect buyers and sellers.
      </p>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--td-error)', padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Platform Risk Settings */}
      <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Platform Risk Settings</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <div style={{ padding: 12, borderRadius: 12, background: 'var(--td-bg-secondary)' }}>
            <div style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>High Value Threshold</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>${settings?.highValueThreshold || 500}</div>
          </div>
          <div style={{ padding: 12, borderRadius: 12, background: 'var(--td-bg-secondary)' }}>
            <div style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>Velocity Threshold</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{settings?.velocityThreshold || 5}/hr</div>
          </div>
          <div style={{ padding: 12, borderRadius: 12, background: 'var(--td-bg-secondary)' }}>
            <div style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>New Account Window</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{settings?.newAccountThresholdDays || 7} days</div>
          </div>
          <div style={{ padding: 12, borderRadius: 12, background: 'var(--td-bg-secondary)' }}>
            <div style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>Manual Review Score</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{settings?.manualReviewThreshold || 25}+</div>
          </div>
          <div style={{ padding: 12, borderRadius: 12, background: 'var(--td-bg-secondary)' }}>
            <div style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>Decline Threshold</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{settings?.declineThreshold || 75}+</div>
          </div>
        </div>
      </div>

      {/* Fraud Check */}
      <div className="glass-card" style={{ padding: 'var(--td-space-lg)', marginBottom: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Transaction Risk Check</h3>
        <p style={{ fontSize: 13, color: 'var(--td-text-secondary)', marginBottom: 12 }}>
          Run a real-time fraud analysis on any transaction. Enter the listing ID and amount.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input
            className="form-input"
            style={{ flex: 1, minWidth: 180 }}
            placeholder="Listing ID"
            value={form.listingId}
            onChange={(e) => setForm({ ...form, listingId: e.target.value })}
          />
          <input
            className="form-input"
            style={{ width: 140 }}
            type="number"
            min={0}
            placeholder="Amount ($)"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
          <button className="btn btn-primary" onClick={handleCheck} disabled={checking}>
            {checking ? 'Analyzing...' : 'Run Risk Check'}
          </button>
        </div>

        {result && riskColors && (
          <div style={{ marginTop: 16, borderRadius: 12, padding: 16, background: riskColors.bg, border: `1px solid ${riskColors.color}22` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--td-text-tertiary)' }}>Risk Level</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: riskColors.color, textTransform: 'uppercase' }}>
                  {result.riskLevel}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--td-text-tertiary)' }}>Risk Score</div>
                <div style={{ fontSize: 24, fontWeight: 800 }}>{result.riskScore}/100</div>
              </div>
            </div>

            {result.risks && result.risks.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Detected Signals:</div>
                {result.risks.map((risk, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(0,0,0,0.15)', borderRadius: 8, fontSize: 13, marginBottom: 4 }}>
                    <span style={{ textTransform: 'capitalize' }}>{risk.type.replace(/_/g, ' ')}</span>
                    <span style={{ color: risk.severity === 'high' ? 'var(--td-error)' : risk.severity === 'medium' ? '#F59E0B' : 'var(--td-text-secondary)' }}>
                      {risk.severity}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <span className={`badge ${result.recommendations?.decline ? 'badge-primary' : ''}`}>
                {result.recommendations?.decline ? '🚫 Decline' : '✅ Allow'}
              </span>
              <span className={`badge ${result.recommendations?.additionalVerification ? 'badge-primary' : ''}`}>
                {result.recommendations?.additionalVerification ? '🔒 Require Verification' : '⚪ No Extra Verification'}
              </span>
              <span className={`badge ${result.recommendations?.manualReview ? 'badge-primary' : ''}`}>
                {result.recommendations?.manualReview ? '🔍 Manual Review' : '⚪ Auto-approved'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Flag Transaction */}
      <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Flag Suspicious Transaction</h3>
        <p style={{ fontSize: 13, color: 'var(--td-text-secondary)', marginBottom: 12 }}>
          Flag a transaction for manual review by our fraud team.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input
            className="form-input"
            style={{ flex: 1, minWidth: 180 }}
            placeholder="Transaction ID"
            value={flagForm.transactionId}
            onChange={(e) => setFlagForm({ ...flagForm, transactionId: e.target.value })}
          />
          <select
            className="form-input"
            style={{ width: 180 }}
            value={flagForm.reason}
            onChange={(e) => setFlagForm({ ...flagForm, reason: e.target.value })}
          >
            <option value="manual_review">Manual Review</option>
            <option value="suspicious_activity">Suspicious Activity</option>
            <option value="payment_dispute">Payment Dispute</option>
            <option value="identity_verification">Identity Verification</option>
            <option value="item_not_received">Item Not Received</option>
          </select>
        </div>
        <textarea
          className="form-input"
          style={{ marginTop: 12, minHeight: 70 }}
          placeholder="Additional notes (optional)"
          value={flagForm.notes}
          onChange={(e) => setFlagForm({ ...flagForm, notes: e.target.value })}
        />
        <button className="btn btn-outline" style={{ marginTop: 12, color: 'var(--td-error)', borderColor: 'var(--td-error)' }} onClick={handleFlag} disabled={flagging}>
          {flagging ? 'Flagging...' : '🚩 Flag Transaction'}
        </button>

        {flagResult && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'rgba(34,197,94,0.1)', color: 'var(--td-success)', fontSize: 13 }}>
            ✓ Transaction flagged for review. The fraud team has been notified.
          </div>
        )}
      </div>
    </div>
  );
};

export default FraudProtection;