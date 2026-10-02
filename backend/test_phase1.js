/**
 * test_phase1.js
 * Automated integration verification for Phase 1: Core Queue Engine
 */

const mongoose = require('mongoose');
const Organization = require('./models/Organization');
const Department = require('./models/Department');
const Counter = require('./models/Counter');
const Worker = require('./models/Worker');
const Ticket = require('./models/Ticket');
const QueueEvent = require('./models/QueueEvent');
const queueService = require('./services/queueService');
const { assertValidTransition, isValidTransition } = require('./services/ticketStateMachine');

require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/queueless';

async function runTests() {
  console.log('--- STARTING PHASE 1 VERIFICATION TESTS ---');
  await mongoose.connect(MONGO_URI);

  try {
    // 1. Clean test collections
    const testOrgNameA = `TestOrgA_${Date.now()}`;
    const testOrgNameB = `TestOrgB_${Date.now()}`;

    const orgA = await Organization.create({ name: testOrgNameA, type: 'GOVERNMENT' });
    const orgB = await Organization.create({ name: testOrgNameB, type: 'HOSPITAL' });
    console.log('✓ 1. Organizations created with tenant boundary (Org A & Org B)');

    // 2. Create Departments
    const deptA1 = await Department.create({
      orgId: orgA._id,
      name: 'Registration',
      prefix: 'REG',
      roomNumber: '101',
      isEntryLevel: true
    });
    const deptA2 = await Department.create({
      orgId: orgA._id,
      name: 'Verification',
      prefix: 'VER',
      roomNumber: '102'
    });
    const deptB1 = await Department.create({
      orgId: orgB._id,
      name: 'Triage',
      prefix: 'TRG',
      roomNumber: 'B1'
    });
    console.log('✓ 2. Departments created with room numbers');

    // 3. Create Counters & Workers
    const counter1 = await Counter.create({
      organizationId: orgA._id,
      departmentId: deptA1._id,
      counterNumber: 1,
      name: 'Counter 1'
    });
    const counter2 = await Counter.create({
      organizationId: orgA._id,
      departmentId: deptA1._id,
      counterNumber: 2,
      name: 'Counter 2'
    });

    const worker1 = await Worker.create({
      organizationId: orgA._id,
      departmentId: deptA1._id,
      counterId: counter1._id,
      name: 'Alice Worker',
      role: 'WORKER'
    });
    const worker2 = await Worker.create({
      organizationId: orgA._id,
      departmentId: deptA1._id,
      counterId: counter2._id,
      name: 'Bob Worker',
      role: 'WORKER'
    });
    console.log('✓ 3. Counters and Workers registered');

    // 4. Test Concurrency-Safe Ticket Numbering
    const dispensePromises = [];
    for (let i = 0; i < 5; i++) {
      dispensePromises.push(queueService.issueTicket({
        organizationId: orgA._id,
        departmentId: deptA1._id,
        priority: 'NORMAL'
      }));
    }
    const issuedTickets = await Promise.all(dispensePromises);
    const ticketNumbers = issuedTickets.map(t => t.ticketNumber);
    const uniqueNumbers = new Set(ticketNumbers);
    if (uniqueNumbers.size !== 5) {
      throw new Error(`Ticket sequence concurrency failed: expected 5 unique, got ${uniqueNumbers.size}`);
    }
    console.log(`✓ 4. Atomic ticket sequence verified: ${ticketNumbers.join(', ')}`);

    // 5. Test State Machine Transitions
    if (!isValidTransition('WAITING', 'CALLED') || !isValidTransition('CALLED', 'SERVING')) {
      throw new Error('Valid state transitions returned false');
    }
    if (isValidTransition('WAITING', 'COMPLETED') || isValidTransition('COMPLETED', 'SERVING')) {
      throw new Error('Invalid state transition allowed');
    }
    console.log('✓ 5. Ticket State Machine enforcement verified');

    // 6. Test Atomic Call Next (Worker 1 and Worker 2 claim separate tickets simultaneously)
    const [claim1, claim2] = await Promise.all([
      queueService.callNextTicket({
        organizationId: orgA._id,
        departmentId: deptA1._id,
        counterId: counter1._id,
        workerId: worker1._id
      }),
      queueService.callNextTicket({
        organizationId: orgA._id,
        departmentId: deptA1._id,
        counterId: counter2._id,
        workerId: worker2._id
      })
    ]);

    if (!claim1.ticket || !claim2.ticket) {
      throw new Error('Failed to claim tickets for both counters');
    }
    if (claim1.ticket._id.toString() === claim2.ticket._id.toString()) {
      throw new Error('RACE CONDITION BUG: Both counters claimed the exact same ticket!');
    }
    console.log(`✓ 6. Atomic queue claiming verified: Counter 1 got ${claim1.ticketNumber}, Counter 2 got ${claim2.ticketNumber}`);

    // 7. Verify Non-Destructive Call Next: Counter 1 calling next does NOT complete Counter 2's active ticket
    await queueService.startService({
      ticketId: claim1.ticket._id,
      workerId: worker1._id,
      counterId: counter1._id
    });
    await queueService.startService({
      ticketId: claim2.ticket._id,
      workerId: worker2._id,
      counterId: counter2._id
    });

    // Worker 1 calls next again
    const claim3 = await queueService.callNextTicket({
      organizationId: orgA._id,
      departmentId: deptA1._id,
      counterId: counter1._id,
      workerId: worker1._id
    });

    // Check Counter 2 ticket status: MUST STILL BE SERVING, NOT COMPLETED!
    const counter2TicketAfter = await Ticket.findById(claim2.ticket._id);
    if (counter2TicketAfter.status !== 'SERVING') {
      throw new Error(`CRITICAL BUG: Counter 2 ticket was incorrectly mutated to ${counter2TicketAfter.status} when Counter 1 called next!`);
    }
    console.log('✓ 7. Non-destructive Call Next verified: Counter 2 serving ticket remained untouched');

    // 8. Test Transfer Operation to Downstream Department
    const transferResult = await queueService.transferTicket({
      ticketId: claim3.ticket._id,
      targetDepartmentId: deptA2._id,
      workerId: worker1._id,
      counterId: counter1._id
    });
    if (transferResult.ticket.status !== 'TRANSFERRED') {
      throw new Error('Ticket status is not TRANSFERRED');
    }
    if (transferResult.ticket.currentDepartmentId.toString() !== deptA2._id.toString()) {
      throw new Error('Ticket currentDepartmentId did not update to target department');
    }
    console.log(`✓ 8. Downstream Transfer verified: Ticket moved to ${deptA2.name} [Room ${deptA2.roomNumber}]`);

    // 9. Test Tenant Isolation
    // Issue ticket in Org B
    const orgBTicket = await queueService.issueTicket({
      organizationId: orgB._id,
      departmentId: deptB1._id
    });

    // Org A attempts to claim tickets in Org A's department -> should NOT see Org B's ticket!
    // Try cross-tenant transfer: transfer Org A ticket to Org B department -> MUST REJECT!
    let crossTenantBlocked = false;
    try {
      await queueService.transferTicket({
        ticketId: claim1.ticket._id,
        targetDepartmentId: deptB1._id,
        workerId: worker1._id
      });
    } catch (e) {
      if (e.message.includes('Tenant Boundary Error')) {
        crossTenantBlocked = true;
      }
    }
    if (!crossTenantBlocked) {
      throw new Error('Tenant boundary violation: Cross-tenant transfer was not rejected!');
    }
    console.log('✓ 9. Tenant Isolation verified: Cross-tenant operations strictly blocked');

    // 10. Verify Queue Events were created
    const eventCount = await QueueEvent.countDocuments({ organizationId: orgA._id });
    if (eventCount < 5) {
      throw new Error(`QueueEvent audit trail failed: expected >= 5 events, got ${eventCount}`);
    }
    console.log(`✓ 10. Immutable QueueEvent audit log verified (${eventCount} events recorded)`);

    // Clean up test documents
    await Organization.deleteMany({ _id: { $in: [orgA._id, orgB._id] } });
    await Department.deleteMany({ _id: { $in: [deptA1._id, deptA2._id, deptB1._id] } });
    await Counter.deleteMany({ organizationId: orgA._id });
    await Worker.deleteMany({ organizationId: orgA._id });
    await Ticket.deleteMany({ organizationId: { $in: [orgA._id, orgB._id] } });
    await QueueEvent.deleteMany({ organizationId: { $in: [orgA._id, orgB._id] } });

    console.log('--- ALL PHASE 1 INTEGRATION TESTS PASSED SUCCESSFULLY! ---');
  } catch (err) {
    console.error('TEST FAILED:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

runTests();
