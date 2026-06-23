import React, { useState, useRef } from 'react';
import { FaChevronLeft, FaChevronRight, FaExpand, FaPlay, FaYoutube, FaInstagram, FaFacebook } from 'react-icons/fa';
import { parseVideoUrl, getVideoPlatformLabel, getVideoPlatformColor } from '../utils/videoEmbed';
import { defaultAvatar } from '../utils/helpers';

/**
 * MediaCarousel — Hybrid image + video carousel for listings.
 *
 * Displays images and (if present) the listing video in a single unified
 * slideshow. Videos are embedded client-side (YouTube/IG/FB iframe or
 * native <video>) — zero server load.
 *
 * Props:
 *   images   - string[] of image URLs
 *   videoUrl - optional video URL to embed among the images
 */
const MediaCarousel = ({ images = [], videoUrl }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loaded, setLoaded] = useState({});
  const videoRef = useRef(null);

  // Build the combined media array — computed directly, no useCallback needed
  const getMediaItems = () => {
    const items = images.map((url) => ({ type: 'image', url }));
    if (videoUrl) {
      const parsed = parseVideoUrl(videoUrl);
      if (parsed) {
        // Insert video as the second item (after the cover image) for best UX
        // If only 1 image, insert at position 1; if no images, it's the only item
        const insertAt = items.length > 0 ? Math.min(1, items.length) : 0;
        // IMPORTANT: parsed.type (e.g. 'youtube') must NOT override our 'video' media type
        // We keep parsed.type as platformType for display logic
        items.splice(insertAt, 0, { ...parsed, type: 'video' });
      }
    }
    return items;
  };

  const items = getMediaItems();

  const goTo = (index) => { setCurrentIndex(index); };
  const goPrev = (e) => { e?.stopPropagation(); setCurrentIndex((prev) => (prev === 0 ? items.length - 1 : prev - 1)); };
  const goNext = (e) => { e?.stopPropagation(); setCurrentIndex((prev) => (prev === items.length - 1 ? 0 : prev + 1)); };

  const handleImageLoad = (index) => {
    setLoaded((prev) => ({ ...prev, [index]: true }));
  };

  const currentItem = items[currentIndex];

  if (!items || items.length === 0) {
    return (
      <div className="carousel">
        <div className="carousel-main" style={{ background: 'var(--td-surface-tertiary)' }}>
          <img src={defaultAvatar} alt="No visual" className="carousel-image" />
        </div>
      </div>
    );
  }

  const renderMedia = () => {
    if (!currentItem) return null;

    // ---- VIDEO ----
    if (currentItem.type === 'video') {
      return (
        <div className="media-carousel-video-wrapper">
          {/* YouTube */}
          {currentItem.platform === 'youtube' && (
            <div className="media-carousel-embed-container">
              <iframe
                src={currentItem.embedUrl}
                title="YouTube product video"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="media-carousel-iframe"
                loading="lazy"
              />
            </div>
          )}

          {/* Instagram */}
          {currentItem.platform === 'instagram' && (
            <div className="media-carousel-embed-container">
              <iframe
                src={currentItem.embedUrl}
                title="Instagram product video"
                frameBorder="0"
                scrolling="no"
                allowtransparency
                allowFullScreen
                className="media-carousel-iframe"
                loading="lazy"
              />
            </div>
          )}

          {/* Facebook */}
          {currentItem.platform === 'facebook' && (
            <div className="media-carousel-embed-container">
              <iframe
                src={currentItem.embedUrl}
                title="Facebook product video"
                frameBorder="0"
                allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                allowFullScreen
                className="media-carousel-iframe"
                loading="lazy"
              />
            </div>
          )}

          {/* TikTok */}
          {currentItem.platform === 'tiktok' && (
            <div className="media-carousel-embed-container">
              <iframe
                src={currentItem.embedUrl}
                title="TikTok product video"
                frameBorder="0"
                allow="autoplay; encrypted-media"
                allowFullScreen
                className="media-carousel-iframe"
                loading="lazy"
              />
            </div>
          )}

          {/* Vimeo */}
          {currentItem.platform === 'vimeo' && (
            <div className="media-carousel-embed-container">
              <iframe
                src={currentItem.embedUrl}
                title="Vimeo product video"
                frameBorder="0"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                className="media-carousel-iframe"
                loading="lazy"
              />
            </div>
          )}

          {/* X/Twitter */}
          {currentItem.platform === 'twitter' && (
            <div className="media-carousel-embed-container">
              <iframe
                src={currentItem.embedUrl}
                title="X product video"
                frameBorder="0"
                allowFullScreen
                className="media-carousel-iframe"
                loading="lazy"
              />
            </div>
          )}

          {/* Direct video file (MP4, etc.) — native <video> tag */}
          {currentItem.platform === 'direct' && (
            <div className="media-carousel-direct-video">
              <video
                ref={videoRef}
                controls
                playsInline
                webkit-playsinline="true"
                preload="metadata"
                className="media-carousel-video-element"
                poster={currentItem.thumbnail || undefined}
              >
                <source src={currentItem.url} type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            </div>
          )}

          {/* Fallback: unknown embed — try iframe */}
          {currentItem.platform === 'unknown' && (
            <div className="media-carousel-embed-container">
              <iframe
                src={currentItem.embedUrl}
                title="Embedded video"
                frameBorder="0"
                allowFullScreen
                className="media-carousel-iframe"
                loading="lazy"
              />
            </div>
          )}

          {/* Platform badge overlay */}
          <div
            className="media-carousel-platform-badge"
            style={{
              position: 'absolute',
              top: 12,
              left: 12,
              background: getVideoPlatformColor(currentItem),
              color: '#fff',
              padding: '4px 10px',
              borderRadius: 'var(--td-radius-full)',
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              zIndex: 3,
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}
          >
            {currentItem.platform === 'youtube' && <FaYoutube size={14} />}
            {currentItem.platform === 'instagram' && <FaInstagram size={14} />}
            {currentItem.platform === 'facebook' && <FaFacebook size={14} />}
            {currentItem.platform === 'direct' && <FaPlay size={12} />}
            {getVideoPlatformLabel(currentItem)}
          </div>
        </div>
      );
    }

    // ---- IMAGE ----
    return (
      <>
        {!loaded[currentIndex] && (
          <div className="skeleton skeleton-image" style={{ position: 'absolute', inset: 0 }} />
        )}
        <img
          src={currentItem.url}
          alt=""
          className="carousel-image"
          style={{ opacity: loaded[currentIndex] ? 1 : 0 }}
          onLoad={() => handleImageLoad(currentIndex)}
        />
      </>
    );
  };

  return (
    <div className="carousel">
      {/* Main Media Display */}
      <div className="carousel-main">
        {renderMedia()}

        {/* Media Counter */}
        <div className="media-carousel-counter" style={{
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
          {currentIndex + 1} / {items.length}
        </div>

        {/* Zoom Hint (images only) */}
        {currentItem?.type === 'image' && (
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
        )}

        {/* Navigation Buttons */}
        {items.length > 1 && (
          <>
            <button className="carousel-btn prev" onClick={goPrev} aria-label="Previous">
              <FaChevronLeft />
            </button>
            <button className="carousel-btn next" onClick={goNext} aria-label="Next">
              <FaChevronRight />
            </button>
          </>
        )}
      </div>

      {/* Dots */}
      {items.length > 1 && (
        <div className="carousel-dots">
          {items.map((item, i) => (
            <button
              key={i}
              className={`carousel-dot ${i === currentIndex ? 'active' : ''}`}
              onClick={() => goTo(i)}
              aria-label={`Go to ${item.type === 'video' ? 'video' : 'image'} ${i + 1}`}
            />
          ))}
        </div>
      )}

      {/* Thumbnails */}
      {items.length > 1 && (
        <div className="carousel-thumbnails">
          {items.map((item, i) => (
            <div
              key={i}
              className={`carousel-thumb-wrapper ${i === currentIndex ? 'active' : ''}`}
              onClick={() => goTo(i)}
            >
              {/* Video thumbnail with play overlay */}
              {item.type === 'video' ? (
                <div className="carousel-thumb-video">
                  {item.thumbnail ? (
                    <img
                      src={item.thumbnail}
                      alt=""
                      className="carousel-thumb"
                      onLoad={() => handleImageLoad(i)}
                    />
                  ) : (
                    <div className="carousel-thumb" style={{
                      background: 'var(--td-surface-tertiary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <FaPlay size={16} style={{ color: 'var(--td-text-tertiary)', opacity: 0.5 }} />
                    </div>
                  )}
                  <div className="carousel-thumb-play-overlay">
                    <FaPlay size={10} />
                  </div>
                </div>
              ) : (
                <img
                  src={item.url}
                  alt=""
                  className="carousel-thumb"
                  onLoad={() => handleImageLoad(i)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MediaCarousel;