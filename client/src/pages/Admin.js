import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
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
} from '../services/api';
import { FaShieldAlt, FaUsers, FaList, FaFlag, FaExchangeAlt, FaSearch, FaTimes, FaCheck, FaBan, FaTrash } from 'react-icons/fa';

const Admin = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashboard, setDashboard] = useState(null);
  const [users, setUsers] = useState([]);
  const [listings, setListings] = useState([]);
  const [reports, setReports] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

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
      }
    } catch (error) {
      console.error('Admin fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId, role) => {
    try {
      await updateUserRole(userId, role);
      fetchData();
    } catch (error) {
      console.error(error);
    }
  };

  const handleSuspend = async (userId) => {
    try {
      await suspendUser(userId);
      fetchData();
    } catch (error) {
      console.error(error);
    }
  };

  const handleUnsuspend = async (userId) => {
    try {
      await unsuspendUser(userId);
      fetchData();
    } catch (error) {
      console.error(error);
    }
  };

  const handleDeleteListing = async (listingId) => {
    if (!window.confirm('Are you sure you want to delete this listing?')) return;
    try {
      await deleteAdminListing(listingId);
      fetchData();
    } catch (error) {
      console.error(error);
    }
  };

  const handleResolveReport = async (reportId, status) => {
    try {
      await updateAdminReportStatus(reportId, status);
      fetchData();
    } catch (error) {
      console.error(error);
    }
  };

  const handleRefund = async (transactionId) => {
    if (!window.confirm('Force refund this transaction? This cannot be undone.')) return;
    try {
      await adminRefundTransaction(transactionId);
      fetchData();
    } catch (error) {
      console.error(error);
    }
  };

  const handleAutoSuspend = async () => {
    if (!window.confirm('Auto-suspend all users with 3+ strikes?')) return;
    try {
      const res = await autoSuspendUsers();
      alert(res.data.message);
      fetchData();
    } catch (error) {
      console.error(error);
    }
  };

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: <FaShieldAlt /> },
    { id: 'users', label: 'Users', icon: <FaUsers /> },
    { id: 'listings', label: 'Listings', icon: <FaList /> },
    { id: 'reports', label: 'Reports', icon: <FaFlag /> },
    { id: 'transactions', label: 'Transactions', icon: <FaExchangeAlt /> },
  ];

  if (!user || (user.role !== 'admin' && user.role !== 'moderator')) return null;

  return (
    <div className="page-container" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <FaShieldAlt /> Admin Panel
      </h1>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--td-space-lg)', overflowX: 'auto', paddingBottom: 8 }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setPage(1); }}
            className={`btn ${activeTab === tab.id ? 'btn-primary' : 'btn-outline'}`}
            style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
        {user.role === 'admin' && (
          <button onClick={handleAutoSuspend} className="btn btn-outline" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--td-error)' }}>
            <FaBan /> Auto-Suspend
          </button>
        )}
      </div>

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
                  <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--td-primary)' }}>${(dashboard.stats.totalCommission || 0).toFixed(2)}</div>
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
                        <span style={{ fontWeight: 600 }}>${t.paymentBreakdown?.totalPaid?.toFixed(2)}</span>
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
                        <button onClick={() => handleResolveReport(r._id, 'resolved')} className="btn btn-sm" style={{ background: 'rgba(0,200,83,0.1)', color: 'var(--td-success)', border: 'none' }}><FaCheck /></button>
                        <button onClick={() => handleResolveReport(r._id, 'dismissed')} className="btn btn-sm" style={{ background: 'rgba(255,23,68,0.1)', color: 'var(--td-error)', border: 'none' }}><FaTimes /></button>
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
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--td-border)' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Name</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Email</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Role</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Strikes</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Actions</th>
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
                                  value={u.role}
                                  onChange={e => handleRoleChange(u._id, e.target.value)}
                                  className="input"
                                  style={{ width: 110, fontSize: 12, padding: '4px 8px' }}
                                >
                                  <option value="user">user</option>
                                  <option value="moderator">moderator</option>
                                  <option value="admin">admin</option>
                                </select>
                                {u.role !== 'suspended' ? (
                                  <button onClick={() => handleSuspend(u._id)} className="btn btn-sm" style={{ background: 'rgba(255,23,68,0.1)', color: 'var(--td-error)', border: 'none' }}>
                                    <FaBan size={12} />
                                  </button>
                                ) : (
                                  <button onClick={() => handleUnsuspend(u._id)} className="btn btn-sm" style={{ background: 'rgba(0,200,83,0.1)', color: 'var(--td-success)', border: 'none' }}>
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
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--td-border)' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Title</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Seller</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Price</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Actions</th>
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
                        <td style={{ padding: '12px 16px', fontWeight: 600 }}>${l.price?.toFixed(2)}</td>
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
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--td-border)' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Reporter</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Listing</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Reason</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Actions</th>
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

      {/* Transactions Tab */}
      {activeTab === 'transactions' && (
        <div>
          {loading ? (
            <div className="skeleton" style={{ height: 200, borderRadius: 'var(--td-radius-lg)' }} />
          ) : (
            <div className="glass-card" style={{ overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--td-border)' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Buyer</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Seller</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Item</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Amount</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Status</th>
                    {user.role === 'admin' && <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>Actions</th>}
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
                        <td style={{ padding: '12px 16px', fontWeight: 600 }}>${(t.paymentBreakdown?.totalPaid || t.itemPrice || 0).toFixed(2)}</td>
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
  );
};

export default Admin;