/* ═══════════════════════════════════════════════════════════
   LOYALTY VAULT — app.js
   Firebase Firestore
   ═══════════════════════════════════════════════════════════ */

'use strict';

/* ──────── HELPERS ──────── */
const $ = id => document.getElementById(id);
const pages = document.querySelectorAll('.page');

function showPage(id) {
  pages.forEach(p => p.classList.remove('active'));
  const target = $(id);
  if (target) {
    target.classList.add('active');
  }
  window.scrollTo(0, 0);
  const ownerPages = ['pageOwnerLogin', 'pageOwnerDash'];
  if (ownerPages.includes(id)) {
    document.body.classList.add('owner-ui');
  } else {
    document.body.classList.remove('owner-ui');
  }
}

function toast(msg, type = 'success') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast toast-${type}`;
  setTimeout(() => t.classList.add('hidden'), 3500);
}

/* ──────── STATE ──────── */
let currentUser = null;       // Owner Firebase Auth user or Customer Firestore mock {uid}
let currentCustomerData = {}; // Firestore customer doc data
let isOwner = false;
let settings = { discount1: 5, discount2: 10, discount3: 15, bhagyadaChakramEnabled: true, malliRaaBaksheeshEnabled: true };
let modeUsed = false;
let historyAllData = [];       // In-memory for filter
let historyFilter = 'ALL';
let unsubHistory = null;       // onSnapshot unsubscribe
let unsubCustomers = null;
let unsubDiscounts = null;

/* ══════════════════════════════════════
   AUTH STATE — Session Management
   ══════════════════════════════════════ */
auth.onAuthStateChanged(async user => {
  // Only owners use Firebase Auth now
  if (user) {
    try {
      const ownerDoc = await db.collection('owners').doc(user.uid).get();
      if (ownerDoc.exists) {
        currentUser = user;
        isOwner = true;
        await loadOwnerDash();
      } else {
        await auth.signOut();
      }
    } catch (_) { }
  } else {
    if (isOwner) {
      currentUser = null;
      isOwner = false;
      showPage('pageLanding');
    }
  }
});

/* ══════════════════════════════════════
   SETTINGS — Firestore
   ══════════════════════════════════════ */
async function fetchSettings() {
  try {
    const doc = await db.collection('settings').doc('config').get();
    if (doc.exists) {
      const d = doc.data();
      settings = {
        discount1: Number(d.discount1) || 5,
        discount2: Number(d.discount2) || 10,
        discount3: Number(d.discount3) || 15,
        bhagyadaChakramEnabled: d.bhagyadaChakramEnabled !== false,
        malliRaaBaksheeshEnabled: d.malliRaaBaksheeshEnabled !== false,
      };
    }
  } catch (_) { }
}

/* ══════════════════════════════════════
   LANDING PAGE
   ══════════════════════════════════════ */
$('btnCustomerLogin').addEventListener('click', () => {
  showPage('pageCustomerLogin');
});
$('btnOwnerLogin').addEventListener('click', e => {
  e.preventDefault();
  showPage('pageOwnerLogin');
});

/* ══════════════════════════════════════
   CUSTOMER AUTH — Name + Phone (Firestore only)
   ══════════════════════════════════════ */
$('btnBackFromCustLogin').addEventListener('click', () => showPage('pageLanding'));

$('formCustomerLogin').addEventListener('submit', async e => {
  e.preventDefault();
  const rawName = $('custName').value.trim();
  const rawPhone = $('custPhone').value.trim();
  const rawKot = $('custKot').value.trim();
  const err = $('custLoginError');
  const btn = $('btnCustLoginSubmit');

  err.classList.add('hidden');

  // Validate
  if (!rawName || rawName.length < 2) {
    err.textContent = 'Please enter a valid name (at least 2 characters)';
    err.classList.remove('hidden');
    return;
  }
  if (!/^[6-9]\d{9}$/.test(rawPhone)) {
    err.textContent = 'Please enter a valid 10-digit Indian mobile number';
    err.classList.remove('hidden');
    return;
  }
  if (!rawKot) {
    err.textContent = 'Please enter your KOT / Bill Number';
    err.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Please wait…';

  try {
    // 1. Verify KOT exists and matches phone
    const billSnap = await db.collection('billCodes').where('billCode', '==', rawKot).get();
    if (billSnap.empty) {
      err.textContent = 'Invalid KOT Number. Please check and try again.';
      err.classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'Continue →';
      return;
    }

    const billDoc = billSnap.docs[0];
    const billData = billDoc.data();

    if (billData.customerPhone !== rawPhone) {
      err.textContent = 'Phone number does not match this KOT.';
      err.classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'Continue →';
      return;
    }

    // 2. The entered KOT must NOT have been played already
    if (billData.hasPlayed) {
      err.textContent = 'This KOT has already been used to play. Please enter a new KOT.';
      err.classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'Continue →';
      return;
    }

    // 3. Fetch all KOTs for this customer to enforce the global cooldown
    const allBillsSnap = await db.collection('billCodes').where('customerPhone', '==', rawPhone).get();
    let latestPlayDate = null;
    let latestPlayStatus = null;

    allBillsSnap.forEach(doc => {
      const d = doc.data();
      if (d.hasPlayed && d.playedAt) {
        const pDate = d.playedAt.toDate();
        if (!latestPlayDate || pDate > latestPlayDate) {
          latestPlayDate = pDate;
          latestPlayStatus = d.status; // 'UNUSED' or 'REDEEMED'
        }
      }
    });

    if (latestPlayDate) {
      const diffMs = Date.now() - latestPlayDate.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      // If their last play was < 10 days ago AND it hasn't been redeemed yet
      if (diffDays < 10 && latestPlayStatus !== 'REDEEMED') {
        const daysLeft = 10 - diffDays;
        err.textContent = `You have an active unused discount! Please redeem it or wait ${daysLeft} days to play again.`;
        err.classList.remove('hidden');
        btn.disabled = false; btn.textContent = 'Continue →';
        return;
      }
    }

    // Save for game results
    window.currentBillDocId = billDoc.id;
    window.currentKotNumber = rawKot;

    // Check if customer exists by phone
    const snap = await db.collection('customers')
      .where('phone', '==', rawPhone)
      .limit(1)
      .get();

    if (!snap.empty) {
      // Existing customer — load their data
      const doc = snap.docs[0];
      currentCustomerData = { id: doc.id, ...doc.data() };
    } else {
      // New customer — create Firestore doc
      const newRef = await db.collection('customers').add({
        name: rawName,
        phone: rawPhone,
        joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
        totalRedemptions: 0
      });
      currentCustomerData = {
        id: newRef.id,
        name: rawName,
        phone: rawPhone,
        totalRedemptions: 0
      };
    }

    // Set current user as anonymous Firestore-based user
    currentUser = { uid: currentCustomerData.id };
    isOwner = false;
    await loadCustomerDash();

  } catch (ex) {
    console.error(ex);
    err.textContent = 'Connection error. Please check your internet and try again';
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Continue →';
  }
});

/* ══════════════════════════════════════
   CUSTOMER DASHBOARD
   ══════════════════════════════════════ */
async function loadCustomerDash() {
  showPage('pageCustomerDash');
  await fetchSettings();

  // Load profile display
  $('dashCustName').textContent = currentCustomerData.name || 'Customer';
  $('profileName').textContent = currentCustomerData.name || '—';
  $('profilePhone').textContent = currentCustomerData.phone || '—';

  if (currentCustomerData.joinedAt && currentCustomerData.joinedAt.toDate) {
    $('profileJoined').textContent = currentCustomerData.joinedAt.toDate().toLocaleDateString();
  } else {
    $('profileJoined').textContent = new Date().toLocaleDateString();
  }

  $('profileRedemptions').textContent = currentCustomerData.totalRedemptions || 0;

  // Load discount history via onSnapshot
  loadMyDiscounts();

  // Show/hide play button based on modeUsed
  const playBtn = $('btnPlayGame');
  if (playBtn) playBtn.classList.toggle('hidden', modeUsed);
}

function loadMyDiscounts() {
  if (unsubDiscounts) unsubDiscounts();
  const phone = currentCustomerData.phone;
  if (!phone) return;

  unsubDiscounts = db.collection('redemptionHistory')
    .where('customerPhone', '==', phone)
    .orderBy('redeemedAt', 'desc')
    .onSnapshot(snapshot => {
      const tbody = $('tbodyMyDiscounts');
      tbody.innerHTML = '';
      if (snapshot.empty) {
        $('noDiscounts').classList.remove('hidden');
        return;
      }
      $('noDiscounts').classList.add('hidden');
      snapshot.forEach(doc => {
        const d = doc.data();
        const redeemedAt = d.redeemedAt ? d.redeemedAt.toDate().toLocaleDateString() : '—';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td data-label="Bill Code" style="font-family:monospace;color:var(--gold-light);">${d.billCode}</td>
          <td data-label="Bill Amount">₹${d.billAmount}</td>
          <td data-label="Discount Given">₹${d.discountGiven || 0}</td>
          <td data-label="Redeemed On">${redeemedAt}</td>
        `;
        tbody.appendChild(tr);
      });
    }, err => {
      console.error('Discounts load error:', err);
    });
}

