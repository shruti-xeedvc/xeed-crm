/**
 * Seed script — creates the initial admin user and sample deals.
 * Run once after migration: node src/seed.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./config/db');

const seed = async () => {
  console.log('Seeding database...');

  // Admin user
  const hash = await bcrypt.hash('xeedadmin2024', 10);
  const { rows: userRows } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email`,
    ['admin@xeedvc.com', hash, 'Xeed Admin']
  );

  if (userRows[0]) {
    console.log(`Created admin: ${userRows[0].email}`);
  } else {
    console.log('Admin user already exists, skipping.');
  }

  // Fetch the admin id (whether just created or pre-existing)
  const { rows: adminRows } = await pool.query(
    `SELECT id FROM users WHERE email = 'admin@xeedvc.com'`
  );
  const adminId = adminRows[0]?.id;

  // Sample deals
  const sampleDeals = [
    {
      company_name: 'SwiftPay', brand: 'SwiftPay', founders: ['Arjun Mehta', 'Priya Sharma'],
      sector: 'Fintech', location: 'Mumbai, India', funding_ask: '$1.5M',
      stage: 'Screening', priority: 'High', ai_score: 8,
      notes: 'B2B payment infrastructure for MSMEs. 3x MoM growth, $50K MRR. Strong team from Razorpay.',
    },
    {
      company_name: 'EduSpark', brand: 'EduSpark', founders: ['Sneha Kapoor'],
      sector: 'EdTech', location: 'Bangalore, India', funding_ask: '$800K',
      stage: 'Diligence', priority: 'Medium', ai_score: 6,
      notes: 'Vernacular language learning platform for Tier 2/3 cities. 40K MAU.',
    },
    {
      company_name: 'ClearOps', brand: null, founders: ['Rahul Nair', 'Amit Joshi'],
      sector: 'SaaS', location: 'Pune, India', funding_ask: '$2M',
      stage: 'Term Sheet', priority: 'High', ai_score: 9,
      notes: 'Supply chain visibility SaaS. $200K ARR, 15 enterprise customers, NRR 130%.',
    },
    {
      company_name: 'HealthEdge', brand: 'HealthEdge', founders: ['Dr. Ananya Singh'],
      sector: 'HealthTech', location: 'Delhi, India', funding_ask: '$500K',
      stage: 'Sourcing', priority: 'Low', ai_score: 5,
      notes: 'Telemedicine for rural India. Early stage, need to validate unit economics.',
    },
    {
      company_name: 'GreenRoute', brand: null, founders: ['Vikram Das', 'Neha Patel'],
      sector: 'CleanTech', location: 'Hyderabad, India', funding_ask: '$3M',
      stage: 'Invested', priority: 'High', ai_score: 9,
      notes: 'EV fleet management. Invested in pre-seed. Strong regulatory tailwinds.',
    },
  ];

  let added = 0;
  for (const d of sampleDeals) {
    const { rowCount } = await pool.query(
      `INSERT INTO deals
         (company_name, brand, founders, sector, location, funding_ask,
          stage, priority, ai_score, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT DO NOTHING`,
      [d.company_name, d.brand, d.founders, d.sector, d.location,
       d.funding_ask, d.stage, d.priority, d.ai_score, d.notes, adminId]
    );
    if (rowCount) added++;
  }
  console.log(`Inserted ${added} sample deals.`);

  await pool.end();
  console.log('Done.');
};

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
