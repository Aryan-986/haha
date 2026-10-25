import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  DoorOpen,
  LayoutGrid,
  PlusCircle,
  Edit2,
  Trash2,
  RefreshCw,
  Check,
  AlertCircle,
  Building2,
  CheckCircle2,
  ToggleLeft,
  ToggleRight,
  UserCheck
} from 'lucide-react';
import {
  getDepartmentRooms,
  createDepartmentRoom,
  updateDepartmentRoom,
  deleteDepartmentRoom,
  getDepartmentCounters,
  createDepartmentCounter,
  updateCounter,
  deleteCounter
} from '../services/organizationService';

export default function DepartmentLocationManager({
  department,
  organization,
  isOpen,
  onClose,
  onDepartmentUpdated
}) {
  const [activeTab, setActiveTab] = useState('counters'); // 'counters' | 'rooms'
  const [rooms, setRooms] = useState([]);
  const [counters, setCounters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Room Form State
  const [isAddingRoom, setIsAddingRoom] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [roomForm, setRoomForm] = useState({ roomNumber: '', name: '' });
  const [submittingRoom, setSubmittingRoom] = useState(false);

  // Counter Form State
  const [isAddingCounter, setIsAddingCounter] = useState(false);
  const [editingCounter, setEditingCounter] = useState(null);
  const [counterForm, setCounterForm] = useState({
    counterNumber: '',
    name: '',
    roomNumber: '',
    status: 'AVAILABLE',
    isActive: true
  });
  const [submittingCounter, setSubmittingCounter] = useState(false);

  const deptId = department?._id;
  const orgId = organization?._id || department?.orgId;

  const loadData = useCallback(async () => {
    if (!deptId) return;
    setLoading(true);
    setError('');
    try {
      const [roomsList, countersList] = await Promise.all([
        getDepartmentRooms(deptId),
        getDepartmentCounters(deptId, orgId)
      ]);
      setRooms(roomsList || []);
      setCounters(countersList || []);
    } catch (err) {
      console.error('Failed to load department locations:', err);
      setError(err.response?.data?.error || err.message || 'Failed to load rooms and counters');
    } finally {
      setLoading(false);
    }
  }, [deptId, orgId]);

  useEffect(() => {
    if (isOpen && deptId) {
      loadData();
      setIsAddingRoom(false);
      setEditingRoom(null);
      setIsAddingCounter(false);
      setEditingCounter(null);
      setError('');
      setSuccess('');
    }
  }, [isOpen, deptId, loadData]);

  if (!isOpen || !department) return null;

  // ─────────────────────────────────────────────────────────────────────────────
  // ROOM HANDLERS
  // ─────────────────────────────────────────────────────────────────────────────
  const handleOpenAddRoom = () => {
    setEditingRoom(null);
    setRoomForm({ roomNumber: '', name: '' });
    setIsAddingRoom(true);
    setError('');
  };

  const handleOpenEditRoom = (room) => {
    setEditingRoom(room);
    setRoomForm({ roomNumber: room.roomNumber || '', name: room.name || '' });
    setIsAddingRoom(true);
    setError('');
  };

  const handleSaveRoom = async (e) => {
    e.preventDefault();
    if (!roomForm.roomNumber.trim()) {
      setError('Room number is required.');
      return;
    }
    setSubmittingRoom(true);
    setError('');
    setSuccess('');
    try {
      if (editingRoom && editingRoom._id && !editingRoom.isDefault) {
        await updateDepartmentRoom(deptId, editingRoom._id, {
          roomNumber: roomForm.roomNumber.trim(),
          name: roomForm.name.trim()
        });
        setSuccess(`Room ${roomForm.roomNumber} updated successfully.`);
      } else {
        await createDepartmentRoom(deptId, {
          roomNumber: roomForm.roomNumber.trim(),
          name: roomForm.name.trim()
        });
        setSuccess(`Room ${roomForm.roomNumber} added successfully.`);
      }
      setIsAddingRoom(false);
      setEditingRoom(null);
      setRoomForm({ roomNumber: '', name: '' });
      await loadData();
      if (onDepartmentUpdated) onDepartmentUpdated();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save room');
    } finally {
      setSubmittingRoom(false);
    }
  };

  const handleDeleteRoom = async (room) => {
    if (!room._id || room.isDefault) {
      setError('This default room cannot be deleted directly. Add configured rooms first.');
      return;
    }
    if (!window.confirm(`Are you sure you want to delete Room ${room.roomNumber}?`)) return;

    setError('');
    setSuccess('');
    try {
      await deleteDepartmentRoom(deptId, room._id);
      setSuccess(`Room ${room.roomNumber} removed.`);
      await loadData();
      if (onDepartmentUpdated) onDepartmentUpdated();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete room');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // COUNTER HANDLERS
  // ─────────────────────────────────────────────────────────────────────────────
  const getNextCounterNumber = () => {
    if (!counters.length) return 1;
    const maxNum = Math.max(...counters.map(c => Number(c.counterNumber) || 0));
    return maxNum + 1;
  };

  const handleOpenAddCounter = () => {
    setEditingCounter(null);
    const nextNum = getNextCounterNumber();
    const defaultRoom = rooms[0]?.roomNumber || department.roomNumber || '';
    setCounterForm({
      counterNumber: String(nextNum),
      name: `Counter ${nextNum}`,
      roomNumber: defaultRoom,
      status: 'AVAILABLE',
      isActive: true
    });
    setIsAddingCounter(true);
    setError('');
  };

  const handleOpenEditCounter = (counter) => {
    setEditingCounter(counter);
    setCounterForm({
      counterNumber: String(counter.counterNumber || ''),
      name: counter.name || '',
      roomNumber: counter.roomNumber || '',
      status: counter.status || 'AVAILABLE',
      isActive: counter.isActive !== false
    });
    setIsAddingCounter(true);
    setError('');
  };

  const handleSaveCounter = async (e) => {
    e.preventDefault();
    if (!counterForm.counterNumber) {
      setError('Counter number is required.');
      return;
    }
    setSubmittingCounter(true);
    setError('');
    setSuccess('');
    try {
      if (editingCounter) {
        await updateCounter(editingCounter._id, {
          counterNumber: Number(counterForm.counterNumber),
          name: counterForm.name.trim() || `Counter ${counterForm.counterNumber}`,
          roomNumber: counterForm.roomNumber.trim(),
          status: counterForm.status,
          isActive: counterForm.isActive
        });
        setSuccess(`Counter ${counterForm.counterNumber} updated.`);
      } else {
        await createDepartmentCounter(deptId, {
          organizationId: orgId,
          counterNumber: Number(counterForm.counterNumber),
          name: counterForm.name.trim() || `Counter ${counterForm.counterNumber}`,
          roomNumber: counterForm.roomNumber.trim(),
          status: counterForm.status || 'AVAILABLE',
          isActive: counterForm.isActive
        });
        setSuccess(`Counter ${counterForm.counterNumber} created.`);
      }
      setIsAddingCounter(false);
      setEditingCounter(null);
      await loadData();
      if (onDepartmentUpdated) onDepartmentUpdated();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save counter');
    } finally {
      setSubmittingCounter(false);
    }
  };

  const handleToggleCounterStatus = async (counter) => {
    const newIsActive = !counter.isActive;
    const newStatus = newIsActive ? 'AVAILABLE' : 'OFFLINE';
    setError('');
    setSuccess('');
    try {
      await updateCounter(counter._id, {
        isActive: newIsActive,
        status: newStatus
      });
      setSuccess(`Counter ${counter.counterNumber} is now ${newStatus}.`);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to update counter status');
    }
  };

  const handleDeleteCounter = async (counter) => {
    if (!window.confirm(`Are you sure you want to delete Counter ${counter.counterNumber}?`)) return;
    setError('');
    setSuccess('');
    try {
      await deleteCounter(counter._id);
      setSuccess(`Counter ${counter.counterNumber} deleted.`);
      await loadData();
      if (onDepartmentUpdated) onDepartmentUpdated();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete counter');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="bg-white border border-neutral-200 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-sans">
        
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase font-mono tracking-wider text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/60">
                {department.prefix}
              </span>
              <h2 className="text-base font-bold tracking-tight text-white">
                {department.name}
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
              <span>{organization?.name || 'Department Physical Locations'}</span>
              <span>•</span>
              <span>Manage Service Rooms & Queue Counters</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between px-6 border-b border-neutral-200 bg-neutral-50/80">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('counters')}
              className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition cursor-pointer ${
                activeTab === 'counters'
                  ? 'border-emerald-700 text-emerald-800 bg-white'
                  : 'border-transparent text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              <span>Service Counters ({counters.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('rooms')}
              className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition cursor-pointer ${
                activeTab === 'rooms'
                  ? 'border-emerald-700 text-emerald-800 bg-white'
                  : 'border-transparent text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <DoorOpen className="w-4 h-4" />
              <span>Physical Rooms ({rooms.length})</span>
            </button>
          </div>

          <div className="py-2">
            {activeTab === 'counters' ? (
              <button
                type="button"
                onClick={handleOpenAddCounter}
                className="inline-flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold py-1.5 px-3 rounded-lg transition shadow-xs cursor-pointer"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Add Counter</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleOpenAddRoom}
                className="inline-flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold py-1.5 px-3 rounded-lg transition shadow-xs cursor-pointer"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Add Room</span>
              </button>
            )}
          </div>
        </div>

        {/* Alerts */}
        <div className="px-6 pt-3">
          {error && (
            <div className="p-3 mb-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-700 shrink-0" />
                <span>{error}</span>
              </div>
              <button onClick={() => setError('')} className="text-rose-700 hover:text-rose-900">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {success && (
            <div className="p-3 mb-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>{success}</span>
              </div>
              <button onClick={() => setSuccess('')} className="text-emerald-700 hover:text-emerald-900">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Modal Body / Tab Content */}
        <div className="flex-1 overflow-y-auto px-6 py-3 space-y-4">
          
          {loading ? (
            <div className="p-12 text-center text-neutral-500 flex flex-col items-center gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-neutral-400" />
              <span className="text-xs">Loading physical location configuration...</span>
            </div>
          ) : activeTab === 'counters' ? (
            /* ───────────────────────────────────────────────────────────── */
            /* COUNTERS TAB                                                  */
            /* ───────────────────────────────────────────────────────────── */
            <div className="space-y-4">
              {/* Add/Edit Counter Inline Drawer */}
              {isAddingCounter && (
                <div className="border border-emerald-200 bg-emerald-50/40 p-4 rounded-xl space-y-3">
                  <div className="flex items-center justify-between pb-1 border-b border-emerald-200/60">
                    <h4 className="text-xs font-bold text-emerald-900 uppercase">
                      {editingCounter ? `Edit Counter ${editingCounter.counterNumber}` : 'Create New Counter'}
                    </h4>
                    <button
                      type="button"
                      onClick={() => { setIsAddingCounter(false); setEditingCounter(null); }}
                      className="text-neutral-400 hover:text-neutral-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <form onSubmit={handleSaveCounter} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-700 mb-1">
                        Counter Number *
                      </label>
                      <input
                        type="number"
                        min="1"
                        required
                        value={counterForm.counterNumber}
                        onChange={e => setCounterForm({ ...counterForm, counterNumber: e.target.value })}
                        placeholder="1"
                        className="w-full text-xs border border-neutral-300 rounded-lg p-2 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-700"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-700 mb-1">
                        Display Name / Purpose
                      </label>
                      <input
                        type="text"
                        value={counterForm.name}
                        onChange={e => setCounterForm({ ...counterForm, name: e.target.value })}
                        placeholder="e.g. Registration Desk"
                        className="w-full text-xs border border-neutral-300 rounded-lg p-2 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-700"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-700 mb-1">
                        Physical Room
                      </label>
                      <select
                        value={counterForm.roomNumber}
                        onChange={e => setCounterForm({ ...counterForm, roomNumber: e.target.value })}
                        className="w-full text-xs border border-neutral-300 rounded-lg p-2 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-700"
                      >
                        <option value="">-- No specific room --</option>
                        {rooms.map((r, i) => (
                          <option key={r._id || i} value={r.roomNumber}>
                            Room {r.roomNumber} {r.name ? `(${r.name})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="sm:col-span-3 flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => { setIsAddingCounter(false); setEditingCounter(null); }}
                        className="px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-200 rounded-lg"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={submittingCounter}
                        className="px-4 py-1.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-lg transition"
                      >
                        {submittingCounter ? 'Saving...' : editingCounter ? 'Update Counter' : 'Create Counter'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Counters List */}
              {counters.length === 0 ? (
                <div className="border border-dashed border-neutral-200 rounded-xl p-8 text-center text-xs text-neutral-500 bg-neutral-50 space-y-2">
                  <LayoutGrid className="w-8 h-8 text-neutral-400 mx-auto" />
                  <p className="font-semibold text-neutral-700">No counters configured for this department yet.</p>
                  <p className="text-neutral-500">Create service counters so workers can be assigned and tickets can be processed or transferred.</p>
                  <button
                    type="button"
                    onClick={handleOpenAddCounter}
                    className="mt-2 inline-flex items-center gap-1 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold py-1.5 px-3 rounded-lg"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>Add First Counter</span>
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-neutral-100 border border-neutral-200 rounded-xl overflow-hidden bg-white">
                  {counters.map(counter => (
                    <div
                      key={counter._id}
                      className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-neutral-50/60 transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs ${
                          counter.isActive
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-neutral-100 text-neutral-500 border border-neutral-200'
                        }`}>
                          #{counter.counterNumber}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-neutral-900">
                              {counter.name || `Counter ${counter.counterNumber}`}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              counter.status === 'AVAILABLE'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : counter.status === 'BUSY'
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : 'bg-neutral-100 text-neutral-600 border border-neutral-200'
                            }`}>
                              {counter.status}
                            </span>
                            {!counter.isActive && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                Inactive
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-500 mt-0.5">
                            <span className="flex items-center gap-1">
                              <DoorOpen className="w-3.5 h-3.5 text-neutral-400" />
                              <span>{counter.roomNumber ? `Room ${counter.roomNumber}` : 'No room specified'}</span>
                            </span>
                            {counter.assignedWorkerId && (
                              <span className="flex items-center gap-1 text-emerald-700 font-medium">
                                <UserCheck className="w-3.5 h-3.5" />
                                <span>Assigned to: {counter.assignedWorkerId.name || 'Worker'}</span>
                              </span>
                            )}
                            {counter.currentTicketId && (
                              <span className="text-amber-700 font-medium font-mono">
                                Serving: #{counter.currentTicketId.ticketNumber}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => handleToggleCounterStatus(counter)}
                          className="p-1.5 text-neutral-500 hover:text-neutral-800 rounded-lg hover:bg-neutral-100 transition"
                          title={counter.isActive ? 'Deactivate Counter' : 'Activate Counter'}
                        >
                          {counter.isActive ? (
                            <ToggleRight className="w-5 h-5 text-emerald-700" />
                          ) : (
                            <ToggleLeft className="w-5 h-5 text-neutral-400" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenEditCounter(counter)}
                          className="p-1.5 text-neutral-600 hover:text-neutral-900 rounded-lg hover:bg-neutral-100 transition"
                          title="Edit Counter"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCounter(counter)}
                          className="p-1.5 text-rose-600 hover:text-rose-800 rounded-lg hover:bg-rose-50 transition"
                          title="Delete Counter"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ───────────────────────────────────────────────────────────── */
            /* ROOMS TAB                                                     */
            /* ───────────────────────────────────────────────────────────── */
            <div className="space-y-4">
              {/* Add/Edit Room Inline Drawer */}
              {isAddingRoom && (
                <div className="border border-emerald-200 bg-emerald-50/40 p-4 rounded-xl space-y-3">
                  <div className="flex items-center justify-between pb-1 border-b border-emerald-200/60">
                    <h4 className="text-xs font-bold text-emerald-900 uppercase">
                      {editingRoom ? `Edit Room ${editingRoom.roomNumber}` : 'Add New Physical Room'}
                    </h4>
                    <button
                      type="button"
                      onClick={() => { setIsAddingRoom(false); setEditingRoom(null); }}
                      className="text-neutral-400 hover:text-neutral-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <form onSubmit={handleSaveRoom} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-700 mb-1">
                        Room Number / Code *
                      </label>
                      <input
                        type="text"
                        required
                        value={roomForm.roomNumber}
                        onChange={e => setRoomForm({ ...roomForm, roomNumber: e.target.value })}
                        placeholder="e.g. 101, A-204"
                        className="w-full text-xs border border-neutral-300 rounded-lg p-2 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-700"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-700 mb-1">
                        Room Name / Purpose
                      </label>
                      <input
                        type="text"
                        value={roomForm.name}
                        onChange={e => setRoomForm({ ...roomForm, name: e.target.value })}
                        placeholder="e.g. Registration & Vitals"
                        className="w-full text-xs border border-neutral-300 rounded-lg p-2 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-700"
                      />
                    </div>

                    <div className="sm:col-span-2 flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => { setIsAddingRoom(false); setEditingRoom(null); }}
                        className="px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-200 rounded-lg"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={submittingRoom}
                        className="px-4 py-1.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-lg transition"
                      >
                        {submittingRoom ? 'Saving...' : editingRoom ? 'Update Room' : 'Add Room'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Rooms List */}
              {rooms.length === 0 ? (
                <div className="border border-dashed border-neutral-200 rounded-xl p-8 text-center text-xs text-neutral-500 bg-neutral-50 space-y-2">
                  <DoorOpen className="w-8 h-8 text-neutral-400 mx-auto" />
                  <p className="font-semibold text-neutral-700">No rooms configured for this department yet.</p>
                  <p className="text-neutral-500">Add physical room numbers (e.g. Room 101, Room 102) to associate with counters and ticket transfers.</p>
                  <button
                    type="button"
                    onClick={handleOpenAddRoom}
                    className="mt-2 inline-flex items-center gap-1 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold py-1.5 px-3 rounded-lg"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>Add First Room</span>
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-neutral-100 border border-neutral-200 rounded-xl overflow-hidden bg-white">
                  {rooms.map((room, idx) => {
                    const countersInRoom = counters.filter(c => c.roomNumber === room.roomNumber);
                    return (
                      <div
                        key={room._id || idx}
                        className="p-3.5 flex items-center justify-between hover:bg-neutral-50/60 transition"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 flex items-center justify-center font-bold text-xs">
                            <DoorOpen className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-neutral-900">
                                Room {room.roomNumber}
                              </span>
                              {room.name && (
                                <span className="text-xs text-neutral-600 font-medium">
                                  — {room.name}
                                </span>
                              )}
                              {room.isDefault && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-neutral-100 text-neutral-700 border border-neutral-200">
                                  Default
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-neutral-500 mt-0.5">
                              {countersInRoom.length} counter(s) in this room
                              {countersInRoom.length > 0 && ` (${countersInRoom.map(c => `Counter ${c.counterNumber}`).join(', ')})`}
                            </div>
                          </div>
                        </div>

                        {!room.isDefault && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditRoom(room)}
                              className="p-1.5 text-neutral-600 hover:text-neutral-900 rounded-lg hover:bg-neutral-100 transition"
                              title="Edit Room"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteRoom(room)}
                              className="p-1.5 text-rose-600 hover:text-rose-800 rounded-lg hover:bg-rose-50 transition"
                              title="Delete Room"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-neutral-50 border-t border-neutral-200 flex items-center justify-between">
          <div className="text-[11px] text-neutral-500">
            Rooms and counters are shared authoritatively across Staff Approvals and Token Transfers.
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-900 text-white text-xs font-semibold rounded-lg transition cursor-pointer"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
}
