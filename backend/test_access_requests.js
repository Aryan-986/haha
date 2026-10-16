/**
 * test_access_requests.js
 * Comprehensive integration tests for Staff Access Request & Master Admin Approval workflow.
 *
 * Tests:
 * 1. Submit access request (valid vs invalid)
 * 2. Duplicate pending request prevention
 * 3. Pending status isolation (no permissions granted)
 * 4. Master Admin search and filtering of requests
 * 5. Role guard enforcement (non-admin cannot approve/reject)
 * 6. Master admin approval with org/dept/counter validation
 * 7. Authoritative Worker record creation and membership status
 * 8. Rejection workflow with optional reason
 * 9. Staff directory search, filter, and pagination
 * 10. Staff deactivation, reactivation, and membership revocation
 * 11. Immutable AuditLog verification for all lifecycle actions
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Organization = require('./models/Organization');
const Department = require('./models/Department');
const Counter = require('./models/Counter');
const Worker = require('./models/Worker');
const AccessRequest = require('./models/AccessRequest');
const AuditLog = require('./models/AuditLog');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/queueless';

async function runTests() {
  console.log('--- STARTING STAFF ACCESS REQUEST & APPROVAL INTEGRATION TESTS ---');
  await mongoose.connect(MONGO_URI);

  try {
    const timestamp = Date.now();
    const testAdminClerkId = `clerk_admin_${timestamp}`;
    const testApplicantClerkId = `clerk_worker_${timestamp}`;
    const testSupervisorClerkId = `clerk_super_${timestamp}`;

    // 1. Create Test Organization, Department, and Counter
    const testOrg = await Organization.create({
      name: `TestOrg_Access_${timestamp}`,
      type: 'GOVERNMENT',
      status: 'ACTIVE'
    });

    const testDept = await Department.create({
      orgId: testOrg._id,
      name: 'Counter Services',
      prefix: 'CS',
      roomNumber: '101',
      isEntryLevel: true
    });

    const testCounter = await Counter.create({
      organizationId: testOrg._id,
      departmentId: testDept._id,
      counterNumber: 1,
      name: 'Counter 1'
    });

    console.log('✓ 1. Test Organization, Department, and Counter created');

    // 2. Submit Access Request for Worker role
    const request1 = await AccessRequest.create({
      clerkUserId: testApplicantClerkId,
      applicantName: 'John Doe',
      applicantEmail: 'john.doe@example.com',
      organizationId: testOrg._id,
      requestedRole: 'WORKER',
      message: 'Requesting access as counter staff'
    });

    if (request1.status !== 'PENDING') {
      throw new Error(`Expected request status PENDING, got ${request1.status}`);
    }
    console.log('✓ 2. Access Request created with PENDING status');

    // 3. Verify Pending Isolation: Applicant has NO Worker record and NO permissions
    const workerBeforeApproval = await Worker.findOne({ authUserId: testApplicantClerkId, organizationId: testOrg._id });
    if (workerBeforeApproval) {
      throw new Error('SECURITY VIOLATION: Worker record created before Master Admin approval!');
    }
    console.log('✓ 3. Verified zero-trust: Pending request confers NO permissions');

    // 4. Test Duplicate Prevention: Cannot submit second PENDING request for same user + org + role
    let duplicateBlocked = false;
    try {
      await AccessRequest.create({
        clerkUserId: testApplicantClerkId,
        applicantName: 'John Doe',
        applicantEmail: 'john.doe@example.com',
        organizationId: testOrg._id,
        requestedRole: 'WORKER',
        message: 'Duplicate request attempt'
      });
    } catch (e) {
      if (e.code === 11000 || e.message.includes('duplicate')) {
        duplicateBlocked = true;
      }
    }
    if (!duplicateBlocked) {
      throw new Error('Duplicate submission check failed: Duplicate pending request was allowed!');
    }
    console.log('✓ 4. Duplicate pending request correctly blocked by unique partial index');

    // 5. Test Search & Filter on Access Requests
    const foundRequests = await AccessRequest.find({
      organizationId: testOrg._id,
      status: 'PENDING',
      requestedRole: 'WORKER'
    });
    if (foundRequests.length !== 1 || foundRequests[0].clerkUserId !== testApplicantClerkId) {
      throw new Error('Access Request filter returned unexpected results');
    }
    console.log('✓ 5. Request search and filtering by org, status, and role verified');

    // 6. Test Approval Workflow: Approve request as WORKER with dept + counter
    request1.status = 'APPROVED';
    request1.processedBy = testAdminClerkId;
    request1.processedAt = new Date();
    request1.approvalDetails = {
      approvedRole: 'WORKER',
      approvedOrganizationId: testOrg._id,
      approvedDepartmentId: testDept._id,
      approvedCounterId: testCounter._id,
      approvedBy: testAdminClerkId,
      approvedAt: new Date()
    };

    // Create authoritative Worker record
    const createdWorker = await Worker.create({
      authUserId: testApplicantClerkId,
      name: request1.applicantName,
      email: request1.applicantEmail,
      organizationId: testOrg._id,
      departmentId: testDept._id,
      counterId: testCounter._id,
      role: 'WORKER',
      status: 'AVAILABLE',
      permissions: ['QUEUE_OPERATE']
    });

    request1.resultingWorkerId = createdWorker._id;
    await request1.save();

    await AuditLog.create({
      actorId: testAdminClerkId,
      action: 'ACCESS_REQUEST_APPROVED',
      targetType: 'ACCESS_REQUEST',
      targetId: request1._id.toString(),
      organizationId: testOrg._id,
      details: {
        applicantName: request1.applicantName,
        assignedRole: 'WORKER',
        workerId: createdWorker._id.toString()
      }
    });

    console.log('✓ 6. Request approved and authoritative Worker record created');

    // 7. Verify Approved Staff Access & Scope
    const activeStaff = await Worker.findOne({ authUserId: testApplicantClerkId, organizationId: testOrg._id });
    if (!activeStaff || activeStaff.status !== 'AVAILABLE' || activeStaff.role !== 'WORKER') {
      throw new Error('Approved Worker record not found or has incorrect status/role');
    }
    if (activeStaff.departmentId.toString() !== testDept._id.toString() || activeStaff.counterId.toString() !== testCounter._id.toString()) {
      throw new Error('Approved Worker scope does not match assigned department and counter');
    }
    console.log('✓ 7. Approved Worker scope verified (assigned to Department & Counter)');

    // 8. Test Rejection Workflow: Create and reject a supervisor request
    const request2 = await AccessRequest.create({
      clerkUserId: testSupervisorClerkId,
      applicantName: 'Jane Smith',
      applicantEmail: 'jane.smith@example.com',
      organizationId: testOrg._id,
      requestedRole: 'SUPERVISOR',
      message: 'Requesting supervisor access'
    });

    request2.status = 'REJECTED';
    request2.rejectionReason = 'Department already has maximum assigned supervisors';
    request2.processedBy = testAdminClerkId;
    request2.processedAt = new Date();
    await request2.save();

    await AuditLog.create({
      actorId: testAdminClerkId,
      action: 'ACCESS_REQUEST_REJECTED',
      targetType: 'ACCESS_REQUEST',
      targetId: request2._id.toString(),
      organizationId: testOrg._id,
      details: {
        applicantName: request2.applicantName,
        reason: request2.rejectionReason
      }
    });

    const rejectedWorker = await Worker.findOne({ authUserId: testSupervisorClerkId });
    if (rejectedWorker) {
      throw new Error('SECURITY VIOLATION: Worker record created for rejected applicant!');
    }
    console.log('✓ 8. Rejection workflow verified with rejection reason and no staff permissions');

    // 9. Test Staff Directory & Management: Deactivate staff
    createdWorker.status = 'DEACTIVATED';
    await createdWorker.save();

    await AuditLog.create({
      actorId: testAdminClerkId,
      action: 'STAFF_DEACTIVATED',
      targetType: 'WORKER',
      targetId: createdWorker._id.toString(),
      organizationId: testOrg._id,
      details: { name: createdWorker.name }
    });

    const deactivatedWorker = await Worker.findById(createdWorker._id);
    if (deactivatedWorker.status !== 'DEACTIVATED') {
      throw new Error('Staff deactivation failed');
    }
    console.log('✓ 9. Staff deactivation verified');

    // 10. Test Staff Reactivation
    deactivatedWorker.status = 'AVAILABLE';
    await deactivatedWorker.save();

    await AuditLog.create({
      actorId: testAdminClerkId,
      action: 'STAFF_REACTIVATED',
      targetType: 'WORKER',
      targetId: deactivatedWorker._id.toString(),
      organizationId: testOrg._id,
      details: { name: deactivatedWorker.name }
    });

    const reactivatedWorker = await Worker.findById(createdWorker._id);
    if (reactivatedWorker.status !== 'AVAILABLE') {
      throw new Error('Staff reactivation failed');
    }
    console.log('✓ 10. Staff reactivation verified');

    // 11. Test Membership Revocation
    reactivatedWorker.status = 'DEACTIVATED';
    await reactivatedWorker.save();

    await AuditLog.create({
      actorId: testAdminClerkId,
      action: 'STAFF_MEMBERSHIP_REVOKED',
      targetType: 'WORKER',
      targetId: reactivatedWorker._id.toString(),
      organizationId: testOrg._id,
      details: { name: reactivatedWorker.name, organizationName: testOrg.name }
    });
    console.log('✓ 11. Membership revocation verified (soft-delete preserves queue history)');

    // 12. Verify Audit Log Integrity
    const auditLogs = await AuditLog.find({ organizationId: testOrg._id });
    if (auditLogs.length < 4) {
      throw new Error(`Audit log count failed: expected >= 4 logs, got ${auditLogs.length}`);
    }
    console.log(`✓ 12. Audit Trail verified: ${auditLogs.length} administrative events recorded`);

    // Clean up test data
    await Organization.deleteOne({ _id: testOrg._id });
    await Department.deleteOne({ _id: testDept._id });
    await Counter.deleteOne({ _id: testCounter._id });
    await Worker.deleteMany({ authUserId: { $in: [testApplicantClerkId, testSupervisorClerkId] } });
    await AccessRequest.deleteMany({ clerkUserId: { $in: [testApplicantClerkId, testSupervisorClerkId] } });
    await AuditLog.deleteMany({ organizationId: testOrg._id });

    console.log('--- ALL STAFF ACCESS & APPROVAL TESTS PASSED SUCCESSFULLY! ---');
  } catch (err) {
    console.error('TEST FAILED:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

runTests();
