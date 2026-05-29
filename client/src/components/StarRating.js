import React from 'react';

const StarRating = ({ rating = 0, size = 20, interactive = false, onChange }) => {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    const filled = i <= Math.round(rating);
    stars.push(
      <span
        key={i}
        onClick={() => interactive && onChange && onChange(i)}
        style={{
          fontSize: `${size}px`,
          color: filled ? '#FFD700' : '#ddd',
          cursor: interactive ? 'pointer' : 'default',
          marginRight: '2px',
        }}
        role={interactive ? 'button' : undefined}
        aria-label={`${i} star${i > 1 ? 's' : ''}`}
      >
        ★
      </span>
    );
  }
  return <span style={{ whiteSpace: 'nowrap' }}>{stars}</span>;
};

export default StarRating;