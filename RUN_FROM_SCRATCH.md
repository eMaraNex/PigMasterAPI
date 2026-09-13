# Run PigMaster API from scratch

## 1. Prerequisites
- PostgreSQL 14+ installed and running
- Node.js 18+ and npm installed

## 2. Create the database
You do not need to use the terminal for this step if you prefer a GUI.

### Option A: Windows / pgAdmin (recommended)
1. Open pgAdmin 4.
2. Connect to your PostgreSQL server.
3. Right-click Databases and choose Create > Database.
4. Set the name to `pigmaster`.
5. Save it.

### Option B: Terminal
If you already have PostgreSQL tools available in a shell, you can run:

```bash
createdb pigmaster -U postgres
# or
psql -U postgres -c "CREATE DATABASE pigmaster;"
```

If you create the database with a different name, make sure the `DB_NAME` value in your environment matches that name.

## 3. Configure environment variables
Set these in [PigMasterAPI/.env](.env) or your deployment environment:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=pigmaster
DB_USER=postgres
DB_PASSWORD=your-password
JWT_SECRET=change-me

MPESA_CONSUMER_KEY=your-key
MPESA_CONSUMER_SECRET=your-secret
MPESA_PASSKEY=your-passkey
MPESA_SHORTCODE=174379
MPESA_CALLBACK_URL=http://localhost:5000/api/v1/payments/mpesa/callback
MPESA_CALLBACK_SECRET=change-me
```

## 4. Install dependencies
```bash
cd PigMasterAPI
npm install
```

## 5. Run database migrations
```bash
npx node-pg-migrate up --migrations-dir src/database/migrations --migrations-table pgmigrations --config migrations-config.js
```

## 6. Start the backend
```bash
npm run dev
```

## 7. Create a first user
Use the registration endpoint:

```bash
curl -X POST http://localhost:5000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "you@example.com",
    "password": "Password123!",
    "name": "Your Name",
    "phone": "254700000000"
  }'
```

A new user receives a 30-day trial subscription automatically.

## 8. Verify the subscription flow
- Trial access is active on registration.
- When an M-Pesa payment is initiated, the payment record is created as pending.
- The subscription only activates after the callback confirms success.
- Expired subscriptions are reconciled on authenticated requests and access is revoked automatically.
