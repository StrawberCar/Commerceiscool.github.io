// script.js — full frontend logic
document.addEventListener('DOMContentLoaded', () => {
  /* ---------- Elements ---------- */
  const canvas = document.getElementById('bg-canvas');
  const ctx = canvas.getContext('2d');

  const countdownEl = document.getElementById('countdown');
  const toGalleryBtn = document.getElementById('to-gallery');
  const toQuotesBtn = document.getElementById('to-quotes');
  const musicToggle = document.getElementById('music-toggle');

  const galleryGrid = document.getElementById('gallery-grid');
  const gallerySearch = document.getElementById('gallery-search');
  const shuffleBtn = document.getElementById('shuffle-btn');
  const regenManifestBtn = document.getElementById('regen-manifest');
  const featuredCarousel = document.getElementById('featured-carousel');

  const quotesList = document.getElementById('quotes-list');
  const quotesFeatured = document.getElementById('quote-featured');

  // Lightbox
  const lb = document.getElementById('lightbox');
  const lbImg = document.getElementById('lb-image');
  const lbCaption = document.getElementById('lb-caption');
  const lbClose = document.getElementById('lb-close');
  const lbPrev = document.getElementById('lb-prev');
  const lbNext = document.getElementById('lb-next');

  /* ---------- Canvas sizing ---------- */
  function resizeCanvas(){
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  /* ---------- Moving gradient + particles ---------- */
  let gx = 0, gy = 0;
  let gvx = (Math.random()*0.6-0.3), gvy = (Math.random()*0.6-0.3);
  const particles = [];
  for(let i=0;i<70;i++){
    particles.push({
      x: Math.random()*canvas.width,
      y: Math.random()*canvas.height,
      r: Math.random()*2+0.6,
      dx: (Math.random()-0.5)*0.8,
      dy: (Math.random()-0.5)*0.8,
      alpha: 0.15 + Math.random()*0.4
    });
  }
  function drawBG(){
    // move gradient
    gx += gvx; gy += gvy;
    // occasionally randomize velocity to make it feel organic
    if(Math.random() < 0.002){ gvx = (Math.random()*0.8-0.4); gvy = (Math.random()*0.8-0.4); }

    const g = ctx.createLinearGradient(gx, gy, canvas.width + gx, canvas.height + gy);
    g.addColorStop(0, '#ff8a00');
    g.addColorStop(0.5, '#ff7aa3');
    g.addColorStop(1, '#e52e71');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // subtle swirl overlay
    ctx.globalCompositeOperation = 'lighter';
    for(const p of particles){
      ctx.beginPath();
      ctx.fillStyle = `rgba(255,255,255,${p.alpha})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  function updateParticles(){
    for(const p of particles){
      p.x += p.dx; p.y += p.dy;
      if(p.x < -30) p.x = canvas.width + 30;
      if(p.x > canvas.width + 30) p.x = -30;
      if(p.y < -30) p.y = canvas.height + 30;
      if(p.y > canvas.height + 30) p.y = -30;
    }
  }
  function animate(){
    drawBG();
    updateParticles();
    requestAnimationFrame(animate);
  }
  animate();

  /* ---------- Countdown (NZ time) ---------- */
  function nowInNZ(){
    // create a Date that represents the current time in Pacific/Auckland
    // this trick creates a string in NZ timezone then parses to a Date in local timezone,
    // resulting in a Date object that represents the same instant.
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
  }
  function updateCountdown(){
    const nzNow = nowInNZ();
    const day = nzNow.getDay(); // 0=Sun, 5=Fri
    // days until next Friday (if today is Friday, go to next week's Friday)
    const daysUntil = ((5 - day + 7) % 7) || 7;
    const target = new Date(nzNow);
    target.setDate(nzNow.getDate() + daysUntil);
    target.setHours(0,0,0,0); // Friday at 00:00 NZ time (start of the day)
    const diff = target - nzNow;
    if(diff <= 0){
      countdownEl.textContent = "It's Justine Day! 🎉";
      return;
    }
    const d = Math.floor(diff / (1000*60*60*24));
    const h = Math.floor((diff / (1000*60*60)) % 24);
    const m = Math.floor((diff / (1000*60)) % 60);
    const s = Math.floor((diff / 1000) % 60);
    countdownEl.textContent = `${d}d ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  setInterval(updateCountdown, 1000);
  updateCountdown();

  /* ---------- Smooth scroll buttons ---------- */
  toGalleryBtn.addEventListener('click', ()=> document.getElementById('gallery').scrollIntoView({behavior:'smooth'}));
  toQuotesBtn.addEventListener('click', ()=> document.getElementById('quotes').scrollIntoView({behavior:'smooth'}));


  /* ---------- Quotes: fetch quotes.txt ---------- */
  async function loadQuotes(){
    try{
      const res = await fetch('quotes.txt');
      if(!res.ok) throw new Error('No quotes.txt found');
      const text = await res.text();
      const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
      populateQuotes(lines);
    } catch(err){
      // fallback default
      const fallback = [
        "Justine is the commerce GOAT. - Student",
        "Peak teacher energy. - Fanclub",
        "Commerce but make it fun. - Anonymous"
      ];
      populateQuotes(fallback);
    }
  }
  function populateQuotes(lines){
    quotesList.innerHTML = '';
    const parsed = lines.map(line => {
      const [quote, author] = line.split(/\s*-\s*/);
      return { quote: quote?.trim() || line, author: author?.trim() || '' };
    });

    // featured (rotating)
    let fi = 0;
    function showFeatured(i){
      const q = parsed[i % parsed.length];
      quotesFeatured.textContent = `${q.quote}${q.author ? ' — ' + q.author : ''}`;
      quotesFeatured.animate([{opacity:0, transform:'translateY(8px)'},{opacity:1, transform:'translateY(0)'}], {duration:350,easing:'ease-out'});
    }
    if(parsed.length) showFeatured(0);
    setInterval(()=>{ fi = (fi+1) % parsed.length; showFeatured(fi); }, 6000);

    // list elements
    parsed.forEach(p=>{
      const bq = document.createElement('blockquote');
      bq.textContent = `${p.quote}${p.author ? ' — ' + p.author : ''}`;
      quotesList.appendChild(bq);
    });
  }
  loadQuotes();

  /* ---------- Gallery auto-population ---------- */
  // Try to fetch art/manifest.json (array of filenames). If not present, fall back to the list you provided.
  const fallbackArt = [
    "art/butler1.png",
    "art/butler2.png",
    "art/butler3.png",
    "art/butleragain.png",
    "art/fdsuj.png",
    "art/justine2.png",
    "art/landscape.png"
  ];
  let artFiles = []; // will store full paths
  async function loadManifest(){
    try{
      const res = await fetch('art/manifest.json', {cache:'no-cache'});
      if(!res.ok) throw new Error('No manifest');
      const list = await res.json();
      if(Array.isArray(list) && list.length) {
        artFiles = list.map(f => (f.startsWith('art/') ? f : `art/${f}`));
      } else {
        artFiles = fallbackArt.slice();
      }
    } catch(e){
      artFiles = fallbackArt.slice();
    }
    renderGallery();
  }
  regenManifestBtn.addEventListener('click', loadManifest);
  loadManifest();

  /* helpers */
  function captionFromFilename(fn){
    return fn.split('/').pop().replace(/\.[^.]+$/, '').replace(/[-_]/g,' ').replace(/\d+/g,'').trim() || 'Untitled';
  }

  let currentIndex = 0;
  function openLightbox(index){
    currentIndex = index;
    lbImg.src = artFiles[index];
    lbCaption.textContent = captionFromFilename(artFiles[index]);
    lb.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeLightbox(){
    lb.classList.add('hidden');
    document.body.style.overflow = '';
  }
  function showPrev(){ openLightbox((currentIndex - 1 + artFiles.length) % artFiles.length); }
  function showNext(){ openLightbox((currentIndex + 1) % artFiles.length); }

  lbClose.addEventListener('click', closeLightbox);
  lbPrev.addEventListener('click', showPrev);
  lbNext.addEventListener('click', showNext);
  document.addEventListener('keydown', (e) => {
    if(lb.classList.contains('hidden')) return;
    if(e.key === 'ArrowLeft') showPrev();
    if(e.key === 'ArrowRight') showNext();
    if(e.key === 'Escape') closeLightbox();
  });

  // Tilt effect for an element
  function attachTilt(el){
    el.addEventListener('mousemove', (ev) => {
      const rect = el.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const cx = rect.width/2, cy = rect.height/2;
      const rx = (y - cy) / cy * 6; // rotateX
      const ry = (cx - x) / cx * 6; // rotateY
      el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) scale(1.03)`;
    });
    el.addEventListener('mouseleave', ()=> el.style.transform = '');
  }

  // Intersection observer for reveal
  const io = new IntersectionObserver(entries => {
    for(const ent of entries){
      if(ent.isIntersecting) ent.target.classList.add('reveal');
    }
  }, {threshold:0.12});

  // render gallery (grid + featured)
  function renderGallery(filterText=''){
    galleryGrid.innerHTML = '';
    const arr = artFiles.slice();
    // filter
    const filtered = arr.filter(p => p.toLowerCase().includes(filterText.toLowerCase()));
    // featured: pick up to 5 for carousel
    const featured = filtered.slice(0,5);
    featuredCarousel.innerHTML = '';
    if(featured.length){
      featured.forEach((f, i) => {
        const img = document.createElement('img');
        img.src = f;
        img.alt = captionFromFilename(f);
        img.dataset.index = artFiles.indexOf(f);
        img.style.display = i === 0 ? 'block' : 'none';
        featuredCarousel.appendChild(img);
      });
      // simple auto-rotate
      let fc = 0;
      setInterval(()=> {
        const imgs = featuredCarousel.querySelectorAll('img');
        if(!imgs.length) return;
        imgs[fc].style.display = 'none';
        fc = (fc + 1) % imgs.length;
        imgs[fc].style.display = 'block';
      }, 3500);
    } else {
      featuredCarousel.textContent = 'No featured images (filter too strict?)';
    }

    // grid
    filtered.forEach((p, idx) => {
      const el = document.createElement('div');
      el.className = 'gallery-item';
      el.innerHTML = `
        <img src="${p}" alt="${captionFromFilename(p)}" loading="lazy" />
        <div class="caption">${captionFromFilename(p)}</div>
      `;
      const indexInAll = artFiles.indexOf(p);
      el.addEventListener('click', ()=> openLightbox(indexInAll));
      attachTilt(el);
      galleryGrid.appendChild(el);
      io.observe(el);
    });
  }

  gallerySearch.addEventListener('input', (e)=> renderGallery(e.target.value.trim()));

  shuffleBtn.addEventListener('click', ()=>{
    // Fisher-Yates shuffle artFiles then re-render
    for(let i=artFiles.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [artFiles[i], artFiles[j]] = [artFiles[j], artFiles[i]];
    }
    renderGallery();
    // small confetti burst (fun)
    smallConfetti();
  });

  /* small confetti function */
  function smallConfetti(){
    const c = document.createElement('canvas');
    c.style.position='fixed'; c.style.left=0; c.style.top=0; c.style.pointerEvents='none'; c.style.zIndex=1200;
    c.width = window.innerWidth; c.height = window.innerHeight;
    document.body.appendChild(c);
    const ct = c.getContext('2d');
    const bits = [];
    for(let i=0;i<60;i++){
      bits.push({
        x: Math.random()*c.width,
        y: -Math.random()*200,
        vx: (Math.random()-0.5)*6,
        vy: 2+Math.random()*4,
        r: 4+Math.random()*6,
        color: `hsl(${Math.random()*360} 80% 60%)`
      });
    }
    let t = 0;
    const anim = setInterval(()=>{
      t++;
      ct.clearRect(0,0,c.width,c.height);
      for(const b of bits){
        b.x += b.vx; b.y += b.vy; b.vy += 0.08;
        ct.fillStyle = b.color;
        ct.beginPath(); ct.ellipse(b.x,b.y,b.r, b.r*0.8, 0,0,Math.PI*2); ct.fill();
      }
      if(t>120){ clearInterval(anim); document.body.removeChild(c); }
    }, 1000/60);
  }

  /* ---------- Initial render ---------- */
  // loadManifest will call renderGallery when ready
  // but render initial fallback immediately so page feels snappy
  artFiles = fallbackArt.slice();
  renderGallery();

  /* ---------- Gesture: click outside lightbox closes ---------- */
  lb.addEventListener('click', (ev)=>{
    if(ev.target === lb) closeLightbox();
  });

  /* ---------- Keyboard: Escape closes if lightbox open ---------- */
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && !lb.classList.contains('hidden')) closeLightbox();
  });

});
