/**
 * test_regressions.js
 * Comprehensive Regression & New Feature Verification Suite
 * 
 * Verifies:
 * - TASK 1: Org Archival Auth (401 Unauth, 403 Forbidden, 200 Master Admin)
 * - TASK 2: Org Editing (PUT /api/v1/orgs/:id, duplicate checking, archived checks)
 * - TASK 3: Multi-counter & room per department support
 * - TASK 4: Ticket transfer with specific room/counter destination & tenant isolation
 * - TASK 5: Citizen & Worker snooze/delay and alerts
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Organization = require('./models/Organization');
const Department = require('./models/Department');
const Counter = require('./models/Counter');
const Worker = require('./models/Worker');
const Ticket = require('./models/Ticket');
const QueueEvent = require('./models/QueueEvent');
const organizationService = require('./services/organizationService');
const counterService = require('./services/counterService');
const queueService = require('./services/queueService');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/queueless';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runRegressionTests() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  QUEUELESS — REGRESSION & NEW FEATURE TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════\n');

  await mongoose.connect(MONGO_URI);

  const testSuffix = `reg_${Date.now()}`;
  let orgMaster = null;
  let orgTenantB = null;
  let deptA = null;
  let deptB = null;
  let counter1 = null;
  let counter2 = null;
  let counter3 = null;
  let workerA = null;

  try {
    // -------------------------------------------------------------
    // SETUP
    // -------------------------------------------------------------
    console.log('─── 0. Setup Test Data ───');
    orgMaster = await Organization.create({
      name: `City Hall ${testSuffix}`,
      code: `CH_${testSuffix.substring(4, 10).toUpperCase()}`,
      status: 'ACTIVE',
      createdBy: 'test_setup'
    });

    orgTenantB = await Organization.create({
      name: `Hospital ${testSuffix}`,
      code: `HP_${testSuffix.substring(4, 10).toUpperCase()}`,
      status: 'ACTIVE',
      createdBy: 'test_setup'
    });

    deptA = await Department.create({
      orgId: orgMaster._id,
      name: 'Passport Services',
      prefix: 'PSP',
      roomNumber: '101'
    });

    deptB = await Department.create({
      orgId: orgMaster._id,
      name: 'Document Verification',
      prefix: 'DOC',
      roomNumber: '102'
    });

    assert(orgMaster && orgTenantB && deptA && deptB, 'Base test organizations and departments created');

    // -------------------------------------------------------------
    // TASK 3: Multi-counter & Room per Department
    // -------------------------------------------------------------
    console.log('\n─── 1. Multi-Counter & Multi-Room Support (TASK 3) ───');
    
    // Counter 1: Room 101-A
    counter1 = await counterService.createCounter({
      organizationId: orgMaster._id,
      departmentId: deptA._id,
      counterNumber: 1,
      name: 'Counter 1',
      roomNumber: 'Room 101-A'
    });
    assert(counter1.roomNumber === 'Room 101-A', 'Counter 1 created with roomNumber: Room 101-A');

    // Counter 2: Room 101-B (Same department, different counter & room)
    counter2 = await counterService.createCounter({
      organizationId: orgMaster._id,
      departmentId: deptA._id,
      counterNumber: 2,
      name: 'Counter 2',
      roomNumber: 'Room 101-B'
    });
    assert(counter2.roomNumber === 'Room 101-B', 'Counter 2 created with roomNumber: Room 101-B in same department');

    // Counter 3: Room 102 in Dept B
    counter3 = await counterService.createCounter({
      organizationId: orgMaster._id,
      departmentId: deptB._id,
      counterNumber: 1,
      name: 'Verification Desk 1',
      roomNumber: 'Room 102'
    });
    assert(counter3.roomNumber === 'Room 102', 'Counter 3 created in destination department with roomNumber');

    // Duplicate counter check in same department
    try {
      await counterService.createCounter({
        organizationId: orgMaster._id,
        departmentId: deptA._id,
        counterNumber: 1,
        name: 'Duplicate Counter'
      });
      assert(false, 'Duplicate counterNumber in same department should be rejected');
    } catch (err) {
      assert(err.status === 409 || err.message.includes('already exists'), 'Duplicate counterNumber in department rejected with 409 Conflict');
    }

    // Mismatched department and org validation
    try {
      await counterService.createCounter({
        organizationId: orgTenantB._id, // Tenant B
        departmentId: deptA._id,          // Dept belonging to Org Master
        counterNumber: 99
      });
      assert(false, 'Mismatched organizationId and departmentId should be rejected');
    } catch (err) {
      assert(err.status === 400 || err.message.includes('does not belong'), 'Mismatched counter org/dept rejected');
    }

    // -------------------------------------------------------------
    // TASK 2: Organization Editing
    // -------------------------------------------------------------
    console.log('\n─── 2. Organization Editing (TASK 2) ───');

    // 2a. Unauthenticated edit check
    try {
      await organizationService.updateOrganization({
        orgId: orgMaster._id,
        updates: { name: 'Renamed Without Auth' },
        userRole: null
      });
      assert(false, 'Unauthenticated edit should throw 401');
    } catch (err) {
      assert(err.status === 401, 'Unauthenticated org edit rejected with HTTP 401 Unauthorized');
    }

    // 2b. Unauthorized edit check
    try {
      await organizationService.updateOrganization({
        orgId: orgMaster._id,
        updates: { name: 'Renamed by Worker' },
        userRole: 'worker'
      });
      assert(false, 'Worker edit should throw 403');
    } catch (err) {
      assert(err.status === 403, 'Unauthorized worker edit rejected with HTTP 403 Forbidden');
    }

    // 2c. Valid master admin edit
    const updatedOrg = await organizationService.updateOrganization({
      orgId: orgMaster._id,
      updates: {
        name: `City Hall Prime ${testSuffix}`,
        timezone: 'Asia/Kathmandu',
        description: 'Updated central city hall services desk'
      },
      userRole: 'master_admin',
      userId: 'master_admin_tester'
    });
    assert(updatedOrg.name === `City Hall Prime ${testSuffix}`, 'Master admin updated organization name');
    assert(updatedOrg.timezone === 'Asia/Kathmandu', 'Master admin updated organization timezone');
    assert(updatedOrg.description === 'Updated central city hall services desk', 'Master admin updated organization description');

    // 2d. Duplicate name validation
    try {
      await organizationService.updateOrganization({
        orgId: orgTenantB._id,
        updates: { name: updatedOrg.name },
        userRole: 'master_admin'
      });
      assert(false, 'Duplicate organization name should be rejected');
    } catch (err) {
      assert(err.status === 409, 'Duplicate organization name rejected with HTTP 409 Conflict');
    }

    // -------------------------------------------------------------
    // TASK 4: Ticket Transfer Destination Selection & Multi-Counter
    // -------------------------------------------------------------
    console.log('\n─── 3. Ticket Transfer Destination Selection (TASK 4) ───');

    workerA = await Worker.create({
      organizationId: orgMaster._id,
      departmentId: deptA._id,
      name: 'Desk Agent Alice',
      role: 'WORKER',
      status: 'AVAILABLE'
    });

    const ticketToTransfer = await Ticket.create({
      organizationId: orgMaster._id,
      departmentId: deptA._id,
      currentDepartmentId: deptA._id,
      ticketNumber: 'PSP-101',
      status: 'CALLED',
      assignedCounterId: counter1._id,
      assignedWorkerId: workerA._id,
      priority: 'NORMAL',
      source: 'WEB'
    });

    // 3a. Cross-tenant transfer rejection
    try {
      await queueService.transferTicket({
        ticketId: ticketToTransfer._id,
        targetDepartmentId: (await Department.create({
          orgId: orgTenantB._id, // Hospital (Tenant B)
          name: 'Triage',
          prefix: 'TRG'
        }))._id,
        workerId: workerA._id,
        counterId: counter1._id
      });
      assert(false, 'Cross-tenant transfer must be blocked');
    } catch (err) {
      assert(err.status === 403 || err.message.includes('Tenant violation') || err.message.includes('Cross-tenant'), 'Cross-tenant transfer blocked with 403');
    }

    // 3b. Invalid counter transfer rejection (counter belonging to wrong department)
    try {
      await queueService.transferTicket({
        ticketId: ticketToTransfer._id,
        targetDepartmentId: deptB._id,
        targetCounterId: counter1._id, // Counter 1 belongs to Dept A, not Dept B!
        workerId: workerA._id,
        counterId: counter1._id
      });
      assert(false, 'Transfer with mismatched target counter must be blocked');
    } catch (err) {
      assert(err.status === 400 || err.message.includes('does not belong to destination'), 'Mismatched target counter rejected with 400');
    }

    // 3c. Valid transfer to specific destination counter & room
    const transferResult = await queueService.transferTicket({
      ticketId: ticketToTransfer._id,
      targetDepartmentId: deptB._id,
      targetCounterId: counter3._id, // Verification Desk 1 in Room 102
      workerId: workerA._id,
      counterId: counter1._id
    });

    assert(transferResult.ticket.status === 'TRANSFERRED', 'Ticket status updated to TRANSFERRED');
    assert(transferResult.ticket.currentDepartmentId.toString() === deptB._id.toString(), 'Ticket department updated to Dept B');
    assert(transferResult.ticket.roomNumber === 'Room 102', 'Ticket destination roomNumber set to Room 102');
    assert(transferResult.ticket.targetCounterId.toString() === counter3._id.toString(), 'Ticket targetCounterId recorded');
    assert(transferResult.ticket.counterNumber === counter3.counterNumber, 'Ticket counterNumber updated');

    // 3d. Check QueueEvent audit trail for transfer
    const transferEvent = await QueueEvent.findOne({
      ticketId: ticketToTransfer._id,
      eventType: 'TICKET_TRANSFERRED'
    }).sort({ timestamp: -1 });
    assert(transferEvent !== null, 'TICKET_TRANSFERRED QueueEvent created');
    assert(transferEvent.destinationRoomNumber === 'Room 102', 'QueueEvent preserves destination roomNumber in audit log');

    // -------------------------------------------------------------
    // TASK 5: Citizen & Worker Delay/Alert Functionality
    // -------------------------------------------------------------
    console.log('\n─── 4. Alert & Delay Functionality (TASK 5) ───');

    const delayedTicket = await Ticket.create({
      organizationId: orgMaster._id,
      departmentId: deptA._id,
      currentDepartmentId: deptA._id,
      ticketNumber: 'PSP-102',
      status: 'WAITING',
      priority: 'NORMAL',
      source: 'WEB'
    });

    // 4a. Citizen snoozes ticket
    const snoozed = await queueService.snoozeTicket({
      ticketId: delayedTicket._id,
      minutes: 10,
      source: 'CITIZEN'
    });
    assert(snoozed.status === 'SNOOZED', 'Citizen snooze sets status to SNOOZED');
    assert(snoozed.snoozeInfo.isSnoozed === true, 'snoozeInfo.isSnoozed is true');
    assert(snoozed.snoozeInfo.snoozeCount === 1, 'snoozeCount incremented to 1');
    assert(new Date(snoozed.snoozeInfo.resumeAt) > new Date(), 'resumeAt is set in the future');

    // 4b. Snoozed ticket excluded from active next call
    const nextCall = await queueService.callNext({
      organizationId: orgMaster._id,
      departmentId: deptA._id,
      counterId: counter1._id,
      workerId: workerA._id
    });
    // Since only PSP-102 was in queue and it is snoozed, callNext should return null
    assert(nextCall.ticket === null, 'Active callNext skips snoozed ticket');

    // 4c. Resume ticket
    const resumed = await queueService.resumeTicket({
      ticketId: delayedTicket._id,
      workerId: workerA._id
    });
    assert(resumed.status === 'WAITING', 'Resumed ticket returns to WAITING status');

    // -------------------------------------------------------------
    // TASK 1: Master Admin Archival Authentication & Isolation
    // -------------------------------------------------------------
    console.log('\n─── 5. Master Admin Archival Security (TASK 1) ───');

    // 5a. Unauthenticated archival check
    try {
      await organizationService.archiveOrganization({
        orgId: orgMaster._id,
        userRole: null,
        userId: null
      });
      assert(false, 'Unauthenticated archive should throw 401');
    } catch (err) {
      assert(err.status === 401, 'Unauthenticated archive returns HTTP 401 Unauthorized');
    }

    // 5b. Unauthorized archival check (worker, citizen, org_admin)
    try {
      await organizationService.archiveOrganization({
        orgId: orgMaster._id,
        userRole: 'worker',
        userId: 'w1'
      });
      assert(false, 'Worker archive should throw 403');
    } catch (err) {
      assert(err.status === 403, 'Worker archive returns HTTP 403 Forbidden');
    }

    try {
      await organizationService.archiveOrganization({
        orgId: orgMaster._id,
        userRole: 'org_admin',
        userId: 'admin1'
      });
      assert(false, 'Org admin archive should throw 403');
    } catch (err) {
      assert(err.status === 403, 'Org admin archive returns HTTP 403 Forbidden');
    }

    // 5c. Authorized Master Admin archival
    const archived = await organizationService.archiveOrganization({
      orgId: orgMaster._id,
      userRole: 'master_admin',
      userId: 'master_admin_user'
    });
    assert(archived.isDeleted === true, 'Organization marked isDeleted = true');
    assert(archived.status === 'INACTIVE', 'Organization status marked INACTIVE');
    assert(archived.deletedBy === 'master_admin_user', 'deletedBy recorded');

    // 5d. Archived organization excluded from active listing
    const activeOrgs = await organizationService.listOrganizations({ status: 'ACTIVE' });
    const foundArchived = activeOrgs.find(o => o._id.toString() === orgMaster._id.toString());
    assert(!foundArchived, 'Archived organization excluded from active organizations list');

    // 5e. Cannot edit archived organization
    try {
      await organizationService.updateOrganization({
        orgId: orgMaster._id,
        updates: { name: 'Attempted Update on Archived Org' },
        userRole: 'master_admin'
      });
      assert(false, 'Editing archived org should be rejected');
    } catch (err) {
      assert(err.status === 400 || err.message.includes('archived'), 'Editing archived organization rejected with 400 Bad Request');
    }

    // 5f. Audit logs preserved for archived organization
    const orgEvents = await QueueEvent.countDocuments({ organizationId: orgMaster._id });
    assert(orgEvents > 0, `Historical QueueEvents preserved for archived organization (${orgEvents} events)`);

  } finally {
    // CLEANUP
    if (orgMaster) {
      await QueueEvent.deleteMany({ organizationId: orgMaster._id });
      await Ticket.deleteMany({ organizationId: orgMaster._id });
      await Counter.deleteMany({ organizationId: orgMaster._id });
      await Department.deleteMany({ orgId: orgMaster._id });
      await Worker.deleteMany({ organizationId: orgMaster._id });
      await Organization.deleteOne({ _id: orgMaster._id });
    }
    if (orgTenantB) {
      await Department.deleteMany({ orgId: orgTenantB._id });
      await Organization.deleteOne({ _id: orgTenantB._id });
    }
    await mongoose.disconnect();
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  RESULTS: ${passed} passed  |  ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════');

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n  ✅ ALL REGRESSION & NEW FEATURE TESTS PASSED!\n');
    process.exit(0);
  }
}

runRegressionTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
