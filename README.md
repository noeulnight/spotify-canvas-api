# Spotify Canvas API

A TypeScript-based API server for fetching Spotify Canvas video URLs with Redis caching support.

## Features

- 🎵 Fetch Spotify Canvas video URLs by track ID
- 🔐 Automatic TOTP-based authentication with Spotify
- ⚡ Redis caching for improved performance
- 🐳 Docker and Docker Compose support
- 🔄 Automatic token refresh and secret rotation
- 📊 Health check endpoints

## Prerequisites

- Node.js 24+ (or Docker)
- Redis
- Spotify `sp_dc` cookie token

## Getting Your Spotify Token

1. Open [Spotify Web Player](https://open.spotify.com) in your browser
2. Open Developer Tools (F12)
3. Go to Application/Storage → Cookies → `https://open.spotify.com`
4. Find and copy the `sp_dc` cookie value

## Installation

### Local Development

```bash
# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env

# Edit .env and add your SPOTIFY_TOKEN
nano .env

# Build TypeScript
pnpm run build

# Run in development mode
pnpm run dev
```

### Docker (Recommended)

```bash
# Copy environment file
cp .env.example .env

# Edit .env and add your SPOTIFY_TOKEN
nano .env

# Start with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop services
docker-compose down
```

## Architecture

### Caching Strategy

The application implements a 2-tier caching system:

2. **Redis Cache** (1nd tier)
   - Shared across instances
   - Persistent across restarts
   - TTL-based automatic expiration
   - Canvas URLs: 7 days
   - Access tokens: Dynamic based on Spotify expiration

3. **API Fallback** (2rd tier)
   - Direct Spotify API calls
   - Only on cache miss
   - Automatic cache population

### Token Management

- Automatic TOTP secret rotation (hourly)
- Token caching with precise TTL
- Fallback to hardcoded secrets if GitHub unavailable
- Automatic token refresh on expiration

## Docker Details

### Build Image

```bash
docker build -t spotify-canvas-api .
```

### Run Container

```bash
docker run -d \
  --name spotify-canvas-api \
  -p 3000:3000 \
  -e SPOTIFY_TOKEN=your_token_here \
  -e REDIS_HOST=redis \
  spotify-canvas-api
```

## Development

```bash
# Install dependencies
pnpm install

# Run in watch mode
pnpm run dev

# Build for production
pnpm run build

# Type checking
npx tsc --noEmit
```

## Project Structure

```
spotify-canvas-api/
├── src/
│   ├── cache/
│   │   └── redis.ts          # Redis cache implementation
│   ├── spotify/
│   │   ├── client.ts         # Spotify authentication client
│   │   └── canvas.ts         # Canvas API handler
│   └── index.ts              # Express server
├── dist/                     # Compiled JavaScript
├── Dockerfile                # Docker image definition
├── docker-compose.yml        # Docker Compose configuration
├── .dockerignore            # Docker build exclusions
├── .env.example             # Environment template
└── package.json             # Dependencies and scripts
```

## Troubleshooting

### Token Issues

If you get authentication errors:

1. Verify your `sp_dc` token is still valid
2. Check if Spotify rotated the TOTP secrets
3. Restart the application to fetch new secrets

# License

MIT License - see LICENSE file for details

# Credits

- Based on [xyloflake/spot-secrets-go](https://github.com/xyloflake/spot-secrets-go) for TOTP secret management
- Inspired by the Spotify Canvas community

# Disclaimer

This project is for educational purposes only. Use at your own risk. Spotify's terms of service prohibit unauthorized API access.