$('btnCustLogout').addEventListener('click', () => {
  if (unsubDiscounts) { unsubDiscounts(); unsubDiscounts = null; }
  // Since customers are not using Firebase Auth, just clear memory
  currentUser = null;
  currentCustomerData = {};
  modeUsed = false;
  $('custName').value = '';
  $('custPhone').value = '';
  showPage('pageLanding');
});

/* ══════════════════════════════════════
   PLAY GAME BUTTON → MODE SELECT
   ══════════════════════════════════════ */
const playBtnEl = $('btnPlayGame');
if (playBtnEl) {
  playBtnEl.addEventListener('click', async () => {
    await fetchSettings();
    const bEnabled = settings.bhagyadaChakramEnabled !== false;
    const mEnabled = settings.malliRaaBaksheeshEnabled !== false;
    const cardB = $('btnModeBhagyada');
    const cardM = $('btnModeMalliRaa');
    if (cardB) cardB.classList.toggle('hidden', !bEnabled);
    if (cardM) cardM.classList.toggle('hidden', !mEnabled);
    showPage('pageModeSelect');
  });
}

/* ══════════════════════════════════════
   MODE SELECTION
   ══════════════════════════════════════ */
function showUnavailablePopup() {
  toast('This mode is currently unavailable. Please try the other mode.', 'error');
}

$('btnModeBhagyada').addEventListener('click', () => {
  if (modeUsed) return;
  if (!settings.bhagyadaChakramEnabled) { showUnavailablePopup(); return; }
  showPage('pageBhagyadaChakram');
  $('btnSpin').disabled = false;
  $('wheelResult').classList.add('hidden');
  drawWheel();
});

$('btnModeMalliRaa').addEventListener('click', () => {
  if (modeUsed) return;
  if (!settings.malliRaaBaksheeshEnabled) { showUnavailablePopup(); return; }
  showPage('pageMalliRaaBaksheesh');
  initScratchCard();
});

/* ══════════════════════════════════════
   BHAGYADA CHAKRAM — SPINNING WHEEL
   ══════════════════════════════════════ */
const wheelCanvas = $('wheelCanvas');
const wheelCtx = wheelCanvas.getContext('2d');
let wheelAngle = 0;
let isSpinning = false;

function getWheelSegments() {
  const d1 = settings.discount1 || 5;
  const d2 = settings.discount2 || 10;
  const d3 = settings.discount3 || 15;
  return [
    { label: 'Sorry', discount: 0, color: '#2d1b69' },
    { label: d1 + '% OFF', discount: d1, color: '#b8912e' },
    { label: 'Sorry', discount: 0, color: '#1a1a3e' },
    { label: d2 + '% OFF', discount: d2, color: '#d4a843' },
    { label: 'Sorry', discount: 0, color: '#2d1b69' },
    { label: d3 + '% OFF', discount: d3, color: '#f0d078' },
  ];
}

