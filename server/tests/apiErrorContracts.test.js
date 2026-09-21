const request = require('supertest');
const app = require('../server');

/**
 * HTTP contract tests for the two API-boundary behaviours a production-mode
 * smoke run of `server/server.js` got wrong:
 *
 *   1. An unmatched `/api/*` request used to fall through to the SPA catch-all
 *      and answer `200 text/html` (index.html). API clients parse JSON, so a
 *      typo'd or removed endpoint looked like a successful response with an
 *      unparseable body. It must be a JSON 404.
 *   2. A malformed/oversized request body used to surface as a 500. body-parser
 *      already marks those as client errors (400/413); a 500 there pollutes
 *      server-error monitoring with client mistakes.
 *
 * The repo-wide convention these tests enforce: client errors are 4xx with a
 * JSON body, never a 500 and never the SPA shell.
 */
describe('API boundary error contracts', () => {
  describe('unmatched /api/* requests', () => {
    it('answers an unknown GET path with a JSON 404, not the SPA shell', async () => {
      const res = await request(app).get('/api/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.type).toMatch(/json/);
      expect(res.body).toEqual({ message: 'Not found' });
      expect(res.text).not.toContain('<!doctype html');
    });

    it('answers an unknown POST path with a JSON 404', async () => {
      const res = await request(app).post('/api/does-not-exist').send({ a: 1 });
      expect(res.status).toBe(404);
      expect(res.type).toMatch(/json/);
      expect(res.body).toEqual({ message: 'Not found' });
    });

    it('answers an unknown nested path with a JSON 404', async () => {
      // Deliberately not `/api/listings/<x>`: a non-ObjectId in an ID position
      // is a 400 by design (see utils/validators.assertObjectId).
      const res = await request(app).get('/api/no-such-resource/deep/path');
      expect(res.status).toBe(404);
      expect(res.type).toMatch(/json/);
      expect(res.body.message).toBe('Not found');
    });

    it('keeps malformed IDs in an ID position a 400, not a 404', async () => {
      const res = await request(app).get('/api/listings/not-an-object-id');
      expect(res.status).toBe(400);
      expect(res.type).toMatch(/json/);
    });

    it('still serves mounted API routes normally', async () => {
      const res = await request(app).get('/api/legal/documents');
      expect(res.status).toBe(200);
      expect(res.type).toMatch(/json/);
    });
  });

  describe('body-parser failures are client errors', () => {
    it('rejects malformed JSON with 400 (never 500)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email":');
      expect(res.status).toBe(400);
      expect(res.type).toMatch(/json/);
      expect(res.body.message).toBe('Invalid request body');
    });

    it('rejects an oversized JSON body with 413 (never 500)', async () => {
      const huge = `{"email":"${'a'.repeat(3 * 1024 * 1024)}"}`;
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send(huge);
      expect(res.status).toBe(413);
      expect(res.type).toMatch(/json/);
      expect(res.body.message).toBe('Invalid request body');
    });

    it('does not echo the request body back to the caller', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email":"leaky@example.test","password":');
      expect(res.status).toBe(400);
      expect(res.text).not.toContain('leaky@example.test');
    });

    it('leaves well-formed requests to their handlers', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.test', password: 'wrong-password' });
      expect(res.status).not.toBe(500);
      expect(res.type).toMatch(/json/);
    });
  });
});
