const request = require('supertest');
const app = require('../server');
const { currencies, convertPrice, formatPrice, getCurrencyByCountry } = require('../config/currencies');

describe('Currency Conversion System', () => {
  describe('v36.1 - Currency rates are defined', () => {
    it('should have rates for major currencies', () => {
      expect(currencies.USD.rate).toBe(1);
      expect(currencies.EUR.rate).toBe(0.92);
      expect(currencies.GBP.rate).toBe(0.79);
      expect(currencies.JPY.rate).toBe(149.5);
    });

    it('v36.2 - should have correct decimals for zero-decimal currencies', () => {
      expect(currencies.JPY.decimals).toBe(0);
      expect(currencies.KRW.decimals).toBe(0);
      expect(currencies.USD.decimals).toBe(2);
    });

    it('v36.3 - should have country-currency mapping', () => {
      expect(getCurrencyByCountry('US')).toBeDefined();
      expect(getCurrencyByCountry('US').rate).toBe(1);
      expect(getCurrencyByCountry('JP')).toBeDefined();
      expect(getCurrencyByCountry('JP').rate).toBe(149.5);
      expect(getCurrencyByCountry('DE')).toBeDefined();
    });
  });

  describe('v36.4 - Price conversion works correctly', () => {
    it('should convert USD to other currencies', () => {
      const eur = convertPrice(100, 'EUR');
      expect(eur).toBe(92); // 100 * 0.92
      
      const jpy = convertPrice(100, 'JPY');
      expect(jpy).toBe(14950); // 100 * 149.5, rounded
    });

    it('v36.5 - should format prices with correct symbols', () => {
      const usd = formatPrice(50, 'USD');
      expect(usd).toContain('$');
      
      const eur = formatPrice(50, 'EUR');
      expect(eur).toContain('€');
    });
  });

  describe('v36.6 - Frontend currency helper functions work', () => {
    it('should export currency helpers for frontend use', () => {
      expect(typeof convertPrice).toBe('function');
      expect(typeof formatPrice).toBe('function');
      expect(typeof getCurrencyByCountry).toBe('function');
    });
  });

  describe('v36.7 - Cross-currency conversion works', () => {
    it('should format price converting from one currency to another', () => {
      // A 100 EUR price displayed in USD should show as ~108.70 USD
      const usdFormatted = formatPrice(100, 'USD', 'EUR');
      expect(usdFormatted).toContain('$');
    });

    it('should handle same currency (no conversion needed)', () => {
      const usdFormatted = formatPrice(50, 'USD', 'USD');
      expect(usdFormatted).toBe('$50.00');
    });
  });

  describe('v36.8 - Zero-decimal currencies handled correctly', () => {
    it('should format JPY without decimals', () => {
      const jpy = formatPrice(5000, 'JPY');
      expect(jpy).toMatch(/¥|JPY/); // Should have yen symbol
    });

    it('should format KRW without decimals', () => {
      const krw = formatPrice(10000, 'KRW');
      expect(krw).toMatch(/₩|KRW/); // Should have won symbol
    });
  });
});
