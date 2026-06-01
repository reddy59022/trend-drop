// Enterprise Order Lifecycle Configuration
// Strict state machine with auto-advancement
// No manual status updates allowed - only system transitions

const orderStates = {
  PENDING: 'pending',
  PAID: 'paid',
  PROCESSING: 'processing',
  CANCELLED_BY_BUYER: 'cancelled_by_buyer',
  CANCELLED_BY_SELLER: 'cancelled_by_seller',
  SHIPPED: 'shipped',
  IN_TRANSIT: 'in_transit',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  BUYER_CONFIRMED: 'buyer_confirmed',
  COMPLETED: 'completed',
  RETURN_REQUESTED: 'return_requested',
  RETURN_ACCEPTED: 'return_accepted',
  RETURN_REJECTED: 'return_rejected',
  RETURN_IN_TRANSIT: 'return_in_transit',
  RETURN_DELIVERED: 'return_delivered',
  REFUNDED: 'refunded',
  DISPUTED: 'disputed',
  DISPUTE_RESOLVED: 'dispute_resolved',
};

// Strict state machine: only these transitions are allowed
const allowedTransitions = {
  [orderStates.PAID]: [orderStates.PROCESSING, orderStates.CANCELLED_BY_BUYER, orderStates.CANCELLED_BY_SELLER],
  [orderStates.PROCESSING]: [orderStates.SHIPPED, orderStates.CANCELLED_BY_SELLER],
  [orderStates.SHIPPED]: [orderStates.IN_TRANSIT],
  [orderStates.IN_TRANSIT]: [orderStates.OUT_FOR_DELIVERY, orderStates.DELIVERED],
  [orderStates.OUT_FOR_DELIVERY]: [orderStates.DELIVERED],
  [orderStates.DELIVERED]: [orderStates.BUYER_CONFIRMED, orderStates.RETURN_REQUESTED, orderStates.DISPUTED],
  [orderStates.BUYER_CONFIRMED]: [orderStates.COMPLETED, orderStates.RETURN_REQUESTED],
  [orderStates.COMPLETED]: [orderStates.RETURN_REQUESTED, orderStates.DISPUTED],
  [orderStates.RETURN_REQUESTED]: [orderStates.RETURN_ACCEPTED, orderStates.RETURN_REJECTED],
  [orderStates.RETURN_ACCEPTED]: [orderStates.RETURN_IN_TRANSIT],
  [orderStates.RETURN_IN_TRANSIT]: [orderStates.RETURN_DELIVERED],
  [orderStates.RETURN_DELIVERED]: [orderStates.REFUNDED, orderStates.DISPUTED],
  [orderStates.DISPUTED]: [orderStates.DISPUTE_RESOLVED, orderStates.REFUNDED],
};

// Time windows (milliseconds)
const timeWindows = {
  BUYER_CONFIRM_DELIVERY: 3 * 24 * 60 * 60 * 1000,   // 3 days to confirm
  RETURN_WINDOW: 5 * 24 * 60 * 60 * 1000,             // 5 days to request return
  SELLER_RESPOND_RETURN: 3 * 24 * 60 * 60 * 1000,     // 3 days for seller response
  RETURN_SHIP_WINDOW: 7 * 24 * 60 * 60 * 1000,        // 7 days to ship return
  DISPUTE_WINDOW: 14 * 24 * 60 * 60 * 1000,           // 14 days to dispute
  AUTO_COMPLETE: 3 * 24 * 60 * 60 * 1000,             // Auto-complete 3 days after confirm
  PAYOUT_HOLD_FROM_DELIVERY: 5 * 24 * 60 * 60 * 1000, // CRITICAL: Hold funds 5 days from delivery (return window)
  CANCELLATION_WINDOW: 24 * 60 * 60 * 1000,           // 24h cancel window
  NEW_SELLER_HOLD: 14 * 24 * 60 * 60 * 1000,          // New seller: hold first 5 sales for 14 days
  NEW_SELLER_THRESHOLD: 5,                              // First 5 sales subject to hold
  SELLER_RESERVE_PERCENT: 0.10,                         // 10% rolling reserve
  SELLER_RESERVE_HOLD_DAYS: 60 * 24 * 60 * 60 * 1000,  // Reserve held 60 days
};

// Cancellation rules
const cancellationRules = {
  buyer: {
    beforeShipment: { allowed: true, refundPercent: 100, shippingRefund: true },
    afterShipment: { allowed: false, reason: 'Item already shipped. Please initiate a return instead.' },
    afterDelivery: { allowed: false, reason: 'Item delivered. Please initiate a return within 5 days.' },
  },
  seller: {
    beforeShipment: { allowed: true, refundPercent: 100, shippingRefund: true, sellerPenalty: true },
    afterShipment: { allowed: false, reason: 'Cannot cancel after shipment. Must fulfill order.' },
  },
};

// Refund calculation rules
const refundRules = {
  cancelledBeforeShipment: {
    buyerRefund: 100, shippingRefund: true, platformFeeRefund: 100,
    description: 'Full refund - order cancelled before shipment',
  },
  cancelledAfterShipment: {
    buyerRefund: 100, shippingRefund: false, platformFeeRefund: 100, sellerPenalty: true,
    description: 'Full refund minus return shipping costs',
  },
  returnAccepted: {
    buyerRefund: 100, shippingRefund: false, platformFeeRefund: 100, returnShippingPaidBy: 'buyer',
    description: 'Full refund after return received and inspected',
  },
  returnRejected: { buyerRefund: 0, description: 'Return rejected - item not eligible' },
  disputeResolved_buyer: { buyerRefund: 100, shippingRefund: true, platformFeeRefund: 100 },
  disputeResolved_seller: { buyerRefund: 0 },
};

const returnEligibility = {
  withinWindow: true,
  conditions: {
    'New with tags': { returnable: true, condition: 'Original condition with tags' },
    'New without tags': { returnable: true, condition: 'Original condition' },
    'Good': { returnable: true, condition: 'Same condition as sold' },
    'Fair': { returnable: true, condition: 'Same condition as sold' },
    'Poor': { returnable: false, reason: 'Poor condition items not eligible for return' },
  },
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

const evidenceRequirements = {
  seller: {
    packingVideo: { recommended: true, description: 'Record packing video as proof of condition' },
    packingPhotos: { required: true, description: 'Photos of item condition, packaging, label', count: 3 },
    trackingProof: { required: true, description: 'Keep shipping receipt with tracking number' },
  },
  buyer: {
    unboxingVideo: { recommended: true, description: 'Record unboxing as proof of condition' },
    unboxingPhotos: { required: true, description: 'Photos of item on arrival', count: 3 },
    returnPackingProof: { required: true, description: 'If returning, record packing' },
  },
  storagePolicy: { maxFiles: 10, maxFileSize: 10 * 1024 * 1024, acceptedFormats: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'], retentionPeriod: '90 days' },
};

const disputeProcess = {
  steps: [
    { step: 1, name: 'Filing', description: 'Either party files a dispute with evidence' },
    { step: 2, name: 'Response', description: 'Other party has 48 hours to respond' },
    { step: 3, name: 'Review', description: 'Platform reviews evidence (1-3 business days)' },
    { step: 4, name: 'Resolution', description: 'Decision made, funds distributed accordingly' },
  ],
  timeLimit: 14 * 24 * 60 * 60 * 1000,
  responseWindow: 48 * 60 * 60 * 1000,
  evidenceRequired: true,
  maxEvidenceFiles: 10,
};

const isValidTransition = (fromState, toState) => {
  const allowed = allowedTransitions[fromState];
  return allowed ? allowed.includes(toState) : false;
};

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