const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const { clerkMiddleware } = require('@clerk/express');
const { initSocket } = require('./socket');
require('dotenv').config();

const app = express();
const httpServer = http.createServer(app);

// Initialize Socket.io on the shared HTTP server
const io = initSocket(httpServer);

// Core Middleware
app.use(cors());
app.use(express.json());

// Attach Clerk Authentication Context
if (process.env.CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY) {
  app.use(clerkMiddleware());
} else {
  console.warn('⚠️ Warning: Clerk keys missing in .env. Clerk middleware bypassed for local development.');
}

// Database Connection & Auto-Seeding
const Service = require('./models/Service');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/queueless';

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('MongoDB Connected Successfully');
    try {
      const existingService = await Service.findOne();
      if (!existingService) {
        await Service.create({
          office: 'District Administration Office (DAO), Kathmandu',
          name: 'Citizenship & National ID Application',
          currentQueueCount: 15,
          currentlyServingNumber: 100,
          activeCounters: 3,
          estimatedWaitMin: 45,
          crowdLevel: 'MODERATE CROWD'
        });
        console.log('Default DAO Kathmandu Service auto-seeded successfully.');
      }
    } catch (seedErr) {
      console.error('Error auto-seeding default service:', seedErr.message);
    }
  })
  .catch((err) => console.error('MongoDB Connection Error:', err));

// Routes Configuration
const queueRoutes = require('./routes/queueRoutes');
const workerRoutes = require('./routes/workerRoutes');
const organizationRoutes = require('./routes/organizationRoutes');

app.use('/api', queueRoutes);
app.use('/api', workerRoutes);
app.use('/api/v1/orgs', organizationRoutes);
app.use('/api/orgs', organizationRoutes);

if (require('fs').existsSync('./routes/adminRoutes.js')) {
  app.use('/api/admin', require('./routes/adminRoutes'));
}

// Global 404 Route Handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.originalUrl} not found on server` });
});

const PORT = process.env.PORT || 5000;
if (require.main === module) {
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT} (HTTP + WebSocket)`);
  });
}

module.exports = { app, httpServer, io };