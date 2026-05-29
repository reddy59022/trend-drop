import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import moment from 'moment';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const Transactions = () => {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetchTransactions();
    // eslint-disable-next-line
  }, [user]);

  const fetchTransactions = async () => {
    try {
      const res = await api.get('/transactions');
      setTransactions(res.data);
    } catch (error) {
      console.error(error);
    }
    setLoading(false);
  };

  if (!user) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <h2>Transactions</h2>
          <p>Sign in to view your transactions</p>
          <Link to="/login" className="btn btn-primary">Sign In</Link>
        </div>
      </div>
    );
  }

  if (loading) return <div className="page-container"><div className="spinner"></div></div>;

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'status-success';
      case 'cancelled': return 'status-error';
      case 'shipped': return 'status-warning';
      default: return 'status-pending';
    }
  };

  return (
    <div className="page-container">
      <h1 className="page-title">Transactions</h1>

      {transactions.length === 0 ? (
        <div className="empty-state">
          <p>No transactions yet</p>
          <Link to="/search" className="btn btn-primary">Browse Items</Link>
        </div>
      ) : (
        <div className="transactions-list">
          {transactions.map((txn) => {
            const isBuyer = txn.buyer?._id === user.id || txn.buyer?._id === user._id;
            return (
              <div key={txn._id} className="transaction-card">
                <Link to={`/listing/${txn.listing?._id}`} className="txn-image">
                  <img src={txn.listing?.images?.[0] || 'https://via.placeholder.com/80'} alt="" />
                </Link>
                <div className="txn-details">
                  <h4>{txn.listing?.title}</h4>
                  <p>{isBuyer ? `Bought from ${txn.seller?.name}` : `Sold to ${txn.buyer?.name}`}</p>
                  <p className="txn-amount">${txn.amount}</p>
                  <span className={`txn-status ${getStatusColor(txn.status)}`}>
                    {txn.status}
                  </span>
                  <p className="txn-date">{moment(txn.createdAt).format('MMM D, YYYY')}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Transactions;