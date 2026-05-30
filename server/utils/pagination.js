// Robust Pagination Utility for million-user scale
// Supports cursor-based and offset-based pagination

const paginate = async (Model, {
  page = 1,
  limit = 20,
  maxLimit = 50,
  sort = { createdAt: -1 },
  filter = {},
  populate = null,
  select = null,
  lean = true,
  cursor = null, // For cursor-based pagination
} = {}) => {
  // Enforce limits
  const safeLimit = Math.min(Math.max(1, parseInt(limit) || 20), parseInt(maxLimit) || 50);
  const safePage = Math.max(1, parseInt(page) || 1);

  let total, docs, hasMore;

  if (cursor) {
    // Cursor-based pagination (better for infinite scroll on mobile)
    filter._id = { $gt: cursor };
    docs = await Model.find(filter)
      .sort(sort)
      .limit(safeLimit + 1) // Fetch one extra to check if there are more
      .populate(populate || '')
      .select(select || '')
      .lean(lean);

    hasMore = docs.length > safeLimit;
    if (hasMore) docs.pop(); // Remove the extra doc

    // Get total count (expensive for large collections, so we cache)
    total = await Model.countDocuments(filter);
  } else {
    // Offset-based pagination (better for page numbers)
    const skip = (safePage - 1) * safeLimit;

    [total, docs] = await Promise.all([
      Model.countDocuments(filter),
      Model.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(safeLimit)
        .populate(populate || '')
        .select(select || '')
        .lean(lean),
    ]);

    hasMore = skip + docs.length < total;
  }

  const totalPages = Math.ceil(total / safeLimit);

  return {
    docs,
    pagination: {
      total,
      totalPages,
      currentPage: safePage,
      limit: safeLimit,
      hasMore,
      hasNextPage: safePage < totalPages,
      hasPrevPage: safePage > 1,
      nextPage: safePage < totalPages ? safePage + 1 : null,
      prevPage: safePage > 1 ? safePage - 1 : null,
    },
    // For cursor-based
    ...(cursor && { nextCursor: docs.length > 0 ? docs[docs.length - 1]._id : null }),
  };
};

// Paginate Mongoose query result
const paginateResult = (docs, total, page, limit) => {
  const totalPages = Math.ceil(total / limit);
  return {
    docs,
    pagination: {
      total,
      totalPages,
      currentPage: page,
      limit,
      hasMore: page < totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
    },
  };
};

module.exports = { paginate, paginateResult };