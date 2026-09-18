import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import {
  listLegalPolicyPacks, createLegalPolicyPack, submitLegalPolicyPack,
  approveLegalPolicyPack, rejectLegalPolicyPack, publishLegalPolicyPack,
  rollbackLegalPolicyPack, bootstrapLegalPolicyTargets, listLegalPolicyTargets,
  updateLegalPolicyTranslations, signOffLegalPolicyLanguage, getLegalPolicyReadiness,
} from '../services/api';

const EMPTY_DOCS = JSON.stringify([
  { type: 'terms', version: 'country-v1', content: { sections: [] } },
  { type: 'privacy', version: 'country-v1', content: { sections: [] } },
  { type: 'cookies', version: 'country-v1', content: { sections: [] } },
  { type: 'buyer', version: 'country-v1', content: { sections: [] } },
  { type: 'seller', version: 'country-v1', content: { sections: [] } },
  { type: 'prohibited', version: 'country-v1', content: { sections: [] } },
], null, 2);

export default function LegalAdmin() {
  const [packs, setPacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ country: '', version: '', changeSummary: '', mandatoryRightsSummary: '', governingLaw: '', disputeResolution: '', documents: EMPTY_DOCS });
  const [targets, setTargets] = useState([]);
  const [readiness, setReadiness] = useState(null);
  const [attestation, setAttestation] = useState('I confirm that I reviewed this language translation and its mandatory legal requirements for this jurisdiction.');
  const [editingPack, setEditingPack] = useState(null);
  const [translationJson, setTranslationJson] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [packsRes, targetsRes, readinessRes] = await Promise.all([listLegalPolicyPacks(), listLegalPolicyTargets(), getLegalPolicyReadiness()]);
      setPacks(packsRes.data.packs || []);
      setTargets(targetsRes.data.targets || []);
      setReadiness(readinessRes.data);
    } catch (error) { toast.error(error.response?.data?.message || 'Could not load policy packs'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const action = async (fn, ...args) => {
    try { await fn(...args); toast.success('Policy pack updated'); load(); }
    catch (error) { toast.error(error.response?.data?.message || 'Policy action failed'); }
  };

  const create = async (event) => {
    event.preventDefault();
    let documents;
    try { documents = JSON.parse(form.documents); } catch (error) { toast.error('Documents must be valid JSON'); return; }
    await action(createLegalPolicyPack, { ...form, documents });
  };

  return (
    <div className="page-container" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <h1 className="page-title">Jurisdiction policy administration</h1>
      <p>Draft, review, approve, publish, supersede, and roll back country policy packs. Every lifecycle action is recorded in an immutable audit stream.</p>
      <div className="glass-card" style={{ padding: 16, marginBottom: 20 }}>
        <strong>Initial rollout boundary</strong>
        <p style={{ margin: '6px 0 12px', fontSize: 13 }}>USA, all configured European countries, Australia, Canada, India, and Japan. Germany is included in Europe. Publishing still requires country-specific counsel review.</p>
        <button type="button" className="btn btn-outline" onClick={async () => { try { await bootstrapLegalPolicyTargets('baseline-2026.1'); toast.success('Draft packs created for rollout targets'); load(); } catch (error) { toast.error(error.response?.data?.message || 'Could not bootstrap target drafts'); } }}>Create baseline drafts for all rollout countries</button>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--td-text-tertiary)' }}>{targets.filter((target) => target.current?.status === 'published').length} published / {targets.length} target countries</div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--td-warning)' }}>Independent review required: the translation author cannot sign off or approve. High-risk rollout jurisdictions also require a separate third approval authority who did not sign off the language.</div>
        {readiness && <div style={{ marginTop: 8, fontSize: 12, color: readiness.allReady ? 'var(--td-success)' : 'var(--td-error)' }}>Structural readiness: {readiness.allReady ? 'all target packs ready' : 'not ready'} — entity configuration: {readiness.entityReady ? 'complete' : 'incomplete'}. Activation remains human-controlled.</div>}
      </div>

      <form className="glass-card" onSubmit={create} style={{ padding: 20, display: 'grid', gap: 10, marginBottom: 24 }}>
        <h2>Create draft policy pack</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
          <input className="form-input" placeholder="Country ISO (US)" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
          <input className="form-input" placeholder="Version (US-2026.1)" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
          <input className="form-input" placeholder="Governing law" value={form.governingLaw} onChange={(e) => setForm({ ...form, governingLaw: e.target.value })} />
        </div>
        <input className="form-input" placeholder="Change summary" value={form.changeSummary} onChange={(e) => setForm({ ...form, changeSummary: e.target.value })} />
        <textarea className="form-input" placeholder="Mandatory rights summary" value={form.mandatoryRightsSummary} onChange={(e) => setForm({ ...form, mandatoryRightsSummary: e.target.value })} rows={2} />
        <input className="form-input" placeholder="Dispute resolution / local procedure" value={form.disputeResolution} onChange={(e) => setForm({ ...form, disputeResolution: e.target.value })} />
        <textarea className="form-input" value={form.documents} onChange={(e) => setForm({ ...form, documents: e.target.value })} rows={8} aria-label="Policy documents JSON" />
        <button className="btn btn-primary" type="submit">Create draft</button>
      </form>

      {editingPack && (
        <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
          <h2>Edit localized translations: {editingPack.country} / {editingPack.version}</h2>
          <p style={{ fontSize: 13 }}>Provide one translation entry per required language for every document. Saving is allowed only while the pack is draft or rejected.</p>
          <textarea className="form-input" value={translationJson} onChange={(e) => setTranslationJson(e.target.value)} rows={12} aria-label="Localized translations JSON" />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary" onClick={async () => { try { const docs = JSON.parse(translationJson); await updateLegalPolicyTranslations(editingPack._id, docs); toast.success('Translations saved'); setEditingPack(null); load(); } catch (error) { toast.error(error.response?.data?.message || 'Translations must be valid JSON'); } }}>Save translations</button>
            <button className="btn btn-outline" onClick={() => setEditingPack(null)}>Close</button>
          </div>
        </div>
      )}

      <div className="glass-card" style={{ padding: 16, marginBottom: 20 }}>
        <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Counsel attestation used for language sign-offs</label>
        <textarea className="form-input" value={attestation} onChange={(e) => setAttestation(e.target.value)} rows={3} />
      </div>

      <div className="glass-card" style={{ overflowX: 'auto' }}>
        <h2 style={{ padding: 20, margin: 0 }}>Policy-pack history</h2>
        {loading ? <div className="skeleton" style={{ height: 160, margin: 20 }} /> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr><th style={{ padding: 10, textAlign: 'left' }}>Country</th><th style={{ padding: 10, textAlign: 'left' }}>Version</th><th style={{ padding: 10, textAlign: 'left' }}>Status</th><th style={{ padding: 10, textAlign: 'left' }}>Actions</th></tr></thead>
            <tbody>{packs.map((pack) => (
              <tr key={pack._id} style={{ borderTop: '1px solid var(--td-border-light)' }}>
                <td style={{ padding: 10 }}>{pack.country}</td><td style={{ padding: 10 }}>{pack.version}</td><td style={{ padding: 10 }}><span className="badge badge-info">{pack.status}</span><div style={{ fontSize: 11, marginTop: 4 }}>{(pack.requiredLanguages || []).map((language) => <span key={language} style={{ marginRight: 4 }}>{language}{(pack.signoffs || []).some((signoff) => signoff.language === language) ? ' ✓' : ' ·'}</span>)}</div></td>
                <td style={{ padding: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(pack.status === 'draft' || pack.status === 'rejected') && <button className="btn btn-sm btn-outline" onClick={() => { setEditingPack(pack); setTranslationJson(JSON.stringify(pack.documents || [], null, 2)); }}>Edit translations</button>}
                  {pack.status === 'draft' && <button className="btn btn-sm btn-outline" onClick={() => action(submitLegalPolicyPack, pack._id)}>Submit review</button>}
                  {pack.status === 'submitted' && <>{(pack.requiredLanguages || []).filter((language) => !(pack.signoffs || []).some((signoff) => signoff.language === language)).map((language) => <button key={language} className="btn btn-sm btn-outline" onClick={() => action(signOffLegalPolicyLanguage, pack._id, language, attestation)}>Sign off {language}</button>)}<button className="btn btn-sm btn-outline" onClick={() => action(approveLegalPolicyPack, pack._id)}>Approve</button><button className="btn btn-sm btn-outline" onClick={() => action(rejectLegalPolicyPack, pack._id, 'Requires legal revision')}>Reject</button></>}
                  {pack.status === 'approved' && <button className="btn btn-sm btn-primary" onClick={() => action(publishLegalPolicyPack, pack._id)}>Publish</button>}
                  {pack.status === 'superseded' && <button className="btn btn-sm btn-outline" onClick={() => action(rollbackLegalPolicyPack, pack._id, { reason: 'Counsel rollback', version: `rollback-${pack.version}-${Date.now()}` })}>Rollback</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
