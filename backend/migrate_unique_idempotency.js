require('dotenv').config();
const mongoose = require('mongoose');
const Ticket = require('./models/Ticket');

async function migrate() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  // Find duplicate idempotency keys
  const duplicates = await Ticket.aggregate([
    { $match: { idempotencyKey: { $ne: null } } },
    { $group: { _id: '$idempotencyKey', count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } }
  ]);

  console.log(`Found ${duplicates.length} duplicate idempotencyKey groups`);
  for (const dup of duplicates) {
    // Keep first, delete the rest
    const [keep, ...remove] = dup.ids;
    await Ticket.deleteMany({ _id: { $in: remove } });
    console.log(`Deduplicated key ${dup._id}, kept ${keep}, removed ${remove.length}`);
  }

  // Drop old index if exists
  try {
    await Ticket.collection.dropIndex('idempotencyKey_1');
    console.log('Dropped old idempotencyKey_1 index');
  } catch (e) {
    console.log('Old index drop notice:', e.message);
  }

  // Create unique sparse index
  await Ticket.collection.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true });
  console.log('Created unique sparse index on Ticket.idempotencyKey successfully');

  await mongoose.connection.close();
}

migrate().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
