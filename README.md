# Boutique — online store (FR/AR, DZD)
Requires Node.js 22.13+ (https://nodejs.org). No other database to install: data lives in `data.db`, photos in `uploads/`.

    npm install
    ADMIN_PASS="choose-a-strong-password" npm start

Store: http://localhost:3000 — Owner dashboard: http://localhost:3000/admin.html
First run uses ADMIN_PASS (default `admin123`): change it in Réglages > Mot de passe. Set WhatsApp number and shop name there too.

## Hosting
Any VPS or Node host (Render, Railway, Fly.io, a small VPS) works. Put it behind HTTPS (required for secure login), set `PORT`, and keep `data.db` and `uploads/` on a persistent disk (set `DATA_DIR` to that disk). Back up those two items regularly.
