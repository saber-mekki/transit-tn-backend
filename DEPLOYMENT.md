# 🚀 Transit TN — Complete Setup & Deployment Guide

---

## 📁 Project Structure

```
Transit-TN/
├── frontend/          ← React + Vite (your existing frontend)
└── backend/           ← Node.js + Express + Prisma (this folder)
    ├── src/
    │   ├── server.ts          ← Main entry point
    │   ├── db.ts              ← Prisma client singleton
    │   ├── middleware/
    │   │   └── auth.ts        ← JWT auth middleware
    │   └── routes/
    │       ├── auth.ts        ← /api/auth/* (signup, login, me)
    │       ├── users.ts       ← /api/users/*
    │       ├── trips.ts       ← /api/trips/*
    │       ├── stations.ts    ← /api/stations/*
    │       ├── locations.ts   ← /api/locations/*
    │       └── notifications.ts ← /api/notifications/*
    ├── prisma/
    │   ├── schema.prisma      ← Database schema
    │   └── seed.ts            ← Demo data seeder
    ├── .env.example           ← Copy this to .env
    ├── package.json
    └── tsconfig.json
```

---

## 🖥️ PART 1 — Run Locally

### Prerequisites

Install these tools if you don't have them:

| Tool | Download |
|------|----------|
| Node.js 18+ | https://nodejs.org |
| PostgreSQL 14+ | https://www.postgresql.org/download |
| Git | https://git-scm.com |

---

### Step 1 — Clone & install

```bash
# Clone the repo
git clone https://github.com/saber-mekki/Transit-TN.git
cd Transit-TN

# Install frontend dependencies
npm install

# Go into backend
cd backend
npm install
```

---

### Step 2 — Set up PostgreSQL locally

**On macOS (with Homebrew):**
```bash
brew install postgresql@14
brew services start postgresql@14
psql postgres -c "CREATE DATABASE transit_tn;"
psql postgres -c "CREATE USER transit_user WITH PASSWORD 'yourpassword';"
psql postgres -c "GRANT ALL PRIVILEGES ON DATABASE transit_tn TO transit_user;"
```

**On Ubuntu/Debian:**
```bash
sudo apt install postgresql postgresql-contrib
sudo -u postgres psql -c "CREATE DATABASE transit_tn;"
sudo -u postgres psql -c "CREATE USER transit_user WITH PASSWORD 'yourpassword';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE transit_tn TO transit_user;"
```

**On Windows:**
1. Download PostgreSQL from https://www.postgresql.org/download/windows
2. Install it (remember the password you set for `postgres` user)
3. Open pgAdmin or psql and run:
```sql
CREATE DATABASE transit_tn;
```

---

### Step 3 — Configure environment variables

```bash
# Inside the backend/ folder
cp .env.example .env
```

Open `.env` and edit it:

```env
DATABASE_URL="postgresql://transit_user:yourpassword@localhost:5432/transit_tn"
JWT_SECRET="any-long-random-string-you-choose"
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

---

### Step 4 — Set up the database

```bash
# Still inside backend/
# Push the schema to your database
npx prisma db push

# Seed with demo data (stations, users, trips)
npm run db:seed
```

You should see:
```
🌱 Seeding Transit TN database...
📍 Seeding stations...
👤 Seeding users...
🚗 Seeding trips...
✅ Seeding complete!

🔑 Demo credentials:
  Admin:    username=admin        password=Admin@123!
  Operator: username=sfax_express  password=Operator@123!
  User:     username=ahmed_b       password=User@123!
```

---

### Step 5 — Start the backend

```bash
# Development mode (auto-restarts on file changes)
npm run dev

# You should see:
# 🚀 Transit TN Backend running on http://localhost:3001
# 📋 Health check: http://localhost:3001/health
```

Test it in your browser: http://localhost:3001/health

---

### Step 6 — Start the frontend

Open a **new terminal**:

```bash
# Go back to the root project folder
cd ..

