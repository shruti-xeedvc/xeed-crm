const { Pool } = require('pg');

// Strip any sslmode param from URL so our ssl config takes full effect
const connectionString = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]*/g, '').replace(/[?&]pgbouncer=[^&]*/g, '');

const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

const testConnection = async () => {
  const client = await pool.connect();
  console.log('PostgreSQL connected');
  client.release();
};

module.exports = { pool, testConnection };
