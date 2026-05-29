# TrendDrop

A full-stack social commerce marketplace for buying and selling fashion, built with React.js, Node.js, Express.js, and MongoDB.

## Features

### Authentication & User Management
- User registration with avatar upload
- JWT-based authentication
- User profiles with bio, location, closet name
- Follow/unfollow users
- Edit profile settings

### Listings (Products)
- Create, edit, delete listings
- Multi-image upload (up to 10 images) with Cloudinary
- Image carousel on detail pages
- Categories: Women, Men, Kids, Electronics, Home, Beauty, Accessories
- Brand, size, color, condition fields
- Discount percentage calculation

### Social Features
- Like/unlike listings
- Comment on listings
- Share listings
- Follow users
- Social feed from followed users
- Notifications (likes, follows, comments, offers, sales)

### Marketplace Features
- Make offers on listings
- Accept/decline/counter offers
- Buy Now (instant purchase)
- Mark items as sold
- Transaction history
- Search with filters (category, brand, size, condition, price range)
- Sort by newest, price, popularity

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React.js 18, React Router v6, Axios, React Toastify, React Icons, Moment.js |
| Backend | Node.js, Express.js |
| Database | MongoDB with Mongoose |
| Image Storage | Cloudinary |
| Authentication | JWT (JSON Web Tokens) |
| Deployment | Render (free tier) |
| Free MongoDB | MongoDB Atlas (M0 free tier) |

## Prerequisites

- Node.js >= 14.0.0
- npm or yarn
- MongoDB Atlas account (free)
- Cloudinary account (free)

## Setup Instructions

### 1. Clone the repository
```bash
git clone <your-repo-url>
cd trend-drop
```

### 2. Install dependencies
```bash
# Install all dependencies
cd server && npm install
cd ../client && npm install
cd ..
```

