const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ─── Models (same schemas as app) ───
const userSchema = new mongoose.Schema({
  name: String, email: { type: String, unique: true }, password: String,
  emailVerified: { type: Boolean, default: false }, role: { type: String, default: 'user' },
  authProvider: { type: String, default: 'email' }, avatar: { type: String, default: '' },
  bio: { type: String, default: '' }, country: { type: String, default: 'US' },
  phone: String, phoneCode: String,
  location: { city: String, state: String, country: String },
  shippingAddress: { street: String, city: String, state: String, postalCode: String, country: String },
  preferences: { currency: String, language: String, notifications: { email: Boolean, push: Boolean, sms: Boolean } },
  sellerInfo: { isSeller: Boolean, shopName: String, description: String, rating: Number, totalSales: Number, totalEarnings: Number },
  balance: { available: Number, pending: Number, currency: String },
  followers: [mongoose.Schema.Types.ObjectId], following: [mongoose.Schema.Types.ObjectId],
  wishlist: [mongoose.Schema.Types.ObjectId],
  stripeAccountId: String, payoutMethod: { type: String, default: 'stripe' },
  onboardingComplete: { type: Boolean, default: false },
  suspended: { type: Boolean, default: false },
}, { timestamps: true });

const listingSchema = new mongoose.Schema({
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  title: String, description: String, price: Number, originalPrice: Number,
  currency: { type: String, default: 'USD' }, images: [String],
  category: String, brand: String, size: String, condition: String, color: String,
  weight: { type: Number, default: 0.5 }, weightUnit: { type: String, default: 'kg' },
  shipping: { domestic: Boolean, international: Boolean, freeShipping: Boolean, shippingCost: Number, estimatedDays: String },
  shipsFrom: { type: String, default: 'US' },
  likes: [mongoose.Schema.Types.ObjectId], comments: [{ user: mongoose.Schema.Types.ObjectId, text: String, createdAt: Date }],
  shares: [mongoose.Schema.Types.ObjectId],
  status: { type: String, default: 'active' }, sold: { type: Boolean, default: false },
  available: { type: Boolean, default: true }, quantity: { type: Number, default: 1 },
  quantitySold: { type: Number, default: 0 }, reserved: { type: Number, default: 0 },
  views: { type: Number, default: 0 }, featured: { type: Boolean, default: false },
  boost: { active: Boolean, tier: String, startDate: Date, endDate: Date, durationDays: Number, fee: Number, priorityScore: Number },
  expiresAt: Date,
  paymentBreakdown: { sellerEarnings: Number, platformFee: Number, platformFeePercent: Number, shippingCost: Number, buyerTotal: Number },
}, { timestamps: true });

const orderSchema = new mongoose.Schema({
  orderNumber: String, buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  sellers: [mongoose.Schema.Types.ObjectId], currency: { type: String, default: 'USD' },
  items: [{ listing: mongoose.Schema.Types.ObjectId, transaction: mongoose.Schema.Types.ObjectId, seller: mongoose.Schema.Types.ObjectId,
    title: String, price: Number, quantity: Number, currency: String, image: String, condition: String, size: String, brand: String }],
  shipments: [{ seller: mongoose.Schema.Types.ObjectId, items: [mongoose.Schema.Types.ObjectId], shippingCost: Number, currency: String,
    status: { type: String, default: 'pending' }, trackingNumber: String, carrier: String, shippedAt: Date }],
  totals: { subtotal: Number, shipping: Number, protectionFees: Number, discounts: Number, total: Number },
  payment: { paymentIntentId: String, status: { type: String, default: 'captured' }, currency: String, totalHeld: Number },
  status: { type: String, default: 'confirmed' },
  shippingAddress: { fullName: String, street1: String, city: String, state: String, postalCode: String, country: String },
}, { timestamps: true });

const transactionSchema = new mongoose.Schema({
  buyer: mongoose.Schema.Types.ObjectId, seller: mongoose.Schema.Types.ObjectId,
  listing: mongoose.Schema.Types.ObjectId, order: mongoose.Schema.Types.ObjectId,
  amount: Number, currency: { type: String, default: 'USD' },
  platformFee: Number, platformFeePercent: Number, sellerEarnings: Number,
  shippingCost: Number, status: { type: String, default: 'completed' },
  paymentIntentId: String, stripeTransferId: String,
}, { timestamps: true });

