(() => {
  const CART_KEY = 'clad-and-shine-cart-v1';
  const money = value => `KES ${Number(value).toLocaleString('en-KE')}`;
  const getCart = () => { try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch { return []; } };
  const saveCart = cart => { localStorage.setItem(CART_KEY, JSON.stringify(cart)); updateCartBadge(); };
  const normalize = value => value.normalize('NFKD').replace(/[’']/g, '').replace(/^clad and shine\s+/i, '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
  const updateCartBadge = () => {
    const button = document.querySelector('[aria-label="Shopping Cart"]');
    if (!button) return;
    button.classList.add('relative');
    button.onclick = () => { window.location.href = 'cart.html'; };
    const count = getCart().reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    let badge = button.querySelector('[data-cart-count]');
    if (!badge) {
      badge = document.createElement('span');
      badge.dataset.cartCount = '';
      badge.className = 'absolute -top-1 -right-2 min-w-4 h-4 rounded-full bg-black text-white text-[9px] font-bold flex items-center justify-center px-1';
      button.append(badge);
    }
    badge.textContent = count;
    badge.hidden = count === 0;
  };

  const addToCart = (variant, product, quantity = 1) => {
    const cart = getCart();
    const existing = cart.find(item => item.variantId === variant.id);
    if (existing) existing.quantity += quantity;
    else cart.push({variantId: variant.id, quantity});
    saveCart(cart);
  };

  async function initCatalog() {
    const home = document.getElementById('new-arrivals');
    const category = home ? 'clothing' : location.pathname.split('/').pop().replace('.html', '');
    const grid = home ? home.querySelector('.grid') : document.querySelector('[aria-label$=" collection"]');
    if (!grid) return;
    const response = await fetch('/api/products?category=' + encodeURIComponent(category));
    if (!response.ok) throw new Error('Could not load the product catalog.');
    let products = (await response.json()).products;
    if (home) products = products.filter(product => product.newArrival).sort((a, b) => b.id - a.id).slice(0, 8);
    else {
      const countLabel = [...document.querySelectorAll('p')].find(element => /^\d+ pieces$/.test(element.textContent.trim()));
      if (countLabel) countLabel.textContent = `${products.length} pieces`;
    }
    grid.replaceChildren(...products.map(product => createProductCard(product, Boolean(home))));
  }

  function createProductCard(product, home) {
    const card = document.createElement(home ? 'div' : 'article');
    card.className = home ? 'flex flex-col group cursor-pointer' : 'flex flex-col group';
    const imageWrap = document.createElement('div');
    imageWrap.className = 'relative bg-[#ebece8] rounded-2xl overflow-hidden aspect-[3/4]' + (home ? ' flex items-center justify-center' : '');
    const image = document.createElement('img'); image.src = product.image; image.alt = 'Clad and Shine ' + product.name;
    image.loading = 'lazy'; image.className = 'w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-300';
    const productUrl = `product.html?slug=${encodeURIComponent(product.slug)}`;
    const imageLink = document.createElement('a'); imageLink.href = productUrl; imageLink.className = 'absolute inset-0 z-0'; imageLink.setAttribute('aria-label', `View ${product.name}`);
    const favorite = document.createElement('button'); favorite.type = 'button'; favorite.setAttribute('aria-label', 'Save ' + product.name);
    favorite.className = (home ? 'absolute top-4 right-4 w-8 h-8 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center text-black hover:bg-white transition ' : 'absolute top-4 right-4 w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center text-black hover:bg-white transition ') + 'z-10';
    favorite.innerHTML = '<svg class="w-4 h-4 stroke-[1.8]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
    imageWrap.append(image, imageLink, favorite);
    const detail = document.createElement('div');
    detail.className = home ? 'mt-3 flex justify-between items-start text-sm' : 'mt-3 flex justify-between items-start gap-3 text-sm';
    const text = document.createElement('div'); const title = document.createElement(home ? 'h3' : 'h2');
    title.className = 'font-bold text-gray-900 text-sm';
    const titleLink = document.createElement('a'); titleLink.href = productUrl; titleLink.className = 'hover:underline underline-offset-4'; titleLink.textContent = home ? 'Clad and Shine ' + product.name : product.name; title.append(titleLink);
    const description = document.createElement('p'); description.className = 'text-xs text-gray-500 font-normal mt-1'; description.textContent = home ? 'New season' : product.description;
    text.append(title, description); detail.append(text);
    card.append(imageWrap, detail);
    const buy = document.createElement('a'); buy.href = productUrl; buy.className = 'mt-3 flex items-center justify-between border-t border-gray-100 pt-3 text-xs';
    const price = document.createElement('span'); price.className = 'font-bold text-gray-900'; price.textContent = money(product.priceKes);
    const action = document.createElement('span'); action.className = 'font-semibold text-gray-600'; action.textContent = 'View details →';
    buy.append(price, action); card.append(buy);
    return card;
  }

  function attachPurchaseControls(card, product) {
    const variants = product.variants;
    const controls = document.createElement('div'); controls.dataset.storeControls = ''; controls.className = 'mt-3 flex flex-col gap-2';
    const price = document.createElement('div'); price.className = 'text-sm font-bold text-gray-900'; price.textContent = money(product.priceKes);
    const select = document.createElement('select'); select.className = 'w-full rounded-full border border-gray-300 bg-white px-3 py-2 text-xs focus:border-black focus:ring-black';
    select.setAttribute('aria-label', `Choose size or option for ${product.name}`);
    for (const variant of variants) {
      const option = document.createElement('option'); option.value = variant.id;
      option.textContent = variant.available > 0 ? variant.option_name + ` · ${variant.available} available` : variant.option_name + ' · Sold out';
      option.disabled = variant.available < 1; select.append(option);
    }
    const add = document.createElement('button'); add.type = 'button';
    add.className = 'w-full rounded-full bg-black px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-gray-800 transition disabled:cursor-not-allowed disabled:bg-gray-300';
    add.textContent = variants.some(variant => variant.available > 0) ? 'Add to bag' : 'Sold out'; add.disabled = !variants.some(variant => variant.available > 0);
    add.addEventListener('click', () => {
      const variant = variants.find(item => item.id === Number(select.value)); if (!variant || variant.available < 1) return;
      const inCart = getCart().filter(item => item.variantId === variant.id).reduce((sum, item) => sum + item.quantity, 0);
      if (inCart >= variant.available) { add.textContent = 'Maximum available added'; return; }
      addToCart(variant, product); add.textContent = 'Added to bag'; setTimeout(() => { add.textContent = 'Add to bag'; }, 1300);
    });
    controls.append(price, select, add); card.append(controls);
  }

  window.CladStore = {CART_KEY, money, getCart, saveCart, updateCartBadge};
  updateCartBadge();
  if (location.pathname.endsWith('/cart.html')) initCart();
  else if (location.pathname.endsWith('/checkout.html')) initCheckout();
  else if (location.pathname.endsWith('/product.html')) initProductDetail();
  else if (location.pathname.endsWith('/admin.html')) initAdmin();
  else initCatalog().catch(error => console.error(error));

  async function initProductDetail() {
    const root = document.getElementById('product-detail');
    const slug = new URLSearchParams(location.search).get('slug');
    if (!root || !slug) { if (root) root.innerHTML = '<p class="py-20 text-center text-sm text-gray-500">Choose a product from the collection to view its details.</p>'; return; }
    try {
      const response = await fetch('/api/products?slug=' + encodeURIComponent(slug));
      const result = await response.json();
      const product = result.products?.[0];
      if (!response.ok || !product) throw new Error('This product could not be found.');
      document.title = `${product.name} | Clad and Shine`;
      window.setProductSEO?.({name:product.name,description:product.description || (product.name + ' from Clad and Shine. View product details and available options.'),image:product.image,price:product.price,available:product.variants.some(variant=>Number(variant.available)>0)});
      const availableTotal = product.variants.reduce((sum, item) => sum + item.available, 0);
      root.innerHTML = `<div class="grid gap-8 lg:grid-cols-2 lg:gap-14"><div class="overflow-hidden rounded-2xl bg-[#ebece8]"><img src="${escapeText(product.image)}" alt="${escapeText(product.name)}" class="aspect-[4/5] w-full object-cover"></div><section class="lg:py-6"><a href="${escapeText(product.category)}.html" class="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 hover:text-black">${escapeText(product.category)} · Nairobi</a><h1 class="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">${escapeText(product.name)}</h1><p class="mt-3 text-lg font-semibold">${money(product.priceKes)}</p><p class="mt-5 text-sm leading-6 text-gray-600">${escapeText(product.description)}</p><p class="mt-4 text-xs text-gray-500">Reference: ${escapeText(product.sku)}</p><div class="mt-8"><div class="flex items-center justify-between"><label for="product-size" class="text-xs font-bold uppercase tracking-wider">Choose size</label><button type="button" id="size-guide-toggle" class="text-xs underline underline-offset-4">Size guide</button></div><select id="product-size" class="mt-3 w-full rounded-full border border-gray-300 bg-white px-4 py-3 text-sm focus:border-black focus:ring-black" aria-label="Choose size or option"></select><p id="product-stock" class="mt-2 text-xs text-gray-500"></p></div><button id="product-add" type="button" class="mt-5 w-full rounded-full bg-black px-5 py-4 text-xs font-bold uppercase tracking-wider text-white hover:bg-gray-800 disabled:bg-gray-300">Add to bag</button><p id="product-added" aria-live="polite" class="mt-2 min-h-5 text-center text-xs text-gray-600"></p><div id="size-guide" class="hidden mt-3 rounded-xl bg-gray-50 p-4 text-xs leading-6 text-gray-600">Sizes are listed as supplied for this product. If you are between sizes, contact us for help before ordering.</div><div class="mt-7 divide-y divide-gray-200 border-y border-gray-200 text-sm"><details class="py-4" open><summary class="cursor-pointer font-semibold">Fit</summary><p class="mt-2 text-xs leading-5 text-gray-600">${escapeText(product.fitNote || 'Everyday fit. Check the size guide before ordering.')}</p></details><details class="py-4"><summary class="cursor-pointer font-semibold">Care</summary><p class="mt-2 text-xs leading-5 text-gray-600">${escapeText(product.careNote || 'Check the garment label for care instructions.')}</p></details><details class="py-4"><summary class="cursor-pointer font-semibold">Availability</summary><p class="mt-2 text-xs leading-5 text-gray-600">${availableTotal > 0 ? `${availableTotal} pieces available across sizes.` : 'Currently sold out.'} Stock is checked again when you place your order.</p></details></div></section></div>`;
      const select = root.querySelector('#product-size');
      product.variants.forEach(variant => {
        const option = document.createElement('option'); option.value = variant.id;
        option.textContent = variant.available > 0 ? `${variant.option_name} · ${variant.available} available` : `${variant.option_name} · Sold out`;
        option.disabled = variant.available < 1; select.append(option);
      });
      const button = root.querySelector('#product-add');
      button.disabled = !product.variants.some(item => item.available > 0);
      if (button.disabled) button.textContent = 'Sold out';
      const updateAvailability = () => {
        const variant = product.variants.find(item => item.id === Number(select.value));
        root.querySelector('#product-stock').textContent = variant ? (variant.available > 0 ? `${variant.available} available in ${variant.option_name}` : 'This size is sold out') : 'Currently sold out';
      };
      select.addEventListener('change', updateAvailability); updateAvailability();
      root.querySelector('#size-guide-toggle').addEventListener('click', () => root.querySelector('#size-guide').classList.toggle('hidden'));
      button.addEventListener('click', () => {
        const variant = product.variants.find(item => item.id === Number(select.value));
        if (!variant || variant.available < 1) return;
        const inCart = getCart().filter(item => item.variantId === variant.id).reduce((sum, item) => sum + item.quantity, 0);
        const status = root.querySelector('#product-added');
        if (inCart >= variant.available) { status.textContent = 'You have added all currently available stock of this size.'; return; }
        addToCart(variant, product); status.textContent = 'Added to your bag.';
      });
    } catch (error) { root.innerHTML = `<p class="py-20 text-center text-sm text-gray-500">${escapeText(error.message)}</p>`; }
  }

  async function initCart() {
    const container = document.getElementById('cart-lines');
    const empty = document.getElementById('cart-empty');
    const summary = document.getElementById('cart-summary');
    try {
      const products = (await (await fetch('/api/products')).json()).products;
      const productByVariant = new Map();
      products.forEach(product => product.variants.forEach(variant => productByVariant.set(variant.id, {product, variant})));
      const cart = getCart().filter(line => productByVariant.has(line.variantId));
      saveCart(cart);
      if (!cart.length) { empty.classList.remove('hidden'); summary.classList.add('hidden'); return; }
      empty.classList.add('hidden'); summary.classList.remove('hidden');
      let subtotal = 0;
      container.innerHTML = '';
      cart.forEach((line, index) => {
        const data = productByVariant.get(line.variantId);
        const lineTotal = data.product.priceKes * line.quantity;
        subtotal += lineTotal;
        const row = document.createElement('article');
        row.className = 'flex gap-4 border-b border-gray-100 py-5';
        row.innerHTML = `<img src="${data.product.image}" alt="" class="h-28 w-24 rounded-xl bg-[#ebece8] object-cover"><div class="min-w-0 flex-1"><h2 class="font-bold text-sm">${escapeText(data.product.name)}</h2><p class="mt-1 text-xs text-gray-500">${escapeText(data.variant.option_name)}</p><p class="mt-2 text-sm font-semibold">${money(data.product.priceKes)}</p><div class="mt-3 flex items-center gap-3"><button data-action="minus" class="h-8 w-8 rounded-full border border-gray-300" aria-label="Decrease quantity">−</button><span class="text-sm">${line.quantity}</span><button data-action="plus" class="h-8 w-8 rounded-full border border-gray-300" aria-label="Increase quantity">+</button><button data-action="remove" class="ml-2 text-xs text-gray-500 underline">Remove</button></div></div><p class="text-sm font-bold">${money(lineTotal)}</p>`;
        row.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
          const updated = getCart();
          const current = updated[index];
          if (button.dataset.action === 'remove' || (button.dataset.action === 'minus' && current.quantity <= 1)) updated.splice(index, 1);
          else if (button.dataset.action === 'minus') current.quantity -= 1;
          else if (button.dataset.action === 'plus') current.quantity += 1;
          saveCart(updated); initCart();
        }));
        container.append(row);
      });
      document.getElementById('cart-subtotal').textContent = money(subtotal);
      document.getElementById('cart-estimated-total').textContent = money(subtotal + 350);
    } catch (error) {
      container.textContent = 'The product service is unavailable. Please start the local store server and reload.';
      console.error(error);
    }
  }

  async function initCheckout() {
    const form = document.getElementById('checkout-form');
    const lines = document.getElementById('checkout-lines');
    const status = document.getElementById('checkout-status');
    const button = document.getElementById('place-order');
    try {
      const products = (await (await fetch('/api/products')).json()).products;
      const lookup = new Map(); products.forEach(product => product.variants.forEach(variant => lookup.set(variant.id, {product, variant})));
      const cart = getCart().filter(item => lookup.has(item.variantId));
      if (!cart.length) { location.href = 'cart.html'; return; }
      let subtotal = 0;
      for (const line of cart) {
        const {product, variant} = lookup.get(line.variantId);
        subtotal += product.priceKes * line.quantity;
        const p = document.createElement('p');
        p.className = 'flex justify-between gap-4 py-2 text-sm';
        p.innerHTML = `<span>${escapeText(product.name)} · ${escapeText(variant.option_name)} × ${line.quantity}</span><strong>${money(product.priceKes * line.quantity)}</strong>`;
        lines.append(p);
      }
      document.getElementById('checkout-subtotal').textContent = money(subtotal);
      document.getElementById('checkout-total').textContent = money(subtotal + 350);
      form.addEventListener('submit', async event => {
        event.preventDefault(); status.textContent = ''; button.disabled = true;
        const values = new FormData(form);
        const payload = {
          customer: {name: values.get('name'), email: values.get('email'), phone: values.get('phone')},
          address: {county: values.get('county'), town: values.get('town'), line1: values.get('line1'), line2: values.get('line2')},
          paymentMethod: values.get('paymentMethod'),
          items: cart
        };
        try {
          const result = await fetch('/api/orders', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
          const data = await result.json();
          if (!result.ok) throw new Error(data.error || 'Could not create the order.');
          saveCart([]);
          location.href = `order-confirmation.html?order=${encodeURIComponent(data.orderNumber)}`;
        } catch (error) { status.textContent = error.message; button.disabled = false; }
      });
    } catch (error) { status.textContent = 'Could not load checkout details. Start the local store server and reload.'; button.disabled = true; }
  }

  async function initAdmin() {
    const login = document.getElementById('admin-login');
    const app = document.getElementById('admin-app');
    const status = document.getElementById('admin-status');
    async function refresh() {
      const session = await (await fetch('/api/admin/session')).json();
      login.classList.toggle('hidden', session.authenticated); app.classList.toggle('hidden', !session.authenticated);
      if (!session.authenticated) return;
      const [ordersResponse, inventoryResponse, movementsResponse, productsResponse] = await Promise.all([
        fetch('/api/admin/orders'), fetch('/api/admin/inventory'), fetch('/api/admin/movements'), fetch('/api/admin/products')
      ]);
      if (![ordersResponse, inventoryResponse, movementsResponse, productsResponse].every(response => response.ok)) throw new Error('Could not load admin data.');
      const [{orders}, {variants}, {movements}, {products}] = await Promise.all([ordersResponse.json(), inventoryResponse.json(), movementsResponse.json(), productsResponse.json()]);
      document.getElementById('admin-order-count').textContent = orders.length;
      document.getElementById('admin-product-count').textContent = new Set(variants.map(row => row.sku)).size;
      document.getElementById('admin-stock-count').textContent = variants.reduce((sum, row) => sum + row.available, 0);
      const orderList = document.getElementById('admin-orders'); orderList.innerHTML = '';
      if (!orders.length) orderList.innerHTML = '<p class="py-8 text-sm text-gray-500">No orders yet. Orders placed at checkout will appear here.</p>';
      orders.forEach(order => {
        const card = document.createElement('article'); card.className = 'rounded-xl border border-gray-200 p-4';
        const itemSummary = order.items.map(item => `${escapeText(item.product_name)} · ${escapeText(item.variant_name)} × ${item.quantity}`).join('<br>');
        let actions = '';
        if (order.order_status === 'awaiting_payment') actions += `<button data-action="pay-demo" class="rounded-full bg-black px-4 py-2 text-xs font-bold text-white">Mark payment received</button>`;
        if (order.order_status === 'processing') actions += `<button data-action="ship" class="rounded-full bg-black px-4 py-2 text-xs font-bold text-white">Mark shipped</button>`;
        if (!['cancelled','shipped','delivered'].includes(order.order_status)) actions += `<button data-action="cancel" class="rounded-full border border-gray-300 px-4 py-2 text-xs font-bold">Cancel order</button>`;
        card.innerHTML = `<div class="flex flex-wrap justify-between gap-3"><div><p class="font-bold">${escapeText(order.order_number)}</p><p class="mt-1 text-xs text-gray-500">${escapeText(order.customer_name)} · ${escapeText(order.phone)} · ${escapeText(order.email)}</p></div><div class="text-right"><p class="font-bold">${money(order.total_kes)}</p><p class="mt-1 text-xs">${escapeText(order.order_status.replaceAll('_',' '))} · ${escapeText(({not_connected_demo:'awaiting payment',paid_demo:'paid',refund_required_demo:'refund required'})[order.payment_status] || order.payment_status.replaceAll('_',' '))}</p></div></div><p class="my-3 text-xs leading-6">${itemSummary}</p><p class="text-xs text-gray-500">${escapeText(order.address.line1)}, ${escapeText(order.address.town)}, ${escapeText(order.address.county)}</p><div class="mt-4 flex flex-wrap gap-2">${actions}</div>`;
        card.querySelectorAll('button').forEach(button => button.addEventListener('click', async () => {
          if (button.dataset.action === 'pay-demo' && !confirm('Confirm that payment has been received and verified?')) return;
          const response = await fetch(`/api/admin/orders/${order.id}/${button.dataset.action}`, {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
          const result = await response.json(); if (!response.ok) status.textContent = result.error; else { status.textContent = 'Order updated.'; refresh(); }
        }));
        orderList.append(card);
      });
      const catalog = document.getElementById('admin-catalog'); catalog.innerHTML = '';
      products.forEach(product => {
        const card = document.createElement('form'); card.dataset.productId = product.id; card.className = 'rounded-2xl bg-white p-4';
        card.innerHTML = `<div class="mb-3 flex gap-3"><img src="${escapeText(product.image_path)}" alt="" class="h-16 w-14 rounded-lg bg-[#ebece8] object-cover"><div><p class="font-bold">${escapeText(product.name)}</p><p class="mt-1 text-[11px] text-gray-500">${escapeText(product.sku)} · ${escapeText(product.category)}</p></div></div><div class="grid grid-cols-1 gap-3 sm:grid-cols-2"><label class="text-[11px] font-semibold">Name<input name="name" value="${escapeText(product.name)}" required class="mt-1 w-full rounded-lg border-gray-300 px-2 py-2 text-xs"></label><label class="text-[11px] font-semibold">Price (KES)<input name="priceKes" type="number" min="1" value="${product.price_kes}" required class="mt-1 w-full rounded-lg border-gray-300 px-2 py-2 text-xs"></label><label class="text-[11px] font-semibold sm:col-span-2">Image path<input name="image" value="${escapeText(product.image_path)}" required class="mt-1 w-full rounded-lg border-gray-300 px-2 py-2 text-xs"></label><label class="text-[11px] font-semibold sm:col-span-2">Description<textarea name="description" required rows="2" class="mt-1 w-full rounded-lg border-gray-300 px-2 py-2 text-xs">${escapeText(product.description)}</textarea></label><label class="flex items-center gap-2 text-[11px] font-semibold sm:col-span-2"><input name="newArrival" type="checkbox" ${product.new_arrival ? 'checked' : ''} class="rounded border-gray-300 text-black"> Show in New Arrivals</label></div><button class="mt-3 rounded-full border border-gray-300 px-4 py-2 text-[11px] font-bold uppercase tracking-wider">Save product</button>`;
        card.addEventListener('submit', async event => {
          event.preventDefault(); const fd = new FormData(card);
          const response = await fetch(`/api/admin/products/${product.id}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:fd.get('name'),priceKes:fd.get('priceKes'),image:fd.get('image'),description:fd.get('description'),newArrival:fd.has('newArrival')})});
          const result = await response.json(); status.textContent = response.ok ? 'Product saved.' : result.error; if (response.ok) refresh();
        });
        catalog.append(card);
      });
      const inventory = document.getElementById('admin-inventory'); inventory.innerHTML = '';
      variants.forEach(row => {
        const tr = document.createElement('tr'); tr.className = 'border-b border-gray-100';
        tr.innerHTML = `<td class="py-3 pr-4"><p class="font-semibold">${escapeText(row.name)}</p><p class="text-[11px] text-gray-500">${escapeText(row.sku)} · ${escapeText(row.variant_sku)}</p></td><td class="py-3 pr-4">${escapeText(row.option_name)}</td><td class="py-3 pr-4">${money(row.price_kes)}</td><td class="py-3 pr-4">${row.available}</td><td class="py-3"><form data-variant="${row.variant_id}" class="flex gap-2"><input name="stock" type="number" min="${row.reserved_quantity}" value="${row.stock_on_hand}" class="w-20 rounded-lg border-gray-300 px-2 py-1 text-xs"><button class="rounded-full border border-gray-300 px-3 py-1 text-xs">Save</button></form></td>`;
        tr.querySelector('form').addEventListener('submit', async event => {
          event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form);
          const response = await fetch('/api/admin/inventory/adjust', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({variantId:row.variant_id,stockOnHand:fd.get('stock'),note:'Admin stock count update'})});
          const data = await response.json(); status.textContent = response.ok ? 'Inventory updated.' : data.error; if (response.ok) refresh();
        });
        inventory.append(tr);
      });
      document.getElementById('admin-movements').innerHTML = movements.slice(0,30).map(row => `<tr class="border-b border-gray-100"><td class="py-2 pr-3">${escapeText(row.created_at.replace('T',' ').replace('+00:00',' UTC'))}</td><td class="py-2 pr-3">${escapeText(row.product_name)} · ${escapeText(row.variant_sku)}</td><td class="py-2 pr-3">${row.stock_delta > 0 ? '+' : ''}${row.stock_delta}</td><td class="py-2 pr-3">${row.reserved_delta > 0 ? '+' : ''}${row.reserved_delta}</td><td class="py-2">${escapeText(row.reason.replaceAll('_',' '))}</td></tr>`).join('');
    }
    login.addEventListener('submit', async event => {
      event.preventDefault(); status.textContent = '';
      const response = await fetch('/api/admin/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:new FormData(login).get('password')})});
      const result = await response.json(); if (!response.ok) { status.textContent = result.error; return; }
      await refresh();
    });
    document.getElementById('admin-add-product').addEventListener('submit', async event => {
      event.preventDefault(); status.textContent = '';
      const form = event.currentTarget; const fd = new FormData(form);
      const response = await fetch('/api/admin/products', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:fd.get('name'),sku:fd.get('sku'),category:fd.get('category'),priceKes:fd.get('priceKes'),image:fd.get('image'),options:String(fd.get('options')).split(',').map(value=>value.trim()).filter(Boolean),openingStock:fd.get('openingStock'),newArrival:fd.has('newArrival'),description:fd.get('description')})});
      const result = await response.json(); status.textContent = response.ok ? 'Product created and added to the catalog.' : result.error;
      if (response.ok) { form.reset(); form.elements.openingStock.value = 8; await refresh(); }
    });
    document.getElementById('admin-logout').addEventListener('click', async () => {await fetch('/api/admin/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); await refresh();});
    try { await refresh(); } catch (error) { status.textContent = error.message; }
  }

  function escapeText(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
})();
