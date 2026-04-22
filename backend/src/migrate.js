/**
 * Run DB migrations: node src/migrate.js
 * Runs all *.sql files in /migrations in filename order.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./config/db');

const migrate = async () => {
  const migrationsDir = path.join(__dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // alphabetical order ensures 001, 002, etc.

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    console.log(`Running migration: ${file}`);
    await pool.query(sql);
    console.log(`  ✓ ${file} complete`);
  }

  console.log('All migrations complete.');
  await pool.end();
};

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
