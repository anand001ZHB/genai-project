# genai-project

This workspace now includes:

- MongoDB-backed user persistence
- JWT authentication and role-based authorization
- Admin and user dashboards in the Angular frontend
- Analytics for visits, signups, logins, dashboard views, and interview activity

## Project structure

- `genai-backend`: NestJS API
- `genai-frontend/ai-chat-ui`: Angular frontend

## Required backend environment

Create a `.env` file inside `genai-backend` with values like:

```env
MONGODB_URI=mongodb+srv://your-user:your-password@your-cluster.mongodb.net/genai_project_test?retryWrites=true&w=majority
JWT_SECRET=change-this-secret
JWT_EXPIRES_IN=7d
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin123456
ADMIN_NAME=Platform Admin
```

The admin account is seeded automatically on backend startup when `ADMIN_EMAIL` and `ADMIN_PASSWORD` are present.

## First Admin Setup

The first admin user is created automatically from the backend environment variables:

```env
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin123456
ADMIN_NAME=Platform Admin
```

On the first backend startup, if no user exists with `ADMIN_EMAIL`, the app creates that user with the `admin` role.

After startup, log in through the app with those credentials and open `/admin/dashboard`.

You can then:

- create normal users
- create admin users
- change a user from `user` to `admin` or from `admin` to `user`
- remove users

Safety rules:

- an admin cannot delete their own account from the dashboard
- the last remaining admin cannot be deleted
- one email address maps to one user record only, so the same email cannot exist as both a `user` and an `admin` at the same time

## MongoDB Setup

The current project setup uses MongoDB Atlas via `MONGODB_URI` in [genai-backend/.env](/workspaces/genai-project/genai-backend/.env).

Recommended database naming:

- `genai_project_test` for development or test use
- `genai_project_prod` for production use

Update [genai-backend/.env](/workspaces/genai-project/genai-backend/.env) with the correct Atlas connection string for the environment you want to use.

## Run locally

Backend:

```bash
cd genai-backend
npm install
npm run start:dev
```

Frontend:

```bash
cd genai-frontend/ai-chat-ui
npm install
npm start
```

## Route flow

- `/`: landing page with `Login`, `Sign Up`, and `Start`
- `/auth`: login/signup page
- `/password`: shared password page for forgot-password and logged-in password changes
- `/user/dashboard`: authenticated standard-user dashboard
- `/admin/dashboard`: authenticated admin analytics dashboard
- `/interview`: protected interview room

Both the home page `Start` button and the auth buttons route users into the auth page before protected access is granted.

The admin dashboard now includes user management for creating users, changing roles, and removing accounts.

## Password Flow

Password actions now live on one shared page at `/password`.

- `Forgot password`: request a reset token with your email, then submit the token with a new password
- `Change password`: available for logged-in users and requires the current password

For local development, the forgot-password API returns the reset token in the response so you can complete the flow without email infrastructure.
In production, that token should be delivered by email instead of being returned to the client.

## Viewing MongoDB data

This app creates MongoDB collections, not SQL tables. The main collections are:

- `users`
- `analyticsevents`

You can inspect them with any of these:

- MongoDB Atlas `Browse Collections`
- MongoDB Compass using your Atlas connection string
- `mongosh` using your Atlas connection string, then `use genai_project_test` or `use genai_project_prod`
- VS Code MongoDB extension, if you prefer browsing inside the editor

## Verification

Backend:

```bash
cd genai-backend
npm run build
npm test -- --runInBand
```

Frontend:

```bash
cd genai-frontend/ai-chat-ui
npm run build
npm test -- --watch=false
```