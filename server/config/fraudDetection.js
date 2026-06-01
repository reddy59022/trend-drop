/**
 * Fraud Detection & Risk Scoring System
 * 
 * FIX #8: Basic fraud scoring system
 * FIX #9: Return abuse tracking (buyer return rate)
 * 
 * This module provides:
 * - Seller risk scoring (new account, high velocity, suspicious patterns)
 * - Buyer risk scoring (return abuse, chargeback history, velocity)
 * - Transaction risk assessment
 * - Return abuse detection
 */

const User = require('../models/User');
const Transaction = require('../models/Transaction');

// Risk thresholds
const RISK_THRESHOLDS = {
  // Seller risk
  NEW_ACCOUNT_DAYS: 30,           // Account less than 30 days old
  HIGH_VELOCITY_SALES_PER_DAY: 10, // More than 10 sales per day
  HIGH_VELOCITY_SALES_PER_HOUR: 3, // More than 3 sales per hour
  SUSPICIOUS_PRICE_DEVIATION: 0.5, // Price 50% below market average
  
  // Buyer risk
  HIGH_RETURN_RATE: 0.30,         // More than 30% return rate
  HIGH_DISPUTE_RATE: 0.15,        // More than 15% dispute rate
  HIGH_VELOCITY_PURCHASES_PER_DAY: 5, // More than 5 purchases per day
  MIN_PURCHASES_FOR_RATE: 3,      // Need at least 3 purchases to calculate rate
  
  // Transaction risk
  HIGH_VALUE_THRESHOLD: 1000,     // Transactions over $1000 are high-risk
  VERY_HIGH_VALUE_THRESHOLD: 5000, // Transactions over $5000 are very high-risk
};

/**
 * Calculate seller risk score (0-100, higher = more risky)
 * 
 * Factors:
 * - Account age (new accounts are riskier)
 * - Sales velocity (sudden spikes are suspicious)
 * - Strike history
 * - Return rate (high returns = potential fraud)
 */
const calculateSellerRiskScore = async (sellerId) => {
  const seller = await User.findById(sellerId);
  if (!seller) return { score: 100, risk: 'unknown', factors: ['seller_not_found'] };
  
  let score = 0;
  const factors = [];
  
  // Factor 1: Account age
  const accountAgeDays = (Date.now() - new Date(seller.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (accountAgeDays < RISK_THRESHOLDS.NEW_ACCOUNT_DAYS) {
    score += 30;
    factors.push(`new_account_${Math.floor(accountAgeDays)}_days`);
  }
  
  // Factor 2: Sales velocity (last 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentSales = await Transaction.countDocuments({
    seller: sellerId,
    createdAt: { $gte: oneDayAgo },
  });
  if (recentSales > RISK_THRESHOLDS.HIGH_VELOCITY_SALES_PER_DAY) {
    score += 25;
    factors.push(`high_velocity_${recentSales}_sales_24h`);
  }
  
  // Factor 3: Sales velocity (last hour)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentHourSales = await Transaction.countDocuments({
    seller: sellerId,
    createdAt: { $gte: oneHourAgo },
  });
  if (recentHourSales > RISK_THRESHOLDS.HIGH_VELOCITY_SALES_PER_HOUR) {
    score += 20;
    factors.push(`high_velocity_${recentHourSales}_sales_1h`);
  }
  
  // Factor 4: Strike history
  const strikes = seller.stats?.strikes || 0;
  if (strikes > 0) {
    score += strikes * 15;
    factors.push(`${strikes}_strikes`);
  }
  
  // Factor 5: Return rate
  const totalSales = seller.stats?.totalSales || 0;
  if (totalSales >= RISK_THRESHOLDS.MIN_PURCHASES_FOR_RATE) {
    const returns = await Transaction.countDocuments({
      seller: sellerId,
      status: { $in: ['refunded', 'return_delivered'] },
    });
    const returnRate = returns / totalSales;
    if (returnRate > RISK_THRESHOLDS.HIGH_RETURN_RATE) {
      score += 25;
      factors.push(`high_return_rate_${(returnRate * 100).toFixed(1)}%`);
    }
  }
  
  // Cap score at 100
  score = Math.min(100, score);
  
  // Determine risk level
  let risk = 'low';
  if (score >= 70) risk = 'high';
  else if (score >= 40) risk = 'medium';
  
  return { score, risk, factors };
};

/**
 * Calculate buyer risk score (0-100, higher = more risky)
 * 
 * Factors:
 * - Account age
 * - Return rate (high returns = potential abuse)
 * - Dispute rate
 * - Purchase velocity
 * - Chargeback history
 */
