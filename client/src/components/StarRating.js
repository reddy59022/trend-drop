import React, { useState } from 'react';
import { FaStar, FaStarHalfAlt, FaRegStar } from 'react-icons/fa';

const StarRating = ({ rating, onRate, readonly = false, size = 20 }) => {
  const [hoverRating, setHoverRating] = useState(0);
  const [animatingStar, setAnimatingStar] = useState(null);

  const handleClick = (value) => {
    if (readonly || !onRate) return;
    setAnimatingStar(value);
    setTimeout(() => setAnimatingStar(null), 400);
    onRate(value);
  };

  const handleMouseEnter = (value) => {
    if (!readonly) setHoverRating(value);
  };

  const handleMouseLeave = () => {
    if (!readonly) setHoverRating(0);
  };

  const displayRating = hoverRating || rating || 0;
  const stars = [];

  for (let i = 1; i <= 5; i++) {
    const isAnimating = animatingStar === i;
    
    let icon;
    if (displayRating >= i) {
      icon = <FaStar />;
    } else if (displayRating >= i - 0.5) {
      icon = <FaStarHalfAlt />;
    } else {
      icon = <FaRegStar />;
    }

    stars.push(
      <button
        key={i}
        type="button"
        className="star-btn"
        onClick={() => handleClick(i)}
        onMouseEnter={() => handleMouseEnter(i)}
        onMouseLeave={handleMouseLeave}
        disabled={readonly}
        style={{
          background: 'none',
          border: 'none',
          cursor: readonly ? 'default' : 'pointer',
          padding: 2,
          color: displayRating >= i - 0.5 ? '#FFD700' : '#D1D5DB',
          fontSize: size,
          transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
          transform: isAnimating ? 'scale(1.3)' : hoverRating >= i ? 'scale(1.15)' : 'scale(1)',
          filter: hoverRating >= i ? 'drop-shadow(0 0 4px rgba(255, 215, 0, 0.4))' : 'none',
        }}
        aria-label={`${i} star${i > 1 ? 's' : ''}`}
      >
        {icon}
      </button>
    );
  }

  return (
    <div className="star-rating" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      {stars}
      {readonly && rating > 0 && (
        <span style={{ marginLeft: 8, fontSize: 14, fontWeight: 600, color: 'var(--td-text-secondary)' }}>
          {rating.toFixed(1)}
        </span>
      )}
    </div>
  );
};

export default StarRating;