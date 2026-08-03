import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import { FaUser, FaEnvelope, FaLock, FaEye, FaEyeSlash, FaCamera, FaCheck } from 'react-icons/fa';

const Register = () => {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [avatar, setAvatar] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    if (user) navigate('/');
  }, [user, navigate]);

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setAvatar(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const passwordStrength = () => {
    const pw = formData.password;
    if (!pw) return { score: 0, label: '', color: 'transparent' };
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    if (pw.length >= 12) score++;
    
    if (score <= 1) return { score: 1, label: 'Weak', color: 'var(--td-error)' };
    if (score <= 2) return { score: 2, label: 'Fair', color: 'var(--td-warning)' };
    if (score <= 3) return { score: 3, label: 'Good', color: 'var(--td-info)' };
    if (score <= 4) return { score: 4, label: 'Strong', color: 'var(--td-success)' };
    return { score: 5, label: 'Very Strong', color: 'var(--td-success)' };
  };

  const strength = passwordStrength();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.password) {
      toast.error('Please fill in all fields');
      return;
    }
    if (formData.password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('name', formData.name);
      fd.append('email', formData.email);
      fd.append('password', formData.password);
      if (avatar) fd.append('avatar', avatar);

      const data = await register(fd);
      toast.success(data.message || 'Registration successful! Check your email to verify.');
      navigate('/verify-email', { state: { email: formData.email } });
    } catch (error) {
      toast.error(error.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container" style={{ animation: 'fadeInUp 0.4s ease-out', maxWidth: 480 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <svg width="48" height="48" viewBox="0 0 32 32" fill="none" style={{ margin: '0 auto 12px' }}>
            <defs>
              <linearGradient id="avBrandIcon" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#6C3BFF"/>
                <stop offset="100%" stopColor="#FF6B81"/>
              </linearGradient>
            </defs>
            <circle cx="16" cy="16" r="16" fill="url(#avBrandIcon)"/>
            <path d="M10 22V12l6-4 6 4v10H10z" fill="white" opacity="0.9"/>
            <path d="M12 18h8v4h-8z" fill="white"/>
          </svg>
          <h1>Create Account</h1>
          <p className="auth-subtitle">Join the world's fashion marketplace</p>
        </div>

        {/* Avatar Upload */}
        <div className="avatar-upload" style={{ marginBottom: 24 }}>
          <label className="avatar-label">
            <input type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: 'none' }} />
            {avatarPreview ? (
              <img src={avatarPreview} alt="Preview" className="avatar-preview" />
            ) : (
              <div className="avatar-placeholder">
                <FaCamera size={24} />
                <span>Add Photo</span>
              </div>
            )}
          </label>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Full Name</label>
            <div style={{ position: 'relative' }}>
              <FaUser style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--td-text-tertiary)' }} />
              <input type="text" className="form-input" placeholder="Your name" value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                style={{ paddingLeft: 36 }} required />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Email</label>
            <div style={{ position: 'relative' }}>
              <FaEnvelope style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--td-text-tertiary)' }} />
              <input type="email" className="form-input" placeholder="you@example.com" value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                style={{ paddingLeft: 36 }} required />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <FaLock style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--td-text-tertiary)' }} />
              <input type={showPassword ? 'text' : 'password'} className="form-input" placeholder="Min 8 characters"
                value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                style={{ paddingLeft: 36, paddingRight: 36 }} required minLength={8} />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--td-text-tertiary)', background: 'none', border: 'none' }}>
                {showPassword ? <FaEyeSlash size={16} /> : <FaEye size={16} />}
              </button>
            </div>
            {/* Password strength */}
            {formData.password && (
              <div style={{ marginTop: 6 }}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} style={{
                      flex: 1, height: 3, borderRadius: 2,
                      background: i <= strength.score ? strength.color : 'var(--td-border)',
                      transition: 'background 0.2s',
                    }} />
                  ))}
                </div>
                <span style={{ fontSize: 11, color: strength.color, fontWeight: 600 }}>{strength.label}</span>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <div style={{ position: 'relative' }}>
              <FaCheck style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--td-text-tertiary)' }} />
              <input type={showConfirmPassword ? 'text' : 'password'} className="form-input" placeholder="Repeat your password"
                value={formData.confirmPassword} onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                style={{ paddingLeft: 36, paddingRight: 36 }} required />
              <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--td-text-tertiary)', background: 'none', border: 'none' }}>
                {showConfirmPassword ? <FaEyeSlash size={16} /> : <FaEye size={16} />}
              </button>
            </div>
            {formData.confirmPassword && formData.password !== formData.confirmPassword && (
              <span className="form-error">Passwords do not match</span>
            )}
          </div>

          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
            {loading ? <><span className="spinner spinner-sm" /> Creating Account...</> : 'Create Account'}
          </button>
        </form>

        <div className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
};

export default Register;