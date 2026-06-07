/**
 * Utility to strip sensitive fields from documents before sending in response.
 * Useful when you forget to use .select('-password') in Mongoose.
 * @param {Object} document - Mongoose document or plain object
 * @param {Array<string>} fieldsToRemove - Array of field names to remove
 * @returns {Object} Sanitized object
 */
export const removeSensitiveFields = (document, fieldsToRemove = ['password_hash', 'refresh_token']) => {
    if (!document) return null;
    
    // Convert Mongoose document to plain JS object if necessary
    const obj = document.toObject ? document.toObject() : { ...document };
    
    fieldsToRemove.forEach(field => {
        delete obj[field];
    });
    
    return obj;
};
