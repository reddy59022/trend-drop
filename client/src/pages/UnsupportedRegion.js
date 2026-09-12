import React from 'react';
import { FaGlobeAmericas, FaEnvelopeOpenText } from 'react-icons/fa';

// Enterprise-standard "not available in your area" screen (Feature 1).
// Shown to users whose region is outside the supported markets (USA + Europe).
const UnsupportedRegion = () => (
  <div className="page-container" style={{ maxWidth: 560, margin: '48px auto', textAlign: 'center' }}>
    <div
      style={{
        width: 96,
        height: 96,
        margin: '0 auto 24px',
        borderRadius: '50%',
        background: 'var(--td-glass-bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 44,
        color: 'var(--td-primary)',
      }}
    >
      <FaGlobeAmericas />
    </div>
    <h1 className="page-title" style={{ fontSize: 26, fontWeight: 800, marginBottom: 8 }}>
      TrendDrop isn&apos;t available in your area yet
    </h1>
    <p style={{ color: 'var(--td-text-secondary)', fontSize: 16, lineHeight: 1.6, marginBottom: 16 }}>
      We&apos;re currently supporting the <strong>United States</strong> and{' '}
      <strong>European countries</strong>. We&apos;re working hard to expand — and we&apos;d
      love to bring TrendDrop to you soon.
    </p>
    <div
      className="glass-card"
      style={{
        padding: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        textAlign: 'left',
        background: 'rgba(255,255,255,0.06)',
      }}
    >
      <FaEnvelopeOpenText size={20} style={{ color: 'var(--td-primary)' }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Want to know when we launch near you?</div>
        <div style={{ fontSize: 13, color: 'var(--td-text-tertiary)' }}>
          Our team is launching market-by-market. Check back soon or follow us for updates.
        </div>
      </div>
    </div>
  </div>
);

export default UnsupportedRegion;