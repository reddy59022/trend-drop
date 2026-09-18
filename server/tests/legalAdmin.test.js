const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const JurisdictionPolicyPack = require('../models/JurisdictionPolicyPack');
const LegalPolicyEvent = require('../models/LegalPolicyEvent');
const { getJwtSecret } = require('../config/security');

const country = 'DE';
const tokenFor = (user) => jwt.sign({ id: user._id }, getJwtSecret(), { expiresIn: '1h' });
const docs = ['terms', 'privacy', 'cookies', 'buyer', 'seller', 'prohibited'].map((type) => ({ type, version: 'DE-2026.1', content: { sections: [{ heading: type, body: 'Counsel-approved local text' }] }, translations: [{ language: 'de', content: { sections: [{ heading: type, body: 'Von der Rechtsberatung geprüfter deutscher Text' }] } }] }));

let admin;
let counsel;
let approver;
let regular;
let adminToken;
let counselToken;
let approverToken;
let regularToken;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI);
  [admin, counsel, approver, regular] = await Promise.all([
    User.create({ name: 'Legal Admin', email: `legaladmin_${Date.now()}@example.com`, password: 'StrongPass123!', role: 'admin', emailVerified: true, country: 'US' }),
    User.create({ name: 'Counsel', email: `counsel_${Date.now()}@example.com`, password: 'StrongPass123!', role: 'legal_counsel', emailVerified: true, country: 'US' }),
    User.create({ name: 'Independent Approver', email: `approver_${Date.now()}@example.com`, password: 'StrongPass123!', role: 'legal_counsel', emailVerified: true, country: 'US' }),
    User.create({ name: 'Regular', email: `regular_${Date.now()}@example.com`, password: 'StrongPass123!', role: 'user', emailVerified: true, country: 'US' }),
  ]);
  adminToken = tokenFor(admin); counselToken = tokenFor(counsel); approverToken = tokenFor(approver); regularToken = tokenFor(regular);
});

afterAll(async () => {
  await LegalPolicyEvent.deleteMany({ country });
  await JurisdictionPolicyPack.deleteMany({ country });
  await User.deleteMany({ _id: { $in: [admin._id, counsel._id, approver._id, regular._id] } });
});

