(() => {
  const url = new URL(window.location.href);
  const allowed = ['page', 'slug', 'id'];
  [...url.searchParams.keys()].forEach(key => { if (!allowed.includes(key)) url.searchParams.delete(key); });
  url.hash = '';
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical); }
  canonical.href = url.href;
  const ogUrl = document.querySelector('meta[property="og:url"]') || Object.assign(document.createElement('meta'), {property:'og:url'});
  ogUrl.content = url.href; if (!ogUrl.parentNode) document.head.append(ogUrl);
  const image = document.querySelector('meta[property="og:image"]');
  if (image && image.content) image.content = new URL(image.content, window.location.href).href;
  const twitterImage = document.querySelector('meta[name="twitter:image"]');
  if (twitterImage && twitterImage.content) twitterImage.content = new URL(twitterImage.content, window.location.href).href;
  window.setProductSEO = ({name, description, image, price, available = true}) => {
    document.title = name + ' | Clad and Shine';
    const pageDescription = description || name + ' — view product details, availability and price in Kenyan shillings.';
    const setMeta = (kind, key, value) => { let el = document.querySelector('meta[' + kind + '=\"' + key + '\"]'); if (!el) { el = document.createElement('meta'); el.setAttribute(kind, key); document.head.append(el); } el.content = value; };
    setMeta('name','description',pageDescription); setMeta('property','og:title',document.title); setMeta('property','og:description',pageDescription); setMeta('name','twitter:title',document.title); setMeta('name','twitter:description',pageDescription);
    const canonicalURL = document.querySelector('link[rel=\"canonical\"]')?.href || window.location.href;
    const product = {'@context':'https://schema.org','@type':'Product','name':name,'description':pageDescription,'image':image ? new URL(image,window.location.href).href : undefined,'offers':{'@type':'Offer','url':canonicalURL,'priceCurrency':'KES','price':Number(price || 0).toFixed(0),'availability':'https://schema.org/' + (available ? 'InStock' : 'OutOfStock')}};
    let old = document.querySelector('script[data-product-schema]'); if (old) old.remove(); const ld = document.createElement('script'); ld.type='application/ld+json'; ld.dataset.productSchema='true'; ld.textContent=JSON.stringify(product); document.head.append(ld);
  };
  const schema = {'@context':'https://schema.org','@type':'WebSite','name':"Clad and Shine",'description':"A Nairobi women’s boutique for clothing, shoes, bags and accessories.",'url':window.location.origin + '/'};
  const ld = document.createElement('script'); ld.type = 'application/ld+json'; ld.textContent = JSON.stringify(schema); document.head.append(ld);
})();
