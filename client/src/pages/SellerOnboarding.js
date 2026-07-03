import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { toast } from 'react-toastify';
import { FaUser, FaTag, FaTruck, FaCreditCard, FaBook, FaCheckCircle, FaArrowRight, FaArrowLeft, FaSpinner } from 'react-icons/fa';

const STEPS = [
  { key: 'profileSetup', title: 'Profile Setup', description: 'Add a photo and bio so buyers trust you', icon: FaUser },
  { key: 'firstListing', title: 'First Listing', description: 'Create your first listing with photos', icon: FaTag },
  { key: 'shippingSetup', title: 'Shipping Setup', description: 'Configure your shipping preferences', icon: FaTruck },
  { key: 'paymentSetup', title: 'Payment Setup', description: 'Connect Stripe or PayPal to receive payments', icon: FaCreditCard },
  { key: 'tipsReview', title: 'Seller Tips', description: 'Learn best practices for successful selling', icon: FaBook },
];

const SellerOnboarding = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [onboarding, setOnboarding] = useState({ completed: false, currentStep: 0, steps: {} });
  const [tips, setTips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    fetchOnboarding();
    fetchTips();
  }, []);

  const fetchOnboarding = async () => {
    try {
      const res = await api.get('/users/me/onboarding');
      setOnboarding(res.data.onboarding);
    } catch (error) {
      console.error('Failed to fetch onboarding:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTips = async () => {
    try {
      const res = await api.get('/onboarding/tips');
      setTips(res.data.tips || []);
    } catch (error) {
      console.error('Failed to fetch tips:', error);
    }
  };

  const completeStep = async (stepKey) => {
    setCompleting(true);
    try {
      const res = await api.post('/users/me/onboarding/complete-step', { step: stepKey });
      setOnboarding(res.data.onboarding);
      toast.success('Step completed!');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to complete step');
    } finally {
      setCompleting(false);
    }
  };

  const resetOnboarding = async () => {
    if (!window.confirm('Are you sure you want to restart onboarding?')) return;
    try {
      const res = await api.post('/users/me/onboarding/reset');
      setOnboarding(res.data.onboarding);
      toast.success('Onboarding reset');
    } catch (error) {
      toast.error('Failed to reset onboarding');
    }
  };

  const getProgress = () => {
    const total = STEPS.length;
    const completed = Object.values(onboarding.steps || {}).filter(s => s.completed).length;
    return Math.round((completed / total) * 100);
  };

  const isStepCompleted = (stepKey) => {
    return onboarding.steps?.[stepKey]?.completed || false;
  };

  const isCurrentStep = (stepKey, index) => {
    // Current step is the first incomplete step, or the next step after last completed
    const completedCount = Object.values(onboarding.steps || {}).filter(s => s.completed).length;
    return index === completedCount && !isStepCompleted(stepKey);
  };

  if (loading) {
    return (
      <div className="page-container" style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="onboarding-page">
      <div className="container">
        <div className="onboarding-header">
          <h1>Welcome to TrendDrop, {user?.name?.split(' ')[0]}!</h1>
          <p className="subtitle">Let's get you set up as a seller</p>
        </div>

        {/* Progress Bar */}
        <div className="progress-container">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${getProgress()}%` }}></div>
          </div>
          <span className="progress-text">{getProgress()}% Complete</span>
        </div>

        {/* Completion Banner */}
        {onboarding.completed && (
          <div className="completion-banner">
            <FaCheckCircle />
            <div>
              <h2>You're all set!</h2>
              <p>Start listing items and making sales</p>
            </div>
            <button className="btn btn-primary" onClick={() => navigate('/sell')}>
              Create Your First Listing
            </button>
          </div>
        )}

        {/* Steps Grid */}
        <div className="steps-grid">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            const completed = isStepCompleted(step.key);
            const current = isCurrentStep(step.key, index);

            return (
              <div
                key={step.key}
                className={`step-card ${completed ? 'completed' : ''} ${current ? 'current' : ''}`}
              >
                <div className="step-icon">
                  <Icon />
                  {completed && <div className="check-badge"><FaCheckCircle /></div>}
                </div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>

                {/* Step-specific content */}
                {current && !completed && (
                  <div className="step-action">
                    {step.key === 'tipsReview' ? (
                      <div className="tips-preview">
                        {tips.slice(0, 3).map(tip => (
                          <div key={tip.id} className="tip-item">
                            <strong>{tip.title}</strong>
                            <p>{tip.description}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <button
                      className="btn btn-primary"
                      onClick={() => completeStep(step.key)}
                      disabled={completing}
                    >
                      {completing ? <FaSpinner className="spinning" /> : 'Complete'}
                      <FaArrowRight />
                    </button>
                  </div>
                )}

                {completed && (
                  <div className="step-completed-badge">
                    <FaCheckCircle /> Completed
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Reset Button */}
        {!onboarding.completed && (
          <div className="reset-container">
            <button className="btn btn-text" onClick={resetOnboarding}>
              Reset Onboarding
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SellerOnboarding;
