import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  getAdminDashboard,
  getAdminUsers,
  updateUserRole,
  suspendUser,
  unsuspendUser,
  getAdminListings,
  deleteAdminListing,
  getAdminReports,
  updateAdminReportStatus,
  getAdminTransactions,
  adminRefundTransaction,
  autoSuspendUsers,
  getPendingSellerVerifications,
  reviewSellerBadge,
  getInsuranceClaims,
  reviewInsuranceClaim,
} from '../services/api';
import { FaShieldAlt, FaUsers, FaList, FaFlag, FaExchangeAlt, FaSearch, FaTimes, FaCheck, FaBan, FaTrash } from 'react-icons/fa';
import { formatPrice } from '../utils/helpers';

const Admin = () => {
  const { user } = useAuth();
  const confirmDialog = useConfirm();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashboard, setDashboard] = useState(null);
  const [users, setUsers] = useState([]);
  const [listings, setListings] = useState([]);
  const [reports, setReports] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [sellerVerifications, setSellerVerifications] = useState([]);
  const [insuranceClaims, setInsuranceClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const tabRefs = useRef({});

  useEffect(() => {
    if (!user || (user.role !== 'admin' && user.role !== 'moderator')) {
      navigate('/login');
      return;
    }
    fetchData();
  }, [user, navigate, activeTab, page]); // eslint-disable-line

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'dashboard') {
        const res = await getAdminDashboard();
        setDashboard(res.data);
      } else if (activeTab === 'users') {
        const res = await getAdminUsers({ search, page, limit: 20 });
        setUsers(res.data.users || []);
      } else if (activeTab === 'listings') {
        const res = await getAdminListings({ page, limit: 20 });
        setListings(res.data.listings || []);
      } else if (activeTab === 'reports') {
        const res = await getAdminReports({ page, limit: 20 });
        setReports(res.data.reports || []);
      } else if (activeTab === 'transactions') {
        const res = await getAdminTransactions({ page, limit: 20 });
        setTransactions(res.data.transactions || []);
      } else if (activeTab === 'verifications') {
        const res = await getPendingSellerVerifications();
        setSellerVerifications(res.data.badges || []);
      } else if (activeTab === 'insurance') {
        const res = await getInsuranceClaims({ status: 'pending', limit: 50 });
        setInsuranceClaims(res.data.claims || []);
      }
    } catch (error) {
      console.error('Admin fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId, role, name, previousRole, selectEl) => {
    const ok = await confirmDialog({
      title: 'Change user role?',
      message: `${name || 'This user'} will become ${role}. This changes what they can see and do.`,
      confirmLabel: 'Change role',
      danger: role === 'admin',
    });
    // A controlled <select> only repaints when React re-renders, and cancelling
    // changes no state — so put the user's real role back explicitly, both when
    // the dialog is dismissed and when the write fails.
    const restoreRole = () => { if (selectEl) selectEl.value = previousRole; };
    if (!ok) {
      restoreRole();
      return;
    }
    try {
      await updateUserRole(userId, role);
      toast.success(`Role updated to ${role}`);
      fetchData();
    } catch (error) {
      restoreRole();
      toast.error(error.response?.data?.message || 'Could not update the role');
    }
  };

  const handleSuspend = async (userId, name) => {
    const ok = await confirmDialog({
      title: 'Suspend this user?',
      message: `${name || 'This user'} will lose access immediately. Transactions and payouts are unaffected.`,
      confirmLabel: 'Suspend',
      danger: true,
    });
    if (!ok) return;
    try {
      await suspendUser(userId);
      toast.success(`${name || 'User'} suspended`);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not suspend the user');
    }
  };

  const handleUnsuspend = async (userId, name) => {
    const ok = await confirmDialog({
      title: 'Restore this user?',
      message: `${name || 'This user'} will regain access with their previous role.`,
      confirmLabel: 'Restore access',
    });
    if (!ok) return;
    try {
      await unsuspendUser(userId);
      toast.success(`${name || 'User'} restored`);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not restore the user');
    }
  };

  const handleDeleteListing = async (listingId) => {
    const ok = await confirmDialog({
      title: 'Delete listing?',
      message: 'Are you sure you want to delete this listing?',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteAdminListing(listingId);
      toast.success('Listing deleted');
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not delete the listing');
    }
  };

  const handleResolveReport = async (reportId, status) => {
    const resolving = status === 'resolved';
    const ok = await confirmDialog({
      title: resolving ? 'Resolve this report?' : 'Dismiss this report?',
      message: resolving
        ? 'The report will be marked resolved. The listing stays live.'
        : 'The report will be dismissed. The listing stays live.',
      confirmLabel: resolving ? 'Resolve' : 'Dismiss',
      danger: !resolving,
    });
    if (!ok) return;
    try {
      await updateAdminReportStatus(reportId, status);
      toast.success(resolving ? 'Report resolved' : 'Report dismissed');
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not update the report');
    }
  };

  const handleRefund = async (transactionId) => {
    const ok = await confirmDialog({
      title: 'Force refund?',
      message: 'Force refund this transaction? This cannot be undone.',
      confirmLabel: 'Force Refund',
      danger: true,
    });
    if (!ok) return;
    try {
      await adminRefundTransaction(transactionId);
      toast.success('Refund issued');
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not issue the refund');
    }
  };

  const handleReviewSellerBadge = async (userId, decision) => {
    try {
      await reviewSellerBadge(userId, {
        decision,
        ...(decision === 'reject' ? { reason: 'Verification requirements were not met' } : {}),
      });
      toast.success(decision === 'approve' ? 'Seller verification approved' : 'Seller verification rejected');
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to review seller verification');
    }
  };

  const handleAutoSuspend = async () => {
    const ok = await confirmDialog({
      title: 'Auto-suspend users?',
      message: 'Auto-suspend all users with 3+ strikes?',
      confirmLabel: 'Auto-Suspend',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await autoSuspendUsers();
      toast.success(res.data.message);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not auto-suspend users');
    }
  };

  const handleInsuranceReview = async (policyId, status) => {
    const ok = await confirmDialog({
      title: status === 'approved' ? 'Approve insurance claim?' : 'Deny insurance claim?',
      message: status === 'approved'
        ? 'The payout (net of the premium) will be released to the seller.'
        : 'The seller will see the claim as denied.',
      confirmLabel: status === 'approved' ? 'Approve' : 'Deny',
      danger: status !== 'approved',
    });
    if (!ok) return;
    try {
      await reviewInsuranceClaim(policyId, { status });
      toast.success(status === 'approved' ? 'Insurance claim approved' : 'Insurance claim denied');
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to review insurance claim');
    }
  };

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: <FaShieldAlt /> },
    { id: 'users', label: 'Users', icon: <FaUsers /> },
    { id: 'listings', label: 'Listings', icon: <FaList /> },
    { id: 'reports', label: 'Reports', icon: <FaFlag /> },
    { id: 'transactions', label: 'Transactions', icon: <FaExchangeAlt /> },
    { id: 'verifications', label: 'Verifications', icon: <FaCheck /> },
    { id: 'insurance', label: 'Insurance', icon: <FaShieldAlt /> },
  ];

  const visibleTabs = tabs.filter(tab => !['verifications', 'insurance'].includes(tab.id) || user?.role === 'admin');

  const selectTab = (id) => {
    setActiveTab(id);
    setPage(1);
  };

  // Standard tabs pattern: one tab stop for the strip, arrows/Home/End move
  // between sections instead of forcing seven Tabs before the page content.
  const handleTabKeyDown = (event, index) => {
    let nextIndex = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % visibleTabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + visibleTabs.length) % visibleTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = visibleTabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = visibleTabs[nextIndex];
    selectTab(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  };

  if (!user || (user.role !== 'admin' && user.role !== 'moderator')) return null;

  return (
    <div className="page-container" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <FaShieldAlt /> Admin Panel
      </h1>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 'var(--td-space-lg)', flexWrap: 'wrap' }}>
        <div role="tablist" aria-label="Admin sections" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, flex: 1 }}>
          {visibleTabs.map((tab, index) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={(el) => { tabRefs.current[tab.id] = el; }}
                type="button"
                role="tab"
                id={`admin-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls="admin-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => selectTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={`btn ${selected ? 'btn-primary' : 'btn-outline'}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
              >
                {tab.icon} {tab.label}
              </button>
            );
          })}
        </div>
        {user.role === 'admin' && (
          <button type="button" onClick={handleAutoSuspend} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--td-error)', marginBottom: 8 }}>
            <FaBan aria-hidden="true" /> Auto-Suspend
          </button>
        )}
      </div>

      <div role="tabpanel" id="admin-panel" aria-labelledby={`admin-tab-${activeTab}`}>
      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && (
        <div>
          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
              {[...Array(5)].map((_, i) => <div key={i} className="skeleton" style={{ height: 100, borderRadius: 'var(--td-radius-lg)' }} />)}
            </div>
          ) : dashboard ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 'var(--td-space-lg)' }}>
                <div className="glass-card" style={{ padding: 'var(--td-space-lg)', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Total Users</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--td-primary)' }}>{dashboard.stats.totalUsers}</div>
                </div>
                <div className="glass-card" style={{ padding: 'var(--td-space-lg)', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Total Listings</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--td-success)' }}>{dashboard.stats.totalListings}</div>
                </div>
                <div className="glass-card" style={{ padding: 'var(--td-space-lg)', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Total Transactions</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--td-info)' }}>{dashboard.stats.totalTransactions}</div>
                </div>
                <div className="glass-card" style={{ padding: 'var(--td-space-lg)', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Pending Reports</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--td-warning)' }}>{dashboard.stats.pendingReports?.length || 0}</div>
                </div>
                <div className="glass-card" style={{ padding: 'var(--td-space-lg)', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Total Commission</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--td-primary)' }}>{formatPrice(dashboard.stats.totalCommission || 0, 'USD')}</div>
                </div>
              </div>

              {/* Recent Transactions */}
              <div className="glass-card" style={{ marginBottom: 'var(--td-space-lg)' }}>
                <div style={{ padding: 'var(--td-space-md) var(--td-space-lg)', borderBottom: '1px solid var(--td-border)', fontWeight: 700, fontSize: 16 }}>Recent Transactions</div>
                {dashboard.recentTransactions?.length === 0 ? (
                  <div className="empty-state" style={{ padding: 'var(--td-space-xl)' }}>
                    <h3>No transactions</h3>
                  </div>
                ) : (
                  dashboard.recentTransactions?.map((t, i) => (
                    <div key={i} style={{ padding: '12px var(--td-space-lg)', borderBottom: '1px solid var(--td-border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14 }}>
                      <div>
                        <strong>{t.buyer?.name || 'Unknown'}</strong> → <strong>{t.seller?.name || 'Unknown'}</strong>
                        <span style={{ color: 'var(--td-text-tertiary)', marginLeft: 8 }}>{t.listing?.title}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontWeight: 600 }}>{formatPrice(t.paymentBreakdown?.totalPaid, t.currency || 'USD')}</span>
                        <span className={`badge badge-${t.status === 'completed' ? 'success' : t.status === 'paid' ? 'info' : t.status === 'refunded' ? 'error' : 'warning'}`}>{t.status}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Pending Reports */}
              {dashboard.pendingReports?.length > 0 && (
                <div className="glass-card">
                  <div style={{ padding: 'var(--td-space-md) var(--td-space-lg)', borderBottom: '1px solid var(--td-border)', fontWeight: 700, fontSize: 16 }}>Pending Reports</div>
                  {dashboard.pendingReports.map((r, i) => (
                    <div key={i} style={{ padding: '12px var(--td-space-lg)', borderBottom: '1px solid var(--td-border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14 }}>
                      <div>
                        <strong>{r.reporter?.name}</strong> reported <strong>{r.listing?.title}</strong>
                        <div style={{ color: 'var(--td-text-tertiary)', fontSize: 12 }}>{r.reason}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => handleResolveReport(r._id, 'resolved')} aria-label="Resolve report" className="btn btn-sm" style={{ background: 'rgba(0,200,83,0.1)', color: 'var(--td-success)', border: 'none' }}><FaCheck /></button>
                        <button onClick={() => handleResolveReport(r._id, 'dismissed')} aria-label="Dismiss report" className="btn btn-sm" style={{ background: 'rgba(255,23,68,0.1)', color: 'var(--td-error)', border: 'none' }}><FaTimes /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="empty-state"><h2>Failed to load dashboard</h2></div>
          )}
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 'var(--td-space-md)' }}>
            <input
              type="text"
              aria-label="Search users by name or email"
              placeholder="Search users by name or email..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="input"
              style={{ flex: 1 }}
            />
            <button onClick={fetchData} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FaSearch /> Search</button>
          </div>
          {loading ? (
            <div className="skeleton" style={{ height: 200, borderRadius: 'var(--td-radius-lg)' }} />
          ) : (
            <div className="glass-card" style={{ overflow: 'hidden' }}>
              <table tabIndex={0} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <caption className="sr-only">Admin users</caption>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--td-border)' }}>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Name</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Email</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Role</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Strikes</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: 'var(--td-text-tertiary)' }}>No users found</td></tr>
                  ) : (
                    users.map((u, i) => (
                      <tr key={u._id} style={{ borderBottom: '1px solid var(--td-border-light)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                        <td style={{ padding: '12px 16px' }}>{u.name}</td>
                        <td style={{ padding: '12px 16px', color: 'var(--td-text-tertiary)' }}>{u.email}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <span className={`badge badge-${u.role === 'admin' ? 'primary' : u.role === 'suspended' ? 'error' : u.role === 'moderator' ? 'info' : 'success'}`}>
                            {u.role}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>{u.stats?.strikes || 0}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {user.role === 'admin' && u.role !== 'admin' && (
                              <>
                                <select
                                  aria-label={`Role for ${u.name || u.email || 'user'}`}
                                  value={u.role}
                                  onChange={e => handleRoleChange(u._id, e.target.value, u.name || u.email, u.role, e.target)}
                                  className="input"
                                  style={{ width: 110, fontSize: 12, padding: '4px 8px' }}
                                >
                                  <option value="user">user</option>
                                  <option value="moderator">moderator</option>
                                  <option value="legal_counsel">legal_counsel</option>
                                  <option value="admin">admin</option>
                                </select>
                                {u.role !== 'suspended' ? (
                                  <button type="button" onClick={() => handleSuspend(u._id, u.name || u.email)} aria-label={`Suspend ${u.name || u.email || 'user'}`} className="btn btn-sm" style={{ background: 'rgba(255,23,68,0.1)', color: 'var(--td-error)', border: 'none' }}>
                                    <FaBan size={12} />
                                  </button>
                                ) : (
                                  <button type="button" onClick={() => handleUnsuspend(u._id, u.name || u.email)} aria-label={`Unsuspend ${u.name || u.email || 'user'}`} className="btn btn-sm" style={{ background: 'rgba(0,200,83,0.1)', color: 'var(--td-success)', border: 'none' }}>
                                    <FaCheck size={12} />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Listings Tab */}
      {activeTab === 'listings' && (
        <div>
          {loading ? (
            <div className="skeleton" style={{ height: 200, borderRadius: 'var(--td-radius-lg)' }} />
          ) : (
            <div className="glass-card" style={{ overflow: 'hidden' }}>
              <table tabIndex={0} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <caption className="sr-only">Admin listings</caption>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--td-border)' }}>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Title</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Seller</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Price</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Status</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {listings.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: 'var(--td-text-tertiary)' }}>No listings found</td></tr>
                  ) : (
                    listings.map((l, i) => (
                      <tr key={l._id} style={{ borderBottom: '1px solid var(--td-border-light)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                        <td style={{ padding: '12px 16px' }}>{l.title}</td>
                        <td style={{ padding: '12px 16px', color: 'var(--td-text-tertiary)' }}>{l.seller?.name || 'Unknown'}</td>
                        <td style={{ padding: '12px 16px', fontWeight: 600 }}>{formatPrice(l.price, l.currency || 'USD')}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <span className={`badge badge-${l.sold ? 'error' : 'success'}`}>{l.sold ? 'Sold' : 'Active'}</span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <button onClick={() => handleDeleteListing(l._id)} className="btn btn-sm" style={{ background: 'rgba(255,23,68,0.1)', color: 'var(--td-error)', border: 'none' }}>
                            <FaTrash size={12} /> Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Reports Tab */}
      {activeTab === 'reports' && (
        <div>
          {loading ? (
            <div className="skeleton" style={{ height: 200, borderRadius: 'var(--td-radius-lg)' }} />
          ) : (
            <div className="glass-card" style={{ overflow: 'hidden' }}>
              <table tabIndex={0} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <caption className="sr-only">Admin listing reports</caption>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--td-border)' }}>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Reporter</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Listing</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Reason</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Status</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: 'var(--td-text-tertiary)' }}>No reports found</td></tr>
                  ) : (
                    reports.map((r, i) => (
                      <tr key={r._id} style={{ borderBottom: '1px solid var(--td-border-light)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                        <td style={{ padding: '12px 16px' }}>{r.reporter?.name || 'Unknown'}</td>
                        <td style={{ padding: '12px 16px' }}>{r.listing?.title || 'Unknown'}</td>
                        <td style={{ padding: '12px 16px', color: 'var(--td-text-tertiary)' }}>{r.reason}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <span className={`badge badge-${r.status === 'resolved' ? 'success' : r.status === 'dismissed' ? 'warning' : 'info'}`}>{r.status}</span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {r.status === 'pending' && (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => handleResolveReport(r._id, 'resolved')} className="btn btn-sm" style={{ background: 'rgba(0,200,83,0.1)', color: 'var(--td-success)', border: 'none' }}><FaCheck /> Resolve</button>
                              <button onClick={() => handleResolveReport(r._id, 'dismissed')} className="btn btn-sm" style={{ background: 'rgba(255,23,68,0.1)', color: 'var(--td-error)', border: 'none' }}><FaTimes /> Dismiss</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Seller Verification Tab */}
      {activeTab === 'verifications' && (
        <div>
          {loading ? (
            <div className="skeleton" style={{ height: 200, borderRadius: 'var(--td-radius-lg)' }} />
          ) : (
            <div className="glass-card" style={{ overflow: 'hidden' }}>
              <table tabIndex={0} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <caption className="sr-only">Admin payout requests</caption>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--td-border)' }}>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left' }}>Seller</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left' }}>Country</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left' }}>Requested</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sellerVerifications.length === 0 ? (
                    <tr><td colSpan={4} style={{ padding: 32, textAlign: 'center', color: 'var(--td-text-tertiary)' }}>No pending verifications</td></tr>
                  ) : sellerVerifications.map((badge) => (
                    <tr key={badge._id} style={{ borderBottom: '1px solid var(--td-border-light)' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <strong>{badge.userId?.name || 'Unknown seller'}</strong>
                        <div style={{ color: 'var(--td-text-tertiary)', fontSize: 12 }}>{badge.userId?.email}</div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>{badge.userId?.country || '—'}</td>
                      <td style={{ padding: '12px 16px' }}>{badge.updatedAt ? new Date(badge.updatedAt).toLocaleDateString() : '—'}</td>
                      <td style={{ padding: '12px 16px' }}>
                        {user.role === 'admin' && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => handleReviewSellerBadge(badge.userId?._id, 'approve')} className="btn btn-sm" style={{ background: 'rgba(0,200,83,0.1)', color: 'var(--td-success)', border: 'none' }}><FaCheck /> Approve</button>
                            <button onClick={() => handleReviewSellerBadge(badge.userId?._id, 'reject')} className="btn btn-sm" style={{ background: 'rgba(255,23,68,0.1)', color: 'var(--td-error)', border: 'none' }}><FaTimes /> Reject</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Insurance Claims Tab */}
      {activeTab === 'insurance' && (
        <div>
          {loading ? (
            <div className="skeleton" style={{ height: 200, borderRadius: 'var(--td-radius-lg)' }} />
          ) : (
            <div className="glass-card" style={{ overflow: 'hidden' }}>
              <table tabIndex={0} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <caption className="sr-only">Admin subscriptions</caption>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--td-border)' }}>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Seller</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Item value</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Premium</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Reason</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {insuranceClaims.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: 'var(--td-text-tertiary)' }}>No pending insurance claims</td></tr>
                  ) : (
                    insuranceClaims.map((c, i) => (
                      <tr key={c._id} style={{ borderBottom: '1px solid var(--td-border-light)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                        <td style={{ padding: '12px 16px' }}>{c.seller?.name || 'Unknown'}</td>
                        <td style={{ padding: '12px 16px', fontWeight: 600 }}>{formatPrice(c.itemValue || 0, c.currency || 'USD')}</td>
                        <td style={{ padding: '12px 16px' }}>{formatPrice(c.premium || 0, c.currency || 'USD')}</td>
                        <td style={{ padding: '12px 16px', color: 'var(--td-text-tertiary)' }}>{c.claim?.reason || 'N/A'}</td>
                        <td style={{ padding: '12px 16px', display: 'flex', gap: 8 }}>
                          <button onClick={() => handleInsuranceReview(c._id, 'approved')} className="btn btn-sm btn-primary">
                            <FaCheck size={12} /> Approve
                          </button>
                          <button onClick={() => handleInsuranceReview(c._id, 'denied')} className="btn btn-sm btn-outline" style={{ color: 'var(--td-error)' }}>
                            <FaTimes size={12} /> Deny
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Transactions Tab */}
      {activeTab === 'transactions' && (
        <div>
          {loading ? (
            <div className="skeleton" style={{ height: 200, borderRadius: 'var(--td-radius-lg)' }} />
          ) : (
            <div className="glass-card" style={{ overflow: 'hidden' }}>
              <table tabIndex={0} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <caption className="sr-only">Admin transactions</caption>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--td-border)' }}>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Buyer</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Seller</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Item</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Amount</th>
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Status</th>
                    {user.role === 'admin' && <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--td-text-tertiary)' }}>No transactions found</td></tr>
                  ) : (
                    transactions.map((t, i) => (
                      <tr key={t._id} style={{ borderBottom: '1px solid var(--td-border-light)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                        <td style={{ padding: '12px 16px' }}>{t.buyer?.name || 'Unknown'}</td>
                        <td style={{ padding: '12px 16px' }}>{t.seller?.name || 'Unknown'}</td>
                        <td style={{ padding: '12px 16px', color: 'var(--td-text-tertiary)' }}>{t.listing?.title || 'N/A'}</td>
                        <td style={{ padding: '12px 16px', fontWeight: 600 }}>{formatPrice(t.paymentBreakdown?.totalPaid || t.itemPrice || 0, t.currency || 'USD')}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <span className={`badge badge-${t.status === 'completed' ? 'success' : t.status === 'paid' ? 'info' : t.status === 'refunded' ? 'error' : 'warning'}`}>{t.status}</span>
                        </td>
                        {user.role === 'admin' && (
                          <td style={{ padding: '12px 16px' }}>
                            {t.status !== 'refunded' && (
                              <button onClick={() => handleRefund(t._id)} className="btn btn-sm" style={{ background: 'rgba(255,23,68,0.1)', color: 'var(--td-error)', border: 'none' }}>
                                <FaBan size={12} /> Force Refund
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
};

export default Admin;