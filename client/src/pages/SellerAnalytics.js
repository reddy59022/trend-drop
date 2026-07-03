import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { toast } from 'react-toastify';
import { FaDollarSign, FaEye, FaTag, FaStar, FaPercentage, FaShoppingBag, FaSpinner } from 'react-icons/fa';

const SellerAnalytics = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [revenueData, setRevenueData] = useState([]);
  const [topListings, setTopListings] = useState([]);
  const [period, setPeriod] = useState('30d');

  useEffect(() => {
    fetchOverview();
    fetchRevenue();
    fetchTopListings();
  }, [period]);

  const fetchOverview = async () => {
    try {
      const res = await api.get(`/users/me/analytics/overview?period=${period}`);
      setOverview(res.data.overview);
    } catch (error) {
      toast.error('Failed to load analytics overview');
    } finally {
      setLoading(false);
    }
  };

  const fetchRevenue = async () => {
    try {
      const res = await api.get(`/users/me/analytics/revenue?period=${period}`);
      setRevenueData(res.data.revenue || []);
    } catch (error) {
      console.error('Failed to load revenue data:', error);
    }
  };

  const fetchTopListings = async () => {
    try {
      const res = await api.get(`/users/me/analytics/top-listings?period=${period}`);
      setTopListings(res.data.topListings || []);
    } catch (error) {
      console.error('Failed to load top listings:', error);
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatNumber = (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  if (loading) {
    return (
      <div className="page-container" style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="analytics-page">
      <div className="container">
        <div className="analytics-header">
          <h1>Sales Analytics</h1>
          <div className="period-selector">
            <button className={period === '7d' ? 'active' : ''} onClick={() => setPeriod('7d')}>7D</button>
            <button className={period === '30d' ? 'active' : ''} onClick={() => setPeriod('30d')}>30D</button>
            <button className={period === '90d' ? 'active' : ''} onClick={() => setPeriod('90d')}>90D</button>
            <button className={period === '1y' ? 'active' : ''} onClick={() => setPeriod('1y')}>1Y</button>
          </div>
        </div>

        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-icon"><FaDollarSign /></div>
            <div className="metric-content">
              <p className="metric-label">Total Revenue</p>
              <h3 className="metric-value">{formatCurrency(overview?.totalRevenue || 0)}</h3>
              <p className="metric-subtext">{overview?.totalSales || 0} sales</p>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-icon"><FaShoppingBag /></div>
            <div className="metric-content">
              <p className="metric-label">Avg Order Value</p>
              <h3 className="metric-value">{formatCurrency(overview?.avgOrderValue || 0)}</h3>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-icon"><FaEye /></div>
            <div className="metric-content">
              <p className="metric-label">Total Views</p>
              <h3 className="metric-value">{formatNumber(overview?.totalViews || 0)}</h3>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-icon"><FaPercentage /></div>
            <div className="metric-content">
              <p className="metric-label">Conversion Rate</p>
              <h3 className="metric-value">{(overview?.conversionRate || 0).toFixed(1)}%</h3>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-icon"><FaStar /></div>
            <div className="metric-content">
              <p className="metric-label">Avg Rating</p>
              <h3 className="metric-value">{(overview?.avgRating || 0).toFixed(1)}</h3>
              <p className="metric-subtext">{overview?.totalRatings || 0} reviews</p>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-icon"><FaTag /></div>
            <div className="metric-content">
              <p className="metric-label">Active Listings</p>
              <h3 className="metric-value">{overview?.activeListings || 0}</h3>
              <p className="metric-subtext">{overview?.soldListings || 0} sold</p>
            </div>
          </div>
        </div>

        <div className="charts-row">
          <div className="chart-card">
            <h3>Revenue Over Time</h3>
            <div className="chart-container">
              {revenueData.length > 0 ? (
                <div className="revenue-data">
                  {revenueData.map((d, i) => (
                    <div key={i} className="revenue-item">
                      {d.date}: {formatCurrency(d.revenue)} ({d.sales} sales)
                    </div>
                  ))}
                </div>
              ) : (
                <p className="no-data">No revenue data for this period</p>
              )}
            </div>
          </div>

          <div className="chart-card">
            <h3>Top Performing Listings</h3>
            <div className="chart-container">
              {topListings.length > 0 ? (
                <div className="top-listings-data">
                  {topListings.slice(0, 5).map((l, i) => (
                    <div key={i} className="listing-item">
                      {l.listing?.title || 'Unknown'}: {formatCurrency(l.revenue)}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="no-data">No sales data for this period</p>
              )}
            </div>
          </div>
        </div>

        {overview?.recentActivity?.length > 0 && (
          <div className="recent-activity">
            <h3>Recent Sales</h3>
            <div className="activity-list">
              {overview.recentActivity.map((sale, index) => (
                <div key={index} className="activity-item">
                  <div className="activity-info">
                    <FaShoppingBag />
                    <div>
                      <p className="activity-buyer">{sale.buyer?.name || 'Anonymous Buyer'}</p>
                      <p className="activity-date">
                        {new Date(sale.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="activity-amount">
                    <FaDollarSign />{formatCurrency(sale.sellerEarnings || 0)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SellerAnalytics;