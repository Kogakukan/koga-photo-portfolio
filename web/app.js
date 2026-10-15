/* Antoine Photographie — portfolio
   Pure helpers first (testable), then the DOM layer. */

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function formatDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(iso));
  if (!m) return String(iso);
  const day = String(parseInt(m[3], 10));
  const month = MONTHS[parseInt(m[2], 10) - 1] || '';
  return `${day} ${month} ${m[1]}`.trim();
}

function formatTime(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(String(iso || ''));
  return m ? `${m[1]}h${m[2]}` : '';
}

/* Rows shown in the detail panel. Only fields that really exist are returned. */
function buildMetaRows(photo) {
  const rows = [
    ['Appareil', photo.camera],
    ['Objectif', photo.lens],
    ['Focale', photo.focalLength],
    ['Ouverture', photo.aperture],
    ['Vitesse', photo.shutter],
    ['ISO', photo.iso != null && photo.iso !== '' ? String(photo.iso) : ''],
    ['Heure', formatTime(photo.date)],
  ];
  return rows.filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
}

/* Justified rows: every photo keeps its real ratio, rows fill the full width. */
function layoutRows(items, containerWidth, targetHeight, gap) {
  const rows = [];
  let row = [];
  let ratioSum = 0;
  for (const item of items) {
    const ratio = item.width && item.height ? item.width / item.height : 1.5;
    row.push({ item, ratio });
    ratioSum += ratio;
    const naturalWidth = ratioSum * targetHeight + gap * (row.length - 1);
    if (naturalWidth >= containerWidth) {
      const height = (containerWidth - gap * (row.length - 1)) / ratioSum;
      rows.push({ cells: row, height });
      row = [];
      ratioSum = 0;
    }
  }
  if (row.length) {
    const fitted = (containerWidth - gap * (row.length - 1)) / ratioSum;
    rows.push({ cells: row, height: Math.min(targetHeight, fitted) });
  }
  return rows;
}

function targetRowHeight(width) {
  if (width >= 2200) return 460;
  if (width >= 1600) return 400;
  if (width >= 1100) return 340;
  if (width >= 700) return 270;
  return 210;
}

function searchText(photo) {
  return [photo.location, photo.year, photo.lens, photo.camera, formatDate(photo.date)]
    .filter(Boolean).join(' ').toLowerCase();
}

if (typeof module !== 'undefined') {
  module.exports = { formatDate, formatTime, buildMetaRows, layoutRows, targetRowHeight, searchText };
}

