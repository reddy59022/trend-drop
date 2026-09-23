const roundMoney = (value) => Math.round(Number(value) * 100) / 100;

const calculateSellerNet = (itemPrice, platformFee, boostFee = 0) =>
  roundMoney(Math.max(0, Number(itemPrice) - Number(platformFee) - Number(boostFee)));

const calculateBuyerTotal = (itemPrice, shippingCost, buyerProtectionFee, discount = 0) =>
  roundMoney(Math.max(0, Number(itemPrice) + Number(shippingCost) + Number(buyerProtectionFee) - Number(discount)));

const calculatePlatformNet = (platformFee, buyerProtectionFee, providerFee) =>
  roundMoney(Number(platformFee) + Number(buyerProtectionFee) - Number(providerFee));

const allocateDiscountedSellerNet = (itemPrice, platformFeePercent, discount = 0) => {
  const discountedSubtotal = roundMoney(Math.max(0, Number(itemPrice) - Number(discount)));
  const platformFee = roundMoney(discountedSubtotal * (Number(platformFeePercent) / 100));
  return {
    discountedSubtotal,
    platformFee,
    sellerEarnings: calculateSellerNet(discountedSubtotal, platformFee),
  };
};

const reconcileItemLedger = ({
  itemPrice,
  shippingCost = 0,
  buyerProtectionFee = 0,
  platformFee = 0,
  boostFee = 0,
  providerFee = 0,
  discount = 0,
}) => {
  const discountedItem = roundMoney(Math.max(0, Number(itemPrice) - Number(discount)));
  const customerCharge = calculateBuyerTotal(discountedItem, shippingCost, buyerProtectionFee);
  const sellerEarnings = calculateSellerNet(discountedItem, platformFee, boostFee);
  const platformGross = roundMoney(Number(platformFee) + Number(buyerProtectionFee));
  const platformNet = calculatePlatformNet(platformFee, buyerProtectionFee, providerFee);
  return {
    discountedItem,
    customerCharge,
    sellerEarnings,
    platformGross,
    platformNet,
    itemLedger: roundMoney(sellerEarnings + Number(platformFee) + Number(boostFee)),
  };
};

const calculateRefundSettlement = ({ totalPaid, sellerEarnings, inventoryQuantity = 1 }) => ({
  buyerRefund: roundMoney(Math.max(0, Number(totalPaid))),
  sellerClawback: roundMoney(Math.max(0, Number(sellerEarnings))),
  restoredQuantity: Number.isInteger(inventoryQuantity) && inventoryQuantity > 0 ? inventoryQuantity : 1,
});

const isValidMoneyInput = (value, max) => {
  if (typeof value !== 'number') return false;
  if (!Number.isFinite(value)) return false;
  if (value < 0) return false;
  return value <= max;
};

const isPositiveIntegerQuantity = (value) => {
  if (typeof value !== 'number') return false;
  if (!Number.isFinite(value)) return false;
  if (!Number.isInteger(value)) return false;
  return value >= 1;
};

const isValidInventoryQuantity = (value) => {
  if (!Number.isFinite(value)) return false;
  if (value < 0) return false;
  return value <= 1000000;
};

const isValidAutoReorderPatch = ({ enabled, quantity, supplier }) => {
  if (enabled !== undefined && typeof enabled !== 'boolean') return false;
  if (quantity !== undefined) {
    if (typeof quantity !== 'number') return false;
    if (!Number.isFinite(quantity)) return false;
  }
  if (supplier !== undefined && supplier !== null && typeof supplier !== 'string') return false;
  return true;
};

const isSuspendedRole = (role) => role === 'suspended';

module.exports = {
  roundMoney,
  calculateSellerNet,
  calculateBuyerTotal,
  calculatePlatformNet,
  allocateDiscountedSellerNet,
  reconcileItemLedger,
  calculateRefundSettlement,
  isValidMoneyInput,
  isPositiveIntegerQuantity,
  isValidInventoryQuantity,
  isValidAutoReorderPatch,
  isSuspendedRole,
};
