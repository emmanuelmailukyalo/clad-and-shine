# Clad and Shine local store foundation

This folder contains the static storefront plus a local Python/SQLite shop service. It uses only Python's standard library.

## Start the local shop

Open PowerShell in this folder and run:

```powershell
$env:SHOP_ADMIN_PASSWORD = 'choose-a-local-demo-password'
python store_server.py
```

Then open `http://127.0.0.1:8000/`. The first start creates `data/store.sqlite3` and seeds the 72 sample products, size variants, prices, opening stock, and inventory history from the catalog pages. The admin password is printed in the server terminal. For a quick local preview only, the server falls back to `demo-only-change-me` if no password is set.

Open `/admin.html` to manage catalog content, sample KES prices, stock counts, orders, and inventory history. Add product images to `assets/products/` before entering their relative paths in the product form. Existing seeded records are not overwritten when the server restarts.

## Demo checkout behavior

- Add-to-bag, size selection, cart quantity changes, and totals work in the browser.
- The server recalculates prices, checks available stock, creates order and item snapshots, and reserves requested stock in one SQLite transaction.
- The checkout offers card (Global Payments planned) and M-Pesa choices. Neither option contacts a provider or takes money.
- Admin actions can simulate payment and shipping to exercise the order lifecycle. These are explicitly demo actions.
- Cancelling an unpaid or processing order releases its inventory reservation.
- The KES 350 delivery amount and all prices and stock quantities are placeholders.

## Security and launch status

This is a local functional prototype, not a public production deployment. The server binds to `127.0.0.1`; do not expose it to the internet. Before launch, replace the local server with a hardened production deployment, use a persistent production database and backups, enable HTTPS, add CSRF/rate limiting and audit controls, set real product/delivery/policy data, and connect Global Payments and M-Pesa with verified server-side callbacks. Never place payment secrets or card numbers in browser code or this local demo.
