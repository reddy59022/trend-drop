/**
 * Return labels are purchased through the same EasyPost account as outbound
 * labels. There is no Shippo/USPS-direct fallback: in production a missing
 * EasyPost credential fails closed, and the seller approval endpoint surfaces
 * the error instead of approving a return without a label.
 */
const mongoose = require('mongoose');
const { createShippingLabel } = require('./easypostService');

const isPopulated = (value) => !!value && !(value instanceof mongoose.Types.ObjectId);

const generateReturnLabel = async (returnRequest) => {
  if (!returnRequest) throw new Error('returnRequest is required');
  // ObjectIds are truthy; checking only for presence skipped population and
  // then failed with "seller address incomplete". Require real documents.
  if (!isPopulated(returnRequest.listing) || !isPopulated(returnRequest.seller) || !isPopulated(returnRequest.buyer)) {
    const Return = require('../models/Return');
    returnRequest = await Return.findById(returnRequest._id)
      .populate('listing', 'title images weight returnPackage price')
      .populate('seller', 'name email phone shippingAddress')
      .populate('buyer', 'name email phone shippingAddress');
  }

  const listing = returnRequest.listing || {};
  const buyer = returnRequest.buyer || {};
  const seller = returnRequest.seller || {};
  const buyerAddress = buyer.shippingAddress || {};
  const sellerAddress = seller.shippingAddress || {};

  const label = await createShippingLabel({
    fromAddress: {
      name: buyer.name || buyerAddress.fullName,
      street1: buyerAddress.street1 || buyerAddress.street,
      street2: buyerAddress.street2,
      city: buyerAddress.city,
      state: buyerAddress.state,
      postalCode: buyerAddress.postalCode || buyerAddress.zip,
      country: buyerAddress.country || 'US',
      phone: buyer.phone || buyerAddress.phone,
      email: buyer.email,
    },
    toAddress: {
      name: seller.name || sellerAddress.fullName,
      street1: sellerAddress.street1 || sellerAddress.street,
      street2: sellerAddress.street2,
      city: sellerAddress.city,
      state: sellerAddress.state,
      postalCode: sellerAddress.postalCode || sellerAddress.zip,
      country: sellerAddress.country || 'US',
      phone: seller.phone || sellerAddress.phone,
      email: seller.email,
    },
    weightKg: listing.weight || 1,
    parcel: {
      length: listing.returnPackage?.length || 10,
      width: listing.returnPackage?.width || 8,
      height: listing.returnPackage?.height || 4,
      weight: (listing.weight || 1) * 35.27396195,
    },
    reference: `return:${returnRequest._id}`,
    declaredValue: listing.price || 0,
  });

  return {
    trackingNumber: label.trackingNumber,
    labelUrl: label.labelUrl,
    carrier: label.carrier,
    service: label.service,
    label: `${label.carrier} ${label.service}`.trim(),
    cost: label.cost,
    provider: label.provider,
    shipmentId: label.shipmentId,
    trackerId: label.trackerId,
    mock: label.provider === 'mock',
  };
};

module.exports = { generateReturnLabel };
