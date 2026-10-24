// Dependency hygiene: pins the removal of deprecated/vulnerable chains.
//
// @sendinblue/client → request@2.88.2 carried CRITICAL advisories (request
// SSRF, form-data boundary/CRLF) and moderate ones (qs, tough-cookie, uuid@3).
// multer-storage-cloudinary pinned cloudinary 1.x (HIGH: argument injection)
// while doing no useful work — its adapter was dead code.
const pkg = require('../package.json');

describe('dependency hygiene', () => {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  it('DH.1 no @sendinblue/client (deprecated request@2 critical chain)', () => {
    expect(deps['@sendinblue/client']).toBeUndefined();
  });

  it('DH.2 no request dependency anywhere in manifests', () => {
    expect(deps.request).toBeUndefined();
  });

  it('DH.3 no multer-storage-cloudinary (pinned vulnerable cloudinary 1.x)', () => {
    expect(deps['multer-storage-cloudinary']).toBeUndefined();
  });

  it('DH.4 cloudinary is on the fixed major (>= 2.7.0)', () => {
    expect(deps.cloudinary).toBeDefined();
    expect(deps.cloudinary).toMatch(/^[\^~]?2\./);
  });
});