const offerSchema = new mongoose.Schema({
  buyer: mongoose.Schema.Types.ObjectId, seller: mongoose.Schema.Types.ObjectId,
  listing: mongoose.Schema.Types.ObjectId, amount: Number, currency: { type: String, default: 'USD' },
  message: String, status: { type: String, default: 'pending' }, expiresAt: Date,
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
  sender: mongoose.Schema.Types.ObjectId, receiver: mongoose.Schema.Types.ObjectId,
  listing: mongoose.Schema.Types.ObjectId, text: String, read: { type: Boolean, default: false },
  conversationId: String,
}, { timestamps: true });

const wishlistSchema = new mongoose.Schema({
  user: mongoose.Schema.Types.ObjectId, listing: mongoose.Schema.Types.ObjectId,
}, { timestamps: true });

const ratingSchema = new mongoose.Schema({
  reviewer: mongoose.Schema.Types.ObjectId, reviewee: mongoose.Schema.Types.ObjectId,
  listing: mongoose.Schema.Types.ObjectId, order: mongoose.Schema.Types.ObjectId,
  rating: Number, comment: String, helpful: { type: Number, default: 0 },
}, { timestamps: true });

const payoutSchema = new mongoose.Schema({
  seller: mongoose.Schema.Types.ObjectId, amount: Number, currency: { type: String, default: 'USD' },
  status: { type: String, default: 'pending' }, method: String, stripePayoutId: String,
  transactions: [mongoose.Schema.Types.ObjectId],
}, { timestamps: true });

