// Aurum 3D - Neural Credit Underwriting Controller
const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/* ---------- Bulletproof API Resolution ---------- */
let API_BASE = '';

async function resolveApiBase() {
  const urlParam = new URLSearchParams(window.location.search).get('api');
  if (urlParam) {
    API_BASE = urlParam.replace(/\/$/, '');
    return API_BASE;
  }

  // Candidate origins to probe
  const candidates = [];
  if (window.location.origin && window.location.origin.startsWith('http')) {
    candidates.push(window.location.origin);
  }
  candidates.push('http://127.0.0.1:8000', 'http://127.0.0.1:8001', 'http://localhost:8000', 'http://localhost:8001');

  const unique = [...new Set(candidates)];
  for (const host of unique) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1000);
      const res = await fetch(`${host}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const h = await res.json();
        if (h && (h.status === 'healthy' || h.model_loaded !== undefined)) {
          API_BASE = host;
          return API_BASE;
        }
      }
    } catch (_) {}
  }
  // Default fallback if all fail
  API_BASE = window.location.origin.startsWith('http') ? window.location.origin : 'http://127.0.0.1:8000';
  return API_BASE;
}

/* ---------- Field Specifications ---------- */
const S = {
  // [label, unit, sliderMin, sliderMax, step, hardMin, hardMax]
  person_age: ['Applicant Age', 'years', 18, 80, 1, 18, 100],
  person_income: ['Annual Income', '₹', 50000, 3000000, 10000, 0, 1e12],
  person_emp_length: ['Employment Length', 'years', 0, 35, 0.5, 0, 60],
  cb_person_cred_hist_length: ['Credit History Length', 'years', 0, 30, 1, 0, 50],
  loan_amnt: ['Requested Loan Amount', '₹', 10000, 1500000, 5000, 1, 1e12],
  loan_int_rate: ['Interest Rate', '%', 5, 25, 0.1, 0, 100]
};

const C = {
  person_home_ownership: ['Home Ownership', [['RENT', 'Renting'], ['MORTGAGE', 'Mortgage'], ['OWN', 'Owns Outright'], ['OTHER', 'Other']]],
  cb_person_default_on_file: ['Historical Default on File', [['N', 'No Default'], ['Y', 'Prior Default']]],
  loan_intent: ['Loan Intent / Purpose', [
    ['PERSONAL', 'Personal'],
    ['EDUCATION', 'Education'],
    ['MEDICAL', 'Medical'],
    ['VENTURE', 'Business Venture'],
    ['HOMEIMPROVEMENT', 'Home Improvement'],
    ['DEBTCONSOLIDATION', 'Debt Consolidation']
  ]],
  loan_grade: ['Assigned Credit Grade', 'ABCDEFG'.split('').map(g => [g, `Grade ${g}`])]
};

// Initial state values
let V = {
  person_age: 30,
  person_income: 600000,
  person_emp_length: 5,
  cb_person_cred_hist_length: 4,
  loan_amnt: 150000,
  loan_int_rate: 11.5,
  person_home_ownership: 'RENT',
  cb_person_default_on_file: 'N',
  loan_intent: 'PERSONAL',
  loan_grade: 'B'
};

const PRESETS = {
  prime: {
    person_age: 34,
    person_income: 1200000,
    person_emp_length: 8,
    cb_person_cred_hist_length: 7,
    loan_amnt: 250000,
    loan_int_rate: 9.5,
    person_home_ownership: 'MORTGAGE',
    cb_person_default_on_file: 'N',
    loan_intent: 'HOMEIMPROVEMENT',
    loan_grade: 'A'
  },
  moderate: {
    person_age: 29,
    person_income: 550000,
    person_emp_length: 4,
    cb_person_cred_hist_length: 4,
    loan_amnt: 160000,
    loan_int_rate: 12.8,
    person_home_ownership: 'RENT',
    cb_person_default_on_file: 'N',
    loan_intent: 'PERSONAL',
    loan_grade: 'B'
  },
  high_risk: {
    person_age: 22,
    person_income: 220000,
    person_emp_length: 1,
    cb_person_cred_hist_length: 1,
    loan_amnt: 200000,
    loan_int_rate: 18.5,
    person_home_ownership: 'RENT',
    cb_person_default_on_file: 'Y',
    loan_intent: 'VENTURE',
    loan_grade: 'E'
  }
};

const STEPS = [
  { t: 'Applicant', h: 'Applicant Profile', d: 'Personal background and financial status', k: ['person_age', 'person_income', 'person_emp_length', 'person_home_ownership'] },
  { t: 'Credit', h: 'Bureau & History', d: 'Credit bureau records and risk rating', k: ['cb_person_cred_hist_length', 'cb_person_default_on_file', 'loan_grade'] },
  { t: 'Loan Request', h: 'Loan Parameters', d: 'Requested capital, interest, and terms', k: ['loan_intent', 'loan_amnt', 'loan_int_rate'] }
];

const GRADE_COL = ['#5ad8ff', '#5debb0', '#aee668', '#f2cb7a', '#f89e5b', '#f56c52', '#ff5252'];
let step = 0;
let result = null;
let busy = false;

const ratio = () => (V.person_income > 0 ? V.loan_amnt / V.person_income : 0);

/* ---------- Audio Synthesizer (Web Audio API) ---------- */
function playAudio(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'approved') {
      // Harmonic chord
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.35);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.6);
    } else if (type === 'flagged') {
      // Alert buzz
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(280.0, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(220.0, ctx.currentTime + 0.35);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } else if (type === 'click') {
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      gain.gain.setValueAtTime(0.03, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.08);
    }
  } catch (_) {}
}

/* ---------- HTML Renderers ---------- */
function sliderHTML(k) {
  const [l, u, mn, mx, st, hmn, hmx] = S[k];
  const p = Math.min(1, Math.max(0, (V[k] - mn) / (mx - mn))) * 100;
  return `
    <div class="fld">
      <div class="fh">
        <label for="n_${k}">${l}</label>
        <span class="val">
          <input id="n_${k}" data-n="${k}" type="number" min="${hmn}" max="${hmx}" step="${st}" value="${V[k]}">
          <em>${u}</em>
        </span>
      </div>
      <input type="range" aria-label="${l}" data-r="${k}" min="${mn}" max="${mx}" step="${st}" value="${Math.min(mx, Math.max(mn, V[k]))}" style="--p:${p}%">
    </div>`;
}

function chipsHTML(k) {
  const [l, o] = C[k];
  const isGrade = k === 'loan_grade';
  return `
    <div class="cl">${l}</div>
    <div class="chips ${isGrade ? 'grades' : ''}" data-c="${k}">
      ${o.map(([v, t], i) => `
        <button type="button" data-v="${v}" class="${V[k] === v ? 'on' : ''}" ${isGrade ? `style="--gc:${GRADE_COL[i]}"` : ''}>${t}</button>
      `).join('')}
    </div>`;
}

function meterHTML() {
  return `
    <div class="meter">
      <div class="t">
        <span>Loan-to-Income (LTI) Ratio</span>
        <b id="mv"></b>
      </div>
      <div class="bar"><i id="mb"></i></div>
    </div>`;
}

function updateMeter() {
  const m = $('mv');
  const hudLti = $('hudLti');
  const r = ratio();
  const pctStr = (r * 100).toFixed(1) + '%';
  if (hudLti) hudLti.textContent = pctStr;
  if (!m) return;
  m.textContent = pctStr;
  const b = $('mb');
  b.style.width = Math.min(100, (r / 2) * 100) + '%';
  b.style.background = r > 2 ? 'var(--ember)' : r > 1 ? '#f89e5b' : r > 0.5 ? 'var(--gold)' : 'var(--ice)';
  $('err').textContent = r > 2 ? '⚠️ High Risk: Requested loan exceeds 200% of annual income.' : '';
}

function render() {
  // Steps header
  $('steps').innerHTML = STEPS.map((s, i) => `
    <button type="button" class="${result ? 'done' : i === step ? 'on' : i < step ? 'done' : ''}" data-s="${i}">${s.t}</button>
  `).join('');

  const pane = $('pane');
  const nav = $('nav');
  pane.style.animation = 'none';
  void pane.offsetWidth;
  pane.style.animation = '';

  if (result) return renderResult();

  const s = STEPS[step];
  pane.innerHTML = `
    <h1>${s.h}</h1>
    <p class="lead">${s.d}</p>
    ${s.k.map(k => (S[k] ? sliderHTML(k) : chipsHTML(k))).join('')}
    ${step === 2 ? meterHTML() : ''}
  `;

  nav.innerHTML = `
    ${step > 0 ? '<button class="btn sm" data-a="back">Back</button>' : ''}
    ${step < 2 ? '<button class="btn p" data-a="next">Continue →</button>' : '<button class="btn p" data-a="run">Run Risk Assessment</button>'}
  `;

  $('err').textContent = '';
  updateMeter();
  scene.setStep(step);
}

function renderResult() {
  const r = result;
  const hi = r.default_prediction === 1;
  const c = hi ? 'var(--ember)' : 'var(--jade)';
  const badgeClass = hi ? 'high' : 'low';
  const badgeText = hi ? 'HIGH RISK · DECLINE' : 'LOW RISK · APPROVED';
  const probPct = r.default_probability * 100;
  const threshPct = r.threshold * 100;

  $('pane').innerHTML = `
    <div class="verdict-badge ${badgeClass}">${badgeText}</div>
    <div class="verdict" style="color:${c}">${r.Result}</div>
    <p class="lead">${hi ? 'Applicant exceeds institutional risk tolerance threshold. Manual underwriting review or rejection required.' : 'Applicant risk metrics meet all prime underwriting requirements. Qualified for standard disbursement.'}</p>
    <div class="pct"><span id="pn">0.0</span><small>%</small></div>
    <div class="track">
      <i id="tf" style="background:${c}"></i>
      <u style="left:${threshPct}%"><span>Threshold ${threshPct.toFixed(1)}%</span></u>
    </div>
    <div class="facts">
      <div>Safety Margin<b>${probPct - threshPct > 0 ? '+' : ''}${(probPct - threshPct).toFixed(2)} pts</b></div>
      <div>Loan vs Income<b>${(ratio() * 100).toFixed(0)}%</b></div>
      <div>Credit Grade<b>${V.loan_grade}</b></div>
      <div>Prior Default<b>${V.cb_person_default_on_file === 'Y' ? 'Yes' : 'No'}</b></div>
    </div>
  `;

  requestAnimationFrame(() => {
    $('tf').style.width = Math.min(100, probPct) + '%';
  });

  // Animated counter
  const t0 = performance.now();
  (function tick(now) {
    const progress = Math.min(1, (now - t0) / 1200);
    const eased = 1 - Math.pow(1 - progress, 3);
    const val = probPct * eased;
    $('pn').textContent = val.toFixed(1);
    if (progress < 1) requestAnimationFrame(tick);
  })(t0);

  $('nav').innerHTML = '<button class="btn p" data-a="edit">Modify & Re-assess</button>';
  scene.setResult(r.default_probability, hi);
}

/* ---------- Event Listeners ---------- */
const card = $('card');

card.addEventListener('input', e => {
  const n = e.target.dataset.n;
  const r = e.target.dataset.r;
  const k = n || r;
  if (!k) return;
  const val = parseFloat(e.target.value);
  if (isNaN(val)) return;
  V[k] = val;

  const rg = card.querySelector(`[data-r="${k}"]`);
  const nu = card.querySelector(`[data-n="${k}"]`);
  const [, , mn, mx] = S[k];
  if (r && nu) nu.value = val;
  if (n && rg) rg.value = Math.min(mx, Math.max(mn, val));
  if (rg) rg.style.setProperty('--p', Math.min(1, Math.max(0, (V[k] - mn) / (mx - mn))) * 100 + '%');

  updateMeter();
  scene.live();
});

card.addEventListener('click', e => {
  const c = e.target.closest('.chips button');
  if (c) {
    playAudio('click');
    V[c.parentNode.dataset.c] = c.dataset.v;
    c.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === c));
    scene.live();
    return;
  }

  const s = e.target.closest('[data-s]');
  if (s && !busy) {
    playAudio('click');
    result = null;
    step = parseInt(s.dataset.s, 10);
    render();
    return;
  }

  const a = e.target.closest('[data-a]');
  if (!a) return;
  const act = a.dataset.a;
  playAudio('click');

  if (act === 'next') {
    step++;
    render();
  } else if (act === 'back') {
    step--;
    render();
  } else if (act === 'edit') {
    result = null;
    step = 2;
    render();
  } else if (act === 'run') {
    run();
  }
});

// Presets bar clicks
$('presetsBar').addEventListener('click', e => {
  const btn = e.target.closest('.preset-btn');
  if (!btn || busy) return;
  const presetKey = btn.dataset.preset;
  if (PRESETS[presetKey]) {
    playAudio('click');
    V = { ...PRESETS[presetKey] };
    result = null;
    render();
    scene.live();
  }
});

/* ---------- Assessment API Invocation ---------- */
async function run() {
  const btn = card.querySelector('[data-a="run"]');
  const err = $('err');
  if (ratio() > 2) {
    updateMeter();
    return;
  }

  const payload = {
    person_age: Math.round(V.person_age),
    person_income: parseFloat(V.person_income),
    person_home_ownership: V.person_home_ownership,
    person_emp_length: parseFloat(V.person_emp_length),
    loan_intent: V.loan_intent,
    loan_grade: V.loan_grade,
    loan_amnt: parseFloat(V.loan_amnt),
    loan_int_rate: parseFloat(V.loan_int_rate),
    loan_percent_income: parseFloat(ratio().toFixed(4)),
    cb_person_default_on_file: V.cb_person_default_on_file,
    cb_person_cred_hist_length: Math.round(V.cb_person_cred_hist_length)
  };

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Computing Neural Risk…`;
  err.textContent = '';
  busy = true;
  scene.busy(true);

  try {
    const targetUrl = `${API_BASE}/predict`;
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    if (!text || text.trim() === '') {
      throw new Error(`Empty response from ${targetUrl} (HTTP ${res.status}). Verify FastAPI is running.`);
    }

    let d;
    try {
      d = JSON.parse(text);
    } catch (parseEx) {
      throw new Error(`Non-JSON response from server (HTTP ${res.status}): ${text.slice(0, 100)}`);
    }

    if (!res.ok) {
      const msg = typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail);
      throw new Error(msg || `Inference error (HTTP ${res.status})`);
    }

    result = d;
    busy = false;
    scene.busy(false);
    render();
    playAudio(d.default_prediction === 1 ? 'flagged' : 'approved');
  } catch (ex) {
    busy = false;
    scene.busy(false);
    btn.disabled = false;
    btn.textContent = 'Run Risk Assessment';
    err.textContent = ex.message || 'Connection error. Check backend server.';
  }
}

