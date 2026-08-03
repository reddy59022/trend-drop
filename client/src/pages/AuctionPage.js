import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { FaGavel, FaPlus, FaUser, FaTag, FaEye } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import { formatPrice } from '../utils/helpers';
import './AuctionPage.css';

const AuctionPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [auctions, setAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('active');
  const [bidAmount, setBidAmount] = useState({});

  useEffect(() => {
    fetchAuctions();
  }, [activeTab]);

  const fetchAuctions = async () => {
    setLoading(true);
    try {
      // Fetch all auctions for the current tab
      const response = await api.get('/auctions', { params: { status: activeTab } });
      setAuctions(response.data.auctions || []);
    } catch (error) {
      console.error('Error fetching auctions:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const isMyAuction = (auction) => {
    return user && String(auction.seller?._id) === String(user._id);
  };
  
  const formatTimeLeft = (endTime) => {
    const diff = new Date(endTime) - new Date();
    if (diff <= 0) return 'Ended';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };
  
  const handleCreateAuction = () => {
    navigate('/auctions/create');
  };

  const handleBid = async (auctionId) => {
    const amount = bidAmount[auctionId];
    if (!amount) return;

    try {
      const response = await api.post(`/auctions/${auctionId}/bids`, { amount: parseFloat(amount) });
      setAuctions(auctions.map(a => a._id === auctionId ? response.data.auction : a));
      toast.success('Bid placed successfully!');
    } catch (error) {
      console.error('Error placing bid:', error);
      toast.error(error.response?.data?.message || 'Failed to place bid');
    }
  };

  return (
    <div className="auction-page">
      <div className="auction-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--td-space-md)' }}>
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 12, margin: 0 }}>
              <FaGavel style={{ color: 'var(--td-primary)' }} />
              Auctions
            </h1>
            <p style={{ margin: 'var(--td-space-xs) 0 0 0', color: 'var(--td-text-secondary)' }}>
              Bid on items with timed auctions and reserve prices
            </p>
          </div>
          <button 
            onClick={handleCreateAuction}
            className="btn btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 20px', fontSize: 14, fontWeight: 600 }}
          >
            <FaPlus size={18} />
            Create Auction
          </button>
        </div>
      </div>

      <div className="auction-tabs">
        <button 
          className={activeTab === 'active' ? 'active' : ''}
          onClick={() => setActiveTab('active')}
        >
          Active
        </button>
        <button 
          className={activeTab === 'scheduled' ? 'active' : ''}
          onClick={() => setActiveTab('scheduled')}
        >
          Upcoming
        </button>
        <button 
          className={activeTab === 'closed' ? 'active' : ''}
          onClick={() => setActiveTab('closed')}
        >
          Ended
        </button>
      </div>

      {loading ? (
        <div className="loading-spinner">Loading auctions...</div>
      ) : (
        <>
          {/* My Auctions Section (where user is seller) */}
          {user && (
            <div className="auction-section">
              <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--td-space-md)', color: 'var(--td-primary)' }}>
                <FaUser /> My Auctions
              </h2>
              {auctions.filter(isMyAuction).length > 0 ? (
                <div className="auction-grid">
                  {auctions.filter(isMyAuction).map(auction => (
                    <div key={auction._id} className="auction-card glass-card my-auction">
                      <div className="my-auction-badge">Your Auction</div>
                      <Link to={`/auctions/${auction._id}`}>
                        <img 
                          src={auction.listing?.images?.[0] || '/placeholder.png'} 
                          alt={auction.listing?.title} 
                          className="auction-image"
                        />
                      </Link>
                      
                      <div className="auction-info">
                        <h3>{auction.listing?.title}</h3>
                        
                        <div className="auction-pricing">
                          <div className="current-bid">
                            <span>Current Bid:</span>
                            <strong>{formatPrice(auction.currentBid, auction.currency || 'USD')}</strong>
                          </div>
                          <div className="reserve-price">
                            <span>Reserve:</span>
                            <span>{formatPrice(auction.reservePrice, auction.currency || 'USD')}</span>
                          </div>
                        </div>

                        <div className="time-left">
                          <span>{auction.status === 'active' ? '⏰' : auction.status === 'scheduled' ? '📅' : '✅'} 
                            {auction.status === 'active' ? `Time left: ${formatTimeLeft(auction.endTime)}` : 
                             auction.status === 'scheduled' ? `Starts: ${new Date(auction.startTime).toLocaleString()}` : 
                             'Ended'}</span>
                        </div>

                        {auction.winner && (
                          <div className="auction-winner">
                            Sold to: {auction.winner.name} for {formatPrice(auction.winningBid, auction.winningCurrency || auction.currency || 'USD')}
                          </div>
                        )}
                        
                        {auction.status === 'active' && (
                          <div className="my-auction-stats">
                            <span><FaEye /> {auction.bids?.length || 0} bids</span>
                            <span><FaTag /> {auction.streamInfo?.viewerCount || 0} viewers</span>
                          </div>
                        )}
                        
                        <Link to={`/auctions/${auction._id}`} className="btn btn-primary" style={{ width: '100%', marginTop: 'var(--td-space-sm)', textAlign: 'center' }}>
                          <FaGavel /> Manage Auction
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="no-auctions glass-card" style={{ padding: 'var(--td-space-xl)', textAlign: 'center' }}>
                  <FaGavel size={48} style={{ color: 'var(--td-text-tertiary)', marginBottom: 'var(--td-space-md)' }} />
                  <p style={{ color: 'var(--td-text-secondary)', marginBottom: 'var(--td-space-lg)' }}>
                    You haven't created any {activeTab} auctions yet.
                  </p>
                  <button 
                    onClick={handleCreateAuction}
                    className="btn btn-primary"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                  >
                    <FaPlus /> Create Your First Auction
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Other Auctions Section (where user can bid) */}
          <div className="auction-section">
            <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--td-space-md)', color: 'var(--td-secondary)' }}>
              <FaTag /> Auctions to Bid On
            </h2>
            {auctions.filter(a => !isMyAuction(a)).length > 0 ? (
              <div className="auction-grid">
                {auctions.filter(a => !isMyAuction(a)).map(auction => (
                  <div key={auction._id} className="auction-card glass-card other-auction">
                    <Link to={`/auctions/${auction._id}`}>
                      <img 
                        src={auction.listing?.images?.[0] || '/placeholder.png'} 
                        alt={auction.listing?.title} 
                        className="auction-image"
                      />
                    </Link>
                    
                    <div className="auction-info">
                      <h3>{auction.listing?.title}</h3>
                      <p className="auction-seller">Seller: {auction.seller?.name}</p>
                      
                      <div className="auction-pricing">
                        <div className="current-bid">
                          <span>Current Bid:</span>
                          <strong>{formatPrice(auction.currentBid, auction.currency || 'USD')}</strong>
                        </div>
                        <div className="reserve-price">
                          <span>Reserve:</span>
                          <span>{formatPrice(auction.reservePrice, auction.currency || 'USD')}</span>
                        </div>
                      </div>

                      {auction.status === 'active' && (
                        <div className="time-left">
                          <span>⏰ Time left: {formatTimeLeft(auction.endTime)}</span>
                        </div>
                      )}

                      {auction.winner && (
                        <div className="auction-winner">
                          Sold to: {auction.winner.name} for {formatPrice(auction.winningBid, auction.winningCurrency || auction.currency || 'USD')}
                        </div>
                      )}

                      {auction.status === 'active' && user && !isMyAuction(auction) && (
                        <div className="bid-form">
                          <input
                            type="number"
                            min={auction.currentBid + 1}
                            step="1"
                            placeholder={`Min: ${formatPrice(auction.currentBid + 1, auction.currency || 'USD')}`}
                            value={bidAmount[auction._id] || ''}
                            onChange={(e) => setBidAmount({...bidAmount, [auction._id]: e.target.value})}
                            className="bid-input"
                          />
                          <button 
                            onClick={() => handleBid(auction._id)}
                            className="bid-button"
                          >
                            Place Bid
                          </button>
                        </div>
                      )}
                      
                      {auction.status === 'active' && (!user || isMyAuction(auction)) && (
                        <div className="bid-form" style={{ justifyContent: 'center' }}>
                          <button 
                            onClick={() => user ? null : navigate('/login')}
                            className="btn btn-outline"
                            disabled={!user || isMyAuction(auction)}
                            style={{ width: '100%' }}
                          >
                            {user ? 'Cannot bid on your own auction' : 'Login to Bid'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="no-auctions glass-card" style={{ padding: 'var(--td-space-xl)', textAlign: 'center' }}>
                <FaTag size={48} style={{ color: 'var(--td-text-tertiary)', marginBottom: 'var(--td-space-md)' }} />
                <p style={{ color: 'var(--td-text-secondary)', marginBottom: 'var(--td-space-lg)' }}>
                  No other auctions available to bid on right now.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AuctionPage;