const recentlyViewedSchema = new mongoose.Schema({
  user: mongoose.Schema.Types.ObjectId, listing: mongoose.Schema.Types.ObjectId, viewedAt: Date,
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Listing = mongoose.model('Listing', listingSchema);
const Order = mongoose.model('Order', orderSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Offer = mongoose.model('Offer', offerSchema);
const Message = mongoose.model('Message', messageSchema);
const Wishlist = mongoose.model('Wishlist', wishlistSchema);
const Rating = mongoose.model('Rating', ratingSchema);
const Payout = mongoose.model('Payout', payoutSchema);
const RecentlyViewed = mongoose.model('RecentlyViewed', recentlyViewedSchema);

// ─── Seed Data ───
const PASSWORD_HASH = bcrypt.hashSync('Password123!', 10);

const users = [
  {
    name: 'Alex Rivera',
    email: 'reddy59021@gmail.com',
    password: PASSWORD_HASH,
    emailVerified: true,
    role: 'user',
    authProvider: 'email',
    avatar: '',
    bio: 'Fashion enthusiast & vintage collector. Selling curated pieces from my personal wardrobe.',
    country: 'US',
    phone: '+1555123001',
    phoneCode: '+1',
    location: { city: 'Los Angeles', state: 'CA', country: 'US' },
    shippingAddress: { street: '123 Sunset Blvd', city: 'Los Angeles', state: 'CA', postalCode: '90028', country: 'US' },
    preferences: { currency: 'USD', language: 'en', notifications: { email: true, push: true, sms: false } },
    sellerInfo: { isSeller: true, shopName: 'Alex Vintage Finds', description: 'Curated vintage & streetwear', rating: 4.8, totalSales: 24, totalEarnings: 1840.50 },
    balance: { available: 420.75, pending: 85.00, currency: 'USD' },
    followers: [], following: [],
    payoutMethod: 'stripe',
    onboardingComplete: true,
  },
  {
    name: 'Jordan Patel',
    email: 'reddy59022@gmail.com',
    password: PASSWORD_HASH,
    emailVerified: true,
    role: 'user',
    authProvider: 'email',
    avatar: '',
    bio: 'Streetwear seller & sneakerhead. Premium brands at fair prices.',
    country: 'US',
    phone: '+1555123002',
    phoneCode: '+1',
    location: { city: 'New York', state: 'NY', country: 'US' },
    shippingAddress: { street: '456 Broadway', city: 'New York', state: 'NY', postalCode: '10013', country: 'US' },
    preferences: { currency: 'USD', language: 'en', notifications: { email: true, push: true, sms: true } },
    sellerInfo: { isSeller: true, shopName: 'Jordan\'s Closet', description: 'Premium streetwear & sneakers', rating: 4.6, totalSales: 18, totalEarnings: 1290.25 },
    balance: { available: 310.00, pending: 50.00, currency: 'USD' },
    followers: [], following: [],
    payoutMethod: 'stripe',
    onboardingComplete: true,
  },
];

const categories = ['Women', 'Men', 'Kids', 'Electronics', 'Home', 'Beauty', 'Accessories', 'Clothing'];
const conditions = ['New with tags', 'New without tags', 'Good', 'Fair', 'Poor'];

const listingsData = [
  // ─── Alex's Listings (Seller 1) ───
  { title: 'Vintage Levi\'s 501 Denim Jacket', description: 'Classic 90s Levi\'s denim jacket in great condition. Faded wash with natural distressing.', price: 65, originalPrice: 120, category: 'Men', brand: 'Levi\'s', size: 'M', condition: 'Good', color: 'Blue', weight: 0.8, quantity: 1 },
  { title: 'Nike Air Max 90 Essential', description: 'White/infrared colorway. Worn twice, almost new condition.', price: 85, originalPrice: 130, category: 'Men', brand: 'Nike', size: '10', condition: 'New without tags', color: 'White', weight: 0.6, quantity: 1 },
  { title: 'Urban Outfitters Floral Midi Dress', description: 'Beautiful floral print midi dress, perfect for summer. Size S.', price: 35, originalPrice: 69, category: 'Women', brand: 'Urban Outfitters', size: 'S', condition: 'Good', color: 'Floral', weight: 0.3, quantity: 1 },
  { title: 'Apple AirPods Pro 2nd Gen', description: 'Brand new sealed box. Noise cancelling, spatial audio.', price: 175, originalPrice: 249, category: 'Electronics', brand: 'Apple', size: 'One Size', condition: 'New with tags', color: 'White', weight: 0.1, quantity: 2 },
  { title: 'Adidas Originals Trefoil Hoodie', description: 'Classic black hoodie with trefoil logo. Cozy fleece interior.', price: 45, originalPrice: 80, category: 'Clothing', brand: 'Adidas', size: 'L', condition: 'Good', color: 'Black', weight: 0.5, quantity: 1 },
  { title: 'Ceramic Plant Pot Set (3pc)', description: 'Minimalist white ceramic pots in small, medium, large. Includes drainage holes.', price: 28, originalPrice: 45, category: 'Home', brand: 'CB2', size: 'Set', condition: 'New with tags', color: 'White', weight: 2.0, quantity: 3 },
  { title: 'MAC Velvet Teddy Lipstick', description: 'Matte finish, barely used. Full size.', price: 12, originalPrice: 23, category: 'Beauty', brand: 'MAC', size: 'Full Size', condition: 'Good', color: 'Brown', weight: 0.05, quantity: 1 },
  { title: 'Ray-Ban Aviator Classic', description: 'Gold frame with green lenses. Includes original case.', price: 95, originalPrice: 163, category: 'Accessories', brand: 'Ray-Ban', size: 'One Size', condition: 'Good', color: 'Gold', weight: 0.1, quantity: 1 },
  { title: 'Patagonia Better Sweater Fleece', description: 'Men\'s full zip fleece jacket. Recycled polyester. Navy blue.', price: 70, originalPrice: 139, category: 'Men', brand: 'Patagonia', size: 'L', condition: 'New without tags', color: 'Navy', weight: 0.4, quantity: 1 },
  { title: 'Kids Nike Running Shoes', description: 'Children\'s running shoes, barely worn. Great for active kids.', price: 25, originalPrice: 55, category: 'Kids', brand: 'Nike', size: '3Y', condition: 'Good', color: 'Black/Red', weight: 0.3, quantity: 2 },

  // ─── Jordan's Listings (Seller 2) ───
  { title: 'Supreme Box Logo Hoodie', description: 'Red box logo hoodie. Size L. Authentic, purchased from Supreme directly.', price: 220, originalPrice: 168, category: 'Men', brand: 'Supreme', size: 'L', condition: 'New without tags', color: 'Red', weight: 0.6, quantity: 1 },
  { title: 'Nike Dunk Low Panda', description: 'Black/white colorway. DS (deadstock). Size 11.', price: 110, originalPrice: 110, category: 'Men', brand: 'Nike', size: '11', condition: 'New with tags', color: 'Black/White', weight: 0.5, quantity: 2 },
  { title: 'Vintage Champion Reverse Weave', description: 'Heavyweight crewneck sweatshirt. 90s era. Gray.', price: 55, originalPrice: 90, category: 'Men', brand: 'Champion', size: 'XL', condition: 'Fair', color: 'Gray', weight: 0.7, quantity: 1 },
  { title: 'Lululemon Align Leggings', description: 'High-rise, size 6. Perfect condition, worn once.', price: 65, originalPrice: 98, category: 'Women', brand: 'Lululemon', size: '6', condition: 'New without tags', color: 'Black', weight: 0.2, quantity: 1 },
  { title: 'Nintendo Switch Pro Controller', description: 'Genuine Nintendo controller. Works perfectly.', price: 45, originalPrice: 70, category: 'Electronics', brand: 'Nintendo', size: 'One Size', condition: 'Good', color: 'Black', weight: 0.3, quantity: 1 },
  { title: 'Casio Vintage Digital Watch', description: 'Classic retro digital watch. Gold tone. New battery.', price: 30, originalPrice: 59, category: 'Accessories', brand: 'Casio', size: 'One Size', condition: 'Good', color: 'Gold', weight: 0.05, quantity: 1 },
  { title: 'Uniqlo Heattech Thermal Set', description: 'Men\'s thermal top and bottom. Brand new with tags.', price: 22, originalPrice: 39, category: 'Men', brand: 'Uniqlo', size: 'M', condition: 'New with tags', color: 'Black', weight: 0.2, quantity: 3 },
  { title: 'West Elm Throw Blanket', description: 'Chunky knit throw in cream. Cozy and stylish.', price: 38, originalPrice: 79, category: 'Home', brand: 'West Elm', size: '50x60', condition: 'Good', color: 'Cream', weight: 1.5, quantity: 1 },
  { title: 'Dyson Supersonic Hair Dryer', description: 'Used for 2 months. Includes all attachments. Works perfectly.', price: 250, originalPrice: 429, category: 'Beauty', brand: 'Dyson', size: 'One Size', condition: 'Good', color: 'Nickel', weight: 0.8, quantity: 1 },
  { title: 'Levi\'s 501 High Rise Jeans', description: 'Women\'s high rise straight leg jeans. Size 26.', price: 40, originalPrice: 78, category: 'Women', brand: 'Levi\'s', size: '26', condition: 'Good', color: 'Blue', weight: 0.5, quantity: 1 },
  { title: 'H&M Oversized Blazer', description: 'Women\'s oversized black blazer. Perfect for layering.', price: 20, originalPrice: 45, category: 'Women', brand: 'H&M', size: 'M', condition: 'New without tags', color: 'Black', weight: 0.4, quantity: 1 },
  { title: 'Sony WH-1000XM4 Headphones', description: 'Noise cancelling wireless headphones. Excellent condition.', price: 180, originalPrice: 349, category: 'Electronics', brand: 'Sony', size: 'One Size', condition: 'Good', color: 'Black', weight: 0.3, quantity: 1 },
  { title: 'North Face Puffer Jacket', description: 'Women\'s puffer jacket. Lightweight but warm. Size M.', price: 80, originalPrice: 199, category: 'Women', brand: 'The North Face', size: 'M', condition: 'Good', color: 'Olive', weight: 0.5, quantity: 1 },
  { title: 'Birkenstock Arizona Sandals', description: 'Classic two-strap sandals. Size 38 EU. Worn a few times.', price: 50, originalPrice: 100, category: 'Accessories', brand: 'Birkenstock', size: '38', condition: 'Good', color: 'Brown', weight: 0.4, quantity: 1 },
  { title: 'Funko Pop Collection (5 Pack)', description: 'Marvel characters: Iron Man, Spider-Man, Thor, Hulk, Captain America.', price: 35, originalPrice: 50, category: 'Kids', brand: 'Funko', size: 'One Size', condition: 'New with tags', color: 'Multi', weight: 0.5, quantity: 1 },
];

async function seed() {
  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/trend-drop';
    console.log('Connecting to:', mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));
    await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('Connected to MongoDB\n');

    // ─── STEP 1: Delete all existing data ───
    console.log('🗑️  Deleting all existing data...');
    const collections = ['users', 'listings', 'orders', 'transactions', 'offers',
      'messages', 'wishlists', 'ratings', 'payouts', 'recentlyvieweds',
      'carts', 'comments', 'collections', 'vendors', 'reports', 'returns',
      'referrals', 'promos', 'subscriptions', 'loyaltyprograms', 'savedsearches',
      'advancedsearches', 'aistlists', 'arshowrooms', 'auctions', 'bundlerules',
      'crossborders', 'inventories', 'liveevents', 'mobilepreferences',
      'offerSharings', 'parties', 'pendingusers', 'pricehistories', 'sellerbadges',
      'sellercommunities', 'shippinginsurances', 'shippingintegrations',
      'socialcommerces', 'trendforecasts', 'virtualtryons', 'videos'];

    for (const col of collections) {
      try {
        await mongoose.connection.db.dropCollection(col).catch(() => {});
      } catch (e) { /* ignore */ }
    }
    console.log('✅ All collections dropped\n');

    // ─── STEP 2: Create Users ───
    console.log('👤 Creating users...');
    const createdUsers = await User.insertMany(users);
    const alex = createdUsers[0];
    const jordan = createdUsers[1];
    console.log(`  ✅ Alex Rivera (${alex.email}) — ID: ${alex._id}`);
    console.log(`  ✅ Jordan Patel (${jordan.email}) — ID: ${jordan._id}\n`);

    // Cross-follow
    alex.following.push(jordan._id);
    jordan.following.push(alex._id);
    alex.followers.push(jordan._id);
    jordan.followers.push(alex._id);
    await alex.save();
    await jordan.save();
    console.log('  ✅ Users are following each other\n');

    // ─── STEP 3: Create Listings ───
    console.log('📦 Creating listings...');
    const createdListings = [];
    for (let i = 0; i < listingsData.length; i++) {
      const data = listingsData[i];
      const seller = i < 10 ? alex : jordan;
      const listing = await Listing.create({
        seller: seller._id,
        title: data.title,
        description: data.description,
        price: data.price,
        originalPrice: data.originalPrice,
        currency: 'USD',
        images: [],  // No images as requested
        category: data.category,
        brand: data.brand,
        size: data.size,
        condition: data.condition,
        color: data.color,
        weight: data.weight,
        weightUnit: 'kg',
        shipping: { domestic: true, international: false, freeShipping: data.price >= 50, shippingCost: data.price >= 50 ? 0 : 5.99, estimatedDays: '3-5' },
        shipsFrom: seller.location?.state === 'CA' ? 'US' : 'US',
        status: 'active',
        available: true,
        quantity: data.quantity,
        quantitySold: 0,
        views: Math.floor(Math.random() * 200) + 10,
        boost: { active: false, tier: '', fee: 0, priorityScore: 0 },
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        paymentBreakdown: {
          sellerEarnings: Math.round(data.price * 0.9 * 100) / 100,
          platformFee: Math.round(data.price * 0.1 * 100) / 100,
          platformFeePercent: 10,
          shippingCost: data.price >= 50 ? 0 : 5.99,
          buyerTotal: data.price + (data.price >= 50 ? 0 : 5.99),
        },
      });
      createdListings.push(listing);
      const prefix = seller.name === 'Alex Rivera' ? 'Alex' : 'Jordan';
      console.log(`  ✅ [${prefix}] ${listing.title} — $${listing.price}`);
    }
    console.log(`  📦 Total: ${createdListings.length} listings\n`);

    // ─── STEP 4: Likes (both users like each other's listings) ───
    console.log('❤️  Adding likes...');
    let likeCount = 0;
    for (const listing of createdListings) {
      const sellerId = listing.seller.toString();
      const otherUser = sellerId === alex._id.toString() ? jordan : alex;
      listing.likes.push(otherUser._id);
      await listing.save();
      likeCount++;
    }
    console.log(`  ✅ ${likeCount} likes added\n`);

    // ─── STEP 5: Comments ───
    console.log('💬 Adding comments...');
    let commentCount = 0;
    const sampleComments = [
      'Love this! Is it still available?',
      'What\'s the condition like in person?',
      'Would you take $10 less?',
      'Great seller, fast shipping!',
      'This is exactly what I was looking for!',
      'Can you provide more photos?',
    ];
    for (let i = 0; i < 6; i++) {
      const listing = createdListings[i];
      const commenter = listing.seller.toString() === alex._id.toString() ? jordan : alex;
      listing.comments.push({
        user: commenter._id,
        text: sampleComments[i],
        createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
      });
      await listing.save();
      commentCount++;
    }
    console.log(`  ✅ ${commentCount} comments added\n`);

    // ─── STEP 6: Orders (Alex buys from Jordan, Jordan buys from Alex) ───
    console.log('🛒 Creating orders...');
    const orders = [];

    // Order 1: Alex buys Supreme Hoodie from Jordan
    const order1Items = createdListings.filter(l => l.seller.toString() === jordan._id.toString()).slice(0, 2);
    const order1 = await Order.create({
      orderNumber: `AV-${100000 + Math.floor(Math.random() * 900000)}`,
      buyer: alex._id,
      sellers: [jordan._id],
      currency: 'USD',
      items: order1Items.map(l => ({
        listing: l._id, transaction: null, seller: l.seller,
        title: l.title, price: l.price, quantity: 1, currency: 'USD',
        condition: l.condition, size: l.size, brand: l.brand,
      })),
      shipments: [{
        seller: jordan._id, items: [], shippingCost: 0, currency: 'USD',
        status: 'shipped', trackingNumber: `USPS${Math.floor(100000000 + Math.random() * 900000000)}`,
        carrier: 'USPS', shippedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      }],
      totals: {
        subtotal: order1Items.reduce((s, l) => s + l.price, 0),
        shipping: 0, protectionFees: 2.99, discounts: 0,
        total: order1Items.reduce((s, l) => s + l.price, 0) + 2.99,
      },
      payment: { paymentIntentId: `pi_seed_${Date.now()}_1`, status: 'captured', currency: 'USD', totalHeld: order1Items.reduce((s, l) => s + l.price, 0) + 2.99 },
      status: 'shipped',
      shippingAddress: { fullName: 'Alex Rivera', street1: '123 Sunset Blvd', city: 'Los Angeles', state: 'CA', postalCode: '90028', country: 'US' },
    });
    orders.push(order1);
    console.log(`  ✅ Order ${order1.orderNumber}: Alex → Jordan (${order1Items.length} items, $${order1.totals.total})`);

    // Order 2: Jordan buys Nike Air Max & MAC lipstick from Alex
    const order2Items = createdListings.filter(l => l.seller.toString() === alex._id.toString()).slice(1, 3);
    const order2 = await Order.create({
      orderNumber: `AV-${100000 + Math.floor(Math.random() * 900000)}`,
      buyer: jordan._id,
      sellers: [alex._id],
      currency: 'USD',
      items: order2Items.map(l => ({
        listing: l._id, transaction: null, seller: l.seller,
        title: l.title, price: l.price, quantity: 1, currency: 'USD',
        condition: l.condition, size: l.size, brand: l.brand,
      })),
      shipments: [{
        seller: alex._id, items: [], shippingCost: 0, currency: 'USD',
        status: 'delivered', trackingNumber: `UPS${Math.floor(100000000 + Math.random() * 900000000)}`,
        carrier: 'UPS', shippedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      }],
      totals: {
        subtotal: order2Items.reduce((s, l) => s + l.price, 0),
        shipping: 0, protectionFees: 2.99, discounts: 0,
        total: order2Items.reduce((s, l) => s + l.price, 0) + 2.99,
      },
      payment: { paymentIntentId: `pi_seed_${Date.now()}_2`, status: 'captured', currency: 'USD', totalHeld: order2Items.reduce((s, l) => s + l.price, 0) + 2.99 },
      status: 'completed',
      shippingAddress: { fullName: 'Jordan Patel', street1: '456 Broadway', city: 'New York', state: 'NY', postalCode: '10013', country: 'US' },
    });
    orders.push(order2);
    console.log(`  ✅ Order ${order2.orderNumber}: Jordan → Alex (${order2Items.length} items, $${order2.totals.total})`);

    // Order 3: Alex buys Dyson from Jordan (confirmed, not yet shipped)
    const order3Item = createdListings.find(l => l.title.includes('Dyson'));
    const order3 = await Order.create({
      orderNumber: `AV-${100000 + Math.floor(Math.random() * 900000)}`,
      buyer: alex._id,
      sellers: [jordan._id],
      currency: 'USD',
      items: [{ listing: order3Item._id, transaction: null, seller: jordan._id,
        title: order3Item.title, price: order3Item.price, quantity: 1, currency: 'USD',
        condition: order3Item.condition, size: order3Item.size, brand: order3Item.brand }],
      shipments: [{ seller: jordan._id, items: [], shippingCost: 0, currency: 'USD', status: 'pending' }],
      totals: { subtotal: order3Item.price, shipping: 0, protectionFees: 2.99, discounts: 0, total: order3Item.price + 2.99 },
      payment: { paymentIntentId: `pi_seed_${Date.now()}_3`, status: 'captured', currency: 'USD', totalHeld: order3Item.price + 2.99 },
      status: 'confirmed',
      shippingAddress: { fullName: 'Alex Rivera', street1: '123 Sunset Blvd', city: 'Los Angeles', state: 'CA', postalCode: '90028', country: 'US' },
    });
    orders.push(order3);
    console.log(`  ✅ Order ${order3.orderNumber}: Alex → Jordan (Dyson, pending shipment)\n`);

    // ─── STEP 7: Transactions ───
    console.log('💳 Creating transactions...');
    const transactions = [];
    for (const order of orders) {
      for (const item of order.items) {
        const tx = await Transaction.create({
          buyer: order.buyer,
          seller: item.seller,
          listing: item.listing,
          order: order._id,
          amount: item.price,
          currency: 'USD',
          platformFee: Math.round(item.price * 0.1 * 100) / 100,
          platformFeePercent: 10,
          sellerEarnings: Math.round(item.price * 0.9 * 100) / 100,
          shippingCost: 0,
          status: order.status === 'completed' ? 'completed' : 'pending',
          paymentIntentId: order.payment.paymentIntentId,
        });
        transactions.push(tx);
      }
    }
    console.log(`  ✅ ${transactions.length} transactions created\n`);

    // ─── STEP 8: Offers ───
    console.log('💰 Creating offers...');
    const offer1 = await Offer.create({
      buyer: jordan._id, seller: alex._id,
      listing: createdListings[0]._id,
      amount: 50, currency: 'USD',
      message: 'Would you take $50 for the denim jacket?',
      status: 'pending',
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    });
    const offer2 = await Offer.create({
      buyer: alex._id, seller: jordan._id,
      listing: createdListings[15]._id,
      amount: 40, currency: 'USD',
      message: 'I can do $40 for the Champion crewneck',
      status: 'accepted',
      expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    });
    console.log(`  ✅ Offer from Jordan to Alex ($50 on denim jacket) — pending`);
    console.log(`  ✅ Offer from Alex to Jordan ($40 on Champion) — accepted\n`);

    // ─── STEP 9: Messages ───
    console.log('✉️  Creating messages...');
    const convId = [alex._id, jordan._id].sort().join('_');
    const msgs = [
      { sender: jordan._id, receiver: alex._id, text: 'Hey! Is the AirPods still available?', read: true },
      { sender: alex._id, receiver: jordan._id, text: 'Yes! They\'re brand new sealed. Want them?', read: true },
      { sender: jordan._id, receiver: alex._id, text: 'Would you do $160?', read: true },
      { sender: alex._id, receiver: jordan._id, text: 'I can do $170 since they\'re sealed. Free shipping!', read: true },
      { sender: jordan._id, receiver: alex._id, text: 'Deal! I\'ll buy them now.', read: false },
    ];
    for (const msg of msgs) {
      await Message.create({ ...msg, conversationId: convId });
    }
    console.log(`  ✅ ${msgs.length} messages in conversation\n`);

    // ─── STEP 10: Wishlists ───
    console.log('📌 Creating wishlists...');
    // Alex wishlist items (Jordan's listings)
    for (const listing of createdListings.slice(10, 14)) {
      await Wishlist.create({ user: alex._id, listing: listing._id });
    }
    // Jordan wishlist items (Alex's listings)
    for (const listing of createdListings.slice(3, 7)) {
      await Wishlist.create({ user: jordan._id, listing: listing._id });
    }
    console.log(`  ✅ Alex: 4 wishlisted items`);
    console.log(`  ✅ Jordan: 4 wishlisted items\n`);

    // ─── STEP 11: Ratings ───
    console.log('⭐ Creating ratings...');
    await Rating.create({
      reviewer: alex._id, reviewee: jordan._id,
      listing: createdListings[10]._id, order: order1._id,
      rating: 5, comment: 'Fast shipping, exactly as described! Great seller.',
      helpful: 3,
    });
    await Rating.create({
      reviewer: jordan._id, reviewee: alex._id,
      listing: createdListings[1]._id, order: order2._id,
      rating: 4, comment: 'Good condition, fair price. Would buy again.',
      helpful: 1,
    });
    console.log(`  ✅ 2 ratings created\n`);

    // ─── STEP 12: Payouts ───
    console.log('💸 Creating payouts...');
    await Payout.create({
      seller: alex._id, amount: 150.00, currency: 'USD',
      status: 'completed', method: 'stripe',
      stripePayoutId: `po_seed_${Date.now()}_1`,
      transactions: transactions.filter(t => t.seller.toString() === alex._id.toString()).slice(0, 2).map(t => t._id),
    });
    await Payout.create({
      seller: jordan._id, amount: 100.00, currency: 'USD',
      status: 'pending', method: 'stripe',
      stripePayoutId: `po_seed_${Date.now()}_2`,
      transactions: transactions.filter(t => t.seller.toString() === jordan._id.toString()).slice(0, 1).map(t => t._id),
    });
    console.log(`  ✅ Alex: $150 completed payout`);
    console.log(`  ✅ Jordan: $100 pending payout\n`);

    // ─── STEP 13: Recently Viewed ───
    console.log('👀 Creating recently viewed...');
    for (const listing of createdListings.slice(10, 18)) {
      await RecentlyViewed.create({ user: alex._id, listing: listing._id, viewedAt: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000) });
    }
    for (const listing of createdListings.slice(0, 8)) {
      await RecentlyViewed.create({ user: jordan._id, listing: listing._id, viewedAt: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000) });
    }
    console.log(`  ✅ 8 recently viewed for each user\n`);

    // ─── SUMMARY ───
    console.log('═══════════════════════════════════════');
    console.log('  🎉 SEED COMPLETE!');
    console.log('═══════════════════════════════════════');
    console.log(`  👤 Users:              2 (both verified, both sellers)`);
    console.log(`  📦 Listings:           ${createdListings.length} (no images)`);
    console.log(`  🛒 Orders:             3 (1 shipped, 1 completed, 1 pending)`);
    console.log(`  💳 Transactions:       ${transactions.length}`);
    console.log(`  💰 Offers:             2 (1 pending, 1 accepted)`);
    console.log(`  ✉️  Messages:           ${msgs.length}`);
    console.log(`  ❤️  Likes:              ${likeCount}`);
    console.log(`  💬 Comments:           ${commentCount}`);
    console.log(`  📌 Wishlists:          8 items`);
    console.log(`  ⭐ Ratings:            2`);
    console.log(`  💸 Payouts:            2 (1 completed, 1 pending)`);
    console.log(`  👀 Recently Viewed:    16`);
    console.log('═══════════════════════════════════════');
    console.log('\n  🔐 Login Credentials:');
    console.log('  ─────────────────────────────────────');
    console.log('  User 1: reddy59021@gmail.com / Password123!');
    console.log('  User 2: reddy59022@gmail.com / Password123!');
    console.log('  ─────────────────────────────────────\n');

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

seed();