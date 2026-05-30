// Enterprise Order Lifecycle Configuration
// Handles cancellations, returns, refunds, dispute resolution

// Order statuses with strict state machine transitions
const orderStates = {
  // Pre-payment
  PENDING: 'pending',
  PAID: 'paid',

  // Post-payment, pre-shipping
  PROCESSING: 'processing',
  CANCELLED_BY_BUYER: 'cancelled_by_buyer',
  CANCELLED_BY_SELLER: 'cancelled_by_seller',

  // Shipping
  SHIPPED: 'shipped',
  IN_TRANSIT: 'in_transit',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',

  // Post-delivery
  BUYER_CONFIRMED: 'buyer_confirmed', // Buyer confirms receipt
  COMPLETED: 'completed', // Funds released to seller

  // Return flow
  RETURN_REQUESTED: 'return_requested',
  RETURN_ACCEPTED: 'return_accepted',
  RETURN_REJECTED: 'return_rejected',
  RETURN_IN_TRANSIT: 'return_in_transit',
  RETURN_DELIVERED: 'return_delivered',
  REFUNDED: 'refunded',

  // Dispute
  DISPUTED: 'disputed',
  DISPUTE_RESOLVED: 'dispute_resolved',
};

// Allowed state transitions (strict state machine)
const allowedTransitions = {
  [orderStates.PAID]: [orderStates.PROCESSING, orderStates.CANCELLED_BY_BUYER, orderStates.CANCELLED_BY_SELLER],
  [orderStates.PROCESSING]: [orderStates.SHIPPED, orderStates.CANCELLED_BY_SELLER],
  [orderStates.SHIPPED]: [orderStates.IN_TRANSIT],
  [orderStates.IN_TRANSIT]: [orderStates.OUT_FOR_DELIVERY, orderStates.DELIVERED],
  [orderStates.OUT_FOR_DELIVERY]: [orderStates.DELIVERED],
  [orderStates.DELIVERED]: [orderStates.BUYER_CONFIRMED, orderStates.RETURN_REQUESTED, orderStates.DISPUTED],
  [orderStates.BUYER_CONFIRMED]: [orderStates.COMPLETED, orderStates.RETURN_REQUESTED],
  [orderStates.COMPLETED]: [orderStates.RETURN_REQUESTED, orderStates.DISPUTED], // 3-day window
  [orderStates.RETURN_REQUESTED]: [orderStates.RETURN_ACCEPTED, orderStates.RETURN_REJECTED],
  [orderStates.RETURN_ACCEPTED]: [orderStates.RETURN_IN_TRANSIT],
  [orderStates.RETURN_IN_TRANSIT]: [orderStates.RETURN_DELIVERED],
  [orderStates.RETURN_DELIVERED]: [orderStates.REFUNDED, orderStates.DISPUTED],
  [orderStates.DISPUTED]: [orderStates.DISPUTE_RESOLVED, orderStates.REFUNDED],
};

// Time windows (in milliseconds)
const timeWindows = {
  BUYER_CONFIRM_DELIVERY: 3 * 24 * 60 * 60 * 1000,      // 3 days to confirm delivery
  RETURN_WINDOW: 5 * 24 * 60 * 60 * 1000,                 // 5 days to request return (from delivery)
  SELLER_RESPOND_RETURN: 3 * 24 * 60 * 60 * 1000,         // 3 days for seller to accept/reject return
  RETURN_SHIP_WINDOW: 7 * 24 * 60 * 60 * 1000,            // 7 days for buyer to ship return
  DISPUTE_WINDOW: 14 * 24 * 60 * 60 * 1000,               // 14 days to file dispute
  AUTO_COMPLETE: 3 * 24 * 60 * 60 * 1000,                 // Auto-complete 3 days after confirmation
  CANCELLATION_WINDOW: 24 * 60 * 60 * 1000,               // 24 hours to cancel before shipping
};

// Cancellation rules
const cancellationRules = {
  buyer: {
    // Can cancel freely before shipment
    beforeShipment: { allowed: true, refundPercent: 100, shippingRefund: true },
    // Can cancel after shipment with conditions
    afterShipment: { allowed: false, reason: 'Item already shipped. Please initiate a return instead.' },
    // After delivery
    afterDelivery: { allowed: false, reason: 'Item delivered. Please initiate a return within 5 days.' },
  },
  seller: {
    // Seller can cancel before shipping (with penalty)
    beforeShipment: {
      allowed: true,
      refundPercent: 100,
      shippingRefund: true,
      sellerPenalty: true, // Seller gets warning/strike
      penaltyMessage: 'Seller cancellation counts as a strike. 3 strikes = account suspension.',
    },
    // Cannot cancel after shipping
    afterShipment: { allowed: false, reason: 'Cannot cancel after shipment. Must fulfill order.' },
  },
};

