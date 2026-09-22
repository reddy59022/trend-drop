import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getLegalConsentStatus, acceptLegalDocuments } from '../services/api';

const PUBLIC_PATHS = ['/legal', '/login', '/register', '/verify-email', '/forgot-password', '/reset-password', '/unavailable'];

export default function LegalConsentGate() {
  const { user } = useAuth();
  const location = useLocation();
  const [status, setStatus] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user || PUBLIC_PATHS.some((path) => location.pathname.startsWith(path))) {
      setStatus(null);
      return undefined;
    }
    let active = true;
    Promise.resolve(getLegalConsentStatus())
      .then((res) => { if (active && res?.data) setStatus(res.data); })
      .catch(() => { /* API remains authoritative at sensitive actions */ });
    return () => { active = false; };
  }, [user, location.pathname]);

  if (!status?.needsReconsent) return null;
  const versions = status.versions || {};

  const accept = async () => {
    if (!accepted || !ageConfirmed) return;
    setSaving(true);
    try {
      await acceptLegalDocuments({ termsVersion: versions.terms, privacyVersion: versions.privacy, ageConfirmed: true });
      setStatus({ ...status, needsReconsent: false });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="legal-consent-title" style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.72)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div className="glass-card" style={{ maxWidth: 560, padding: 28, background: 'var(--td-surface)' }}>
        <h2 id="legal-consent-title">Review updated legal terms</h2>
        <p>To continue using protected marketplace features, review and accept the current documents for your country.</p>
        <p><Link to="/legal/terms" target="_blank" rel="noreferrer">Terms of Service</Link> · <Link to="/legal/privacy" target="_blank" rel="noreferrer">Privacy Notice</Link></p>
        <label style={{ display: 'block', margin: '16px 0' }}><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> I accept the current Terms of Service and Privacy Notice.</label>
        <label style={{ display: 'block', marginBottom: 18 }}><input type="checkbox" checked={ageConfirmed} onChange={(e) => setAgeConfirmed(e.target.checked)} /> I confirm I meet the applicable minimum age requirement.</label>
        <button className="btn btn-primary btn-block" disabled={!accepted || !ageConfirmed || saving} onClick={accept}>{saving ? 'Saving…' : 'Accept and continue'}</button>
      </div>
    </div>
  );
}