function drawWheel(angle = 0) {
  const size = window.innerWidth < 480 ? 260 : window.innerWidth < 768 ? 300 : 400;
  if (wheelCanvas.width !== size) { wheelCanvas.width = size; wheelCanvas.height = size; }
  const segments = getWheelSegments();
  const cx = wheelCanvas.width / 2, cy = wheelCanvas.height / 2;
  const r = cx - 10;
  const arc = (2 * Math.PI) / segments.length;
  wheelCtx.clearRect(0, 0, wheelCanvas.width, wheelCanvas.height);
  segments.forEach((seg, i) => {
    const startAngle = angle + i * arc;
    const endAngle = startAngle + arc;
    wheelCtx.beginPath();
    wheelCtx.moveTo(cx, cy);
    wheelCtx.arc(cx, cy, r, startAngle, endAngle);
    wheelCtx.closePath();
    wheelCtx.fillStyle = seg.color;
    wheelCtx.fill();
    wheelCtx.strokeStyle = 'rgba(10,10,18,0.5)';
    wheelCtx.lineWidth = 2;
    wheelCtx.stroke();
    wheelCtx.save();
    wheelCtx.translate(cx, cy);
    wheelCtx.rotate(startAngle + arc / 2);
    wheelCtx.textAlign = 'right';
    wheelCtx.fillStyle = seg.discount > 0 ? '#0a0a12' : '#9a96a6';
    wheelCtx.font = seg.discount > 0 ? 'bold 15px Syne' : '13px DM Sans';
    wheelCtx.fillText(seg.label, r - 18, 5);
    wheelCtx.restore();
  });
  wheelCtx.beginPath();
  wheelCtx.arc(cx, cy, 22, 0, 2 * Math.PI);
  wheelCtx.fillStyle = '#0a0a12';
  wheelCtx.fill();
  wheelCtx.strokeStyle = '#d4a843';
  wheelCtx.lineWidth = 3;
  wheelCtx.stroke();
  wheelCtx.fillStyle = '#d4a843';
  wheelCtx.font = 'bold 11px Syne';
  wheelCtx.textAlign = 'center';
  wheelCtx.fillText('SPIN', cx, cy + 4);
}

$('btnSpin').addEventListener('click', () => {
  if (isSpinning || modeUsed) return;
  isSpinning = true;
  $('btnSpin').disabled = true;
  $('wheelResult').classList.add('hidden');
  const segments = getWheelSegments();
  const arc = (2 * Math.PI) / segments.length;
  const extraSpins = 5 + Math.random() * 3;
  const targetAngle = extraSpins * 2 * Math.PI + Math.random() * 2 * Math.PI;
  const duration = 4000;
  const startTime = performance.now();
  const startAngle = wheelAngle;
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function animate(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    wheelAngle = startAngle + targetAngle * easeOut(progress);
    drawWheel(wheelAngle);
    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      isSpinning = false;
      const normalized = ((2 * Math.PI) - (wheelAngle % (2 * Math.PI))) % (2 * Math.PI);
      const pointerAngle = (normalized + Math.PI * 1.5) % (2 * Math.PI);
      const segIndex = Math.floor(pointerAngle / arc) % segments.length;
      showWheelResult(segments[segIndex]);
    }
  }
  requestAnimationFrame(animate);
});

window.addEventListener('resize', () => {
  if ($('pageBhagyadaChakram').classList.contains('active')) drawWheel(wheelAngle);
});

