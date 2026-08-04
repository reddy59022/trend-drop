import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useNavigate } from 'react-router-dom';
import { FaCreditCard, FaCheck, FaCrown, FaStar, FaGem, FaRocket } from 'react-icons/fa';
import api from '../services/api';

const Subscriptions = () => {
  const { user } = useAuth();
  const confirmDialog = useConfirm();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [billingCycle, setBillingCycle] = useState('monthly');

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchData();
  }, [user, navigate]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [plansRes, subRes] = await Promise.all([
        api.get('/subscriptions/plans'),
        api.get('/subscriptions'),
      ]);
      setPlans(plansRes.data || []);
      setSubscription(subRes.data || null);
    } catch (error) {
      console.error('Error fetching subscription data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async (tier) => {
    try {
      await api.post('/subscriptions/subscribe', { tier, billingCycle });
      fetchData();
    } catch (error) {
      console.error('Error subscribing:', error);
    }
  };

  const handleCancel = async () => {
    const ok = await confirmDialog({
      title: 'Cancel subscription?',
      message: 'Cancel your subscription?',
      confirmLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post('/subscriptions/cancel');
      fetchData();
    } catch (error) {
      console.error('Error cancelling:', error);
    }
  };

  const getPlanIcon = (tier) => {
    switch (tier) {
      case 'enterprise': return <FaGem />;
      case 'pro': return <FaCrown />;
      case 'basic': return <FaStar />;
      default: return <FaRocket />;
    }
  };

  if (loading) {
    return (
      <div className="page-container" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="skeleton" style={{ height: 60, borderRadius: 'var(--td-radius-lg)', marginBottom: 20 }} />
        <div className="skeleton" style={{ height: 400, borderRadius: 'var(--td-radius-lg)' }} />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <FaCreditCard /> Seller Subscriptions
      </h1>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 24 }}>
        <button
          onClick={() => setBillingCycle('monthly')}
          className={`btn ${billingCycle === 'monthly' ? 'btn-primary' : 'btn-outline'}`}
        >
          Monthly
        </button>
        <button
          onClick={() => setBillingCycle('annual')}
          className={`btn ${billingCycle === 'annual' ? 'btn-primary' : 'btn-outline'}`}
        >
          Annual (Save 20%)
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {plans.map(plan => (
          <div key={plan.id} className="glass-card" style={{ padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{getPlanIcon(plan.id)}</div>
            <h3 style={{ margin: '0 0 8px 0' }}>{plan.name}</h3>
            <div style={{ fontSize: 32, fontWeight: 700, margin: '12px 0' }}>
              ${plan.price}
              <span style={{ fontSize: 14, color: 'var(--td-text-secondary)' }}>
                /{billingCycle === 'annual' ? 'year' : 'month'}
              </span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0', textAlign: 'left' }}>
              {Object.entries(plan.features).map(([feature, enabled]) => (
                <li key={feature} style={{ padding: '4px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {enabled ? <FaCheck color="var(--td-success)" /> : <span style={{ opacity: 0.3 }}>○</span>}
                  {feature.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                </li>
              ))}
            </ul>
            <button
              onClick={() => plan.price > 0 && handleSubscribe(plan.id)}
              disabled={plan.price === 0}
              className="btn btn-primary"
              style={{ width: '100%' }}
            >
              {subscription?.tier === plan.id ? 'Current Plan' : plan.price === 0 ? 'Free Plan' : 'Subscribe'}
            </button>
          </div>
        ))}
      </div>

      {subscription && subscription.tier !== 'free' && (
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button onClick={handleCancel} className="btn btn-outline" style={{ color: 'var(--td-error)' }}>
            Cancel Subscription
          </button>
        </div>
      )}
    </div>
  );
};

export default Subscriptions;