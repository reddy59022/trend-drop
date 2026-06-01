/**
 * Intelligent Video URL Detection & Embed Generator
 * 
 * Parses video URLs from YouTube, Instagram, Facebook, and direct video files.
 * Generates embed URLs, thumbnails, and platform metadata.
 * All videos play client-side — zero server burden.
 */

const PLATFORMS = {
  YOUTUBE: 'youtube',
  INSTAGRAM: 'instagram',
  FACEBOOK: 'facebook',
  DIRECT: 'direct',
  TIKTOK: 'tiktok',
  VIMEO: 'vimeo',
  TWITTER: 'twitter',
};

const VIDEO_FILE_EXTENSIONS = /\.(mp4|mov|webm|ogg|avi|mkv)(\?.*)?$/i;

/**
 * Parse a video URL and return platform metadata + embed info.
 * Returns null if the URL is empty, invalid, or unsupported.
 *
 * @param {string} url - The raw video URL from the seller
 * @returns {object|null} { platform, embedUrl, thumbnail, url, type } or null
 */
export const parseVideoUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // ---- YouTube ----
  // (www.)youtube.com/watch?v=ID | youtu.be/ID | shorts/ID | embed/ID
  let match;
  match = trimmed.match(
    /(?:(?:www\.)?youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  if (match) {
    const videoId = match[1];
    return {
      platform: PLATFORMS.YOUTUBE,
      embedUrl: `https://www.youtube.com/embed/${videoId}?playsinline=1&rel=0&modestbranding=1`,
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      url: trimmed,
      videoId,
      type: 'youtube',
    };
  }


  // ---- Facebook ----
  // facebook.com/watch/?v=ID | facebook.com/USER/videos/ID | fb.watch/ID
  match = trimmed.match(
    /(?:facebook\.com\/(?:watch\/?\?v=|[\w.-]+\/videos\/)|fb\.watch\/)([\w.-]+)/
  );
  if (match) {
    const videoId = match[1];
    return {
      platform: PLATFORMS.FACEBOOK,
      embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(trimmed)}&show_text=false`,
      thumbnail: '',
      url: trimmed,
      videoId,
      type: 'facebook',
    };
  }

  // ---- Direct video file ----
  if (VIDEO_FILE_EXTENSIONS.test(trimmed)) {
    return {
      platform: PLATFORMS.DIRECT,
      embedUrl: trimmed,
      thumbnail: '',
      url: trimmed,
      type: 'direct',
    };
  }

  // ---- TikTok ----
  // tiktok.com/@user/video/ID or vm.tiktok.com/ID
  match = trimmed.match(
    /(?:tiktok\.com\/@[\w.-]+\/video\/(\d+)|vm\.tiktok\.com\/([\w]+))/
  );
  if (match) {
    const videoId = match[1] || match[2];
    return {
      platform: PLATFORMS.TIKTOK,
      embedUrl: `https://www.tiktok.com/embed/v2/${videoId}`,
      thumbnail: '',
      url: trimmed,
      videoId,
      type: 'tiktok',
    };
  }

  // ---- Vimeo ----
  match = trimmed.match(/vimeo\.com\/(\d+)/);
  if (match) {
    const videoId = match[1];
    return {
      platform: PLATFORMS.VIMEO,
      embedUrl: `https://player.vimeo.com/video/${videoId}?title=0&byline=0&portrait=0`,
      thumbnail: '',
      url: trimmed,
      videoId,
      type: 'vimeo',
    };
  }

  // ---- X (Twitter) ----
  match = trimmed.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
  if (match) {
    const tweetId = match[1];
    return {
      platform: PLATFORMS.TWITTER,
      embedUrl: `https://platform.twitter.com/embed/Tweet.html?id=${tweetId}`,
      thumbnail: '',
      url: trimmed,
      videoId: tweetId,
      type: 'twitter',
    };
  }

  // Unrecognized URL — return as generic embed attempt
  return {
    platform: 'unknown',
    embedUrl: trimmed,
    thumbnail: '',
    url: trimmed,
    type: 'unknown',
  };
};

/**
 * Get a human-readable label for the video platform
 * @param {object} videoInfo - Result from parseVideoUrl (or media item with platform field)
 * @returns {string}
 */
export const getVideoPlatformLabel = (videoInfo) => {
  if (!videoInfo) return '';
  // Can accept either parsed output (type='youtube') or media item (platform='youtube')
  const platformKey = videoInfo.platform || videoInfo.type || '';
  const labels = {
    youtube: 'YouTube',
    instagram: 'Instagram Reel',
    facebook: 'Facebook Video',
    direct: 'Video',
    tiktok: 'TikTok',
    vimeo: 'Vimeo',
    twitter: 'X Video',
    unknown: 'Video',
  };
  return labels[platformKey] || 'Video';
};

/**
 * Returns a CSS-friendly color for the platform badge
 * @param {object} videoInfo - Result from parseVideoUrl (or media item with platform field)
 * @returns {string}
 */
export const getVideoPlatformColor = (videoInfo) => {
  if (!videoInfo) return '#999';
  const platformKey = videoInfo.platform || videoInfo.type || '';
  const colors = {
    youtube: '#FF0000',
    instagram: '#E4405F',
    facebook: '#1877F2',
    direct: '#6C63FF',
    tiktok: '#000000',
    vimeo: '#1AB7EA',
    twitter: '#1DA1F2',
    unknown: '#999',
  };
  return colors[platformKey] || '#999';
};

/**
 * Validate that a URL looks like a playable video URL
 * @param {string} url
 * @returns {boolean}
 */
export const isValidVideoUrl = (url) => {
  const parsed = parseVideoUrl(url);
  return parsed !== null;
};

export { PLATFORMS };