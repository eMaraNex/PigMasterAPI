import runMigrations from "./migrate.js";
import logger from '../middleware/logger.js';

export const runSetUp = async (req, res) => {
    try {
        await runMigrations();
        logger.info('Database setup completed successfully');
        return res.status(200).json({ message: 'Database migrations and seeding completed successfully' });
    } catch (error) {
        logger.error('Database setup failed:', error.message);
        return res.status(500).json({ error: 'Database setup failed', details: error.message });
    }
};