/**
 * Multi-Language Support (i18n) Tests
 * Tests translation engine and language support
 */
const {
  translate,
  getSupportedLanguages,
  getLanguage,
  getDefaultLanguage,
  translations,
} = require('../config/i18n');

describe('Multi-Language Support (i18n)', () => {
  describe('Translation Engine', () => {
    test('I18N.1 English translation - common keys', () => {
      expect(translate('en', 'common.search')).toBe('Search');
      expect(translate('en', 'common.cart')).toBe('Cart');
      expect(translate('en', 'common.login')).toBe('Login');
      expect(translate('en', 'common.save')).toBe('Save');
    });

    test('I18N.2 Spanish translation - common keys', () => {
      expect(translate('es', 'common.search')).toBe('Buscar');
      expect(translate('es', 'common.cart')).toBe('Carrito');
      expect(translate('es', 'common.login')).toBe('Iniciar Sesión');
    });

    test('I18N.3 French translation - common keys', () => {
      expect(translate('fr', 'common.search')).toBe('Rechercher');
      expect(translate('fr', 'common.cart')).toBe('Panier');
      expect(translate('fr', 'common.login')).toBe('Connexion');
    });

    test('I18N.4 German translation - common keys', () => {
      expect(translate('de', 'common.search')).toBe('Suche');
      expect(translate('de', 'common.cart')).toBe('Warenkorb');
      expect(translate('de', 'common.login')).toBe('Anmelden');
    });

    test('I18N.5 Japanese translation - common keys', () => {
      expect(translate('ja', 'common.search')).toBe('検索');
      expect(translate('ja', 'common.cart')).toBe('カート');
      expect(translate('ja', 'common.login')).toBe('ログイン');
    });
  });

  describe('Nested Keys', () => {
    test('I18N.6 Deep nested translation - nav.feed', () => {
      expect(translate('en', 'nav.feed')).toBe('Feed');
      expect(translate('es', 'nav.feed')).toBe('Feed');
      expect(translate('fr', 'nav.feed')).toBe('Fil');
      expect(translate('de', 'nav.feed')).toBe('Feed');
      expect(translate('ja', 'nav.feed')).toBe('フィード');
    });

    test('I18N.7 Listing category translations', () => {
      expect(translate('en', 'listing.title')).toBe('Title');
      expect(translate('es', 'listing.title')).toBe('Título');
      expect(translate('fr', 'listing.title')).toBe('Titre');
      expect(translate('de', 'listing.title')).toBe('Titel');
      expect(translate('ja', 'listing.title')).toBe('タイトル');
    });

    test('I18N.8 Order status translations', () => {
      expect(translate('en', 'order.shipped')).toBe('Shipped');
      expect(translate('es', 'order.shipped')).toBe('Enviado');
      expect(translate('fr', 'order.shipped')).toBe('Expédié');
      expect(translate('de', 'order.shipped')).toBe('Versendet');
      expect(translate('ja', 'order.shipped')).toBe('発送済み');
    });

    test('I18N.9 Payment translations', () => {
      expect(translate('en', 'payment.paymentSuccessful')).toBe('Payment Successful');
      expect(translate('es', 'payment.paymentSuccessful')).toBe('Pago Exitoso');
      expect(translate('fr', 'payment.paymentSuccessful')).toBe('Paiement Réussi');
      expect(translate('de', 'payment.paymentSuccessful')).toBe('Zahlung Erfolgreich');
    });

    test('I18N.10 Error message translations', () => {
      expect(translate('en', 'errors.invalidEmail')).toBe('Invalid email address');
      expect(translate('es', 'errors.invalidEmail')).toBe('Dirección de correo inválida');
      expect(translate('fr', 'errors.invalidEmail')).toBe('Adresse e-mail invalide');
      expect(translate('de', 'errors.invalidEmail')).toBe('Ungültige E-Mail-Adresse');
    });
  });

  describe('Fallback Mechanism', () => {
    test('I18N.11 Missing key falls back to English', () => {
      expect(translate('es', 'nonexistent.key')).toBe('nonexistent.key');
    });

    test('I18N.12 Missing key with fallback text', () => {
      expect(translate('es', 'nonexistent.key', 'Default Text')).toBe('Default Text');
    });

    test('I18N.13 Partial key fallback - missing nested key', () => {
      expect(translate('en', 'nonexistent.key')).toBe('nonexistent.key');
    });

    test('I18N.14 Unknown language falls back to English', () => {
      expect(translate('xx', 'common.search')).toBe('Search');
      expect(translate('zz', 'common.cart')).toBe('Cart');
    });

    test('I18N.15 Empty language code falls back to English', () => {
      expect(translate('', 'common.search')).toBe('Search');
    });
  });

  describe('Supported Languages', () => {
    test('I18N.16 Get all supported languages', () => {
      const languages = getSupportedLanguages();
      expect(languages).toHaveLength(5);
      expect(languages.map(l => l.code)).toContain('en');
      expect(languages.map(l => l.code)).toContain('es');
      expect(languages.map(l => l.code)).toContain('fr');
      expect(languages.map(l => l.code)).toContain('de');
      expect(languages.map(l => l.code)).toContain('ja');
    });

    test('I18N.17 English is default language', () => {
      const defaultLang = getDefaultLanguage();
      expect(defaultLang.code).toBe('en');
      expect(defaultLang.default).toBe(true);
    });

    test('I18N.18 Get language by code', () => {
      const es = getLanguage('es');
      expect(es.code).toBe('es');
      expect(es.name).toBe('Español');
      expect(es.flag).toBe('🇪🇸');

      const ja = getLanguage('ja');
      expect(ja.code).toBe('ja');
      expect(ja.name).toBe('日本語');
      expect(ja.flag).toBe('🇯🇵');
    });

    test('I18N.19 Get non-existent language returns undefined', () => {
      const lang = getLanguage('xx');
      expect(lang).toBeUndefined();
    });

    test('I18N.20 All supported languages have required fields', () => {
      const languages = getSupportedLanguages();
      languages.forEach(lang => {
        expect(lang.code).toBeDefined();
        expect(lang.name).toBeDefined();
        expect(lang.flag).toBeDefined();
        expect(lang.default).toBeDefined();
      });
    });
  });

  describe('Translation Completeness', () => {
    test('I18N.21 All languages have common keys', () => {
      const commonKeys = Object.keys(translations.en.common);
      Object.keys(translations).forEach(lang => {
        const langKeys = Object.keys(translations[lang].common);
        expect(langKeys).toEqual(expect.arrayContaining(commonKeys));
      });
    });

    test('I18N.22 All languages have nav keys', () => {
      const navKeys = Object.keys(translations.en.nav);
      Object.keys(translations).forEach(lang => {
        const langKeys = Object.keys(translations[lang].nav);
        expect(langKeys).toEqual(expect.arrayContaining(navKeys));
      });
    });

    test('I18N.23 All languages have listing keys', () => {
      const listingKeys = Object.keys(translations.en.listing);
      Object.keys(translations).forEach(lang => {
        const langKeys = Object.keys(translations[lang].listing);
        expect(langKeys).toEqual(expect.arrayContaining(listingKeys));
      });
    });

    test('I18N.24 All languages have order keys', () => {
      const orderKeys = Object.keys(translations.en.order);
      Object.keys(translations).forEach(lang => {
        const langKeys = Object.keys(translations[lang].order);
        expect(langKeys).toEqual(expect.arrayContaining(orderKeys));
      });
    });

    test('I18N.25 All languages have error keys', () => {
      const errorKeys = Object.keys(translations.en.errors);
      Object.keys(translations).forEach(lang => {
        const langKeys = Object.keys(translations[lang].errors);
        expect(langKeys).toEqual(expect.arrayContaining(errorKeys));
      });
    });
  });

  describe('Edge Cases', () => {
    test('I18N.26 Empty key returns empty or key', () => {
      expect(translate('en', '')).toBe('');
    });

    test('I18N.27 Null/undefined fallback returns key', () => {
      expect(translate('en', 'missing.key', null)).toBe('missing.key');
      expect(translate('en', 'missing.key', undefined)).toBe('missing.key');
    });

    test('I18N.28 Special characters in translations preserved', () => {
      expect(translate('fr', 'payment.expiryDate')).toContain("Date d'Expiration");
    });

    test('I18N.29 Unicode characters handled correctly', () => {
      expect(translate('ja', 'common.search')).toBe('検索');
      expect(translate('ja', 'common.home')).toBe('ホーム');
    });

    test('I18N.30 Case sensitivity - language codes fallback to English', () => {
      // Uppercase codes not in dictionary, fallback to English
      expect(translate('EN', 'common.search')).toBe('Search');
      expect(translate('ES', 'common.search')).toBe('Search');
    });
  });

  describe('Real-World Usage Scenarios', () => {
    test('I18N.31 Complete checkout flow translations', () => {
      const en = {
        addToCart: translate('en', 'listing.addToCart'),
        buyNow: translate('en', 'listing.buyNow'),
        paymentSuccessful: translate('en', 'payment.paymentSuccessful'),
        orderPlaced: translate('en', 'success.orderPlaced'),
        shipped: translate('en', 'order.shipped'),
      };

      const es = {
        addToCart: translate('es', 'listing.addToCart'),
        buyNow: translate('es', 'listing.buyNow'),
        paymentSuccessful: translate('es', 'payment.paymentSuccessful'),
        orderPlaced: translate('es', 'success.orderPlaced'),
        shipped: translate('es', 'order.shipped'),
      };

      expect(en.addToCart).toBe('Add to Cart');
      expect(es.addToCart).toBe('Añadir al Carrito');
      expect(en.paymentSuccessful).toBe('Payment Successful');
      expect(es.paymentSuccessful).toBe('Pago Exitoso');
    });

    test('I18N.32 Seller dashboard translations', () => {
      expect(translate('de', 'listing.draft')).toBe('Entwurf');
      expect(translate('de', 'listing.active')).toBe('Aktiv');
      expect(translate('de', 'listing.sold')).toBe('Verkauft');
      expect(translate('de', 'listing.boost')).toBe('Boost');
    });

    test('I18N.33 Message system translations', () => {
      expect(translate('ja', 'messages.sendMessage')).toBe('メッセージを送信');
      expect(translate('ja', 'messages.online')).toBe('オンライン');
      expect(translate('ja', 'messages.offline')).toBe('オフライン');
    });

    test('I18N.34 Auth system translations', () => {
      expect(translate('fr', 'auth.signIn')).toBe('Se Connecter');
      expect(translate('fr', 'auth.signUp')).toBe('S\'inscrire');
      expect(translate('fr', 'auth.emailVerification')).toBe('Vérification E-mail');
    });

    test('I18N.35 Shipping translations', () => {
      expect(translate('de', 'shipping.trackingNumber')).toBe('Sendungsnummer');
      expect(translate('de', 'shipping.freeShipping')).toBe('Kostenloser Versand');
      expect(translate('de', 'shipping.track')).toBe('Verfolgen');
    });
  });

  describe('Performance', () => {
    test('I18N.36 Translation lookup is fast', () => {
      const start = Date.now();
      for (let i = 0; i < 10000; i++) {
        translate('en', 'common.search');
        translate('es', 'listing.title');
        translate('ja', 'order.shipped');
      }
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000); // Should complete in < 1 second
    });

    test('I18N.37 Multiple language switches work correctly', () => {
      const languages = ['en', 'es', 'fr', 'de', 'ja'];
      languages.forEach(lang => {
        const result = translate(lang, 'common.search');
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
      });
    });
  });
});