export const CONTACT_EMAIL = 'connect.trenddrop@gmail.com';

export const contactMailto = (subject = '') => {
  const query = subject ? `?subject=${encodeURIComponent(subject)}` : '';
  return `mailto:${CONTACT_EMAIL}${query}`;
};
