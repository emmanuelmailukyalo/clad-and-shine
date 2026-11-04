from __future__ import annotations

import html
import json
import os
import re
import secrets
import sqlite3
import threading
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / 'data'
DB_PATH = DATA_DIR / 'store.sqlite3'
PORT = int(os.environ.get('STORE_PORT', '8000'))
if not os.environ.get('STORE_ADMIN_PASSWORD'):
    local_env = ROOT / '.env'
    if local_env.is_file():
        for line in local_env.read_text(encoding='utf-8').splitlines():
            key, separator, value = line.partition('=')
            if separator and key.strip() == 'STORE_ADMIN_PASSWORD':
                os.environ['STORE_ADMIN_PASSWORD'] = value.strip()
                break
ADMIN_PASSWORD = os.environ.get("STORE_ADMIN_PASSWORD")
ADMIN_SESSIONS: set[str] = set()
SESSION_LOCK = threading.Lock()
DELIVERY_FEE_KES = 350  # Temporary demo estimate. Set the real delivery rules before launch.


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys = ON')
    return connection


def slugify(value: str) -> str:
    value = value.casefold().replace('’', '').replace("'", '')
    value = re.sub(r'[^a-z0-9]+', '-', value).strip('-')
    return value


def schema() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    with connect() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY,
            sku TEXT NOT NULL UNIQUE,
            slug TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            description TEXT NOT NULL,
            image_path TEXT NOT NULL,
            price_kes INTEGER NOT NULL CHECK(price_kes >= 0),
            fit_note TEXT NOT NULL DEFAULT 'Everyday fit. Check the size guide before ordering.',
            care_note TEXT NOT NULL DEFAULT 'Check the garment label for care instructions.',
            is_new_arrival INTEGER NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS variants (
            id INTEGER PRIMARY KEY,
            product_id INTEGER NOT NULL REFERENCES products(id),
            sku TEXT NOT NULL UNIQUE,
            option_name TEXT NOT NULL,
            stock_on_hand INTEGER NOT NULL DEFAULT 0 CHECK(stock_on_hand >= 0),
            reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK(reserved_quantity >= 0),
            UNIQUE(product_id, option_name)
        );
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY,
            order_number TEXT NOT NULL UNIQUE,
            customer_name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            address_json TEXT NOT NULL,
            payment_method TEXT NOT NULL CHECK(payment_method IN ('card', 'mpesa')),
            payment_status TEXT NOT NULL,
            order_status TEXT NOT NULL,
            subtotal_kes INTEGER NOT NULL,
            delivery_fee_kes INTEGER NOT NULL,
            total_kes INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY,
            order_id INTEGER NOT NULL REFERENCES orders(id),
            product_id INTEGER NOT NULL REFERENCES products(id),
            variant_id INTEGER NOT NULL REFERENCES variants(id),
            product_sku TEXT NOT NULL,
            product_name TEXT NOT NULL,
            variant_name TEXT NOT NULL,
            image_path TEXT NOT NULL,
            unit_price_kes INTEGER NOT NULL,
            quantity INTEGER NOT NULL CHECK(quantity > 0),
            line_total_kes INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS inventory_movements (
            id INTEGER PRIMARY KEY,
            variant_id INTEGER NOT NULL REFERENCES variants(id),
            order_id INTEGER REFERENCES orders(id),
            stock_delta INTEGER NOT NULL DEFAULT 0,
            reserved_delta INTEGER NOT NULL DEFAULT 0,
            reason TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
        CREATE INDEX IF NOT EXISTS idx_variants_product ON variants(product_id);
        ''')
        product_columns = {row['name'] for row in db.execute('PRAGMA table_info(products)')}
        if 'fit_note' not in product_columns:
            db.execute("ALTER TABLE products ADD COLUMN fit_note TEXT NOT NULL DEFAULT 'Everyday fit. Check the size guide before ordering.'")
        if 'care_note' not in product_columns:
            db.execute("ALTER TABLE products ADD COLUMN care_note TEXT NOT NULL DEFAULT 'Check the garment label for care instructions.'")
    seed_catalog()


def seed_catalog() -> None:
    rng_prices = {'clothing': (1600, 6900), 'shoes': (2400, 8200), 'bags': (1900, 7600), 'accessories': (700, 3900)}
    options = {'clothing': ['XS', 'S', 'M', 'L', 'XL'], 'shoes': ['EU 36', 'EU 37', 'EU 38', 'EU 39', 'EU 40', 'EU 41'], 'bags': ['One Size'], 'accessories': ['One Size']}
    import random
    rng = random.Random(20261012)
    items = []
    category_indexes = {category: 0 for category in ('clothing', 'shoes', 'bags', 'accessories')}
    for category in ('clothing', 'shoes', 'bags', 'accessories'):
        source = ROOT / f'{category}.html'
        markup = source.read_text(encoding='utf-8')
        for article in re.findall(r'<article class="flex flex-col group">(.*?)</article>', markup, re.S):
            name_match = re.search(r'<h2[^>]*>(.*?)</h2>', article, re.S)
            desc_match = re.search(r'<p class="text-xs text-gray-500 font-normal mt-1">(.*?)</p>', article, re.S)
            image_match = re.search(r'<img[^>]+src="([^"]+)"', article)
            if not (name_match and desc_match and image_match):
                continue
            name = html.unescape(re.sub(r'<[^>]+>', '', name_match.group(1))).strip()
            description = html.unescape(re.sub(r'<[^>]+>', '', desc_match.group(1))).strip()
            items.append((category, name, description, image_match.group(1)))

    with connect() as db:
        if db.execute('SELECT COUNT(*) FROM products').fetchone()[0]:
            return
        for category, name, description, image_path in items:
            category_indexes[category] += 1
            slug = f'{category}-{slugify(name)}'
            sku = f'CS-{category[:3].upper()}-{slugify(name).upper()[:20]}'
            minimum, maximum = rng_prices[category]
            price = rng.randrange(minimum // 100, maximum // 100 + 1) * 100
            featured = int(category == 'clothing' and category_indexes[category] <= 8)
            cur = db.execute('INSERT INTO products(sku,slug,name,category,description,image_path,price_kes,is_new_arrival,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
                             (sku, slug, name, category, description, image_path, price, featured, now_iso()))
            product_id = cur.lastrowid
            for option in options[category]:
                variant_sku = f'{sku}-{slugify(option).upper()}'
                stock = rng.randint(5, 14)
                vcur = db.execute('INSERT INTO variants(product_id,sku,option_name,stock_on_hand) VALUES(?,?,?,?)',
                                  (product_id, variant_sku, option, stock))
                db.execute('INSERT INTO inventory_movements(variant_id,stock_delta,reason,note,created_at) VALUES(?,? ,?, ?,?)',
                           (vcur.lastrowid, stock, 'seed', 'Demo opening stock; replace with counted inventory.', now_iso()))
        print(f'Seeded {len(items)} sample products. Prices and stock are placeholders.')


def product_json(db: sqlite3.Connection, row: sqlite3.Row) -> dict:
    variants = db.execute('SELECT id,sku,option_name,stock_on_hand,reserved_quantity FROM variants WHERE product_id=? ORDER BY id', (row['id'],)).fetchall()
    return {
        'id': row['id'], 'sku': row['sku'], 'slug': row['slug'], 'name': row['name'],
        'category': row['category'], 'description': row['description'], 'image': row['image_path'],
        'priceKes': row['price_kes'], 'fitNote': row['fit_note'], 'careNote': row['care_note'],
        'newArrival': bool(row['is_new_arrival']), 'variants': [dict(v) | {'available': v['stock_on_hand'] - v['reserved_quantity']} for v in variants]
    }


def json_bytes(payload: object) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode('utf-8')


class StoreHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        print(f'[{self.log_date_time_string()}] {self.address_string()} {fmt % args}')

    def send_json(self, payload: object, status: int = 200, headers: dict | None = None):
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def body_json(self) -> dict:
        length = int(self.headers.get('Content-Length', '0'))
        if length > 1_000_000:
            raise ValueError('Request is too large.')
        body = self.rfile.read(length) if length else b'{}'
        return json.loads(body.decode('utf-8'))

    def is_admin(self) -> bool:
        cookie = self.headers.get('Cookie', '')
        token = next((part.strip().split('=', 1)[1] for part in cookie.split(';') if part.strip().startswith('cs_admin=')), '')
        with SESSION_LOCK:
            return bool(token and token in ADMIN_SESSIONS)

    def require_admin(self) -> bool:
        if self.is_admin():
            return True
        self.send_json({'error': 'Admin sign-in required.'}, 401)
        return False

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/products':
            query_params = parse_qs(parsed.query)
            category = query_params.get('category', [None])[0]
            slug = query_params.get('slug', [None])[0]
            with connect() as db:
                query = 'SELECT * FROM products WHERE active=1'
                params = ()
                if category:
                    query += ' AND category=?'
                    params = (category,)
                if slug:
                    query += ' AND slug=?'
                    params = (slug,)
                rows = db.execute(query + ' ORDER BY id', params).fetchall()
                products = [product_json(db, row) for row in rows]
            return self.send_json({'products': products})
        if parsed.path == '/api/health':
            with connect() as db:
                counts = {table: db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] for table in ('products', 'variants', 'orders', 'order_items')}
            return self.send_json({'ok': True, 'database': counts})
        if parsed.path == '/api/admin/session':
            return self.send_json({'authenticated': self.is_admin()})
        if parsed.path.startswith('/api/admin/'):
            if not self.require_admin():
                return
            with connect() as db:
                if parsed.path == '/api/admin/orders':
                    orders = db.execute('SELECT * FROM orders ORDER BY id DESC').fetchall()
                    result = []
                    for order in orders:
                        data = dict(order)
                        data['address'] = json.loads(data.pop('address_json'))
                        data['items'] = [dict(item) for item in db.execute('SELECT * FROM order_items WHERE order_id=?', (order['id'],))]
                        result.append(data)
                    return self.send_json({'orders': result})
                if parsed.path == '/api/admin/inventory':
                    rows = db.execute('''SELECT v.id variant_id,v.sku variant_sku,v.option_name,v.stock_on_hand,v.reserved_quantity,
                        p.sku,p.name,p.category,p.price_kes,p.image_path FROM variants v JOIN products p ON p.id=v.product_id ORDER BY p.category,p.name,v.id''').fetchall()
                    return self.send_json({'variants': [dict(r) | {'available': r['stock_on_hand'] - r['reserved_quantity']} for r in rows]})
                if parsed.path == '/api/admin/products':
                    rows = db.execute('SELECT * FROM products ORDER BY category,name').fetchall()
                    return self.send_json({'products': [dict(row) | {'new_arrival': bool(row['is_new_arrival'])} for row in rows]})
                if parsed.path == '/api/admin/movements':
                    rows = db.execute('''SELECT m.*,v.sku variant_sku,p.name product_name FROM inventory_movements m JOIN variants v ON v.id=m.variant_id JOIN products p ON p.id=v.product_id ORDER BY m.id DESC LIMIT 200''').fetchall()
                    return self.send_json({'movements': [dict(r) for r in rows]})
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self.body_json()
        except (ValueError, json.JSONDecodeError):
            return self.send_json({'error': 'Invalid JSON request.'}, 400)

        if path == '/api/admin/login':
            password = str(body.get('password', ''))
            import hmac
            if not ADMIN_PASSWORD or not hmac.compare_digest(password, ADMIN_PASSWORD):
                return self.send_json({'error': 'Password did not match.'}, 401)
            token = secrets.token_urlsafe(32)
            with SESSION_LOCK:
                ADMIN_SESSIONS.add(token)
            return self.send_json({'ok': True}, headers={'Set-Cookie': f'cs_admin={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'})
        if path == '/api/admin/logout':
            cookie = self.headers.get('Cookie', '')
            token = next((part.strip().split('=', 1)[1] for part in cookie.split(';') if part.strip().startswith('cs_admin=')), '')
            with SESSION_LOCK:
                ADMIN_SESSIONS.discard(token)
            return self.send_json({'ok': True}, headers={'Set-Cookie': 'cs_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})
        if path == '/api/orders':
            return self.create_order(body)
        if path == '/api/admin/products':
            if not self.require_admin():
                return
            return self.create_product(body)
        match_product = re.fullmatch(r'/api/admin/products/(\d+)', path)
        if match_product:
            if not self.require_admin():
                return
            return self.edit_product(int(match_product.group(1)), body)
        match = re.fullmatch(r'/api/admin/orders/(\d+)/(pay-demo|ship|cancel)', path)
        if match:
            if not self.require_admin():
                return
            return self.update_order(int(match.group(1)), match.group(2))
        if path == '/api/admin/inventory/adjust':
            if not self.require_admin():
                return
            return self.adjust_inventory(body)
        return self.send_json({'error': 'Not found.'}, 404)

    def validate_product_image(self, value: str) -> str:
        value = value.strip().replace('\\', '/')
        resolved = (ROOT / value).resolve()
        assets = (ROOT / 'assets' / 'products').resolve()
        if assets not in resolved.parents or not resolved.is_file():
            raise ValueError('Choose an existing image in assets/products/.')
        return resolved.relative_to(ROOT).as_posix()

    def create_product(self, body: dict):
        try:
            category = str(body.get('category', '')).strip().lower()
            name = str(body.get('name', '')).strip()
            sku = str(body.get('sku', '')).strip().upper()
            description = str(body.get('description', '')).strip()
            price = int(body.get('priceKes'))
            image_path = self.validate_product_image(str(body.get('image', '')))
            options = [str(value).strip()[:40] for value in body.get('options', []) if str(value).strip()]
            stock = int(body.get('openingStock', 0))
            if category not in ('clothing', 'shoes', 'bags', 'accessories'):
                raise ValueError('Choose a valid product category.')
            if not name or not description or not sku or not re.fullmatch(r'[A-Z0-9-]{3,40}', sku):
                raise ValueError('Product name, description, and a SKU using letters, numbers, and hyphens are required.')
            if price < 1 or price > 1_000_000 or stock < 0 or stock > 100_000:
                raise ValueError('Enter a valid price and opening stock count.')
            if not options or len(options) > 20 or len(set(options)) != len(options):
                raise ValueError('Enter one or more unique size or option values, comma separated.')
            stamp = now_iso()
            with connect() as db:
                db.execute('BEGIN IMMEDIATE')
                cur = db.execute('INSERT INTO products(sku,slug,name,category,description,image_path,price_kes,is_new_arrival,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
                    (sku, f"{category}-{slugify(name)}", name, category, description, image_path, price, int(bool(body.get('newArrival'))), stamp))
                product_id = cur.lastrowid
                for option in options:
                    variant_sku = f'{sku}-{slugify(option).upper()}'
                    variant = db.execute('INSERT INTO variants(product_id,sku,option_name,stock_on_hand) VALUES(?,?,?,?)', (product_id, variant_sku, option, stock))
                    db.execute('INSERT INTO inventory_movements(variant_id,stock_delta,reason,note,created_at) VALUES(?,?,?,?,?)',
                               (variant.lastrowid, stock, 'new_product_opening_stock', 'Initial stock entered in admin.', stamp))
                db.commit()
            return self.send_json({'ok': True, 'productId': product_id}, 201)
        except sqlite3.IntegrityError:
            return self.send_json({'error': 'That SKU or product URL is already in use. Choose a unique SKU or product name.'}, 409)
        except (TypeError, ValueError) as error:
            return self.send_json({'error': str(error)}, 400)

    def edit_product(self, product_id: int, body: dict):
        try:
            name = str(body.get('name', '')).strip()
            description = str(body.get('description', '')).strip()
            price = int(body.get('priceKes'))
            featured = int(bool(body.get('newArrival')))
            if not name or not description or price < 1 or price > 1_000_000:
                raise ValueError('Enter a product name, description, and valid KES price.')
            with connect() as db:
                current = db.execute('SELECT image_path FROM products WHERE id=?', (product_id,)).fetchone()
                if not current:
                    raise ValueError('Product not found.')
                image_path = self.validate_product_image(str(body.get('image', current['image_path'])))
                cursor = db.execute('UPDATE products SET name=?,slug=category || ? ,description=?,image_path=?,price_kes=?,is_new_arrival=? WHERE id=?',
                    (name, '-' + slugify(name), description, image_path, price, featured, product_id))
                if not cursor.rowcount:
                    raise ValueError('Product not found.')
            return self.send_json({'ok': True})
        except sqlite3.IntegrityError:
            return self.send_json({'error': 'That product name would duplicate another product URL.'}, 409)
        except (TypeError, ValueError) as error:
            return self.send_json({'error': str(error)}, 400)

    def create_order(self, body: dict):
        customer = body.get('customer') or {}
        address = body.get('address') or {}
        payment_method = body.get('paymentMethod')
        required = (('name', customer.get('name')), ('email', customer.get('email')), ('phone', customer.get('phone')),
                    ('county', address.get('county')), ('town', address.get('town')), ('address', address.get('line1')))
        if any(not isinstance(value, str) or not value.strip() for _, value in required):
            return self.send_json({'error': 'Complete your contact and delivery details.'}, 400)
        if payment_method not in ('card', 'mpesa'):
            return self.send_json({'error': 'Choose a payment method.'}, 400)
        raw_items = body.get('items')
        if not isinstance(raw_items, list) or not raw_items or len(raw_items) > 80:
            return self.send_json({'error': 'Your cart is empty or has too many lines.'}, 400)
        quantities = {}
        for item in raw_items:
            try:
                variant_id, quantity = int(item['variantId']), int(item['quantity'])
            except (KeyError, TypeError, ValueError):
                return self.send_json({'error': 'A cart item is invalid.'}, 400)
            if quantity < 1 or quantity > 30:
                return self.send_json({'error': 'Choose between 1 and 30 of each item.'}, 400)
            quantities[variant_id] = quantities.get(variant_id, 0) + quantity

        try:
            with connect() as db:
                db.execute('BEGIN IMMEDIATE')
                items = []
                subtotal = 0
                for variant_id, quantity in quantities.items():
                    row = db.execute('''SELECT v.*,p.sku product_sku,p.name product_name,p.image_path,p.price_kes,p.active
                        FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?''', (variant_id,)).fetchone()
                    if not row or not row['active']:
                        raise ValueError('One of the products is no longer available.')
                    available = row['stock_on_hand'] - row['reserved_quantity']
                    if quantity > available:
                        raise ValueError(f"Only {available} left for {row['product_name']} ({row['option_name']}).")
                    line_total = row['price_kes'] * quantity
                    subtotal += line_total
                    items.append((row, quantity, line_total))
                stamp = now_iso()
                order_number = 'CS-' + datetime.now(timezone.utc).strftime('%y%m%d') + '-' + secrets.token_hex(3).upper()
                delivery = DELIVERY_FEE_KES
                cur = db.execute('''INSERT INTO orders(order_number,customer_name,email,phone,address_json,payment_method,payment_status,order_status,
                    subtotal_kes,delivery_fee_kes,total_kes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                    (order_number, customer['name'].strip(), customer['email'].strip(), customer['phone'].strip(), json.dumps(address),
                     payment_method, 'not_connected_demo', 'awaiting_payment', subtotal, delivery, subtotal + delivery, stamp, stamp))
                order_id = cur.lastrowid
                for row, quantity, line_total in items:
                    db.execute('INSERT INTO order_items(order_id,product_id,variant_id,product_sku,product_name,variant_name,image_path,unit_price_kes,quantity,line_total_kes) VALUES(?,?,?,?,?,?,?,?,?,?)',
                        (order_id, row['product_id'], row['id'], row['product_sku'], row['product_name'], row['option_name'], row['image_path'], row['price_kes'], quantity, line_total))
                    db.execute('UPDATE variants SET reserved_quantity=reserved_quantity+? WHERE id=?', (quantity, row['id']))
                    db.execute('INSERT INTO inventory_movements(variant_id,order_id,reserved_delta,reason,note,created_at) VALUES(?,?,?,?,?,?)',
                        (row['id'], order_id, quantity, 'demo_order_reservation', 'Reserved while awaiting a real payment integration.', stamp))
                db.commit()
            return self.send_json({'ok': True, 'orderNumber': order_number, 'orderId': order_id, 'orderStatus': 'awaiting_payment',
                                   'paymentStatus': 'not_connected_demo', 'totalKes': subtotal + delivery}, 201)
        except ValueError as error:
            return self.send_json({'error': str(error)}, 409)

    def update_order(self, order_id: int, action: str):
        try:
            with connect() as db:
                db.execute('BEGIN IMMEDIATE')
                order = db.execute('SELECT * FROM orders WHERE id=?', (order_id,)).fetchone()
                if not order:
                    raise ValueError('Order not found.')
                items = db.execute('SELECT * FROM order_items WHERE order_id=?', (order_id,)).fetchall()
                stamp = now_iso()
                if action == 'pay-demo':
                    if order['order_status'] != 'awaiting_payment':
                        raise ValueError('Only orders awaiting payment can be marked paid.')
                    db.execute("UPDATE orders SET payment_status='paid_demo',order_status='processing',updated_at=? WHERE id=?", (stamp, order_id))
                elif action == 'ship':
                    if order['payment_status'] != 'paid_demo' or order['order_status'] != 'processing':
                        raise ValueError('Confirm payment before shipping this order.')
                    for item in items:
                        db.execute('UPDATE variants SET stock_on_hand=stock_on_hand-?,reserved_quantity=reserved_quantity-? WHERE id=?',
                                   (item['quantity'], item['quantity'], item['variant_id']))
                        db.execute('INSERT INTO inventory_movements(variant_id,order_id,stock_delta,reserved_delta,reason,note,created_at) VALUES(?,?,?,?,?,?,?)',
                                   (item['variant_id'], order_id, -item['quantity'], -item['quantity'], 'demo_order_shipped', 'Sample order fulfillment.', stamp))
                    db.execute("UPDATE orders SET order_status='shipped',updated_at=? WHERE id=?", (stamp, order_id))
                elif action == 'cancel':
                    if order['order_status'] in ('cancelled', 'shipped', 'delivered'):
                        raise ValueError('This order cannot be cancelled in its current status.')
                    for item in items:
                        db.execute('UPDATE variants SET reserved_quantity=reserved_quantity-? WHERE id=?', (item['quantity'], item['variant_id']))
                        db.execute('INSERT INTO inventory_movements(variant_id,order_id,reserved_delta,reason,note,created_at) VALUES(?,?,?,?,?,?)',
                                   (item['variant_id'], order_id, -item['quantity'], 'order_cancelled', 'Released reservation when order was cancelled.', stamp))
                    db.execute("UPDATE orders SET order_status='cancelled',payment_status=CASE WHEN payment_status='paid_demo' THEN 'refund_required_demo' ELSE payment_status END,updated_at=? WHERE id=?", (stamp, order_id))
                db.commit()
            return self.send_json({'ok': True})
        except ValueError as error:
            return self.send_json({'error': str(error)}, 409)

    def adjust_inventory(self, body: dict):
        try:
            variant_id = int(body.get('variantId'))
            new_quantity = int(body.get('stockOnHand'))
            note = str(body.get('note', 'Manual count update')).strip()[:250]
            if new_quantity < 0:
                raise ValueError('Stock cannot be negative.')
            with connect() as db:
                db.execute('BEGIN IMMEDIATE')
                variant = db.execute('SELECT * FROM variants WHERE id=?', (variant_id,)).fetchone()
                if not variant:
                    raise ValueError('Inventory item not found.')
                if new_quantity < variant['reserved_quantity']:
                    raise ValueError('Stock on hand cannot be lower than currently reserved stock.')
                delta = new_quantity - variant['stock_on_hand']
                db.execute('UPDATE variants SET stock_on_hand=? WHERE id=?', (new_quantity, variant_id))
                db.execute('INSERT INTO inventory_movements(variant_id,stock_delta,reason,note,created_at) VALUES(?,?,?,?,?)',
                           (variant_id, delta, 'manual_stock_adjustment', note, now_iso()))
                db.commit()
            return self.send_json({'ok': True})
        except (TypeError, ValueError) as error:
            return self.send_json({'error': str(error)}, 400)

    def translate_path(self, path: str) -> str:
        path = super().translate_path(path)
        resolved = Path(path).resolve()
        if ROOT not in resolved.parents and resolved != ROOT:
            return str(ROOT / '__not_found__')
        if resolved.is_dir():
            resolved = resolved / 'heelave-storefront-2560.html'
        return str(resolved)


if __name__ == '__main__':
    schema()
    print('Clad and Shine local store: http://127.0.0.1:' + str(PORT))
    print('Payment methods do not contact Global Payments or M-Pesa until payment processing is configured.')
    ThreadingHTTPServer(('127.0.0.1', PORT), StoreHandler).serve_forever()

