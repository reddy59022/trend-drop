import React from 'react';
import { Link } from 'react-router-dom';

const DOCUMENTS = [
  ['terms', 'Terms of Service'], ['privacy', 'Privacy Notice'], ['cookies', 'Cookie and Tracking Notice'],
  ['buyer', 'Buyer Rules and Returns'], ['seller', 'Seller Rules and Payouts'], ['prohibited', 'Prohibited Items and Conduct'],
];

export default function LegalCenter() {
  return (
    <div className="page-container" style={{ maxWidth: 900, margin: '0 auto' }}>
      <h1 className="page-title">Legal center</h1>
      <p>Review the rules and notices that apply to your use of AURAVEST. Country-specific mandatory rights always prevail where required by law.</p>
      <div className="glass-card" style={{ padding: 24, display: 'grid', gap: 12 }}>
        {DOCUMENTS.map(([type, title]) => <Link key={type} to={`/legal/${type}`} className="btn btn-outline">{title}</Link>)}
      </div>
      <p style={{ marginTop: 24, fontSize: 13, color: 'var(--td-text-tertiary)' }}>Need help or want to exercise a privacy right? Use in-app support or the legal contact shown in the Privacy Notice.</p>
    </div>
  );
}
