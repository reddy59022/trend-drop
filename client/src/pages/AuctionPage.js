import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import './AuctionPage.css';

const AuctionPage = () => {
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
      const response = await api.get('/auctions', { params: { status: activeTab } });
      setAuctions(response.data.auctions || []);
    } catch (error) {
      console.error('Error fetching auctions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleBid = async (auctionId) => {
    const amount = bidAmount[auctionId];
    if (!amount) return;

    try {
      const response = await api.post(`/auctions/${auctionId}/bids`, { amount: parseFloat(amount) });
      setAuctions(auctions.map(a => a._id === auctionId ? response.data.auction : a));
      alert('Bid placed successfully!');
    } catch (error) {
      console.error('Error placing bid:', error);
      alert(error.response?.data?.message || 'Failed to place bid');
    }
  };

  const formatTimeLeft = (endTime) => {
    const diff = new Date(endTime) - new Date();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  return (
    <div className="auction-page">
      <div className="auction-header">
        <h1>Auctions</h1>
        <p>Bid on items with timed auctions and reserve prices</p>
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
        <div className="auction-grid">
          {auctions.map(auction => (
            <div key={auction._id} className="auction-card glass-card">
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
                    <strong>${auction.currentBid}</strong>
                  </div>
                  <div className="reserve-price">
                    <span>Reserve:</span>
                    <span>${auction.reservePrice}</span>
                  </div>
                </div>

                {auction.status === 'active' && (
                  <div className="time-left">
                    <span>⏰ Time left: {formatTimeLeft(auction.endTime)}</span>
                  </div>
                )}

                {auction.winner && (
                  <div className="auction-winner">
                    Sold to: {auction.winner.name} for ${auction.winningBid}
                  </div>
                )}

                {auction.status === 'active' && (
                  <div className="bid-form">
                    <input
                      type="number"
                      min={auction.currentBid + 1}
                      step="1"
                      placeholder={`Min: $${auction.currentBid + 1}`}
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
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && auctions.length === 0 && (
        <div className="no-auctions">
          <p>No auctions found in this category.</p>
        </div>
      )}
    </div>
  );
};

export default AuctionPage;