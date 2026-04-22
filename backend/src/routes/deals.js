const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// All deal routes require auth
router.use(requireAuth);

// GET /api/deals
router.get('/', async (req, res) => {
  const { stage, sector, priority, search, sort = 'date_added', order = 'desc' } = req.query;

  const conditions = [];
  const params = [];

  if (stage) {
    params.push(stage);
    conditions.push(`stage = $${params.length}`);
  }
  if (sector) {
    params.push(sector);
    conditions.push(`sector ILIKE $${params.length}`);
  }
  if (priority) {
    params.push(priority);
    conditions.push(`priority = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(company_name ILIKE $${params.length} OR brand ILIKE $${params.length} OR notes ILIKE $${params.length} OR description ILIKE $${params.length} OR EXISTS (SELECT 1 FROM unnest(founders) AS f WHERE f ILIKE $${params.length}))`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const allowedSort = ['date_added', 'company_name', 'ai_score', 'created_at', 'funding_ask'];
  const sortCol = allowedSort.includes(sort) ? sort : 'date_added';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  const { rows } = await pool.query(
    `SELECT d.*, u.name AS created_by_name
     FROM deals d
     LEFT JOIN users u ON u.id = d.created_by
     ${where}
     ORDER BY d.${sortCol} ${sortOrder}`,
    params
  );

  res.json(rows);
});

// GET /api/deals/:id
router.get('/:id', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.*, u.name AS created_by_name
     FROM deals d
     LEFT JOIN users u ON u.id = d.created_by
     WHERE d.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Deal not found' });
  res.json(rows[0]);
});

// POST /api/deals
router.post('/', async (req, res) => {
  const {
    company_name, brand, founders = [], sector, location,
    funding_ask, stage = 'Screening', priority = 'Medium',
    ai_score, notes, date_added,
    description, founder_background, poc, deck_link,
  } = req.body;

  if (!company_name) return res.status(400).json({ error: 'company_name is required' });

  const { rows } = await pool.query(
    `INSERT INTO deals
       (company_name, brand, founders, sector, location, funding_ask, stage,
        priority, ai_score, notes, date_added, created_by,
        description, founder_background, poc, deck_link)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [company_name, brand, founders, sector, location, funding_ask,
     stage, priority, ai_score, notes, date_added || new Date(), req.user.id,
     description, founder_background, poc, deck_link]
  );

  res.status(201).json(rows[0]);
});

// PUT /api/deals/:id
router.put('/:id', async (req, res) => {
  const {
    company_name, brand, founders, sector, location,
    funding_ask, stage, priority, ai_score, notes, date_added,
    description, founder_background, poc, deck_link,
  } = req.body;

  const { rows: existing } = await pool.query('SELECT id FROM deals WHERE id = $1', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: 'Deal not found' });

  const { rows } = await pool.query(
    `UPDATE deals SET
       company_name = COALESCE($1, company_name),
       brand = COALESCE($2, brand),
       founders = COALESCE($3, founders),
       sector = COALESCE($4, sector),
       location = COALESCE($5, location),
       funding_ask = COALESCE($6, funding_ask),
       stage = COALESCE($7, stage),
       priority = COALESCE($8, priority),
       ai_score = COALESCE($9, ai_score),
       notes = COALESCE($10, notes),
       date_added = COALESCE($11, date_added),
       description = COALESCE($12, description),
       founder_background = COALESCE($13, founder_background),
       poc = COALESCE($14, poc),
       deck_link = COALESCE($15, deck_link)
     WHERE id = $16
     RETURNING *`,
    [company_name, brand, founders, sector, location, funding_ask,
     stage, priority, ai_score, notes, date_added,
     description, founder_background, poc, deck_link, req.params.id]
  );

  res.json(rows[0]);
});

// DELETE /api/deals/:id
router.delete('/:id', async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM deals WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Deal not found' });
  res.json({ message: 'Deal deleted' });
});

// POST /api/deals/batch  — Google Sheets upsert
router.post('/batch', async (req, res) => {
  const { deals } = req.body;
  if (!Array.isArray(deals) || deals.length === 0) {
    return res.status(400).json({ error: 'deals array required' });
  }

  const results = [];

  for (const deal of deals) {
    const { company_name, brand, founders, sector, location, funding_ask,
            stage, priority, ai_score, notes, date_added } = deal;

    if (!company_name) continue;

    // Upsert by company_name (case-insensitive)
    const { rows } = await pool.query(
      `INSERT INTO deals
         (company_name, brand, founders, sector, location, funding_ask, stage,
          priority, ai_score, notes, date_added, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [company_name, brand, founders || [], sector, location, funding_ask,
       stage || 'Sourcing', priority || 'Medium', ai_score, notes,
       date_added || new Date(), req.user.id]
    );

    if (rows[0]) results.push({ status: 'added', deal: rows[0] });
    else results.push({ status: 'skipped', company_name });
  }

  res.json({ processed: results.length, results });
});

module.exports = router;
