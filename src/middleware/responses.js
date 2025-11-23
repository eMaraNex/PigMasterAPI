import logger from './logger.js';

/**
 * Helper function to standardize success responses
 * @param {Object} res - Express response object
 * @param {number} [statusCode=200] - HTTP status code (defaults to 200)
 * @param {string} [message] - Optional success message
 * @param {Object|Array} [data] - Data to include in the response
 * @returns {void}
 */
export const SuccessResponse = (res, statusCode = 200, message, data) => {
    try {
        const response = {
            success: true,
            ...(message && { message }), // Include message only if provided
            ...(data !== undefined && { data }) // Include data only if provided
        };

        logger.info(`Success response: ${JSON.stringify(response)}`);
        res.status(statusCode).json(response);
    } catch (error) {
        logger.error(`Error in SuccessResponse: ${error.message}`);
        res.status(500).json({
            success: false,
            message: `Internal server error: ${error.message}`
        });
    }
};