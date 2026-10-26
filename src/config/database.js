import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const { Pool } = pg;

// Return DATE columns as 'YYYY-MM-DD' strings. The default parser builds a local-midnight
// Date, which serialises to the previous day for users east of UTC.
pg.types.setTypeParser(1082, value => value);

const dbConfig = {};

if (process.env.NODE_ENV === 'production') {
    dbConfig.connectionString = process.env.DATABASE_URL;
    // Managed Postgres providers require TLS; set DB_SSLMODE=disable only for a private network database.
    dbConfig.ssl = process.env.DB_SSLMODE === 'disable' ? false : { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' };
} else {
    dbConfig.host = process.env.DB_HOST || 'localhost';
    dbConfig.port = parseInt(process.env.DB_PORT) || 5432;
    dbConfig.database = process.env.DB_NAME || 'karagani-db';
    dbConfig.user = process.env.DB_USER || 'postgres';
    dbConfig.password = process.env.DB_PASSWORD;
}

const hasLocalDbConfig = Boolean(process.env.DB_HOST || process.env.DB_NAME || process.env.DB_USER);

if (process.env.NODE_ENV !== 'production' && process.env.DATABASE_URL && !hasLocalDbConfig) {
    console.error('Error: DATABASE_URL is set in development without explicit local DB settings. Please remove DATABASE_URL or provide DB_HOST/DB_NAME/DB_USER.');
    process.exit(1);
}

if (process.env.NODE_ENV !== 'production' && process.env.DATABASE_URL && hasLocalDbConfig) {
    console.log('Using local DB settings from DB_* environment variables in development; ignoring DATABASE_URL.');
}

dbConfig.max = Number.parseInt(process.env.DB_POOL_MAX, 10) || 10; // Keep small (1-2) on serverless platforms via DB_POOL_MAX
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
            // Parameters are deliberately not logged: they contain personal and payment data.
            console.error('Database query error:', { query, error: error.message });
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

    /** Runs fn(client) inside BEGIN/COMMIT, rolling back on any error. */
    static async withTransaction(fn) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}