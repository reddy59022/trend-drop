import React, { useState } from 'react';
import { FaChevronLeft, FaChevronRight, FaExpand } from 'react-icons/fa';
import { defaultAvatar } from '../utils/helpers';

const ImageCarousel = ({ images = [] }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loaded, setLoaded] = useState({});

  const goTo = (index) => {
    setCurrentIndex(index);
  };

  const goPrev = (e) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const goNext = (e) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  const handleImageLoad = (index) => {
    setLoaded((prev) => ({ ...prev, [index]: true }));
  };

  if (!images || images.length === 0) {
    return (
      <div className="carousel">
        <div className="carousel-main" style={{ background: 'var(--td-surface-tertiary)' }}>
          <img src={defaultAvatar} alt="No images" className="carousel-image" />
        </div>
      </div>
    );
  }

  return (
    <div className="carousel">
      {/* Main Image */}
      <div className="carousel-main">
        {!loaded[currentIndex] && (
          <div className="skeleton skeleton-image" style={{ position: 'absolute', inset: 0 }} />
        )}
        <img
          src={images[currentIndex]}
          alt={`Product image ${currentIndex + 1}`}
          className="carousel-image"
          style={{ opacity: loaded[currentIndex] ? 1 : 0 }}
          onLoad={() => handleImageLoad(currentIndex)}
        />

        {/* Image Counter */}
        <div style={{
          position: 'absolute',
          top: 12,
          right: 12,
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(4px)',
          color: '#fff',
          padding: '4px 10px',
          borderRadius: 'var(--td-radius-full)',
          fontSize: 12,
          fontWeight: 600,
          zIndex: 2,
        }}>
          {currentIndex + 1} / {images.length}
        </div>

        {/* Zoom Hint */}
        <div style={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          background: 'rgba(0,0,0,0.4)',
          backdropFilter: 'blur(4px)',
          color: '#fff',
          padding: '4px 8px',
          borderRadius: 'var(--td-radius-full)',
          fontSize: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          zIndex: 2,
          opacity: 0.7,
        }}>
          <FaExpand size={10} /> Tap to zoom
        </div>

        {/* Navigation Buttons */}
        {images.length > 1 && (
          <>
            <button className="carousel-btn prev" onClick={goPrev} aria-label="Previous image">
              <FaChevronLeft />
            </button>
            <button className="carousel-btn next" onClick={goNext} aria-label="Next image">
              <FaChevronRight />
            </button>
          </>
        )}
      </div>

      {/* Dots */}
      {images.length > 1 && (
        <div className="carousel-dots">
          {images.map((_, i) => (
            <button
              key={i}
              className={`carousel-dot ${i === currentIndex ? 'active' : ''}`}
              onClick={() => goTo(i)}
              aria-label={`Go to image ${i + 1}`}
            />
          ))}
        </div>
      )}

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="carousel-thumbnails">
          {images.map((img, i) => (
            <img
              key={i}
              src={img}
              alt=""
              className={`carousel-thumb ${i === currentIndex ? 'active' : ''}`}
              onClick={() => goTo(i)}
              onLoad={() => handleImageLoad(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ImageCarousel;