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
  const requestedPage = Math.max(1, parseInt(page) || 1);

  let total, docs, hasMore, effectivePage;

  if (cursor) {
    // Cursor-based pagination (better for infinite scroll on mobile).
    // NEVER mutate the caller's filter — it is reused across every page of an
    // infinite scroll. Build a separate query filter with the cursor bound.
    const cursorFilter = { ...filter, _id: { $gt: cursor } };
    docs = await Model.find(cursorFilter)
      .sort(sort)
      .limit(safeLimit + 1) // Fetch one extra to check if there are more
      .populate(populate || '')
      .select(select || '')
      .lean(lean);

    hasMore = docs.length > safeLimit;
    if (hasMore) docs.pop(); // Remove the extra doc

    // total is the TOTAL number of items matching the caller's filter (NOT
    // the post-cursor remainder), so a UI can render a stable 1-20 of N
    // while scrolling instead of watching N shrink on every page.
    total = await Model.countDocuments(filter);
    effectivePage = 1; // Cursor-based doesn't use page numbers
  } else {
    // Offset-based pagination (better for page numbers)
    // CRITICAL FIX: First get total count to calculate totalPages
    total = await Model.countDocuments(filter);
    
    // Calculate totalPages and clamp page to valid range
    const totalPages = Math.ceil(total / safeLimit);
    effectivePage = Math.min(requestedPage, Math.max(1, totalPages));
    
    // Now fetch documents with the clamped page
    const skip = (effectivePage - 1) * safeLimit;
    
    docs = await Model.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(safeLimit)
      .populate(populate || '')
      .select(select || '')
      .lean(lean);

    hasMore = skip + docs.length < total;
  }

  const totalPages = Math.ceil(total / safeLimit);

  return {
    docs,
    pagination: {
      total,
      totalPages,
      currentPage: effectivePage,
      limit: safeLimit,
      hasMore,
      hasNextPage: effectivePage < totalPages,
      hasPrevPage: effectivePage > 1,
      nextPage: effectivePage < totalPages ? effectivePage + 1 : null,
      prevPage: effectivePage > 1 ? effectivePage - 1 : null,
    },
    // For cursor-based
    ...(cursor && { nextCursor: docs.length > 0 ? docs[docs.length - 1]._id : null }),
  };
};

// Paginate Mongoose query result
const paginateResult = (docs, total, page, limit) => {
  const totalPages = Math.ceil(total / limit);
  // CRITICAL FIX: Clamp page to valid range
  const effectivePage = Math.min(page, Math.max(1, totalPages));
  
  return {
    docs,
    pagination: {
      total,
      totalPages,
      currentPage: effectivePage,
      limit,
      hasMore: effectivePage < totalPages,
      hasNextPage: effectivePage < totalPages,
      hasPrevPage: effectivePage > 1,
      nextPage: effectivePage < totalPages ? effectivePage + 1 : null,
      prevPage: effectivePage > 1 ? effectivePage - 1 : null,
    },
  };
};

module.exports = { paginate, paginateResult };