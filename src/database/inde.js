import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const { Pool } = pg;

// Minimal PostgreSQL configuration for local connection
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'karagani_farm_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD === 'undefined' || process.env.DB_PASSWORD === '' ? undefined : process.env.DB_PASSWORD,
};

// Create a connection pool
export const pool = new Pool(dbConfig);

// Test the connection on startup
(async () => {
    try {
        const client = await pool.connect();
        console.log('Connected to PostgreSQL successfully');
        client.release();
    } catch (error) {
        console.error('Failed to connect to PostgreSQL:', error.message);
        process.exit(1); // Exit if connection fails
    }
})();