import logger from '../middleware/logger.js';

export const runSetUp = async (req, res) => {
    try {
        logger.info('Database setup endpoint is disabled in favor of node-pg-migrate');
        return res.status(200).json({ message: 'Use npm run migrate for database setup' });
    } catch (error) {
        logger.error('Database setup failed:', error.message);
        return res.status(500).json({ error: 'Database setup failed', details: error.message });
    }
};