describe('jurisdiction policy-pack administration', () => {
  test('readiness audit fails closed and never activates countries automatically', async () => {
    const res = await request(app).get('/api/admin/legal/readiness').set('Authorization', `Bearer ${counselToken}`);
    expect(res.status).toBe(200);
    expect(res.body.activationAllowed).toBe(false);
    expect(res.body.allReady).toBe(false);
    expect(res.body.countries.map((entry) => entry.country)).toContain('DE');
  });

  test('requires legal counsel authorization', async () => {
    const res = await request(app).get('/api/admin/legal/policy-packs').set('Authorization', `Bearer ${regularToken}`);
    expect(res.status).toBe(403);
  });

  test('legal counsel can create, submit, approve, and publish a pack', async () => {
    const base = { country, version: 'DE-2026.1', changeSummary: 'Initial counsel review', mandatoryRightsSummary: 'Local mandatory rights apply.', governingLaw: 'Local law', disputeResolution: 'Local courts and mandatory authorities.', documents: docs };
    const created = await request(app).post('/api/admin/legal/policy-packs').set('Authorization', `Bearer ${counselToken}`).send(base);
    expect(created.status).toBe(201);
    const id = created.body.pack._id;
    expect(created.body.pack.status).toBe('draft');

    expect((await request(app).post(`/api/admin/legal/policy-packs/${id}/publish`).set('Authorization', `Bearer ${counselToken}`)).status).toBe(409);
    expect((await request(app).post(`/api/admin/legal/policy-packs/${id}/submit`).set('Authorization', `Bearer ${counselToken}`)).status).toBe(200);
    const blockedApproval = await request(app).post(`/api/admin/legal/policy-packs/${id}/approve`).set('Authorization', `Bearer ${adminToken}`);
    expect(blockedApproval.status).toBe(409);
    const selfSignoff = await request(app).post(`/api/admin/legal/policy-packs/${id}/signoffs`).set('Authorization', `Bearer ${counselToken}`).send({ language: 'de', attestation: 'Ich habe die deutsche Übersetzung unabhängig geprüft und bestätige ihre Richtigkeit für diese Gerichtsbarkeit.' });
    expect(selfSignoff.status).toBe(409);
    expect(selfSignoff.body.code).toBe('INDEPENDENT_REVIEW_REQUIRED');
    const signoff = await request(app).post(`/api/admin/legal/policy-packs/${id}/signoffs`).set('Authorization', `Bearer ${adminToken}`).send({ language: 'de', attestation: 'Ich habe die deutsche Übersetzung unabhängig geprüft und bestätige ihre Richtigkeit für diese Gerichtsbarkeit.' });
    expect(signoff.status).toBe(200);
    const sameReviewerApproval = await request(app).post(`/api/admin/legal/policy-packs/${id}/approve`).set('Authorization', `Bearer ${adminToken}`);
    expect(sameReviewerApproval.status).toBe(409);
    expect(sameReviewerApproval.body.code).toBe('THREE_PERSON_APPROVAL_REQUIRED');
    expect((await request(app).post(`/api/admin/legal/policy-packs/${id}/approve`).set('Authorization', `Bearer ${approverToken}`)).status).toBe(200);
    const published = await request(app).post(`/api/admin/legal/policy-packs/${id}/publish`).set('Authorization', `Bearer ${counselToken}`);
    expect(published.status).toBe(200);
    expect(published.body.pack.status).toBe('published');

    const publicDocs = await request(app).get(`/api/legal/documents?country=${country}&language=de`);
    expect(publicDocs.status).toBe(200);
    expect(publicDocs.body.countryPolicy.status).toBe('approved');
    expect(publicDocs.body.countryPolicy.version).toBe('DE-2026.1');
    expect(publicDocs.body.documents[0].localized).toBe(true);
    const localizedTerms = await request(app).get(`/api/legal/documents/terms?country=${country}&language=de`);
    expect(localizedTerms.body.document.localized).toBe(true);
    expect((await LegalPolicyEvent.countDocuments({ pack: id }))).toBeGreaterThanOrEqual(4);
  });

  test('publishing a replacement supersedes the current pack and rollback restores prior text', async () => {
    const first = await JurisdictionPolicyPack.findOne({ country, version: 'DE-2026.1' });
    const created = await request(app).post('/api/admin/legal/policy-packs').set('Authorization', `Bearer ${counselToken}`).send({ country, version: 'DE-2026.2', changeSummary: 'Updated local rule', mandatoryRightsSummary: 'Updated rights.', documents: docs.map((doc) => ({ ...doc, version: 'DE-2026.2', content: { sections: [{ heading: doc.type, body: 'Updated counsel text' }] } })) });
    const id = created.body.pack._id;
    await request(app).post(`/api/admin/legal/policy-packs/${id}/submit`).set('Authorization', `Bearer ${counselToken}`);
    await request(app).post(`/api/admin/legal/policy-packs/${id}/signoffs`).set('Authorization', `Bearer ${adminToken}`).send({ language: 'de', attestation: 'Ich habe die deutsche Übersetzung unabhängig geprüft und bestätige ihre Richtigkeit für diese Gerichtsbarkeit.' });
    expect((await request(app).post(`/api/admin/legal/policy-packs/${id}/approve`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(409);
    await request(app).post(`/api/admin/legal/policy-packs/${id}/approve`).set('Authorization', `Bearer ${approverToken}`);
    const published = await request(app).post(`/api/admin/legal/policy-packs/${id}/publish`).set('Authorization', `Bearer ${counselToken}`);
    expect(published.body.superseded._id).toBe(String(first._id));

    const rollback = await request(app).post(`/api/admin/legal/policy-packs/${first._id}/rollback`).set('Authorization', `Bearer ${counselToken}`).send({ version: 'DE-rollback-2026.1', reason: 'Restore approved text' });
    expect(rollback.status).toBe(201);
    expect(rollback.body.pack.rollbackOf).toBe(String(first._id));
    expect((await JurisdictionPolicyPack.findOne({ country, status: 'published' })).version).toBe('DE-rollback-2026.1');
  });
});