/* ---------- Health Monitor ---------- */
async function checkHealth() {
  const chip = $('chip');
  const hudApi = $('hudApi');
  const hudThreshold = $('hudThreshold');

  try {
    const base = await resolveApiBase();
    if (hudApi) hudApi.textContent = base.replace(/^https?:\/\//, '');

    const res = await fetch(`${base}/health`);
    if (!res.ok) throw new Error('Status ' + res.status);
    const h = await res.json();

    if (h.model_loaded) {
      chip.className = 'chip ok';
      $('chipTxt').textContent = `FastAPI Online · Port ${base.split(':').pop() || '80'}`;
      if (h.threshold && hudThreshold) {
        hudThreshold.textContent = `${(h.threshold * 100).toFixed(1)}%`;
      }
    } else {
      chip.className = 'chip bad';
      $('chipTxt').textContent = 'Server Online, Model Not Ready';
    }
  } catch (err) {
    chip.className = 'chip bad';
    $('chipTxt').textContent = 'Backend Offline · Run python main.py';
  }
}

/* ---------- 3D Three.js WebGL Scene ---------- */
const scene = (() => {
  const canvas = $('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const threeScene = new THREE.Scene();
  threeScene.fog = new THREE.FogExp2(0x05070e, 0.045);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(1.5, 0.4, 7);

  const GOLD = new THREE.Color('#f2cb7a');
  const ICE = new THREE.Color('#5ad8ff');
  const JADE = new THREE.Color('#36e2a0');
  const EMBER = new THREE.Color('#ff5252');

  const currentColor = ICE.clone();
  const targetColor = ICE.clone();

  const state = {
    expo: 0,
    expoTarget: 0.2,
    pulse: 0,
    busy: false,
    step: 0,
    isResult: false,
    spinSpeed: 0.18
  };

  // Particle Core System
  const particleCount = 6500;
  const positions = new Float32Array(particleCount * 3);
  const seeds = new Float32Array(particleCount);

  for (let i = 0; i < particleCount; i++) {
    const y = 1 - 2 * (i + 0.5) / particleCount;
    const radius = Math.sqrt(1 - y * y);
    const theta = i * 2.399963; // Golden ratio spiral
    positions[i * 3] = Math.cos(theta) * radius * 1.6;
    positions[i * 3 + 1] = y * 1.6;
    positions[i * 3 + 2] = Math.sin(theta) * radius * 1.6;
    seeds[i] = Math.random();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uExpo: { value: 0 },
      uPulse: { value: 0 },
      uColor: { value: currentColor }
    },
    vertexShader: `
      attribute float aSeed;
      uniform float uTime, uExpo, uPulse;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float wave = sin(p.x * 2.5 + uTime * 0.9) + sin(p.y * 3.5 - uTime * 0.7) + sin(p.z * 4.0 + uTime);
        p *= 1.0 + (0.04 + uExpo * 0.26) * wave + uPulse * 0.18 * sin(aSeed * 25.0 + uTime * 5.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (2.2 + aSeed * 2.0) * (300.0 / -mv.z);
        vAlpha = 0.4 + 0.6 * sin(aSeed * 30.0 + uTime * 1.2);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        if (r > 0.5) discard;
        float intensity = (1.0 - r * 2.0) * vAlpha;
        gl_FragColor = vec4(uColor, intensity);
      }
    `
  });

  const orb = new THREE.Points(geometry, material);
  const coreGroup = new THREE.Group();
  coreGroup.add(orb);
  threeScene.add(coreGroup);

  // Wireframe Core
  const icosahedron = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.9, 1),
    new THREE.MeshBasicMaterial({ color: currentColor, wireframe: true, transparent: true, opacity: 0.35 })
  );
  coreGroup.add(icosahedron);

  // Torus Rings
  const ringRadii = [2.2, 2.65, 3.1];
  const rings = ringRadii.map((r, i) => {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.006, 8, 160),
      new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.4 - i * 0.08 })
    );
    mesh.rotation.set(1.1 + i * 0.5, i * 0.6, 0);
    coreGroup.add(mesh);
    return mesh;
  });

  // Perspective Cyber Grid Floor
  const grid = new THREE.GridHelper(50, 70, 0xf2cb7a, 0x5ad8ff);
  grid.position.y = -2.8;
  grid.material.transparent = true;
  grid.material.opacity = 0.12;
  threeScene.add(grid);

  // Ambient Stardust Dust Particles
  const dustCount = 800;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount * 3; i++) {
    dustPos[i] = (Math.random() - 0.5) * 35;
  }
  const dustGeom = new THREE.BufferGeometry();
  dustGeom.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  threeScene.add(new THREE.Points(dustGeom, new THREE.PointsMaterial({ size: 0.03, color: 0x9eabbf, transparent: true, opacity: 0.5 })));

  // Mouse Parallax
  let mouseX = 0;
  let mouseY = 0;
  window.addEventListener('pointermove', e => {
    mouseX = e.clientX / window.innerWidth - 0.5;
    mouseY = e.clientY / window.innerHeight - 0.5;
  });

  function onResize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);
  onResize();

  const gradeIndex = () => 'ABCDEFG'.indexOf(V.loan_grade);

  const controls = {
    live() {
      state.expoTarget = Math.min(1, ratio());
      if (!state.isResult) {
        targetColor.copy(ICE).lerp(EMBER, (gradeIndex() / 6) * 0.85);
      }
      state.pulse = Math.max(state.pulse, 0.4);
    },
    setStep(idx) {
      state.step = idx;
      state.isResult = false;
      state.spinSpeed = 0.16 + idx * 0.1;
      controls.live();
    },
    busy(b) {
      state.busy = b;
    },
    setResult(prob, isHigh) {
      state.isResult = true;
      state.expoTarget = prob;
      targetColor.copy(isHigh ? EMBER : JADE);
      state.pulse = 1.3;
    }
  };

  const clock = new THREE.Clock();

  function animate() {
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    material.uniforms.uTime.value = t;

    const currentSpeed = state.busy ? 3.5 : state.isResult ? 0.08 : state.spinSpeed;
    orb.rotation.y += dt * currentSpeed;
    icosahedron.rotation.y -= dt * currentSpeed * 1.4;
    icosahedron.material.color.copy(currentColor);

    rings.forEach((r, i) => {
      r.rotation.z += dt * (0.12 + i * 0.08) * (state.busy ? 6 : 1);
    });

    state.expo += ((state.busy ? 0.45 : state.expoTarget) - state.expo) * dt * 2.5;
    material.uniforms.uExpo.value = state.expo;

    state.pulse *= Math.pow(0.25, dt);
    material.uniforms.uPulse.value = state.pulse;

    currentColor.lerp(state.busy ? GOLD : targetColor, dt * 3.2);

    const isMobile = window.innerWidth < 1024;
    const targetZ = isMobile ? 9.5 : state.isResult ? 5.6 : 7.0 - state.step * 0.4;
    const targetX = isMobile ? 0 : state.isResult ? 1.8 : 1.5;

    coreGroup.position.x += (targetX - coreGroup.position.x) * dt * 2.2;
    coreGroup.position.y += ((isMobile ? 1.4 : 0) + Math.sin(t * 0.7) * 0.1 - coreGroup.position.y) * dt * 2.5;

    camera.position.z += (targetZ - camera.position.z) * dt * 2.0;
    camera.position.x += (mouseX * 1.4 - camera.position.x) * dt * 2.2;
    camera.position.y += (-mouseY * 0.9 + 0.3 - camera.position.y) * dt * 2.2;
    camera.lookAt(0, 0, 0);

    renderer.render(threeScene, camera);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  return controls;
})();

/* ---------- Startup ---------- */
resolveApiBase().then(() => {
  render();
  checkHealth();
  setInterval(checkHealth, 8000);
});
