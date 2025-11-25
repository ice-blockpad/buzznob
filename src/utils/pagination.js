/**
 * Pagination Utility
 * Industry-standard pagination helpers with security protections
 * Supports both cursor-based (recommended) and offset-based pagination
 */

// Maximum limit to prevent abuse and database overload
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/**
 * Parse and validate pagination parameters from request
 * @param {Object} req - Express request object
 * @param {Object} options - Configuration options
 * @param {number} options.maxLimit - Maximum allowed limit (default: 100)
 * @param {number} options.defaultLimit - Default limit if not provided (default: 20)
 * @returns {Object} - { limit, offset, cursor, hasOffset, hasCursor }
 */
function parsePaginationParams(req, options = {}) {
  const maxLimit = options.maxLimit || MAX_LIMIT;
  const defaultLimit = options.defaultLimit || DEFAULT_LIMIT;

  // Parse limit with hard cap
  const requestedLimit = parseInt(req.query.limit) || defaultLimit;
  const limit = Math.min(Math.max(1, requestedLimit), maxLimit); // Clamp between 1 and maxLimit

  // Log warning if user tried to exceed max limit
  if (requestedLimit > maxLimit) {
    console.warn(`[PAGINATION] User ${req.user?.id || 'anonymous'} requested limit ${requestedLimit}, capped to ${maxLimit}`);
  }

  // Parse cursor (for cursor-based pagination)
  // Cursor can be an ID (number) or timestamp (string), so we keep it as string if it's not a number
  let cursor = null;
  if (req.query.cursor) {
    const parsed = parseInt(req.query.cursor);
    cursor = isNaN(parsed) ? req.query.cursor : parsed;
  }

  // Parse offset (for offset-based pagination, backward compatibility)
  const offset = req.query.offset !== undefined ? Math.max(0, parseInt(req.query.offset) || 0) : null;
  const page = req.query.page ? Math.max(1, parseInt(req.query.page) || 1) : null;
  const calculatedOffset = offset !== null ? offset : (page ? (page - 1) * limit : 0);

  // Determine which pagination method to use
  const hasCursor = cursor !== null;
  const hasOffset = offset !== null || page !== null;

  return {
    limit,
    offset: calculatedOffset,
    cursor,
    page,
    hasOffset,
    hasCursor,
    maxLimit
  };
}

/**
 * Build Prisma query options for cursor-based pagination
 * @param {Object} params - Pagination parameters from parsePaginationParams
 * @param {string} cursorField - Field name to use for cursor (default: 'id')
 * @param {string} orderDirection - 'asc' or 'desc' (default: 'desc')
 * @returns {Object} - Prisma query options { where, orderBy, take }
 */
function buildCursorQuery(params, cursorField = 'id', orderDirection = 'desc') {
  const { limit, cursor } = params;

  const where = cursor ? {
    [cursorField]: orderDirection === 'desc' 
      ? { lt: cursor }  // For DESC: get records with id < cursor
      : { gt: cursor }  // For ASC: get records with id > cursor
  } : {};

  const orderBy = {
    [cursorField]: orderDirection
  };

  // Fetch limit + 1 to check if there are more items
  return {
    where,
    orderBy,
    take: limit + 1
  };
}

/**
 * Build Prisma query options for offset-based pagination
 * @param {Object} params - Pagination parameters from parsePaginationParams
 * @param {string} orderField - Field name to order by (default: 'id')
 * @param {string} orderDirection - 'asc' or 'desc' (default: 'desc')
 * @returns {Object} - Prisma query options { orderBy, skip, take }
 */
function buildOffsetQuery(params, orderField = 'id', orderDirection = 'desc') {
  const { limit, offset } = params;

  return {
    orderBy: {
      [orderField]: orderDirection
    },
    skip: offset,
    take: limit
  };
}

/**
 * Generate pagination response metadata
 * @param {Array} data - The fetched data array
 * @param {Object} params - Pagination parameters
 * @param {string} cursorField - Field name used for cursor (default: 'id')
 * @returns {Object} - Pagination metadata
 */
function buildPaginationResponse(data, params, cursorField = 'id') {
  const { limit, offset, cursor, page, hasCursor, hasOffset } = params;
  const hasMore = data.length === limit;

  // Cursor-based pagination response
  if (hasCursor || (!hasOffset && !hasCursor)) {
    const lastItem = data.length > 0 ? data[data.length - 1] : null;
    const nextCursor = hasMore && lastItem ? lastItem[cursorField] : null;

    return {
      data,
      limit,
      nextCursor,
      hasMore
    };
  }

  // Offset-based pagination response (backward compatibility)
  const nextOffset = hasMore ? offset + limit : null;

  return {
    data,
    limit,
    offset,
    nextOffset,
    page: page || Math.floor(offset / limit) + 1,
    hasMore
  };
}

/**
 * Generate pagination response with total count (for offset-based pagination)
 * @param {Array} data - The fetched data array
 * @param {Object} params - Pagination parameters
 * @param {number} totalCount - Total number of records
 * @returns {Object} - Pagination metadata with total count
 */
function buildPaginationResponseWithTotal(data, params, totalCount) {
  const { limit, offset, page } = params;
  const hasMore = data.length === limit;
  const totalPages = Math.ceil(totalCount / limit);

  return {
    data,
    limit,
    offset,
    nextOffset: hasMore ? offset + limit : null,
    page: page || Math.floor(offset / limit) + 1,
    total: totalCount,
    totalPages,
    hasMore
  };
}

module.exports = {
  MAX_LIMIT,
  DEFAULT_LIMIT,
  parsePaginationParams,
  buildCursorQuery,
  buildOffsetQuery,
  buildPaginationResponse,
  buildPaginationResponseWithTotal
};

