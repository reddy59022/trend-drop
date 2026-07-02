/**
 * Tax Calculation Tests
 * Comprehensive tests for VAT/GST/Sales Tax across 100+ countries
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const { calculateTax, getTaxRate, checkTaxThreshold, validateTaxNumber, taxRules } = require('../config/tax');
const { getCountry } = require('../config/countries');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let sellerToken, sellerId;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }

  const seller = await User.create({
    name: 'Tax Seller',
    email: `tax_seller_${Date.now()}@test.com`,
    password: 'password123',
    country: 'US',
    currency: 'USD',
    emailVerified: true,
    authProvider: 'email',
    shippingAddress: { fullName: 'Seller', street1: '123 St', city: 'City', state: 'CA', postalCode: '90210', country: 'US' },
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  sellerToken = jwt.sign({ id: seller._id }, JWT_SECRET, { expiresIn: '30d' });
  sellerId = seller._id;
});

afterAll(async () => {
  await User.deleteMany({ email: /tax_seller_/ });
  await mongoose.connection.close();
});

describe('Tax Calculation Engine', () => {
  describe('US Sales Tax', () => {
    test('TX.1 California sales tax rate', () => {
      const result = getTaxRate('US', 'CA', 100, 'standard');
      expect(result.rate).toBeCloseTo(0.0725, 4);
      expect(result.type).toBe('sales_tax');
      expect(result.name).toBe('Sales Tax - California');
    });

    test('TX.2 New York sales tax rate', () => {
      const result = getTaxRate('US', 'NY', 100);
      expect(result.rate).toBeCloseTo(0.04, 4);
      expect(result.name).toBe('Sales Tax - New York');
    });

    test('TX.3 Texas sales tax rate', () => {
      const result = getTaxRate('US', 'TX', 100);
      expect(result.rate).toBeCloseTo(0.0625, 4);
    });

    test('TX.4 No state tax (Delaware, Oregon, Montana)', () => {
      expect(getTaxRate('US', 'DE').rate).toBe(0);
      expect(getTaxRate('US', 'OR').rate).toBe(0);
      expect(getTaxRate('US', 'MT').rate).toBe(0);
    });

    test('TX.5 Calculate tax amount for US', () => {
      const result = calculateTax('US', 'CA', 100, 10);
      expect(result.taxRate).toBeCloseTo(0.0725, 4);
      expect(result.taxAmount).toBeCloseTo(7.95, 1); // (100+10)*0.0725
      expect(result.taxType).toBe('sales_tax');
    });
  });

  describe('Canada GST/HST/PST', () => {
    test('TX.6 Ontario HST (13%)', () => {
      const result = getTaxRate('CA', 'ON');
      expect(result.rate).toBeCloseTo(0.13, 4);
      expect(result.name).toBe('HST - Ontario');
    });

    test('TX.7 Quebec QST (9.975%)', () => {
      const result = getTaxRate('CA', 'QC');
      expect(result.rate).toBeCloseTo(0.09975, 5);
      expect(result.name).toBe('QST - Quebec');
    });

    test('TX.8 Alberta GST (5%)', () => {
      const result = getTaxRate('CA', 'AB');
      expect(result.rate).toBeCloseTo(0.05, 4);
    });

    test('TX.9 BC PST (7%)', () => {
      const result = getTaxRate('CA', 'BC');
      expect(result.rate).toBeCloseTo(0.07, 4);
      expect(result.name).toBe('PST - British Columbia');
    });

    test('TX.10 Calculate Canadian tax', () => {
      const result = calculateTax('CA', 'ON', 100, 10);
      expect(result.taxAmount).toBeCloseTo(14.30, 1); // (100+10)*0.13
    });
  });

  describe('European VAT', () => {
    test('TX.11 Germany VAT (19%)', () => {
      const result = getTaxRate('DE');
      expect(result.rate).toBeCloseTo(0.19, 4);
      expect(result.type).toBe('vat');
    });

    test('TX.12 France VAT (20%)', () => {
      const result = getTaxRate('FR');
      expect(result.rate).toBeCloseTo(0.20, 4);
    });

    test('TX.13 UK VAT (20%)', () => {
      const result = getTaxRate('GB');
      expect(result.rate).toBeCloseTo(0.20, 4);
      expect(result.type).toBe('vat');
    });

    test('TX.14 Italy VAT (22%)', () => {
      const result = getTaxRate('IT');
      expect(result.rate).toBeCloseTo(0.22, 4);
    });

    test('TX.15 Netherlands VAT (21%)', () => {
      const result = getTaxRate('NL');
      expect(result.rate).toBeCloseTo(0.21, 4);
    });

    test('TX.16 Sweden VAT (25%)', () => {
      const result = getTaxRate('SE');
      expect(result.rate).toBeCloseTo(0.25, 4);
    });

    test('TX.17 Luxembourg VAT (17%)', () => {
      const result = getTaxRate('LU');
      expect(result.rate).toBeCloseTo(0.17, 4);
    });

    test('TX.18 Hungary VAT (27%)', () => {
      const result = getTaxRate('HU');
      expect(result.rate).toBeCloseTo(0.27, 4);
    });

    test('TX.19 Calculate EU VAT', () => {
      const result = calculateTax('DE', null, 100, 10);
      expect(result.taxAmount).toBeCloseTo(20.90, 1); // (100+10)*0.19
    });
  });

  describe('Asia-Pacific Taxes', () => {
    test('TX.20 Japan Consumption Tax (10%)', () => {
      const result = getTaxRate('JP');
      expect(result.rate).toBeCloseTo(0.10, 4);
      expect(result.type).toBe('consumption_tax');
    });

    test('TX.21 China VAT (13%)', () => {
      const result = getTaxRate('CN');
      expect(result.rate).toBeCloseTo(0.13, 4);
    });

    test('TX.22 South Korea VAT (10%)', () => {
      const result = getTaxRate('KR');
      expect(result.rate).toBeCloseTo(0.10, 4);
    });

    test('TX.23 India GST (18%)', () => {
      const result = getTaxRate('IN', 'MH');
      expect(result.rate).toBeCloseTo(0.18, 4);
      expect(result.type).toBe('gst');
    });

    test('TX.24 Singapore GST (8%)', () => {
      const result = getTaxRate('SG');
      expect(result.rate).toBeCloseTo(0.08, 4);
      expect(result.type).toBe('gst');
    });

    test('TX.25 Australia GST (10%)', () => {
      const result = getTaxRate('AU', 'NSW');
      expect(result.rate).toBeCloseTo(0.10, 4);
    });

    test('TX.26 New Zealand GST (15%)', () => {
      const result = getTaxRate('NZ');
      expect(result.rate).toBeCloseTo(0.15, 4);
    });

    test('TX.27 Hong Kong - No tax', () => {
      const result = getTaxRate('HK');
      expect(result.rate).toBe(0);
      expect(result.type).toBe('none');
    });
  });

  describe('Middle East Taxes', () => {
    test('TX.28 UAE VAT (5%)', () => {
      const result = getTaxRate('AE');
      expect(result.rate).toBeCloseTo(0.05, 4);
    });

    test('TX.29 Saudi Arabia VAT (15%)', () => {
      const result = getTaxRate('SA');
      expect(result.rate).toBeCloseTo(0.15, 4);
    });

    test('TX.30 Israel VAT (17%)', () => {
      const result = getTaxRate('IL');
      expect(result.rate).toBeCloseTo(0.17, 4);
    });

    test('TX.31 Qatar - No VAT', () => {
      const result = getTaxRate('QA');
      expect(result.rate).toBe(0);
      expect(result.type).toBe('none');
    });
  });

  describe('Americas (non-US)', () => {
    test('TX.32 Mexico IVA (16%)', () => {
      const result = getTaxRate('MX');
      expect(result.rate).toBeCloseTo(0.16, 4);
    });

    test('TX.33 Brazil VAT (17%)', () => {
      const result = getTaxRate('BR');
      expect(result.rate).toBeCloseTo(0.17, 4);
    });

    test('TX.34 Argentina IVA (21%)', () => {
      const result = getTaxRate('AR');
      expect(result.rate).toBeCloseTo(0.21, 4);
    });

    test('TX.35 Chile IVA (19%)', () => {
      const result = getTaxRate('CL');
      expect(result.rate).toBeCloseTo(0.19, 4);
    });

    test('TX.36 Colombia IVA (19%)', () => {
      const result = getTaxRate('CO');
      expect(result.rate).toBeCloseTo(0.19, 4);
    });
  });

  describe('Africa', () => {
    test('TX.37 South Africa VAT (15%)', () => {
      const result = getTaxRate('ZA');
      expect(result.rate).toBeCloseTo(0.15, 4);
    });

    test('TX.38 Nigeria VAT (7.5%)', () => {
      const result = getTaxRate('NG');
      expect(result.rate).toBeCloseTo(0.075, 4);
    });

    test('TX.39 Kenya VAT (16%)', () => {
      const result = getTaxRate('KE');
      expect(result.rate).toBeCloseTo(0.16, 4);
    });
  });

  describe('Tax Thresholds', () => {
    test('TX.40 US threshold ($100k)', () => {
      const result = checkTaxThreshold('US', 99999);
      expect(result.required).toBe(false);
      expect(result.threshold).toBe(100000);
    });

    test('TX.41 Canada threshold (CAD 30k)', () => {
      const result = checkTaxThreshold('CA', 25000);
      expect(result.required).toBe(false);
      expect(result.threshold).toBe(30000);
    });

    test('TX.42 UK threshold (£85k)', () => {
      const result = checkTaxThreshold('GB', 80000);
      expect(result.required).toBe(false);
      expect(result.threshold).toBe(85000);
    });

    test('TX.43 No threshold country (Israel threshold=0 means always required)', () => {
      const result = checkTaxThreshold('IL', 0);
      expect(result.required).toBe(true);
      expect(result.threshold).toBe(0);
    });

    test('TX.43b Above threshold requires registration', () => {
      const result = checkTaxThreshold('US', 150000);
      expect(result.required).toBe(true);
      expect(result.threshold).toBe(100000);
    });
  });

  describe('Tax Number Validation', () => {
    test('TX.44 US EIN format', () => {
      const result = validateTaxNumber('US', '12-3456789');
      expect(result.valid).toBe(true);
    });

    test('TX.45 UK VAT format', () => {
      const result = validateTaxNumber('GB', '123456789 012');
      expect(result.valid).toBe(true);
    });

    test('TX.46 German VAT format', () => {
      const result = validateTaxNumber('DE', 'DE123456789');
      expect(result.valid).toBe(true);
    });

    test('TX.47 Invalid tax number', () => {
      const result = validateTaxNumber('US', 'invalid');
      expect(result.valid).toBe(false);
    });

    test('TX.48 No validation pattern', () => {
      const result = validateTaxNumber('JP', '12345');
      expect(result.valid).toBe(true);
      expect(result.message).toBe('No specific validation for this country');
    });
  });

  describe('Edge Cases', () => {
    test('TX.49 Unknown country returns no tax', () => {
      const result = getTaxRate('XX');
      expect(result.rate).toBe(0);
      expect(result.type).toBe('none');
    });

    test('TX.50 Zero item value', () => {
      const result = calculateTax('US', 'CA', 0, 0);
      expect(result.taxAmount).toBe(0);
    });

    test('TX.51 Large item value', () => {
      const result = calculateTax('DE', null, 100000, 10000);
      expect(result.taxAmount).toBeCloseTo(20900, 0); // (110k)*0.19
    });

    test('TX.52 Currency conversion preserved', () => {
      const result = calculateTax('JP', null, 10000, 1000);
      expect(result.currency).toBe('JPY');
    });
  });

  describe('Tax Integration with Payment Flow', () => {
    test('TX.53 Tax included in breakdown', async () => {
      const res = await request(app)
        .post('/api/shipping/calculate-breakdown')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          itemPrice: 100,
          fromCountry: 'US',
          toCountry: 'CA',
          toState: 'ON',
          weightKg: 0.5,
        });

      expect(res.status).toBe(200);
      // Buyer pays item + shipping + protection + tax
      expect(res.body.buyer.totalPaid).toBeGreaterThan(100);
      // Tax amount is present
      expect(res.body.buyer.tax).toBeDefined();
      expect(res.body.buyer.tax.taxAmount).toBeGreaterThan(0);
      expect(res.body.buyer.tax.taxType).toBe('gst_hst');
      // Seller receives item price minus platform fee plus shipping (shipping passes through)
      expect(res.body.seller.sellerEarnings).toBeGreaterThan(90);
      expect(res.body.seller.sellerEarnings).toBeLessThan(res.body.buyer.totalPaid);
    });
  });
});