const calculateBuyerRiskScore = async (buyerId) => {
  const buyer = await User.findById(buyerId);
  if (!buyer) return { score: 100, risk: 'unknown', factors: ['buyer_not_found'] };
  
  let score = 0;
  const factors = [];
  
  // Factor 1: Account age
  const accountAgeDays = (Date.now() - new Date(buyer.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (accountAgeDays < RISK_THRESHOLDS.NEW_ACCOUNT_DAYS) {
    score += 25;
    factors.push(`new_account_${Math.floor(accountAgeDays)}_days`);
  }
  
  // Factor 2: Return rate
  const totalPurchases = buyer.stats?.totalPurchases || 0;
  if (totalPurchases >= RISK_THRESHOLDS.MIN_PURCHASES_FOR_RATE) {
    const returns = await Transaction.countDocuments({
      buyer: buyerId,
      status: { $in: ['refunded', 'return_delivered', 'return_requested'] },
    });
    const returnRate = returns / totalPurchases;
    if (returnRate > RISK_THRESHOLDS.HIGH_RETURN_RATE) {
      score += 30;
      factors.push(`high_return_rate_${(returnRate * 100).toFixed(1)}%`);
    }
    
    // Track return rate for abuse detection
    buyer.stats.returnRate = returnRate;
    buyer.stats.totalReturns = returns;
  }
  
  // Factor 3: Dispute rate
  if (totalPurchases >= RISK_THRESHOLDS.MIN_PURCHASES_FOR_RATE) {
    const disputes = await Transaction.countDocuments({
      buyer: buyerId,
      status: 'disputed',
    });
    const disputeRate = disputes / totalPurchases;
    if (disputeRate > RISK_THRESHOLDS.HIGH_DISPUTE_RATE) {
      score += 25;
      factors.push(`high_dispute_rate_${(disputeRate * 100).toFixed(1)}%`);
    }
    
    buyer.stats.disputeRate = disputeRate;
    buyer.stats.totalDisputes = disputes;
  }
  
  // Factor 4: Purchase velocity (last 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentPurchases = await Transaction.countDocuments({
    buyer: buyerId,
    createdAt: { $gte: oneDayAgo },
  });
  if (recentPurchases > RISK_THRESHOLDS.HIGH_VELOCITY_PURCHASES_PER_DAY) {
    score += 20;
    factors.push(`high_velocity_${recentPurchases}_purchases_24h`);
  }
  
  // Factor 5: Strike history
  const strikes = buyer.stats?.strikes || 0;
  if (strikes > 0) {
    score += strikes * 15;
    factors.push(`${strikes}_strikes`);
  }
  
  // Cap score at 100
  score = Math.min(100, score);
  
  // Determine risk level
  let risk = 'low';
  if (score >= 70) risk = 'high';
  else if (score >= 40) risk = 'medium';
  
  // Save updated stats
  await buyer.save();
  
  return { score, risk, factors };
};

/**
 * Assess transaction risk
 * 
 * Combines seller and buyer risk scores with transaction-specific factors
 */
const assessTransactionRisk = async (buyerId, sellerId, amount) => {
  const [sellerRisk, buyerRisk] = await Promise.all([
    calculateSellerRiskScore(sellerId),
    calculateBuyerRiskScore(buyerId),
  ]);
  
  let score = (sellerRisk.score + buyerRisk.score) / 2;
  const factors = [...sellerRisk.factors, ...buyerRisk.factors];
  
  // Transaction-specific factors
  if (amount >= RISK_THRESHOLDS.VERY_HIGH_VALUE_THRESHOLD) {
    score += 20;
    factors.push(`very_high_value_$${amount}`);
  } else if (amount >= RISK_THRESHOLDS.HIGH_VALUE_THRESHOLD) {
    score += 10;
    factors.push(`high_value_$${amount}`);
  }
  
  score = Math.min(100, Math.round(score));
  
  let risk = 'low';
  let action = 'approve';
  
  if (score >= 70) {
    risk = 'high';
    action = 'review'; // Flag for manual review
  } else if (score >= 40) {
    risk = 'medium';
    action = 'monitor'; // Allow but monitor closely
  }
  
  return {
    score,
    risk,
    action,
    factors,
    sellerRisk,
    buyerRisk,
  };
};

/**
 * Check for return abuse
 * 
 * Returns true if buyer shows signs of return abuse
 */
const checkReturnAbuse = async (buyerId) => {
  const buyer = await User.findById(buyerId);
  if (!buyer) return { isAbusive: false, reason: 'buyer_not_found' };
  
  const totalPurchases = buyer.stats?.totalPurchases || 0;
  if (totalPurchases < RISK_THRESHOLDS.MIN_PURCHASES_FOR_RATE) {
    return { isAbusive: false, reason: 'insufficient_history' };
  }
  
  const returns = await Transaction.countDocuments({
    buyer: buyerId,
    status: { $in: ['refunded', 'return_delivered', 'return_requested'] },
  });
  
  const returnRate = returns / totalPurchases;
  
  if (returnRate > RISK_THRESHOLDS.HIGH_RETURN_RATE) {
    return {
      isAbusive: true,
      reason: 'high_return_rate',
      returnRate,
      totalReturns: returns,
      totalPurchases,
      message: `Return rate ${(returnRate * 100).toFixed(1)}% exceeds threshold ${(RISK_THRESHOLDS.HIGH_RETURN_RATE * 100)}%`,
    };
  }
  
  return { isAbusive: false, returnRate, totalReturns: returns, totalPurchases };
};

module.exports = {
  RISK_THRESHOLDS,
  calculateSellerRiskScore,
  calculateBuyerRiskScore,
  assessTransactionRisk,
  checkReturnAbuse,
};