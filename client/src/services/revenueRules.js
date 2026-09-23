export const roundMoney = (value) => Math.round(Number(value) * 100) / 100;

export const normalizeQuantity = (value) => (
  Number.isInteger(value) && value > 0 ? value : 1
);

export const calculateBuyerLine = (breakdown, quantity = 1) => {
  const qty = normalizeQuantity(quantity);
  const buyer = breakdown?.buyer || {};
  const itemPrice = Number(buyer.itemPrice) || 0;
  const shippingCost = Number(buyer.shippingCost) || 0;
  const protectionFee = Number(buyer.buyerProtectionFee) || 0;
  return {
    itemPrice: itemPrice * qty,
    shippingCost,
    protectionFee: protectionFee * qty,
    total: roundMoney(itemPrice * qty + shippingCost + protectionFee * qty),
  };
};

export const calculateSellerNet = (itemPrice, platformFee, boostFee = 0) => (
  roundMoney(Math.max(0, Number(itemPrice) - Number(platformFee) - Number(boostFee)))
);

export const calculateBuyerTotal = (itemPrice, shippingCost, protectionFee, discount = 0) => (
  roundMoney(Math.max(0, Number(itemPrice) + Number(shippingCost) + Number(protectionFee) - Number(discount)))
);

export const calculatePlatformNet = (platformFee, protectionFee, providerFee) => (
  roundMoney(Number(platformFee) + Number(protectionFee) - Number(providerFee))
);

export const reconcileItemLedger = ({
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

export const calculateRefundSettlement = ({ totalPaid, sellerEarnings, inventoryQuantity = 1 }) => ({
  buyerRefund: roundMoney(Math.max(0, Number(totalPaid))),
  sellerClawback: roundMoney(Math.max(0, Number(sellerEarnings))),
  restoredQuantity: Number.isInteger(inventoryQuantity) && inventoryQuantity > 0 ? inventoryQuantity : 1,
});

export const calculateDiscountedSellerNet = (itemPrice, platformFeePercent, discount = 0) => {
  const discountedSubtotal = roundMoney(Math.max(0, Number(itemPrice) - Number(discount)));
  const platformFee = roundMoney(discountedSubtotal * (Number(platformFeePercent) / 100));
  return {
    discountedSubtotal,
    platformFee,
    sellerEarnings: calculateSellerNet(discountedSubtotal, platformFee),
  };
};
