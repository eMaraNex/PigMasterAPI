import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const { Pool } = pg;

const dbConfig = {};

if (process.env.NODE_ENV === 'production') {
    dbConfig.connectionString = process.env.DATABASE_URL;
    dbConfig.ssl = false;
    dbConfig.sslmode = 'disable';
} else {
    dbConfig.host = process.env.DB_HOST || 'localhost';
    dbConfig.port = parseInt(process.env.DB_PORT) || 5432;
    dbConfig.database = process.env.DB_NAME || 'karagani-db';
    dbConfig.user = process.env.DB_USER || 'postgres';
    dbConfig.password = process.env.DB_PASSWORD;
}

if (process.env.NODE_ENV !== 'production' && process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL is set in development. This might connect to production. Please remove DATABASE_URL from your environment.');
    process.exit(1);
}

dbConfig.max = 1; // Reduced for serverless
dbConfig.min = 0; // No minimum connections
dbConfig.idleTimeoutMillis = 10000; // 10 seconds
dbConfig.connectionTimeoutMillis = 60000; // 60 seconds
dbConfig.acquireTimeoutMillis = 60000; // 60 seconds
dbConfig.createTimeoutMillis = 60000; // 60 seconds
dbConfig.destroyTimeoutMillis = 5000; // 5 seconds
dbConfig.createRetryIntervalMillis = 200;
dbConfig.propagateCreateError = false;

export const pool = new Pool(dbConfig);

// Test the connection on startup - ONLY IN DEVELOPMENT
if (process.env.NODE_ENV !== 'production') {
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
}

// Database helper class for executing queries and transactions
export class DatabaseHelper {
    static async executeQuery(query, params = []) {
        const client = await pool.connect();
        try {
            const result = await client.query(query, params);
            return result;
        } catch (error) {
            console.error('Database query error:', { query, params, error: error.message });
            throw error;
        } finally {
            client.release();
        }
    }

    static async executeTransaction(queries) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const results = [];

            for (const { query, params } of queries) {
                const result = await client.query(query, params);
                results.push(result);
            }

            await client.query('COMMIT');
            return results;
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Transaction error:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async getConnection() {
        return await pool.connect();
    }
}