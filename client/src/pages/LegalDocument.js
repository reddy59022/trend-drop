import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../services/api';

const LegalDocument = () => {
  const { type } = useParams();
  const [document, setDocument] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get(`/legal/documents/${type}`)
      .then((res) => { if (active) setDocument(res.data.document); })
      .catch(() => { if (active) setError('This legal document is unavailable.'); });
    return () => { active = false; };
  }, [type]);

  if (error) return <div className="page-container"><h1>Legal information</h1><p>{error}</p></div>;
  if (!document) return <div className="page-container"><div className="spinner" /></div>;
  const content = document.content || document;
  const sections = Array.isArray(content.sections) ? content.sections : [];

  return (
    <article className="page-container" style={{ maxWidth: 900, margin: '0 auto' }}>
      <p><Link to="/legal">Legal center</Link></p>
      <h1 className="page-title">{document.title || document.type}</h1>
      <p style={{ color: 'var(--td-text-secondary)' }}>{content.summary || 'Localized jurisdiction policy text.'}</p>
      <p style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>Version {document.version}. Language: {document.language || 'en'}. {document.localized === false ? 'No localized translation is available; baseline text is shown.' : ''}</p>
      {sections.map((section, index) => {
        const heading = Array.isArray(section) ? section[0] : section.heading;
        const body = Array.isArray(section) ? section[1] : section.body;
        return (

        <section key={heading} style={{ margin: '28px 0' }}>
          <h2>{heading}</h2>
          <p style={{ lineHeight: 1.7 }}>{body}</p>
        </section>
        );
      })}
      <div className="glass-card" style={{ padding: 16, marginTop: 32 }}>
        <strong>Important</strong>
        <p style={{ marginBottom: 0 }}>This document is a platform baseline and does not remove mandatory rights in your country. Entity details and country supplements must be completed and reviewed before launch in each jurisdiction.</p>
      </div>
    </article>
  );
};

export default LegalDocument;
