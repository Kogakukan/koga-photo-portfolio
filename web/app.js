/* Antoine Photographie — portfolio (v8)
   1) Pure helpers (tested in Node)  2) DOM layer. */

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  return `${parseInt(m[3], 10)} ${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

/* Detail rows: only fields that really exist (no time: camera clock = France time). */
function buildMetaRows(photo) {
  return [
    ['Appareil', photo.camera],
    ['Objectif', photo.lens],
    ['Focale', photo.focalLength],
    ['Ouverture', photo.aperture],
    ['Vitesse', photo.shutter],
    ['ISO', photo.iso],
  ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '');
}

/* Justified rows: real ratios, every row fills the width. */
function layoutRows(items, containerWidth, targetHeight, gap) {
  const rows = [];
  let row = [];
  let ratioSum = 0;
  for (const item of items) {
    const ratio = item.width && item.height ? item.width / item.height : 1.5;
    row.push({ item, ratio });
    ratioSum += ratio;
    if (ratioSum * targetHeight + gap * (row.length - 1) >= containerWidth) {
      rows.push({ cells: row, height: (containerWidth - gap * (row.length - 1)) / ratioSum });
      row = [];
      ratioSum = 0;
    }
  }
  if (row.length) {
    rows.push({ cells: row, height: Math.min(targetHeight, (containerWidth - gap * (row.length - 1)) / ratioSum) });
  }
  return rows;
}

function targetRowHeight(viewportWidth) {
  if (viewportWidth >= 2200) return 460;
  if (viewportWidth >= 1600) return 400;
  if (viewportWidth >= 1100) return 340;
  if (viewportWidth >= 700) return 270;
  if (viewportWidth >= 420) return 230;
  return 200;
}

function searchText(photo) {
  return [photo.location, photo.year, photo.lens, photo.camera, formatDate(photo.date)].filter(Boolean).join(' ').toLowerCase();
}

if (typeof module !== 'undefined') {
  module.exports = { formatDate, buildMetaRows, layoutRows, targetRowHeight, searchText };
}

/* ================================================================== DOM */
if (typeof document !== 'undefined') {
  const $ = (sel) => document.querySelector(sel);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const EASE = 'cubic-bezier(0.22, 0.8, 0.24, 1)';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = () => window.matchMedia('(max-width: 860px)').matches;

  const state = { photos: [], facets: {}, filtered: [], filter: null, query: '', index: 0 };

  /* ---------------------------------------------------------- Theme */
  $('#themeToggle').addEventListener('click', () => {
    const dark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  });

  /* ---------------------------------------------------------- Views */
  function showView(name) {
    document.querySelectorAll('.nav-link').forEach((b) => b.classList.toggle('is-active', b.dataset.view === name));
    $('#view-gallery').hidden = name !== 'gallery';
    $('#view-collections').hidden = name !== 'collections';
    if (name === 'gallery') renderGallery();
    window.scrollTo({ top: 0 });
  }
  document.querySelectorAll('.nav-link').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

  /* ---------------------------------------------------------- Filters */
  function renderFilters() {
    const chips = [{ label: 'Tout' }];
    (state.facets.years || []).forEach((y) => chips.push({ type: 'year', value: y, label: y }));
    if ((state.facets.locations || []).length) chips.push({ sep: true });
    (state.facets.locations || []).forEach((l) => chips.push({ type: 'location', value: l, label: l }));
    if (state.filter && state.filter.type === 'lens') chips.push({ sep: true }, { type: 'lens', value: state.filter.value, label: state.filter.value });

    $('#filters').innerHTML = chips.map((c) => {
      if (c.sep) return '<span class="chip-sep"></span>';
      const active = c.type ? (state.filter && state.filter.type === c.type && state.filter.value === c.value) : !state.filter;
      return `<button class="chip${active ? ' is-active' : ''}" data-type="${esc(c.type || '')}" data-value="${esc(c.value || '')}">${esc(c.label)}</button>`;
    }).join('');
    $('#filters').querySelectorAll('.chip').forEach((btn) => btn.addEventListener('click', () => {
      state.filter = btn.dataset.type ? { type: btn.dataset.type, value: btn.dataset.value } : null;
      renderFilters();
      renderGallery();
    }));
    const active = $('#filters .chip.is-active');
    if (active && isMobile()) {
      const strip = $('#filters');
      strip.scrollTo({ left: active.offsetLeft - strip.clientWidth / 2 + active.offsetWidth / 2, behavior: 'smooth' });
    }
  }

  function applyFilters() {
    const q = state.query.toLowerCase();
    state.filtered = state.photos.filter((p) => {
      if (state.filter && String(p[state.filter.type] || '') !== state.filter.value) return false;
      return !q || searchText(p).includes(q);
    });
  }

  /* ---------------------------------------------------------- Gallery */
  const revealObserver = 'IntersectionObserver' in window && !reduceMotion
    ? new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-visible'); revealObserver.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px' })
    : null;

  function renderGallery({ instant = false } = {}) {
    applyFilters();
    const gallery = $('#gallery');
    const width = gallery.clientWidth;
    if (!width) return;
    const gap = width < 700 ? 6 : 14;
    gallery.style.setProperty('--gap', `${gap}px`);
    const rows = layoutRows(state.filtered, width, targetRowHeight(window.innerWidth), gap);
    let i = 0;
    gallery.innerHTML = rows.map((row) => {
      const h = Math.round(row.height);
      const cells = row.cells.map(({ item, ratio }) => {
        const idx = i++;
        const w = Math.floor(ratio * row.height);
        return `<button class="tile" data-index="${idx}" aria-label="Ouvrir la photo" style="width:${w}px;height:${h}px;background-image:url('${item.placeholder || ''}')">`
          + `<img src="${esc(item.thumbSmall || item.thumb)}" srcset="${esc(item.thumbSmall)} 640w, ${esc(item.thumb)} 1280w" sizes="${w}px" alt="${esc([item.location, formatDate(item.date)].filter(Boolean).join(', '))}" loading="lazy" decoding="async" /></button>`;
      }).join('');
      return `<div class="row${revealObserver && !instant ? ' reveal' : ''}">${cells}</div>`;
    }).join('');

    gallery.querySelectorAll('img').forEach((img) => {
      const done = () => img.classList.add('is-loaded');
      if (img.complete && img.naturalWidth) done(); else img.addEventListener('load', done, { once: true });
    });
    if (revealObserver && !instant) gallery.querySelectorAll('.row.reveal').forEach((r) => revealObserver.observe(r));
    gallery.querySelectorAll('.tile').forEach((t) => t.addEventListener('click', () => openLightbox(Number(t.dataset.index), t)));
  }

  let lastWidth = window.innerWidth;
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth === lastWidth) return; // ignore mobile address-bar height changes
      lastWidth = window.innerWidth;
      if (!$('#view-gallery').hidden) renderGallery({ instant: true });
    }, 150);
  });

  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    if ($('#view-gallery').hidden) showView('gallery'); else renderGallery({ instant: true });
  });

  /* ---------------------------------------------------------- Collections */
  function groupBy(key) {
    const map = new Map();
    state.photos.forEach((p) => {
      if (!p[key]) return;
      if (!map.has(p[key])) map.set(p[key], []);
      map.get(p[key]).push(p);
    });
    return [...map.entries()];
  }

  function folderHTML(type, label, photos) {
    const shown = photos.slice(0, 3);
    const peeks = shown.map((p, n) => `<img class="peek peek-${3 - shown.length + n + 1}" src="${esc(p.thumbSmall || p.thumb)}" alt="" loading="lazy" />`).join('');
    return `<button class="folder" data-type="${esc(type)}" data-value="${esc(label)}">
      <div class="folder-visual"><div class="folder-back"></div>${peeks}
        <div class="folder-front"><span class="folder-name">${esc(label)}</span><span class="folder-count">${photos.length} photo${photos.length > 1 ? 's' : ''}</span></div>
      </div></button>`;
  }

  function renderCollections() {
    const sections = [
      ['Lieux', 'Par destination', 'location', groupBy('location').sort((a, b) => a[0].localeCompare(b[0], 'fr'))],
      ['Années', 'Par année de prise de vue', 'year', groupBy('year').sort((a, b) => b[0].localeCompare(a[0]))],
      ['Objectifs', 'Par optique', 'lens', groupBy('lens').sort((a, b) => a[0].localeCompare(b[0], 'fr'))],
    ].filter((s) => s[3].length);
    $('#collections').innerHTML = sections.map(([title, caption, type, entries]) => `
      <section class="collections-section">
        <h2 class="collections-title">${esc(title)}</h2>
        <p class="collections-caption">${esc(caption)}</p>
        <div class="folder-grid">${entries.map(([label, photos]) => folderHTML(type, label, photos)).join('')}</div>
      </section>`).join('');
    $('#collections').querySelectorAll('.folder').forEach((f) => f.addEventListener('click', () => {
      state.filter = { type: f.dataset.type, value: f.dataset.value };
      state.query = '';
      $('#search').value = '';
      renderFilters();
      showView('gallery');
    }));
  }

  /* ---------------------------------------------------------- Lightbox */
  const lb = $('#lightbox');
  const stage = $('#lbStage');
  const img = $('#lbImage');
  const info = $('#lbInfo');
  let view = { scale: 1, x: 0, y: 0 };         // touch zoom/pan state
  let loadToken = 0;

  function setTransform(animated) {
    const tf = view.scale === 1 && !view.x && !view.y ? '' : `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    img.style.transition = animated ? `transform 0.35s ${EASE}` : (tf ? 'none' : '');
    img.style.transform = tf;
  }
  function resetView(animated) { view = { scale: 1, x: 0, y: 0 }; stage.classList.remove('is-zoomed'); setTransform(animated); }

  function fillDetails(photo) {
    $('#lbPlace').textContent = photo.location || '';
    $('#lbDate').textContent = formatDate(photo.date) || photo.year || '';
    $('#lbMeta').innerHTML = buildMetaRows(photo).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    $('#lbCounter').textContent = `${state.index + 1} / ${state.filtered.length}`;
  }

  function preload(i) {
    const p = state.filtered[(i + state.filtered.length) % state.filtered.length];
    if (p) { const im = new Image(); im.src = p.full; }
  }

  function showPhoto() {
    const photo = state.filtered[state.index];
    if (!photo) return;
    resetView(false);
    const token = ++loadToken;
    img.src = photo.thumb;                      // already cached: instant
    const full = new Image();
    full.onload = () => { if (token === loadToken) img.src = photo.full; };
    full.src = photo.full;
    img.alt = [photo.location, formatDate(photo.date)].filter(Boolean).join(', ');
    fillDetails(photo);
    history.replaceState(null, '', `#${photo.id}`);
    preload(state.index + 1);
    preload(state.index - 1);
  }

  function flip(fromRect, reverse) {
    const to = img.getBoundingClientRect();
    if (!fromRect || !to.width || reduceMotion || !img.animate) return null;
    const dx = fromRect.left + fromRect.width / 2 - (to.left + to.width / 2);
    const dy = fromRect.top + fromRect.height / 2 - (to.top + to.height / 2);
    const s = fromRect.width / to.width;
    const frames = [{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: 'none' }];
    return img.animate(reverse ? frames.reverse() : frames, { duration: reverse ? 380 : 480, easing: EASE, fill: 'both' });
  }

  function openLightbox(index, tile) {
    state.index = index;
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    info.classList.remove('is-expanded');
    img.style.visibility = 'hidden';
    showPhoto();
    const fromRect = tile ? tile.getBoundingClientRect() : null;
    const start = () => {
      img.style.visibility = '';
      requestAnimationFrame(() => lb.classList.add('is-open'));
      const anim = flip(fromRect, false);
      if (anim) anim.onfinish = () => anim.cancel();
    };
    if (img.decode) img.decode().then(start, start); else start();
  }

  function closeLightbox() {
    const tile = $(`#gallery .tile[data-index="${state.index}"]`);
    let rect = null;
    if (tile && !$('#view-gallery').hidden) {
      const r = tile.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) rect = r;
    }
    resetView(false);
    lb.classList.remove('is-open');
    const anim = rect ? flip(rect, true) : null;
    const finish = () => {
      lb.hidden = true;
      img.removeAttribute('src');
      if (anim) anim.cancel();
      document.body.style.overflow = '';
      history.replaceState(null, '', location.pathname + location.search);
    };
    if (anim) anim.onfinish = finish; else setTimeout(finish, 320);
  }

  function move(delta) {
    if (state.filtered.length < 2) return;
    state.index = (state.index + delta + state.filtered.length) % state.filtered.length;
    showPhoto();
    if (img.animate && !reduceMotion) img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease-out' });
  }

  /* Desktop: click to zoom 2x where you click, move to explore. */
  let lastTouchEnd = 0;
  stage.addEventListener('click', (e) => {
    if (Date.now() - lastTouchEnd < 700) return;         // ignore synthetic clicks after touch
    if (e.target !== img) { if (stage.classList.contains('is-zoomed')) stage.classList.remove('is-zoomed'); else closeLightbox(); return; }
    const r = img.getBoundingClientRect();
    img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
    stage.classList.toggle('is-zoomed');
  });
  stage.addEventListener('mousemove', (e) => {
    if (!stage.classList.contains('is-zoomed')) return;
    const r = stage.getBoundingClientRect();
    img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
  });

  /* Touch: pinch to zoom, double-tap, pan, swipe left/right, swipe down to close. */
  const t = { mode: null, startX: 0, startY: 0, dx: 0, dy: 0, baseX: 0, baseY: 0, dist: 0, baseScale: 1, lastTap: 0 };
  const distance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const center = () => { const r = stage.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

  stage.addEventListener('touchstart', (e) => {
    img.style.transformOrigin = '50% 50%';
    if (e.touches.length === 2) {
      t.mode = 'pinch'; t.dist = distance(e.touches[0], e.touches[1]); t.baseScale = view.scale;
      return;
    }
    const p = e.touches[0];
    t.startX = p.clientX; t.startY = p.clientY; t.dx = 0; t.dy = 0;
    t.baseX = view.x; t.baseY = view.y;
    t.mode = view.scale > 1 ? 'pan' : 'swipe';
  }, { passive: true });

  stage.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (t.mode === 'pinch' && e.touches.length === 2) {
      view.scale = Math.min(4, Math.max(1, t.baseScale * distance(e.touches[0], e.touches[1]) / t.dist));
      if (view.scale === 1) { view.x = 0; view.y = 0; }
      setTransform(false);
      return;
    }
    const p = e.touches[0];
    t.dx = p.clientX - t.startX; t.dy = p.clientY - t.startY;
    if (t.mode === 'pan') {
      view.x = t.baseX + t.dx; view.y = t.baseY + t.dy; setTransform(false);
    } else if (t.mode === 'swipe') {
      const vertical = Math.abs(t.dy) > Math.abs(t.dx);
      img.style.transition = 'none';
      img.style.transform = vertical && t.dy > 0 ? `translateY(${t.dy}px) scale(${Math.max(0.85, 1 - t.dy / 1200)})` : `translateX(${t.dx}px)`;
      if (vertical && t.dy > 0) lb.querySelector('.lb-backdrop').style.opacity = String(Math.max(0.35, 1 - t.dy / 500));
    }
  }, { passive: false });

  stage.addEventListener('touchend', (e) => {
    lastTouchEnd = Date.now();
    if (e.touches.length) return;                          // still one finger down after a pinch
    const backdrop = lb.querySelector('.lb-backdrop');
    backdrop.style.opacity = '';
    const moved = Math.abs(t.dx) > 10 || Math.abs(t.dy) > 10;

    if (t.mode === 'pinch') {
      if (view.scale < 1.05) resetView(true); else stage.classList.add('is-zoomed');
    } else if (t.mode === 'swipe' && moved) {
      if (t.dy > 110 && Math.abs(t.dy) > Math.abs(t.dx)) { closeLightbox(); }
      else if (Math.abs(t.dx) > 60 && Math.abs(t.dx) > Math.abs(t.dy)) { move(t.dx < 0 ? 1 : -1); }
      else { resetView(true); }
    } else if (!moved) {                                    // tap
      const now = Date.now();
      if (now - t.lastTap < 300) {                          // double-tap: zoom in/out at finger
        if (view.scale > 1) resetView(true);
        else {
          const c = center();
          view.scale = 2.5;
          view.x = (c.x - t.startX) * (view.scale - 1);
          view.y = (c.y - t.startY) * (view.scale - 1);
          stage.classList.add('is-zoomed');
          setTransform(true);
        }
        t.lastTap = 0;
      } else {
        t.lastTap = now;
      }
    }
    t.mode = null; t.dx = 0; t.dy = 0;
  });

  /* Mobile bottom sheet: tap the header to show / hide the details. */
  $('#lbHead').addEventListener('click', () => { if (isMobile()) info.classList.toggle('is-expanded'); });
  info.querySelector('.lb-handle').addEventListener('click', () => info.classList.toggle('is-expanded'));

  /* Share the direct link to the current photo. */
  let toastTimer;
  function toast(message) {
    const el = $('#lbToast');
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 1800);
  }
  $('#lbShare').addEventListener('click', async () => {
    const url = location.href;
    try {
      if (navigator.share && isMobile()) { await navigator.share({ title: 'Antoine Photographie', url }); return; }
      await navigator.clipboard.writeText(url);
      toast('Lien copié');
    } catch (err) { /* partage annulé */ }
  });

  $('#lbClose').addEventListener('click', closeLightbox);
  $('#lbPrev').addEventListener('click', () => move(-1));
  $('#lbNext').addEventListener('click', () => move(1));
  document.addEventListener('keydown', (e) => {
    if (lb.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') move(-1);
    if (e.key === 'ArrowRight') move(1);
  });

  /* ---------------------------------------------------------- Boot */
  $('#footerYear').textContent = `© ${new Date().getFullYear()}`;
  fetch('catalog.json', { cache: 'no-cache' })
    .then((r) => r.json())
    .then((catalog) => {
      state.photos = catalog.photos || [];
      state.facets = catalog.facets || {};
      renderFilters();
      renderGallery();
      renderCollections();
      const id = decodeURIComponent(location.hash.slice(1));
      if (id) {
        const index = state.filtered.findIndex((p) => p.id === id);
        if (index >= 0) openLightbox(index, null);
      }
    })
    .catch(() => { /* pas de catalogue : page vide */ });
}