/* ------------------------------------------------------------------ */
/* DOM layer                                                           */
/* ------------------------------------------------------------------ */
if (typeof document !== 'undefined') {
  const $ = (sel) => document.querySelector(sel);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = { photos: [], facets: {}, filtered: [], filter: null, query: '', index: 0 };

  /* ---------- Theme ---------- */
  if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');
  $('#themeToggle').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  });

  /* ---------- Views ---------- */
  function showView(name) {
    document.querySelectorAll('.nav-link').forEach((b) => b.classList.toggle('is-active', b.dataset.view === name));
    $('#view-gallery').hidden = name !== 'gallery';
    $('#view-collections').hidden = name !== 'collections';
    if (name === 'gallery') renderGallery();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  document.querySelectorAll('.nav-link').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

  /* ---------- Filters ---------- */
  function renderFilters() {
    const chips = [{ type: null, value: null, label: 'Tout' }];
    (state.facets.years || []).forEach((y) => chips.push({ type: 'year', value: y, label: y }));
    const locs = state.facets.locations || [];
    if (locs.length) chips.push({ sep: true });
    locs.forEach((l) => chips.push({ type: 'location', value: l, label: l }));
    if (state.filter && state.filter.type === 'lens') {
      chips.push({ sep: true });
      chips.push({ type: 'lens', value: state.filter.value, label: state.filter.value });
    }
    $('#filters').innerHTML = chips.map((c) => {
      if (c.sep) return '<span class="chip-sep"></span>';
      const active = (!state.filter && !c.type) || (state.filter && state.filter.type === c.type && String(state.filter.value) === String(c.value));
      return `<button class="chip${active ? ' is-active' : ''}" data-type="${esc(c.type || '')}" data-value="${esc(c.value || '')}">${esc(c.label)}</button>`;
    }).join('');
    $('#filters').querySelectorAll('.chip').forEach((btn) => btn.addEventListener('click', () => {
      state.filter = btn.dataset.type ? { type: btn.dataset.type, value: btn.dataset.value } : null;
      renderFilters();
      renderGallery();
    }));
  }

  function applyFilters() {
    const q = state.query.toLowerCase();
    state.filtered = state.photos.filter((p) => {
      if (state.filter && String(p[state.filter.type] || '') !== String(state.filter.value)) return false;
      if (q && !searchText(p).includes(q)) return false;
      return true;
    });
  }

  /* ---------- Gallery ---------- */
  function renderGallery() {
    applyFilters();
    const gallery = $('#gallery');
    const width = gallery.clientWidth;
    if (!width) return;
    const gap = width < 700 ? 8 : 14;
    gallery.style.setProperty('--gap', `${gap}px`);
    const rows = layoutRows(state.filtered, width, targetRowHeight(window.innerWidth), gap);
    let i = 0;
    gallery.innerHTML = rows.map((row) => {
      const cells = row.cells.map(({ item, ratio }) => {
        const idx = i++;
        const w = Math.floor(ratio * row.height);
        return `<button class="tile" style="width:${w}px;height:${Math.round(row.height)}px" data-index="${idx}" aria-label="Ouvrir la photo">
          <img src="${esc(item.thumb)}" alt="${esc([item.location, item.year].filter(Boolean).join(', '))}" loading="lazy" decoding="async" />
        </button>`;
      }).join('');
      return `<div class="row">${cells}</div>`;
    }).join('');
    gallery.querySelectorAll('img').forEach((img) => {
      if (img.complete) img.classList.add('is-loaded');
      else img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
    });
    gallery.querySelectorAll('.tile').forEach((t) => t.addEventListener('click', () => openLightbox(Number(t.dataset.index))));
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!$('#view-gallery').hidden) renderGallery(); }, 120);
  });

  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    if ($('#view-gallery').hidden) showView('gallery'); else renderGallery();
  });

  /* ---------- Collections ---------- */
  function groupBy(key) {
    const map = new Map();
    state.photos.forEach((p) => {
      const k = p[key];
      if (!k) return;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(p);
    });
    return [...map.entries()];
  }

  function folderHTML(type, label, photos) {
    const peeks = photos.slice(0, 3).map((p, n) => `<img class="peek peek-${3 - Math.min(photos.length, 3) + n + 1}" src="${esc(p.thumb)}" alt="" loading="lazy" />`).join('');
    const count = `${photos.length} photo${photos.length > 1 ? 's' : ''}`;
    return `<button class="folder" data-type="${esc(type)}" data-value="${esc(label)}">
      <div class="folder-visual">
        <div class="folder-back"></div>
        ${peeks}
        <div class="folder-front"><span class="folder-name">${esc(label)}</span><span class="folder-count">${count}</span></div>
      </div>
    </button>`;
  }

  function renderCollections() {
    const sections = [
      ['Lieux', 'Par destination', 'location', groupBy('location').sort((a, b) => a[0].localeCompare(b[0], 'fr'))],
      ['Années', 'Par année de prise de vue', 'year', groupBy('year').sort((a, b) => String(b[0]).localeCompare(String(a[0])))],
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

  /* ---------- Lightbox ---------- */
  const lb = $('#lightbox');
  const stage = $('#lbStage');
  const lbImg = $('#lbImage');

  function fillDetails(photo) {
    $('#lbPlace').textContent = photo.location || '';
    $('#lbDate').textContent = formatDate(photo.date) || photo.year || '';
    $('#lbMeta').innerHTML = buildMetaRows(photo)
      .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`)
      .join('');
    $('#lbCounter').textContent = `${state.index + 1} / ${state.filtered.length}`;
  }

  function showPhoto() {
    const photo = state.filtered[state.index];
    if (!photo) return;
    stage.classList.remove('is-zoomed');
    lbImg.classList.add('is-loading');
    lbImg.onload = () => lbImg.classList.remove('is-loading');
    lbImg.src = photo.full;
    lbImg.alt = [photo.location, formatDate(photo.date)].filter(Boolean).join(', ');
    fillDetails(photo);
  }

  function openLightbox(index) {
    state.index = index;
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => lb.classList.add('is-open'));
    showPhoto();
  }

  function closeLightbox() {
    lb.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(() => { lb.hidden = true; lbImg.src = ''; }, 300);
  }

  function move(delta) {
    if (!state.filtered.length) return;
    state.index = (state.index + delta + state.filtered.length) % state.filtered.length;
    showPhoto();
  }

  // Click to zoom (max 2x) where you clicked; move the mouse to explore.
  stage.addEventListener('click', (e) => {
    if (e.target !== lbImg) { if (!stage.classList.contains('is-zoomed')) closeLightbox(); else stage.classList.remove('is-zoomed'); return; }
    const r = lbImg.getBoundingClientRect();
    lbImg.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
    stage.classList.toggle('is-zoomed');
  });
  stage.addEventListener('mousemove', (e) => {
    if (!stage.classList.contains('is-zoomed')) return;
    const r = stage.getBoundingClientRect();
    lbImg.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
  });

  // Swipe on mobile.
  let touchX = null;
  stage.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) move(dx < 0 ? 1 : -1);
    touchX = null;
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

  /* ---------- Boot ---------- */
  $('#footerYear').textContent = `© ${new Date().getFullYear()}`;
  fetch('catalog.json', { cache: 'no-store' })
    .then((r) => r.json())
    .then((catalog) => {
      state.photos = catalog.photos || [];
      state.facets = catalog.facets || {};
      renderFilters();
      renderGallery();
      renderCollections();
    })
    .catch(() => { /* Pas de catalogue : la page reste simplement vide. */ });
}
