const axios = require('axios');
const Trend = require('../models/Trend');

// Fetch trending posts from X/Twitter
const fetchTrends = async () => {
  try {
    // Replace with actual X API call or Grok API
    const response = await axios.post('https://api.x.ai/trends', {
      query: 'fashion OR style OR outfit',
      count: 50,
      from_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.X_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const posts = response.data.posts || [];
    const trends = posts.map(post => ({
      postId: post.id,
      text: post.text,
      author: post.author,
      hashtags: post.hashtags || [],
      likes: post.likes || 0,
      reposts: post.reposts || 0,
      replies: post.replies || 0,
      views: post.views || 0,
      timestamp: post.timestamp,
      isViral: post.likes + post.reposts + post.replies > 1000, // Threshold for virality
    }));

    // Bulk upsert trends
    await Trend.bulkWrite(
      trends.map(trend => ({
        updateOne: {
          filter: { postId: trend.postId },
          update: { $set: trend },
          upsert: true,
        },
      }))
    );

    return trends;
  } catch (error) {
    console.error('Error fetching trends:', error.message);
    throw error;
  }
};

// Check if a post is viral
const isViral = (post) => {
  return post.likes + post.reposts + post.replies > 1000;
};

module.exports = {
  fetchTrends,
  isViral,
};