// Refund calculation rules
const refundRules = {
  cancelledBeforeShipment: {
    buyerRefund: 100,        // Full refund to buyer
    shippingRefund: true,     // Shipping fee refunded
    platformFeeRefund: 100,  // Platform fee refunded
    description: 'Full refund - order cancelled before shipment',
  },
  cancelledAfterShipment: {
    buyerRefund: 100,
    shippingRefund: false,     // Buyer pays return shipping
    platformFeeRefund: 100,
    sellerPenalty: true,
    description: 'Full refund minus return shipping costs',
  },
  returnAccepted: {
    buyerRefund: 100,
    shippingRefund: false,     // Return shipping paid by buyer
    platformFeeRefund: 100,
    returnShippingPaidBy: 'buyer',
    description: 'Full refund after return received and inspected',
  },
  returnRejected: {
    buyerRefund: 0,
    description: 'Return rejected - item not eligible for return',
  },
  disputeResolved_buyer: {
    buyerRefund: 100,
    shippingRefund: true,
    platformFeeRefund: 100,
    description: 'Dispute resolved in buyer favor',
  },
  disputeResolved_seller: {
    buyerRefund: 0,
    description: 'Dispute resolved in seller favor',
  },
};

// Return eligibility criteria
const returnEligibility = {
  // Must be within return window
  withinWindow: true,
  // Item condition requirements
  conditions: {
    'New with tags': { returnable: true, condition: 'Original condition with tags attached' },
    'New without tags': { returnable: true, condition: 'Original condition, tags may be removed' },
    'Good': { returnable: true, condition: 'Same condition as sold, no damage' },
    'Fair': { returnable: true, condition: 'Same condition as sold, no significant damage' },
    'Poor': { returnable: false, reason: 'Items sold as Poor condition are not eligible for return' },
  },
  // Non-returnable items
  nonReturnable: [
    'Items without proof of purchase',
    'Items that have been altered or modified',
    'Items with damage caused by buyer',
    'Items returned outside the 5-day window',
    'Items not in original condition',
    'Intimate wear (hygiene reasons)',
    'Custom/personalized items',
  ],
};

// Evidence requirements (packing/unpacking proof)
const evidenceRequirements = {
  seller: {
    packingVideo: {
      recommended: true,
      description: 'Record a video while packing the item to prove condition before shipping',
      why: 'Protects seller against false damage claims during returns',
    },
    packingPhotos: {
      required: true,
      description: 'Take clear photos of item condition, packaging, and shipping label',
      count: 3, // Minimum photos recommended
    },
    trackingProof: {
      required: true,
      description: 'Keep shipping receipt with tracking number as proof of shipment',
    },
  },
  buyer: {
    unboxingVideo: {
      recommended: true,
      description: 'Record a video while unboxing the package to prove item condition on arrival',
      why: 'Protects buyer against item not as described claims',
    },
    unboxingPhotos: {
      required: true,
      description: 'Take clear photos of item condition upon arrival, including any damage',
      count: 3,
    },
    returnPackingProof: {
      required: true,
      description: 'If returning, record packing and keep shipping receipt',
    },
  },
  // Evidence stored on platform for dispute resolution
  storagePolicy: {
    maxFiles: 10,
    maxFileSize: 10 * 1024 * 1024, // 10MB per file
    acceptedFormats: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'],
    retentionPeriod: '90 days after transaction completion',
  },
};

// Dispute resolution process
const disputeProcess = {
  steps: [
    { step: 1, name: 'Filing', description: 'Either party files a dispute with evidence' },
    { step: 2, name: 'Response', description: 'Other party has 48 hours to respond with counter-evidence' },
    { step: 3, name: 'Review', description: 'Platform reviews all evidence (1-3 business days)' },
    { step: 4, name: 'Resolution', description: 'Decision made, funds distributed accordingly' },
  ],
  timeLimit: 14 * 24 * 60 * 60 * 1000, // 14 days to file
  responseWindow: 48 * 60 * 60 * 1000,  // 48 hours to respond
  evidenceRequired: true,
  maxEvidenceFiles: 10,
};

// Check if a state transition is valid
const isValidTransition = (fromState, toState) => {
  const allowed = allowedTransitions[fromState];
  return allowed ? allowed.includes(toState) : false;
};

// Get allowed actions for current state
const getAllowedActions = (status, role) => {
  const transitions = allowedTransitions[status] || [];
  const actions = [];

  if (role === 'buyer') {
    if (transitions.includes(orderStates.CANCELLED_BY_BUYER)) actions.push('cancel');
    if (transitions.includes(orderStates.BUYER_CONFIRMED)) actions.push('confirm_received');
    if (transitions.includes(orderStates.RETURN_REQUESTED)) actions.push('request_return');
    if (transitions.includes(orderStates.DISPUTED)) actions.push('file_dispute');
  }

  if (role === 'seller') {
    if (transitions.includes(orderStates.CANCELLED_BY_SELLER)) actions.push('cancel');
    if (transitions.includes(orderStates.SHIPPED)) actions.push('ship');
    if (transitions.includes(orderStates.RETURN_ACCEPTED)) actions.push('accept_return');
    if (transitions.includes(orderStates.RETURN_REJECTED)) actions.push('reject_return');
    if (transitions.includes(orderStates.DISPUTED)) actions.push('file_dispute');
  }

  return actions;
};

module.exports = {
  orderStates,
  allowedTransitions,
  timeWindows,
  cancellationRules,
  refundRules,
  returnEligibility,
  evidenceRequirements,
  disputeProcess,
  isValidTransition,
  getAllowedActions,
};