const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  listingId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Listing', 
    required: true,
    index: true,
  },
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
  },
  text: { 
    type: String, 
    required: true, 
    maxlength: 500,
  },
  // Hashtags extracted from comment text
  hashtags: [{ 
    type: String,
  }],
  likes: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
  }],
  // For threaded replies
  parentId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Comment',
    default: null,
  },
  replies: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Comment',
  }],
}, {
  timestamps: true,
});

// Extract hashtags from text before saving
commentSchema.pre('save', function(next) {
  if (this.isModified('text') || this.isNew) {
    const hashtagRegex = /#(\w+)/g;
    const matches = this.text.match(hashtagRegex) || [];
    this.hashtags = matches.map(m => m.substring(1).toLowerCase());
  }
  next();
});

module.exports = mongoose.model('Comment', commentSchema);