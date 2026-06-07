/**
 * Calculates skip and limit for database queries
 * @param {number|string} page - Current page number
 * @param {number|string} limit - Number of items per page
 * @returns {Object} { page, limit, skip }
 */
export const getPaginationOptions = (page = 1, limit = 10) => {
    const pageNumber = Math.max(1, parseInt(page, 10) || 1);
    const limitNumber = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (pageNumber - 1) * limitNumber;

    return { page: pageNumber, limit: limitNumber, skip };
};

/**
 * Generates standardized pagination metadata for API responses
 * @param {number} totalItems - Total count of items in DB
 * @param {number} page - Current page number
 * @param {number} limit - Items per page
 * @returns {Object} Standardized pagination metadata
 */
export const getPaginationMetadata = (totalItems, page, limit) => {
    const totalPages = Math.ceil(totalItems / limit);
    
    return {
        totalItems,
        totalPages,
        currentPage: page,
        itemsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
    };
};