function generateCouponCode(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = prefix + '-';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function showWheelResult(segment) {
  modeUsed = true;
  if ($('btnPlayGame')) $('btnPlayGame').classList.add('hidden');
  const resultDiv = $('wheelResult');
  resultDiv.classList.remove('hidden');
  if (segment.discount > 0) {
    try {
      if (window.currentBillDocId) {
        await db.collection('billCodes').doc(window.currentBillDocId).update({
          hasPlayed: true,
          playedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
    } catch (e) { console.error('Failed to update billcode:', e); }

    const code = window.currentKotNumber || generateCouponCode('BC');
    const start = new Date().toLocaleDateString();
    const expiryDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const expiry = expiryDate.toLocaleDateString();
    resultDiv.className = 'result-box win';
    resultDiv.innerHTML = `
      <h3>🎉 Congratulations!</h3>
      <p>Download your coupon — it will NOT be saved to your wallet.</p>
      <div style="margin:1rem 0;font-size:1.5rem;color:var(--gold-primary);font-weight:bold;">${segment.discount}% OFF</div>
      <button id="ldDownloadBtn" class="btn-primary" style="margin-bottom:0.5rem;">📥 Download Coupon</button>
      <button class="btn-to-dash" onclick="loadCustomerDash()">View My Profile →</button>
    `;
    $('ldDownloadBtn').addEventListener('click', () => {
      downloadCouponImage(currentCustomerData.name, currentCustomerData.phone, segment.discount, code, start, expiry, 'Bhagyada Chakram');
    });
  } else {
    resultDiv.className = 'result-box lose';
    resultDiv.innerHTML = `
      <h3>😅 Better luck next time!</h3>
      <p>Don't worry — you can try again on your next visit!</p>
      <button class="btn-to-dash" onclick="loadCustomerDash()">View My Profile →</button>
    `;
  }
}

/* ══════════════════════════════════════
   MALLI RAA BAKSHEESH — SCRATCH CARD
   ══════════════════════════════════════ */
let scratchRevealed = false;
let scratchDiscountValue = 0;
let scratchStrokeCount = 0;

function initScratchCard() {
  scratchRevealed = false;
  scratchStrokeCount = 0;
  const flipper = $('scratchFlipper');
  flipper.classList.remove('flipped');
  const discounts = [settings.discount1 || 5, settings.discount2 || 10, settings.discount3 || 15];
  scratchDiscountValue = discounts[Math.floor(Math.random() * discounts.length)];
  $('scratchDiscount').textContent = scratchDiscountValue + '%';
  $('revealDiscount').textContent = scratchDiscountValue + '%';
  const oldCanvas = $('scratchCanvas');
  const newCanvas = oldCanvas.cloneNode(true);
  oldCanvas.parentNode.replaceChild(newCanvas, oldCanvas);
  const w = window.innerWidth < 480 ? 280 : 320;
  const h = window.innerWidth < 480 ? 175 : 200;
  newCanvas.width = w; newCanvas.height = h;
  newCanvas.style.touchAction = 'none';
  const ctx = newCanvas.getContext('2d', { willReadFrequently: true });
  ctx.globalCompositeOperation = 'source-over';
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#d4a843');
  grad.addColorStop(0.5, '#f0d078');
  grad.addColorStop(1, '#b8912e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(10,10,18,0.15)';
  ctx.font = 'bold 18px Syne';
  ctx.textAlign = 'center';
  ctx.fillText('✦ SCRATCH HERE ✦', w / 2, h / 2 - 10);
  ctx.font = '13px DM Sans';
  ctx.fillText('Use your finger or mouse', w / 2, h / 2 + 15);
  ctx.globalCompositeOperation = 'destination-out';
  let isDrawing = false;
  function draw(e) {
    if (!isDrawing || scratchRevealed) return;
    const rect = newCanvas.getBoundingClientRect();
    const scaleX = w / rect.width, scaleY = h / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = (clientX - rect.left) * scaleX, y = (clientY - rect.top) * scaleY;
    ctx.beginPath(); ctx.arc(x, y, 24, 0, Math.PI * 2); ctx.fill();
    checkScratchPercent(ctx, w, h);
  }
  newCanvas.addEventListener('mousedown', e => { isDrawing = true; draw(e); });
  newCanvas.addEventListener('mousemove', draw);
  newCanvas.addEventListener('mouseup', () => isDrawing = false);
  newCanvas.addEventListener('mouseleave', () => isDrawing = false);
  newCanvas.addEventListener('touchstart', e => { if (e.cancelable) e.preventDefault(); isDrawing = true; draw(e); }, { passive: false });
  newCanvas.addEventListener('touchmove', e => { if (e.cancelable) e.preventDefault(); draw(e); }, { passive: false });
  newCanvas.addEventListener('touchend', () => isDrawing = false);
  $('scratchResult').classList.add('hidden');
}

function checkScratchPercent(ctx, w, h) {
  if (scratchRevealed) return;
  scratchStrokeCount++;
  if (scratchStrokeCount % 3 !== 0) return;
  const imageData = ctx.getImageData(0, 0, w, h);
  const pixels = imageData.data;
  let sampled = 0, transparent = 0;
  for (let i = 3; i < pixels.length; i += 16) { sampled++; if (pixels[i] < 128) transparent++; }
  if ((transparent / sampled) * 100 >= 30) {
    scratchRevealed = true;
    modeUsed = true;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    $('scratchFlipper').classList.add('flipped');
    setTimeout(showScratchResult, 900);
  }
}

async function showScratchResult() {
  if ($('btnPlayGame')) $('btnPlayGame').classList.add('hidden');

  try {
    if (window.currentBillDocId) {
      await db.collection('billCodes').doc(window.currentBillDocId).update({
        hasPlayed: true,
        playedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (e) { console.error('Failed to update billcode:', e); }

  const code = window.currentKotNumber || generateCouponCode('WB');
  const start = new Date().toLocaleDateString();
  const expiryDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  const expiryStr = expiryDate.toLocaleDateString();
  showWinPopup(scratchDiscountValue, code, 'Malli Raa Baksheesh', '10 days', start, expiryStr);
  const resultDiv = $('scratchResult');
  resultDiv.classList.remove('hidden');
  resultDiv.className = 'result-box win';
  resultDiv.innerHTML = `
    <h3>🎉 You unlocked ${scratchDiscountValue}% OFF!</h3>
    <p>Your exclusive Malli Raa Baksheesh discount</p>
    <div class="coupon-code-display">${code}</div>
    <p style="font-size:0.75rem;color:var(--text-muted);margin-top:0.3rem;">Valid for 10 days</p>
    <button id="wbResultDownloadBtn" class="btn-primary" style="margin-top:0.5rem;margin-bottom:0.5rem;">📥 Download Coupon</button>
    <button class="btn-to-dash" onclick="loadCustomerDash()">View My Profile →</button>
  `;
  $('wbResultDownloadBtn').addEventListener('click', () => {
    downloadCouponImage(currentCustomerData.name, currentCustomerData.phone, scratchDiscountValue, code, start, expiryStr, 'Malli Raa Baksheesh');
  });
}

/* ══════════════════════════════════════
   WIN POPUP MODAL
   ══════════════════════════════════════ */
function showWinPopup(discount, code, source, validFor, start, expiryStr) {
  let popup = $('winPopup');
  if (!popup) { popup = document.createElement('div'); popup.id = 'winPopup'; document.body.appendChild(popup); }
  popup.className = 'win-popup';
  popup.innerHTML = `
    <div class="win-popup-backdrop" onclick="closeWinPopup()"></div>
    <div class="win-popup-content">
      <div class="win-popup-confetti">🎊</div>
      <h2>🎉 You Won!</h2>
      <div class="win-popup-discount">${discount}% OFF</div>
      <p class="win-popup-source">${source}</p>
      <div class="win-popup-code" onclick="navigator.clipboard.writeText('${code}');this.querySelector('.copy-hint').textContent='Copied!';setTimeout(()=>this.querySelector('.copy-hint').textContent='Tap to copy',1500);">
        <span class="code-text">${code}</span>
        <span class="copy-hint">Tap to copy</span>
      </div>
      <p class="win-popup-expiry">Valid for ${validFor}</p>
      <button id="popupDownloadBtn" class="btn-primary win-popup-btn">📥 Download Coupon</button>
      <button class="btn-outline win-popup-btn" onclick="closeWinPopup();loadCustomerDash();" style="width:100%;padding:0.95rem;margin-top:0.5rem;">🎟️ View My Profile</button>
      <button class="win-popup-close" onclick="closeWinPopup()">✕</button>
    </div>
  `;
  popup.querySelector('#popupDownloadBtn').addEventListener('click', () => {
    downloadCouponImage(currentCustomerData.name, currentCustomerData.phone, discount, code, start, expiryStr, source);
  });
}

function closeWinPopup() {
  const popup = $('winPopup');
  if (popup) { popup.className = 'win-popup win-popup-closing'; setTimeout(() => popup.className = 'win-popup hidden', 300); }
}
window.closeWinPopup = closeWinPopup;
window.loadCustomerDash = loadCustomerDash;


/* ══════════════════════════════════════
   OWNER AUTH
   ══════════════════════════════════════ */
$('btnBackFromOwnerLogin').addEventListener('click', () => showPage('pageLanding'));

$('formOwnerLogin').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('ownerEmail').value.trim();
  const pass = $('ownerPass').value;
  const btn = $('btnOwnerLoginSubmit');
  const err = $('ownerLoginError');
  err.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Logging in…';
  try {
    const cred = await auth.signInWithEmailAndPassword(email, pass);
    const ownerDoc = await db.collection('owners').doc(cred.user.uid).get();
    if (!ownerDoc.exists) {
      await auth.signOut();
      err.textContent = 'Access denied. This account is not an owner account.';
      err.classList.remove('hidden');
      return;
    }
    currentUser = cred.user;
    isOwner = true;
    await loadOwnerDash();
  } catch (_) {
    err.textContent = 'Invalid email or password';
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login →';
  }
});

$('btnOwnerLogout').addEventListener('click', async () => {
  if (unsubHistory) { unsubHistory(); unsubHistory = null; }
  if (unsubCustomers) { unsubCustomers(); unsubCustomers = null; }
  await auth.signOut();
  currentUser = null; isOwner = false;
  $('ownerEmail').value = '';
  $('ownerPass').value = '';
  showPage('pageLanding');
});

/* ══════════════════════════════════════
   OWNER DASHBOARD — LOAD
   ══════════════════════════════════════ */
async function loadOwnerDash() {
  showPage('pageOwnerDash');
  await fetchSettings();
  loadSettingsForm();
  startHistoryListener();
  startCustomersListener();
}

/* ── Tabs ── */
document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    $(btn.dataset.tab).classList.add('active');
  });
});

/* ══════════════════════════════════════
   ADD BILL CODE
   ══════════════════════════════════════ */
$('btnAddBillCode').addEventListener('click', async () => {
  const code = $('newBillCode').value.trim();
  const name = $('newBillCustomerName').value.trim();
  const phone = $('newBillPhone').value.trim();
  const amount = Number($('newBillAmount').value);
  const date = $('newBillDate').value;
  const msg = $('billCodeAddMsg');

  msg.className = 'hidden';
  msg.textContent = '';

  if (!code || !name || !phone || !amount || !date) {
    msg.textContent = 'Please fill all required fields';
    msg.className = 'error-text';
    return;
  }

  const btn = $('btnAddBillCode');
  btn.disabled = true;
  btn.textContent = 'Adding…';

  try {
    const existing = await db.collection('billCodes')
      .where('billCode', '==', code).get();

    if (!existing.empty) {
      msg.textContent = 'This bill code already exists';
      msg.className = 'error-text';
      return;
    }

    await db.collection('billCodes').add({
      billCode: code,
      billCode_lower: code.toLowerCase(),
      customerName: name,
      customerName_lower: name.toLowerCase(),
      customerPhone: phone,
      billAmount: amount,
      billDate: date,
      status: 'UNUSED',
      redeemedAt: null,
      approvedBy: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    msg.textContent = 'Bill code added successfully';
    msg.className = 'success-text';
    $('newBillCode').value = '';
    $('newBillCustomerName').value = '';
    $('newBillPhone').value = '';
    $('newBillAmount').value = '';
    $('newBillDate').value = '';

  } catch (err) {
    console.error(err);
    msg.textContent = 'Connection error. Please check your internet and try again';
    msg.className = 'error-text';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add Bill Code';
  }
});

/* ══════════════════════════════════════
   REDEEM SEARCH (DEBOUNCED)
   ══════════════════════════════════════ */
let debounceTimer;
window.handleSearch = function (val) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => searchBills(val), 300);
};

async function searchBills(value) {
  value = (value || '').trim();
  const container = $('redeemResults');

  if (!value) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;">Searching…</p>';
  const lower = value.toLowerCase();

  try {
    let snap = await db.collection('billCodes').where('customerPhone', '==', value).get();
    if (snap.empty) snap = await db.collection('billCodes').where('billCode_lower', '==', lower).get();
    if (snap.empty) snap = await db.collection('billCodes').where('customerName_lower', '==', lower).get();

    if (snap.empty) {
      container.innerHTML = '<p class="error-text">No record found. Please check the code and try again</p>';
      return;
    }
    renderRedeemResults(snap.docs, container);
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="error-text">Connection error. Please check your internet and try again</p>';
  }
}

function renderRedeemResults(docs, container) {
  let html = '';
  docs.forEach(doc => {
    const d = doc.data();
    const isRedeemed = d.status === 'REDEEMED';
    const statusBadge = isRedeemed
      ? '<span class="status-expired">REDEEMED</span>'
      : '<span class="status-active">UNUSED</span>';
    const redeemedInfo = isRedeemed
      ? `<p style="color:var(--text-muted);font-size:0.85rem;">Redeemed on: ${d.redeemedAt ? d.redeemedAt.toDate().toLocaleString() : 'N/A'}</p>`
      : '';
    const actionBtn = isRedeemed
      ? ''
      : `<button class="btn-primary btn-sm" style="margin-top:0.75rem;" onclick="promptApprove('${doc.id}','${d.customerName}','${d.billCode}')">Approve Discount</button>`;

    html += `
      <div class="settings-card" style="margin-bottom:0.75rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
          <span style="font-family:monospace;color:var(--gold-light);font-weight:700;">${d.billCode}</span>
          ${statusBadge}
        </div>
        <div style="margin-top:0.5rem;font-size:0.9rem;color:var(--text-secondary);display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.3rem;">
          <span>👤 ${d.customerName}</span>
          <span>📞 ${d.customerPhone}</span>
          <span>₹${d.billAmount}</span>
          <span>📅 ${d.billDate}</span>
        </div>
        ${redeemedInfo}
        ${actionBtn}
      </div>`;
  });
  container.innerHTML = html;
}

/* ── Approve Popup ── */
window.promptApprove = function (docId, name, code) {
  let popup = $('approveConfirmPopup');
  if (!popup) { popup = document.createElement('div'); popup.id = 'approveConfirmPopup'; document.body.appendChild(popup); }
  popup.className = 'win-popup';
  popup.innerHTML = `
    <div class="win-popup-backdrop" onclick="closeApprovePopup()"></div>
    <div class="win-popup-content" style="max-width:360px;">
      <div style="font-size:2rem;margin-bottom:0.5rem;">✅</div>
      <h2 style="color:var(--gold);font-size:1.3rem;margin-bottom:0.5rem;">Approve Discount?</h2>
      <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:1.2rem;">
        Approve discount for <strong style="color:var(--gold-light);">${name}</strong>?<br>
        <span style="font-family:monospace;color:var(--gold-light);">${code}</span> will be marked as <strong>REDEEMED</strong>.
      </p>
      <div style="display:flex;gap:0.75rem;">
        <button class="btn-outline" style="flex:1;" onclick="closeApprovePopup()">Cancel</button>
        <button class="btn-primary" style="flex:1;" onclick="confirmApprove('${docId}','${name}')">Confirm</button>
      </div>
    </div>
  `;
};

function closeApprovePopup() {
  const p = $('approveConfirmPopup');
  if (p) p.className = 'win-popup hidden';
}
window.closeApprovePopup = closeApprovePopup;

window.confirmApprove = async function (docId, name) {
  closeApprovePopup();
  try {
    const docRef = db.collection('billCodes').doc(docId);
    const snap = await docRef.get();
    if (!snap.exists) { toast('Bill code not found', 'error'); return; }
    const d = snap.data();
    if (d.status === 'REDEEMED') {
      toast(`This code was already redeemed on ${d.redeemedAt ? d.redeemedAt.toDate().toLocaleString() : 'an earlier date'}`, 'error');
      return;
    }
    const ts = firebase.firestore.FieldValue.serverTimestamp();
    await docRef.update({ status: 'REDEEMED', redeemedAt: ts, approvedBy: currentUser.uid });
    await db.collection('redemptionHistory').add({
      billCode: d.billCode,
      customerName: d.customerName,
      customerPhone: d.customerPhone,
      billAmount: d.billAmount,
      discountGiven: Math.round(d.billAmount * 0.1),
      redeemedAt: ts,
      approvedBy: currentUser.uid
    });
    toast(`Discount approved for ${name} successfully`);
    // Re-search to refresh results
    const searchVal = $('searchBillCode').value;
    if (searchVal) searchBills(searchVal);
  } catch (err) {
    console.error(err);
    toast('Connection error. Please check your internet and try again', 'error');
  }
};

/* ══════════════════════════════════════
   HISTORY TAB — onSnapshot
   ══════════════════════════════════════ */
function startHistoryListener() {
  if (unsubHistory) unsubHistory();
  unsubHistory = db.collection('billCodes')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .onSnapshot(snapshot => {
      historyAllData = [];
      let total = 0, unused = 0, redeemed = 0;
      snapshot.forEach(doc => {
        const d = { id: doc.id, ...doc.data() };
        historyAllData.push(d);
        total++;
        if (d.status === 'UNUSED') unused++;
        if (d.status === 'REDEEMED') redeemed++;
      });
      $('statTotal').textContent = total;
      $('statUnused').textContent = unused;
      $('statRedeemed').textContent = redeemed;
      renderHistoryTable();
    }, err => console.error('History listener error:', err));
}

window.applyHistoryFilter = function (filter) {
  historyFilter = filter;
  ['filterAll', 'filterUnused', 'filterRedeemed'].forEach(id => $(id).classList.remove('active'));
  if (filter === 'ALL') $('filterAll').classList.add('active');
  else if (filter === 'UNUSED') $('filterUnused').classList.add('active');
  else $('filterRedeemed').classList.add('active');
  renderHistoryTable();
};

function renderHistoryTable() {
  const tbody = $('tbodyHistory');
  tbody.innerHTML = '';
  const filtered = historyFilter === 'ALL'
    ? historyAllData
    : historyAllData.filter(d => d.status === historyFilter);

  if (filtered.length === 0) {
    $('noHistory').classList.remove('hidden');
    return;
  }
  $('noHistory').classList.add('hidden');
  filtered.forEach(d => {
    const isRedeemed = d.status === 'REDEEMED';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Code" style="font-family:monospace;color:var(--gold-light);">${d.billCode}</td>
      <td data-label="Customer">${d.customerName}</td>
      <td data-label="Phone">${d.customerPhone}</td>
      <td data-label="Amount">₹${d.billAmount}</td>
      <td data-label="Date">${d.billDate}</td>
      <td data-label="Status"><span class="${isRedeemed ? 'status-expired' : 'status-active'}">${d.status}</span></td>
      <td data-label="Redeemed At">${isRedeemed && d.redeemedAt ? d.redeemedAt.toDate().toLocaleString() : '-'}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ══════════════════════════════════════
   CUSTOMERS TAB — onSnapshot
   ══════════════════════════════════════ */
function startCustomersListener() {
  if (unsubCustomers) unsubCustomers();
  unsubCustomers = db.collection('customers')
    .orderBy('joinedAt', 'desc')
    .limit(100)
    .onSnapshot(snapshot => {
      const tbody = $('tbodyCustomers');
      tbody.innerHTML = '';
      if (snapshot.empty) { $('noCustomers').classList.remove('hidden'); return; }
      $('noCustomers').classList.add('hidden');
      snapshot.forEach(doc => {
        const d = doc.data();
        const joined = d.joinedAt ? d.joinedAt.toDate().toLocaleDateString() : '—';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td data-label="Name">${d.name || '—'}</td>
          <td data-label="Phone">${d.phone || '—'}</td>
          <td data-label="Email" style="font-size:0.82rem;">${d.email || '—'}</td>
          <td data-label="Joined">${joined}</td>
          <td data-label="Redemptions">${d.totalRedemptions || 0}</td>
          <td data-label="Action">
            <button class="btn-danger btn-sm" onclick="deleteCustomer('${doc.id}','${d.name}')">Delete</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }, err => console.error('Customers listener error:', err));
}

window.deleteCustomer = function (uid, name) {
  let popup = $('deleteConfirmPopup');
  if (!popup) { popup = document.createElement('div'); popup.id = 'deleteConfirmPopup'; document.body.appendChild(popup); }
  popup.className = 'win-popup';
  popup.innerHTML = `
    <div class="win-popup-backdrop" onclick="closeDeletePopup()"></div>
    <div class="win-popup-content" style="max-width:360px;">
      <div style="font-size:2rem;margin-bottom:0.5rem;">🗑️</div>
      <h2 style="color:var(--danger);font-size:1.3rem;margin-bottom:0.5rem;">Delete Customer?</h2>
      <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:1.2rem;">
        Permanently delete <strong>${name}</strong>? This cannot be undone.
      </p>
      <div style="display:flex;gap:0.75rem;">
        <button class="btn-outline" style="flex:1;" onclick="closeDeletePopup()">Cancel</button>
        <button class="btn-danger" style="flex:1;" onclick="confirmDeleteCustomer('${uid}')">Delete</button>
      </div>
    </div>
  `;
};
function closeDeletePopup() { const p = $('deleteConfirmPopup'); if (p) p.className = 'win-popup hidden'; }
window.closeDeletePopup = closeDeletePopup;
window.confirmDeleteCustomer = async function (uid) {
  closeDeletePopup();
  try {
    await db.collection('customers').doc(uid).delete();
    toast('Customer deleted.');
  } catch (err) {
    toast('Error deleting customer. Try again.', 'error');
  }
};

/* ══════════════════════════════════════
   SETTINGS TAB
   ══════════════════════════════════════ */
function loadSettingsForm() {
  $('setDiscount1').value = settings.discount1 || 5;
  $('setDiscount2').value = settings.discount2 || 10;
  $('setDiscount3').value = settings.discount3 || 15;
  $('toggleBhagyadaChakram').checked = settings.bhagyadaChakramEnabled !== false;
  $('toggleMalliRaaBaksheesh').checked = settings.malliRaaBaksheeshEnabled !== false;
  updateToggleUI($('toggleBhagyadaChakram'), $('statusBhagyadaChakram'));
  updateToggleUI($('toggleMalliRaaBaksheesh'), $('statusMalliRaaBaksheesh'));
}

function updateToggleUI(toggle, statusEl) {
  statusEl.textContent = toggle.checked ? 'Enabled' : 'Disabled';
  statusEl.classList.toggle('disabled', !toggle.checked);
}

$('toggleBhagyadaChakram').addEventListener('change', e => updateToggleUI(e.target, $('statusBhagyadaChakram')));
$('toggleMalliRaaBaksheesh').addEventListener('change', e => updateToggleUI(e.target, $('statusMalliRaaBaksheesh')));

$('btnSaveSettings').addEventListener('click', async () => {
  const payload = {
    discount1: parseInt($('setDiscount1').value) || 5,
    discount2: parseInt($('setDiscount2').value) || 10,
    discount3: parseInt($('setDiscount3').value) || 15,
    bhagyadaChakramEnabled: $('toggleBhagyadaChakram').checked,
    malliRaaBaksheeshEnabled: $('toggleMalliRaaBaksheesh').checked,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  try {
    await db.collection('settings').doc('config').set(payload, { merge: true });
    settings = { ...settings, ...payload };
    toast('Settings saved!');
  } catch (err) {
    toast('Error saving settings. Please try again.', 'error');
  }
});

/* ── Erase All ── */
$('btnEraseAll').addEventListener('click', () => {
  let popup = $('eraseConfirmPopup');
  if (!popup) { popup = document.createElement('div'); popup.id = 'eraseConfirmPopup'; document.body.appendChild(popup); }
  popup.className = 'win-popup';
  popup.innerHTML = `
    <div class="win-popup-backdrop" onclick="closeErasePopup()"></div>
    <div class="win-popup-content" style="max-width:360px;">
      <div style="font-size:2rem;margin-bottom:0.5rem;">⚠️</div>
      <h2 style="color:var(--danger);font-size:1.3rem;margin-bottom:0.5rem;">Erase All Data?</h2>
      <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:1.2rem;">
        This will permanently delete <strong>all customers, bill codes, and redemption history</strong>. This is irreversible.
      </p>
      <div class="input-group" style="text-align:left; margin-bottom:0.75rem;">
        <label for="eraseConfirmEmail" style="color:var(--text-secondary);">Owner Email</label>
        <input type="email" id="eraseConfirmEmail" placeholder="owner@andhra.com" />
      </div>
      <div class="input-group" style="text-align:left; margin-bottom:1rem;">
        <label for="eraseConfirmPass" style="color:var(--text-secondary);">Password</label>
        <input type="password" id="eraseConfirmPass" placeholder="Enter password" />
      </div>
      <p id="eraseConfirmError" class="error-text hidden" style="margin-bottom:1rem;"></p>
      <div style="display:flex;gap:0.75rem;">
        <button class="btn-outline" style="flex:1;" onclick="closeErasePopup()">Cancel</button>
        <button class="btn-danger" style="flex:1;" onclick="confirmEraseAll()">Erase All</button>
      </div>
    </div>
  `;
});
function closeErasePopup() { const p = $('eraseConfirmPopup'); if (p) p.className = 'win-popup hidden'; }
window.closeErasePopup = closeErasePopup;
window.confirmEraseAll = async function () {
  const email = $('eraseConfirmEmail').value.trim();
  const pass = $('eraseConfirmPass').value;
  const err = $('eraseConfirmError');
  err.classList.add('hidden');

  if (!email || !pass) {
    err.textContent = 'Please enter email and password to confirm.';
    err.classList.remove('hidden');
    return;
  }

  try {
    // 1. Re-authenticate to verify credentials
    await firebase.auth().signInWithEmailAndPassword(email, pass);

    // 2. Authentication successful, proceed with erase
    closeErasePopup();

    const batch = db.batch();
    const billSnap = await db.collection('billCodes').limit(150).get();
    billSnap.forEach(doc => batch.delete(doc.ref));

    const histSnap = await db.collection('redemptionHistory').limit(150).get();
    histSnap.forEach(doc => batch.delete(doc.ref));

    const custSnap = await db.collection('customers').limit(150).get();
    custSnap.forEach(doc => batch.delete(doc.ref));

    await batch.commit();
    toast('All data erased.');
    setTimeout(() => window.location.reload(), 1500);
  } catch (err) {
    err.textContent = 'Invalid email or password. Erase failed.';
    err.classList.remove('hidden');
  }
};

/* ══════════════════════════════════════
   COUPON IMAGE DOWNLOAD
   ══════════════════════════════════════ */
window.downloadCouponImage = function (name, phone, discount, code, start, expiry, source) {
  const canvas = document.createElement('canvas');
  canvas.width = 600; canvas.height = 380;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.font = 'bold 80px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) ctx.fillText('ANDHRA HOTEL', i * 300, j * 100);
  ctx.restore();
  ctx.strokeStyle = '#f5c842'; ctx.lineWidth = 4;
  ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);
  ctx.lineWidth = 1;
  ctx.strokeRect(26, 26, canvas.width - 52, canvas.height - 52);
  const draw = (text, x, y, font, color, align = 'left') => {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(text, x, y);
  };
  draw('Andhra Hotel', canvas.width / 2, 60, 'bold 28px serif', '#f5c842', 'center');
  draw('A Multi Cuisine Restaurant', canvas.width / 2, 90, 'italic 16px serif', '#ffffff', 'center');
  ctx.beginPath(); ctx.moveTo(40, 110); ctx.lineTo(canvas.width - 40, 110);
  ctx.strokeStyle = '#7c5cfc'; ctx.lineWidth = 2; ctx.stroke();
  const sx = 60; let y = 145; const ls = 30;
  draw('Customer Name', sx, y, '16px sans-serif', '#999999');
  draw(': ' + (name || '—'), sx + 140, y, 'bold 16px sans-serif', '#ffffff');
  y += ls;
  draw('Phone Number', sx, y, '16px sans-serif', '#999999');
  draw(': ' + (phone || '—'), sx + 140, y, 'bold 16px sans-serif', '#ffffff');
  y += 40;
  draw('Discount', sx, y, '16px sans-serif', '#999999');
  draw(': ' + discount + '% OFF', sx + 140, y, 'bold 22px sans-serif', '#f5c842');
  y += ls;
  draw('KOT Number', sx, y, '16px sans-serif', '#999999');
  draw(': ' + code, sx + 140, y, 'bold 18px sans-serif', '#ffffff');
  y += 45;
  draw('Valid From', sx, y, '14px sans-serif', '#999999');
  draw(': ' + start, sx + 90, y, '14px sans-serif', '#ffffff');
  draw('Valid Until', sx + 230, y, '14px sans-serif', '#999999');
  draw(': ' + expiry, sx + 320, y, '14px sans-serif', '#ffffff');
  draw('Source: ' + source, canvas.width / 2, canvas.height - 35, 'italic 14px sans-serif', '#7c5cfc', 'center');
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `AndhraHotel_Coupon_${(name || '').replace(/[^a-zA-Z0-9]/g, '')}.png`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

/* ══════════════════════════════════════
   BACKGROUND ANIMATION
   ══════════════════════════════════════ */
function initBackgroundAnimation() {
  const canvas = $('bgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w = canvas.width = window.innerWidth;
  let h = canvas.height = window.innerHeight;
  const isMobile = window.innerWidth < 480;
  const maxP = isMobile ? 15 : 40;
  const colors = ['#f5c842', '#7c5cfc', 'rgba(255,255,255,0.6)'];
  class Particle {
    constructor() { this.reset(true); }
    reset(randomY = false) {
      this.x = Math.random() * w;
      this.y = randomY ? Math.random() * h : h + Math.random() * 20;
      this.r = Math.random() * 3 + 1;
      this.color = colors[Math.floor(Math.random() * colors.length)];
      this.speedY = Math.random() * 0.5 + 0.1;
      this.speedX = (Math.random() - 0.5) * 0.4;
      this.opacity = Math.random() * 0.6 + 0.2;
    }
    update() {
      this.y -= this.speedY; this.x += this.speedX;
      if (this.y + this.r < 0 || this.x > w || this.x < 0) this.reset();
    }
    draw() {
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = this.color; ctx.globalAlpha = this.opacity; ctx.fill();
    }
  }
  const particles = Array.from({ length: maxP }, () => new Particle());
  let animFrame, isVisible = !document.hidden;
  function animate() {
    if (!isVisible) return;
    ctx.clearRect(0, 0, w, h);
    particles.forEach(p => { p.update(); p.draw(); });
    ctx.globalAlpha = 1;
    animFrame = requestAnimationFrame(animate);
  }
  animate();
  window.addEventListener('resize', () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; });
  document.addEventListener('visibilitychange', () => {
    isVisible = !document.hidden;
    if (isVisible) animate(); else cancelAnimationFrame(animFrame);
  });
}

/* ══════════════════════════════════════
   INIT ON LOAD
   ══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  initBackgroundAnimation();
  try { await fetchSettings(); } catch (_) { }
  const splash = $('appSplash');
  if (splash) splash.classList.add('fade-out');
});