### 3. Set up MongoDB Atlas (Free)
1. Go to [mongodb.com/atlas](https://www.mongodb.com/atlas)
2. Create a free M0 cluster
3. Create a database user
4. Get the connection string and add it to your `.env` file

### 4. Set up Cloudinary (Free)
1. Go to [cloudinary.com](https://cloudinary.com)
2. Create a free account
3. Get your Cloud Name, API Key, and API Secret

### 5. Configure Environment Variables
```bash
cd server
cp .env.example .env
# Edit .env with your values
```

Required environment variables:
```
PORT=5000
MONGO_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/trend-drop?retryWrites=true&w=majority
JWT_SECRET=4QmypzuXr4jWuuQAa6hFuga0Mch4wT19Usj53CRxd14=
CLOUDINARY_CLOUD_NAME=dhw3unh0e
CLOUDINARY_API_KEY=536891899585567
CLOUDINARY_API_SECRET=kxa47g-Rl846xNqfWU0kh3uTN0M
NODE_ENV=development
```

### 6. Run the application

#### Option A: Run All Platforms at Once (Recommended)
```bash
# From the project root
bash start.sh
```
This starts everything:
- **Backend API** on `http://localhost:5000`
- **Web App** on `http://localhost:3000`
- **Android Emulator** (if Android SDK is installed)
- **iOS Simulator** (if on macOS with Xcode)

All platforms automatically point to the local backend. Press `Ctrl+C` to stop all.

#### Option B: Run Individually
```bash
# Terminal 1 - Backend
cd server
npm run dev

# Terminal 2 - Frontend
cd client
npm start
```

The web app will be available at `http://localhost:3000`

## Deployment on Render (Free)

### Steps:
1. Push your code to GitHub
2. Go to [render.com](https://render.com) and create an account
3. Click "New" > "Web Service"
4. Connect your GitHub repository
5. Configure:
   - **Build Command:** `cd client && npm install && npm run build && cd ../server && npm install`
   - **Start Command:** `node server/server.js`
6. Add environment variables in Render dashboard:
   - `NODE_ENV` = `production`
   - `MONGO_URI` = your MongoDB Atlas connection string
   - `JWT_SECRET` = generate a strong secret
   - `CLOUDINARY_CLOUD_NAME` = dhw3unh0e
   - `CLOUDINARY_API_KEY` = 536891899585567
   - `CLOUDINARY_API_SECRET` = kxa47g-Rl846xNqfWU0kh3uTN0M
7. Deploy!

### Alternative: Using render.yaml
Render can auto-configure from `render.yaml` if present in your repo root.

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register user |
| POST | /api/auth/login | Login user |
| GET | /api/auth/me | Get current user |
| PUT | /api/auth/profile | Update profile |
| PUT | /api/auth/avatar | Update avatar |

### Listings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/listings | Get all listings (with filters) |
| GET | /api/listings/:id | Get single listing |
| POST | /api/listings | Create listing |
| PUT | /api/listings/:id | Update listing |
| DELETE | /api/listings/:id | Delete listing |
| POST | /api/listings/:id/like | Toggle like |
| POST | /api/listings/:id/comment | Add comment |
| POST | /api/listings/:id/share | Share listing |
| PATCH | /api/listings/:id/sold | Mark as sold |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/users/:id | Get user profile |
| POST | /api/users/:id/follow | Toggle follow |
| GET | /api/users/:id/followers | Get followers |
| GET | /api/users/:id/following | Get following |
| GET | /api/users/:id/closet | Get user's closet |
| GET | /api/users/feed | Get social feed |

### Offers
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/offers | Create offer |
| GET | /api/offers/received | Get received offers |
| GET | /api/offers/sent | Get sent offers |
| PATCH | /api/offers/:id/accept | Accept offer |
| PATCH | /api/offers/:id/decline | Decline offer |
| PATCH | /api/offers/:id/counter | Counter offer |

### Transactions
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/transactions | Create purchase |
| GET | /api/transactions | Get transactions |
| GET | /api/transactions/:id | Get transaction detail |

## Mobile App Deployment (iOS & Android via Capacitor)

TrendDrop uses **Capacitor** to deploy as native iOS and Android apps. The Render backend serves as the API server for all platforms (web, iOS, Android).

### Prerequisites for Mobile
- **Android:** Android Studio (for Android builds)
- **iOS:** Xcode + macOS (for iOS builds)
- Node.js >= 14.0.0

### Build for Web
```bash
cd client
npm run build
```

### Build for Android
```bash
cd client
npm run build
npx cap sync android
npx cap open android
```
This opens Android Studio. From there:
1. Select **Build > Build Bundle(s) / APK(s) > Build APK(s)**
2. Or run directly on a connected device/emulator

### Build for iOS
```bash
cd client
npm run build
npx cap sync ios
npx cap open ios
```
This opens Xcode. From there:
1. Select your development team in Signing & Capabilities
2. Select a target device/simulator
3. Click Run (▶)

### API Configuration for Mobile
The mobile app automatically detects it's running on a native platform and points to:
```
https://trend-drop.onrender.com/api
```

**IMPORTANT:** After deploying to Render, update the API URL in `client/src/services/api.js` with your actual Render deployment URL.

### Capacitor Commands Reference
| Command | Description |
|---------|-------------|
| `npm run build` | Build the React app |
| `npx cap sync` | Copy web assets to native projects |
| `npx cap sync android` | Sync Android only |
| `npx cap sync ios` | Sync iOS only |
| `npx cap open android` | Open in Android Studio |
| `npx cap open ios` | Open in Xcode |
| `npm run mobile:android` | Build + Sync + Open Android |
| `npm run mobile:ios` | Build + Sync + Open iOS |

### Three-Platform Architecture
```
┌─────────────────────────────────────────┐
│              Render Backend              │
│         (Node.js + Express API)          │
│    https://trend-drop.onrender.com      │
└──────────┬──────────┬──────────┬────────┘
           │          │          │
    ┌──────┘   ┌──────┘   ┌─────┘
    │          │          │
┌───▼───┐ ┌───▼───┐ ┌───▼────┐
│  Web  │ │ iOS   │ │Android │
│ (React│ │(Capac)│ │(Capac) │
│  SPA) │ │       │ │        │
└───────┘ └───────┘ └────────┘
```

## License

MIT
