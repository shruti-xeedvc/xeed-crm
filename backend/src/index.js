require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { testConnection } = require('./config/db');
const { initCronJobs } = require('./services/cronService');

const authRoutes = require('./routes/auth');
const dealRoutes = require('./routes/deals');
const gmailRoutes = require('./routes/gmail');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/deals', dealRoutes);
app.use('/api/gmail', gmailRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const start = async () => {
  await testConnection();
  initCronJobs();
  app.listen(PORT, () => {
    console.log(`Xeed CRM backend running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  });
};

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
