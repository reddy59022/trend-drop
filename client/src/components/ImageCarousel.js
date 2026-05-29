import React, { useState } from 'react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';

const ImageCarousel = ({ images }) => {
  const [current, setCurrent] = useState(0);

  if (!images || images.length === 0) {
    return (
      <div className="carousel">
        <img src="https://via.placeholder.com/500" alt="" />
      </div>
    );
  }

  const next = () => {
    setCurrent(current === images.length - 1 ? 0 : current + 1);
  };

  const prev = () => {
    setCurrent(current === 0 ? images.length - 1 : current - 1);
  };

  return (
    <div className="carousel">
      <div className="carousel-main">
        {images.length > 1 && (
          <button className="carousel-btn prev" onClick={prev}>
            <FaChevronLeft />
          </button>
        )}
        <img src={images[current]} alt="" className="carousel-image" />
        {images.length > 1 && (
          <button className="carousel-btn next" onClick={next}>
            <FaChevronRight />
          </button>
        )}
      </div>
      {images.length > 1 && (
        <div className="carousel-dots">
          {images.map((_, index) => (
            <button
              key={index}
              className={`carousel-dot ${index === current ? 'active' : ''}`}
              onClick={() => setCurrent(index)}
            />
          ))}
        </div>
      )}
      {images.length > 1 && (
        <div className="carousel-thumbnails">
          {images.map((img, index) => (
            <img
              key={index}
              src={img}
              alt={`Thumb ${index + 1}`}
              className={`carousel-thumb ${index === current ? 'active' : ''}`}
              onClick={() => setCurrent(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ImageCarousel;