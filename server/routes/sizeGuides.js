const express = require('express');
const router = express.Router();

// Size guide data for different categories
// Returns standardized measurements for each category
const sizeGuides = {
  Women: {
    description: 'Women\'s apparel size guide',
    measurements: ['bust', 'waist', 'hip', 'inseam'],
    sizing: {
      XS: { numeric: '0-2', bust: '31-32', waist: '23-24', hip: '33-34' },
      S: { numeric: '4-6', bust: '33-34', waist: '25-26', hip: '35-36' },
      M: { numeric: '8-10', bust: '35-36', waist: '27-28', hip: '37-38' },
      L: { numeric: '12-14', bust: '37-38', waist: '29-30', hip: '39-40' },
      XL: { numeric: '16-18', bust: '39-41', waist: '31-33', hip: '41-43' },
      XXL: { numeric: '20-22', bust: '42-44', waist: '34-36', hip: '44-46' },
    },
  },
  Men: {
    description: 'Men\'s apparel size guide',
    measurements: ['chest', 'waist', 'neck', 'sleeve', 'inseam'],
    sizing: {
      XS: { numeric: '30-32', chest: '32-34', waist: '26-28', neck: '13.5-14', sleeve: '31-32', inseam: '28-30' },
      S: { numeric: '34-36', chest: '35-37', waist: '29-31', neck: '14.5-15', sleeve: '32-33', inseam: '30-31' },
      M: { numeric: '38-40', chest: '38-40', waist: '32-34', neck: '15.5-16', sleeve: '33-34', inseam: '31-32' },
      L: { numeric: '42-44', chest: '41-43', waist: '35-37', neck: '16.5-17', sleeve: '34-35', inseam: '32-33' },
      XL: { numeric: '46-48', chest: '44-46', waist: '38-40', neck: '17.5-18', sleeve: '35-36', inseam: '33-34' },
      XXL: { numeric: '50-52', chest: '47-49', waist: '41-43', neck: '18.5-19', sleeve: '36-37', inseam: '34-35' },
    },
  },
  Kids: {
    description: 'Children\'s size guide by age',
    measurements: ['height', 'weight', 'chest', 'waist'],
    sizing: {
      '2T': { age: '2', height: '33-35', weight: '27-29', chest: '20-21', waist: '19.5-20.5' },
      '3T': { age: '3', height: '36-38', weight: '30-32', chest: '21-22', waist: '20.5-21.5' },
      '4T': { age: '4', height: '39-41', weight: '33-35', chest: '22-23', waist: '21-22' },
      '5': { age: '5', height: '42-44', weight: '36-40', chest: '23-24', waist: '22-23' },
      '6': { age: '6', height: '45-47', weight: '41-45', chest: '24-25', waist: '22-23' },
      '7': { age: '7', height: '48-49', weight: '46-50', chest: '25-26', waist: '23-24' },
      '8': { age: '8', height: '50-51', weight: '51-55', chest: '26-27', waist: '23-24' },
      '10': { age: '10', height: '52-54', weight: '56-65', chest: '27-28', waist: '24-25' },
      '12': { age: '12', height: '55-57', weight: '66-75', chest: '28-29', waist: '25-26' },
      '14': { age: '14', height: '58-60', weight: '76-85', chest: '29-31', waist: '26-27' },
    },
  },
  Accessories: {
    description: 'Accessories size guide (one size fits most)',
    measurements: [],
    sizing: {
      'One Size': { note: 'Most accessories are one size fits most' },
    },
  },
  Shoes: {
    description: 'Shoe size guide (US sizes)',
    measurements: ['foot length (inches)'],
    sizing: {
      '5': { uk: '2.5', eu: '35', cm: '22' },
      '5.5': { uk: '3', eu: '35.5', cm: '22.5' },
      '6': { uk: '3.5', eu: '36', cm: '23' },
      '6.5': { uk: '4', eu: '37', cm: '23.5' },
      '7': { uk: '4.5', eu: '37.5', cm: '24' },
      '7.5': { uk: '5', eu: '38', cm: '24.5' },
      '8': { uk: '5.5', eu: '38.5', cm: '25' },
      '8.5': { uk: '6', eu: '39', cm: '25.5' },
      '9': { uk: '6.5', eu: '40', cm: '26' },
      '9.5': { uk: '7', eu: '41', cm: '26.5' },
      '10': { uk: '7.5', eu: '42', cm: '27' },
      '11': { uk: '8.5', eu: '43', cm: '28' },
      '12': { uk: '9.5', eu: '44', cm: '29' },
      '13': { uk: '10.5', eu: '45', cm: '30' },
    },
  },
  Beauty: {
    description: 'Beauty products are typically one size',
    measurements: [],
    sizing: { 'One Size': { note: 'Standard size' } },
  },
  Electronics: {
    description: 'Electronics by category type',
    measurements: [],
    sizing: {
      'Portable': { note: 'Smartphones, tablets, accessories' },
      'Standard': { note: 'Laptops, speakers, cameras' },
      'Large': { note: 'Monitors, printers, consoles' },
    },
  },
  Home: {
    description: 'Home goods by standard sizes',
    measurements: ['width', 'length', 'height'],
    sizing: {
      'Small': { dimensions: 'Under 12"', examples: 'Decor, kitchen tools' },
      'Medium': { dimensions: '12-24"', examples: 'Vases, lamps, pillows' },
      'Large': { dimensions: '24-48"', examples: 'Rugs, wall art, furniture' },
      'Extra Large': { dimensions: '48"+', examples: 'Furniture, large decor' },
    },
  },
};

// GET /api/size-guides - List all available size guide categories
router.get('/', (req, res) => {
  const categories = Object.keys(sizeGuides).map(key => ({
    category: key,
    description: sizeGuides[key].description,
    measurements: sizeGuides[key].measurements,
    sizeCount: Object.keys(sizeGuides[key].sizing).length,
  }));
  res.json(categories);
});

// GET /api/size-guides/:category - Get size guide for a specific category
router.get('/:category', (req, res) => {
  const { category } = req.params;
  // Case-insensitive lookup
  const matchedKey = Object.keys(sizeGuides).find(
    k => k.toLowerCase() === category.toLowerCase()
  );

  if (!matchedKey) {
    return res.status(404).json({ message: `No size guide available for "${category}"` });
  }

  res.json(sizeGuides[matchedKey]);
});

// GET /api/size-guides/suggestions/:category/:size - Get size suggestions
router.get('/suggestions/:category/:size', (req, res) => {
  const { category, size } = req.params;
  const matchedKey = Object.keys(sizeGuides).find(
    k => k.toLowerCase() === category.toLowerCase()
  );

  if (!matchedKey) {
    return res.status(404).json({ message: `No size guide for "${category}"` });
  }

  const guide = sizeGuides[matchedKey];
  const sizeData = guide.sizing[size.toUpperCase()];

  if (!sizeData) {
    return res.status(404).json({
      message: `Size "${size}" not found for ${matchedKey}`,
      availableSizes: Object.keys(guide.sizing),
    });
  }

  res.json({
    category: matchedKey,
    size: size.toUpperCase(),
    measurements: sizeData,
    guide: guide.description,
  });
});

module.exports = router;