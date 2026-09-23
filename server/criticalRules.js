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
  isValidMoneyInput,
  isPositiveIntegerQuantity,
  isValidInventoryQuantity,
  isValidAutoReorderPatch,
  isSuspendedRole,
};
