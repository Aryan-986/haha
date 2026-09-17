const mongoose = require('mongoose');
require('dotenv').config();
const Service = require('./models/Service');

const defaultServices = [
  {
    office: 'District Administration Office (DAO), Kathmandu',
    name: 'Citizenship & National ID Application',
    currentlyServingNumber: 101,
    currentQueueCount: 15,
    activeCounters: 3,
    estimatedWaitMin: 45,
    crowdLevel: 'MODERATE CROWD'
  },
  {
    office: 'Department of Passports, Tripureshwor',
    name: 'e-Passport Distribution & Biometrics',
    currentlyServingNumber: 205,
    currentQueueCount: 32,
    activeCounters: 5,
    estimatedWaitMin: 60,
    crowdLevel: 'HIGH CROWD'
  },
  {
    office: 'Transport Management Office, Ekantakuna',
    name: 'Driving License Renewal & Biometrics',
    currentlyServingNumber: 88,
    currentQueueCount: 8,
    activeCounters: 2,
    estimatedWaitMin: 20,
    crowdLevel: 'LOW CROWD'
  }
];

const seedDatabase = async () => {
  try {
    const connStr = process.env.MONGO_URI || 'mongodb://localhost:27017/queue_db';
    await mongoose.connect(connStr);
    console.log('Connected to MongoDB for seeding...');

    // Option A: Clear existing invalid/incomplete documents
    await Service.deleteMany({});
    console.log('Cleared existing Service records.');

    // Option B: Insert fresh services containing all required fields (like `office`)
    const seededServices = await Service.insertMany(defaultServices);
    console.log(`Successfully seeded ${seededServices.length} services with complete fields.`);

    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

seedDatabase();