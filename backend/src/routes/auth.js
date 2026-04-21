const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const signToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  res.json({ token: signToken(user), user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, email, name, role, created_at FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

// POST /api/auth/register  (admin only)
router.post('/register', requireAuth, requireAdmin, async (req, res) => {
  const { email, password, name, role = 'analyst' } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, password, and name are required' });
  }

  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
      [email.toLowerCase(), hash, name, role]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    throw err;
  }
});

// GET /api/auth/users  (admin only — list all users)
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, email, name, role, created_at FROM users ORDER BY created_at ASC'
  );
  res.json(rows);
});

// DELETE /api/auth/users/:id  (admin only — remove a user)
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.status(400).json({ error: "Cannot delete your own account" });
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
  res.json({ message: 'User removed' });
});

// PUT /api/auth/password  (change own password)
router.put('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword required' });
  }

  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
    return res.status(401).json({ error: 'Current password incorrect' });
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
  res.json({ message: 'Password updated' });
});

module.exports = router;