# Start the frontend
npm run dev

# Frontend running at: http://localhost:5173
```

---

### Step 7 — Connect frontend to backend

In your frontend code, set the API base URL to point to the backend.
Create a file `frontend/src/api.ts`:

```typescript
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export async function apiRequest(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Request failed');
  return data;
}

// Auth
export const login = (username: string, password: string) =>
  apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });

export const signup = (data: object) =>
  apiRequest('/api/auth/signup', { method: 'POST', body: JSON.stringify(data) });

export const getMe = () => apiRequest('/api/auth/me');

// Trips
export const getTrips = (params?: Record<string, string>) =>
  apiRequest(`/api/trips?${new URLSearchParams(params || '')}`);

export const createTrip = (data: object) =>
  apiRequest('/api/trips', { method: 'POST', body: JSON.stringify(data) });

export const deleteTrip = (id: string) =>
  apiRequest(`/api/trips/${id}`, { method: 'DELETE' });

// Users (admin)
export const getUsers = () => apiRequest('/api/users');
export const updateUser = (id: string, data: object) =>
  apiRequest(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteUser = (id: string) =>
  apiRequest(`/api/users/${id}`, { method: 'DELETE' });

// Stations
export const getStations = () => apiRequest('/api/stations');
export const createStation = (data: object) =>
  apiRequest('/api/stations', { method: 'POST', body: JSON.stringify(data) });

// Notifications
export const getNotifications = () => apiRequest('/api/notifications');
export const markNotifRead = (id: string) =>
  apiRequest(`/api/notifications/${id}/read`, { method: 'PUT' });
export const markAllRead = () =>
  apiRequest('/api/notifications/read-all', { method: 'PUT' });
```

Create `.env` in the **frontend root**:
```env
VITE_API_URL=http://localhost:3001
```

---

### ✅ Local API Endpoints Reference

```
GET    /health                         → Health check (public)

POST   /api/auth/signup                → Register new user
POST   /api/auth/login                 → Login → returns { user, token }
GET    /api/auth/me                    → Get current user (auth required)
PUT    /api/auth/password              → Change password (auth required)

GET    /api/trips                      → Search trips (public)
GET    /api/trips?type=louage          → Filter by type
GET    /api/trips?fromCity=Tunis       → Filter by city
GET    /api/trips?date=2026-05-10      → Filter by date
GET    /api/trips/:id                  → Single trip (public)
POST   /api/trips                      → Create trip (operator/admin)
PUT    /api/trips/:id                  → Update trip (operator/admin)
DELETE /api/trips/:id                  → Delete trip (operator/admin)
GET    /api/trips/operator/my          → My trips (operator)

GET    /api/stations                   → All stations (public)
POST   /api/stations                   → Create station (admin)
PUT    /api/stations/:id               → Update station (admin)
DELETE /api/stations/:id               → Delete station (admin)

GET    /api/locations                  → All governorates + delegations (public)

GET    /api/users                      → All users (admin only)
POST   /api/users                      → Create user (admin only)
GET    /api/users/:id                  → Get user
PUT    /api/users/:id                  → Update user
DELETE /api/users/:id                  → Delete user (admin only)

GET    /api/notifications              → My notifications
GET    /api/notifications/unread-count → Unread count
PUT    /api/notifications/:id/read     → Mark one as read
PUT    /api/notifications/read-all     → Mark all as read
DELETE /api/notifications/:id          → Delete notification
POST   /api/notifications              → Send notification (admin only)
```

---

## ☁️ PART 2 — Deploy to Production

### Option A — Railway (Easiest, Free tier available) ⭐ Recommended

**1. Create accounts:**
- Sign up at https://railway.app (free)
- Connect your GitHub account

**2. Deploy PostgreSQL database:**
```
Railway Dashboard → New Project → Add Service → Database → PostgreSQL
```
Railway gives you a `DATABASE_URL` automatically. Copy it.

**3. Deploy the backend:**
```
Railway Dashboard → New Project → Deploy from GitHub repo → Select Transit-TN → Set root directory to "backend"
```

Set environment variables in Railway dashboard:
```
DATABASE_URL    = (paste the PostgreSQL URL from step 2)
JWT_SECRET      = (generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
NODE_ENV        = production
PORT            = 3001
FRONTEND_URL    = https://your-frontend-url.vercel.app
```

Set the start command: `npm run build && npm start`

**4. Run migrations on Railway:**
In Railway terminal (or add to build command):
```bash
npx prisma db push && npm run db:seed
```

Your backend URL will be something like: `https://transit-tn-backend.railway.app`

---

### Option B — Render (Also free tier)

**1.** Sign up at https://render.com

**2.** Create a PostgreSQL database:
```
New → PostgreSQL → Free plan
```
Copy the Internal Database URL.

**3.** Create a Web Service:
```
New → Web Service → Connect GitHub → Transit-TN repo
Root Directory: backend
Build Command: npm install && npx prisma db push && npm run db:seed && npm run build
Start Command: npm start
```

Set environment variables same as Railway above.

---

### Option C — Deploy Frontend to Vercel

**1.** Sign up at https://vercel.com

**2.** Import your GitHub repo:
```
New Project → Import Transit-TN → Framework: Vite
Root Directory: . (or frontend/)
Build Command: npm run build
Output Directory: dist
```

**3.** Set environment variable:
```
VITE_API_URL = https://your-backend-url.railway.app
```

Click Deploy. Your app will be live at `https://transit-tn-xxx.vercel.app` 🎉

---

### Option D — Deploy with Docker (Advanced)

**Dockerfile for backend** (create `backend/Dockerfile`):
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
RUN npx prisma generate
EXPOSE 3001
CMD ["npm", "start"]
```

**docker-compose.yml** (in project root):
```yaml
version: '3.8'
services:
  db:
    image: postgres:14
    environment:
      POSTGRES_DB: transit_tn
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: yourpassword
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  backend:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://postgres:yourpassword@db:5432/transit_tn
      JWT_SECRET: your-secret-here
      NODE_ENV: production
      FRONTEND_URL: http://localhost:5173
    depends_on:
      - db

volumes:
  pgdata:
```

Run with:
```bash
docker-compose up --build
```

---

## 🔐 Security Checklist Before Going Live

- [ ] Change `JWT_SECRET` to a long random string (64+ characters)
- [ ] Use environment variables — never hardcode secrets
- [ ] Change default admin password after first login
- [ ] Enable HTTPS (Railway/Render/Vercel do this automatically)
- [ ] Set `NODE_ENV=production`
- [ ] Set `FRONTEND_URL` to your actual frontend URL (for CORS)
- [ ] Review rate limits in `server.ts` for your traffic needs

---

## 🧪 Test the API quickly

Once running locally, test with curl:

```bash
# Health check
curl http://localhost:3001/health

# Login as admin
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123!"}'

# Get all trips (save the token from login above)
curl http://localhost:3001/api/trips \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"

# Search trips from Tunis to Sfax
curl "http://localhost:3001/api/trips?fromCity=Tunis&toCity=Sfax&type=louage"
```

Or use **Postman** / **Thunder Client** (VS Code extension) for a GUI.

---

## 🆘 Common Issues

| Problem | Solution |
|---------|----------|
| `ECONNREFUSED` connecting to DB | Make sure PostgreSQL is running: `brew services start postgresql` |
| `P1000` Prisma auth error | Check your `DATABASE_URL` password is correct |
| `Cannot find module` | Run `npm install` again |
| CORS errors in browser | Set `FRONTEND_URL` in `.env` to your frontend URL |
| Port 3001 already in use | Change `PORT=3002` in `.env` |
| Prisma client not generated | Run `npx prisma generate` |

---

## 📞 Support

If you get stuck, share the exact error message and we'll fix it together!
