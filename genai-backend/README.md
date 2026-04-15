# GenAI Backend

NestJS API for authentication, role-based access control, chat endpoints, and MongoDB-backed analytics.

## Environment

Create `.env` in this folder:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/genai-project
JWT_SECRET=change-this-secret
JWT_EXPIRES_IN=7d
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin123456
ADMIN_NAME=Platform Admin
```

## Features

- `POST /auth/signup`: register a standard user
- `POST /auth/login`: authenticate and receive JWT
- `GET /auth/me`: get the current user profile
- `POST /analytics/events`: store anonymous or authenticated analytics events
- `GET /analytics/overview`: admin-only analytics summary
- `POST /chat/start`: protected interview start
- `POST /chat/end`: protected interview end

## Development

```bash
npm install
npm run start:dev
```

MongoDB defaults to `mongodb://127.0.0.1:27017/genai-project` if `MONGODB_URI` is not set.

## Verification

```bash
npm run build
npm test -- --runInBand
```
