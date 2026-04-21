/**
 * Run DB migration: node src/migrate.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./config/db');

const migrate = async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/001_initial.sql'),
    'utf-8'
  );
  await pool.query(sql);
  console.log('Migration complete.');
  await pool.end();
};

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
