import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { getPayoutDashboard, getCommissionInfo } from '../services/api';
import StarRating from '../components/StarRating';
import { getRatingsBySeller } from '../services/api';

const SellerDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [commissionInfo, setCommissionInfo] = useState(null);
  const [reviews, setReviews] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, navigate]);

  const fetchData = async () => {
    try {
      const [dashRes, commRes] = await Promise.all([
        getPayoutDashboard().catch(() => ({ data: { commissionRate: 0.10, commissionPercent: 10, totalSales: 0, totalCommission: 0, totalEarnings: 0, pendingAmount: 0, pendingCount: 0, payoutHistory: [], recentTransactions: [] } })),
        getCommissionInfo().catch(() => ({ data: { commissionRate: 0.10, commissionPercent: 10, sellerKeeps: '90%', comparedTo: { trenddrop: '10%', poshmark: '20%', mercari: '10%', depop: '10%' }, features: [] } })),
      ]);
      setDashboard(dashRes.data);
      setCommissionInfo(commRes.data);
      // Reviews are optional - don't block on failure
      try {
        const revRes = await getRatingsBySeller(user._id);
        setReviews(revRes.data);
      } catch {
        setReviews({ averageRating: 0, count: 0, ratings: [] });
      }
    } catch (error) {
      console.error('Failed to load dashboard', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading dashboard...</div>;
  if (!dashboard) return <div style={{ padding: 40, textAlign: 'center' }}>Failed to load dashboard</div>;

  return (
    <div style={{ padding: '20px 16px', maxWidth: 800, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 20, fontSize: 24, fontWeight: 700 }}>💰 Seller Dashboard</h2>

      {/* Commission Banner */}
      {commissionInfo && (
        <div style={{
          background: 'linear-gradient(135deg, #FF4D6D, #FF8FA3)',
          borderRadius: 16, padding: 24, marginBottom: 24, color: '#fff',
        }}>
          <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 4 }}>TrendDrop Commission</div>
          <div style={{ fontSize: 48, fontWeight: 700, marginBottom: 4 }}>
            Only {commissionInfo.commissionPercent}%
          </div>
          <div style={{ fontSize: 16, marginBottom: 16 }}>
            You keep {commissionInfo.sellerKeeps} of every sale
          </div>

          {/* Competitor Comparison */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 12, background: 'rgba(255,255,255,0.15)',
            borderRadius: 12, padding: 16,
          }}>
              {Object.entries(commissionInfo.comparedTo || {}).map(([platform, rate]) => (
              <div key={platform} style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: 11, textTransform: 'uppercase', opacity: 0.8,
                  marginBottom: 4, letterSpacing: 1,
                }}>
                  {platform}
                </div>
                <div style={{
                  fontSize: platform === 'trenddrop' ? 22 : 18,
                  fontWeight: platform === 'trenddrop' ? 800 : 600,
                }}>
                  {rate}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 12, marginBottom: 24,
      }}>
        {[
          { label: 'Total Sales', value: `$${dashboard.totalSales?.toFixed(2) || '0.00'}`, color: '#FF4D6D' },
          { label: 'Your Earnings', value: `$${dashboard.totalEarnings?.toFixed(2) || '0.00'}`, color: '#2ecc71' },
          { label: 'Commission Paid', value: `$${dashboard.totalCommission?.toFixed(2) || '0.00'}`, color: '#e74c3c' },
          { label: 'Pending Payout', value: `$${dashboard.pendingAmount?.toFixed(2) || '0.00'}`, color: '#f39c12' },
        ].map((stat, i) => (
          <div key={i} style={{
            background: '#fff', border: '1px solid #eee', borderRadius: 12,
            padding: 16, textAlign: 'center',
          }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {stat.label}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: stat.color }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Seller Rating */}
      {reviews && (
        <div style={{
          background: '#fff', border: '1px solid #eee', borderRadius: 12,
          padding: 20, marginBottom: 24, display: 'flex',
          alignItems: 'center', gap: 16,
        }}>
          <div style={{ fontSize: 36, fontWeight: 700, color: '#FF4D6D' }}>
            {reviews.averageRating?.toFixed(1) || '0.0'}
          </div>
          <div>
            <StarRating rating={reviews.averageRating || 0} size={22} />
            <div style={{ fontSize: 14, color: '#888', marginTop: 4 }}>
              {reviews.count || 0} review{(reviews.count || 0) !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      )}

      {/* Payout History */}
      <div style={{
        background: '#fff', border: '1px solid #eee', borderRadius: 12,
        overflow: 'hidden', marginBottom: 24,
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', fontWeight: 700, fontSize: 16 }}>
          Payout History
        </div>
        {dashboard.payoutHistory?.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>
            <p style={{ fontSize: 16, marginBottom: 4 }}>No payouts yet</p>
            <p style={{ fontSize: 13 }}>Complete your first sale to see payouts here</p>
          </div>
        ) : (
          dashboard.payoutHistory?.map((p, i) => (
            <div key={i} style={{
              padding: '14px 20px', borderBottom: '1px solid #f5f5f5',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
                  {p.listing?.title || 'Listing'}
                </div>
                <div style={{ fontSize: 12, color: '#888' }}>
                  Sale: ${p.salePrice?.toFixed(2)} • Commission: ${p.commissionAmount?.toFixed(2)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: '#2ecc71', fontSize: 16 }}>
                  +${p.payoutAmount?.toFixed(2)}
                </div>
                <div style={{ fontSize: 11, color: '#aaa' }}>
                  {p.paidAt ? new Date(p.paidAt).toLocaleDateString() : ''}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* How Payouts Work */}
      <div style={{
        background: '#f8f8f8', borderRadius: 12, padding: 20,
      }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>How Payouts Work</h3>
        <div style={{ fontSize: 14, color: '#555', lineHeight: 1.8 }}>
          <div>1️⃣ <strong>List your item</strong> — It's free to list</div>
          <div>2️⃣ <strong>Buyer purchases</strong> — Payment is held securely</div>
          <div>3️⃣ <strong>Ship within 7 days</strong> — Use prepaid shipping label</div>
          <div>4️⃣ <strong>Buyer confirms delivery</strong> — Funds are released</div>
          <div>5️⃣ <strong>Get paid</strong> — Only {commissionInfo?.commissionPercent || 10}% commission deducted</div>
        </div>
      </div>
    </div>
  );
};

export default SellerDashboard;