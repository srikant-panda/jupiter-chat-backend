# Jupiter Chat Backend

Backend API for Jupiter Chat, a ChatGPT-style AI chat application built with Node.js, Express, MongoDB, JWT authentication, refresh-token sessions, and streaming AI responses.

## Features

- User signup and login
- JWT access-token authentication
- Refresh-token based sessions
- HTTP-only refresh-token cookies
- Protected API routes
- Chat and message management
- Streaming AI responses
- OpenRouter and Gemini integration
- Token usage tracking
- MongoDB persistence with Mongoose
- Zod request validation
- CORS support

## Tech Stack

- Node.js
- Express
- MongoDB and Mongoose
- JWT
- bcrypt
- Zod
- OpenRouter / Google Gemini
- dotenv
- cookie-parser

## Project Structure

```text
jupiter-chat-backend/
├── config/              # Application configuration
├── controllers/         # Request and business logic
├── middlewares/         # Authentication and request middleware
├── models/              # Mongoose models
├── routes/              # Express routes
├── services/            # AI and supporting services
├── validators/          # Zod validation schemas
├── utils/               # Shared utilities
├── server.js            # Application entry point
├── package.json
└── .env.example
```

## Getting Started

### Requirements

- Node.js 18+
- MongoDB
- OpenRouter API key and/or supported AI provider credentials

### Install

```bash
npm install
```

### Environment

Create a `.env` file in the project root and configure the required values:

```env
PORT=3000
NODE_ENV=development
MONGO_URI=mongodb://localhost:27017/jupiter-chat
JWT_SECRET=replace-with-a-long-random-secret
OPENROUTER_API_KEY=your-openrouter-key
```

Never commit real secrets to the repository.

### Run

Development:

```bash
npm run dev
```

Production:

```bash
npm start
```

The default API server runs on `http://localhost:3000`.

## Authentication

Jupiter Chat uses an authenticated-user architecture. Protected resources require an authenticated user.

The authentication model uses a short-lived access token and a refresh-token session:

```text
Login
  │
  ├── Access Token ──> Authorization: Bearer <token>
  │
  └── Refresh Token ─> HTTP-only Cookie
```

The access token is used for protected API requests. When it expires, the client can call the refresh endpoint using the HTTP-only refresh-token cookie to obtain a new access token.

### Authentication endpoints

```text
POST /api/auth/signup
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
```

### User endpoint

```text
GET /api/user/get-me
```

## Chat API

```text
GET    /api/chat/getRecentChat
POST   /api/chat/createChat
GET    /api/chat/:chatId
DELETE /api/chat/:chatId
```

Chat operations must be scoped to the authenticated user's ID so one user cannot access another user's conversations.

## Message API

```text
GET  /api/message/:chatId
POST /api/message/:chatId/stream
POST /api/message/stream
POST /api/message/:chatId
POST /api/message
```

The streaming endpoints return AI output incrementally via SSE. If a model does not support streaming, the backend automatically falls back to the classic non-streaming service (`generateAIResponse`). Classic request-response endpoints are also available at `POST /api/message` and `POST /api/message/:chatId`.

Typical flow:

```text
Frontend
   │
   │ POST /api/message/.../stream
   ▼
Express API
   │
   ▼
Authentication
   │
   ▼
Message Controller
   │
   ▼
AI Provider
   │
   ▼
Streaming Response
   │
   ├── token
   ├── token
   ├── token
   └── done
```

## Data Model

The backend separates users, sessions, chats, and messages:

```text
User
 ├── Sessions
 │    └── refresh-token/JTI state
 │
 └── Chats
      └── Messages
```

Chat and message queries should always include the authenticated user's identity when the resource belongs to a user.

## CORS

When the frontend and backend are deployed on different origins, configure CORS to allow only trusted frontend origins.

For example:

```text
Frontend: https://jupiter-chat.vercel.app
Backend:  https://jupiter-chat-backend.onrender.com
```

For this cross-origin setup, set these backend environment variables:

```text
PRODUCTION=true
VITE_FRONTEND_URL=https://jupiter-chat.vercel.app
```

Set the frontend's `VITE_API_URL` to the HTTPS backend API URL, for example
`https://jupiter-chat-backend.onrender.com/api`. The refresh cookie uses
`SameSite=None; Secure`, so both deployed URLs must use HTTPS. The frontend
origin must match exactly (including the scheme and without a trailing slash).

Do not use a wildcard origin with credentialed requests.

For a production custom-domain architecture, the public API can also be exposed through the same origin:

```text
https://jupiter-chat.com/
https://jupiter-chat.com/api/*
```

A reverse proxy can route `/api/*` to the backend while the frontend is served separately. This keeps the browser-facing API same-origin even when the backend physically runs on Render.

## Security

Production deployments should follow these practices:

- Never commit JWT secrets or provider API keys.
- Never log passwords, access tokens, refresh tokens, or session credentials.
- Use HTTPS in production.
- Keep refresh tokens HTTP-only and secure.
- Configure `SameSite` according to the deployment architecture.
- Add CSRF protection when authentication relies on cross-site cookies.
- Rate-limit login, signup, refresh, and other abuse-prone endpoints.
- Use generic authentication errors where appropriate to reduce account enumeration.
- Validate all user-controlled input.
- Scope chat and message queries to the authenticated user's ID.
- Restrict CORS to trusted origins.
- Configure reasonable request-body limits.

## Deployment

The backend can be deployed to Render or another Node.js hosting platform.

A typical deployment looks like:

```text
Internet
   │
   ▼
Frontend (Vercel)
   │
   │ HTTPS
   ▼
Backend (Render)
   │
   ├── MongoDB
   │
   └── AI Provider
```

For a cleaner production setup, use a custom domain and reverse proxy so the frontend and API can be exposed through one browser origin.

## Development Checklist

```text
[ ] npm install
[ ] Environment variables configured
[ ] MongoDB connection works
[ ] Signup works
[ ] Login works
[ ] Access-token authentication works
[ ] Refresh flow works
[ ] Logout works
[ ] Chat creation works
[ ] Chat ownership checks work
[ ] Message retrieval works
[ ] AI streaming works
[ ] Provider errors are handled
[ ] CORS is restricted
[ ] Rate limiting is enabled
[ ] Secrets are not committed
[ ] Production uses HTTPS
```

## License

No license file is currently included. Add a `LICENSE` file if you intend to distribute Jupiter Chat publicly.
