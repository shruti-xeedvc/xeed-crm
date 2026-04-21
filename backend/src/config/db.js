const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false, checkServerIdentity: () => undefined }
    : false,
});

const testConnection = async () => {
  const client = await pool.connect();
  console.log('PostgreSQL connected');
  client.release();
};

module.exports = { pool, testConnection };
