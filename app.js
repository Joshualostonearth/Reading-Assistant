/**
 * ReadEase — Reading Assistant for Reading Difficulty
 * app.js — Application logic
 *
 * Modules contained in this file:
 *  1.  App State              — Central state object
 *  2.  Passage Data           — Built-in reading passages
 *  3.  Screen Navigation      — showScreen()
 *  4.  Settings               — updateSetting(), setTheme()
 *  5.  Passage Selection      — buildPassageList()
 *  6.  Session Initialisation — initReading(), requestCamera(), skipCamera()
 *  7.  Calibration            — 9-point gaze calibration routine
 *  8.  Reading Screen Setup   — startReading()
 *  9.  Line Management        — setActiveLine(), addBehaviorLog()
 * 10.  Metrics UI             — updateMetricsUI()
 * 11.  Eye Tracking           — MediaPipe FaceMesh + iris landmark detection
 * 12.  Demo Gaze              — Mouse / automatic line advance fallback
 * 13.  Gaze Processing        — updateGaze(), mapGazeToLine(), mapGazeToWord()
 * 14.  Text-to-Speech (TTS)   — Web Speech API wrapper
 * 15.  Status Pill            — setStatusPill()
 * 16.  Webcam Preview         — toggleWebcamPreview()
 * 17.  Session End + Dashboard— endSession(), buildDashboard()
 * 18.  Export                 — exportReport()
 * 19.  Keyboard Shortcuts
 */

'use strict';

// =============================================================
//  1. APP STATE
//     Central object for all mutable application-level state.
// =============================================================
const appState = {
  // Visual settings
  theme: 'light',
  fontSize: '20px',
  lineHeight: '1.9',
  letterSpacing: '0.01em',
  showGazeDot: true,
  showGuide: true,

  // Audio settings
  autoRead: true,
  pausePronounce: true,
  speechRate: 1,
  selectedVoice: null,

  // Session
  selectedPassage: 0,
  useCamera: false,
  demoMode: false,
  cameraStream: null,

  // Gaze
  gazeX: 0,
  gazeY: 0,
  currentLine: -1,

  // Calibration
  calibrated: false,
  calibPoints: [],

  // MediaPipe handles
  faceMesh: null,
  mpCamera: null,
};

// =============================================================
//  2. PASSAGE DATA
//     Each passage contains title, metadata, and an array of
//     lines. Lines are the atomic units the eye tracker maps to.
// =============================================================
const passages = [
  {
    icon: '🐙',
    title: 'The Octopus',
    level: 'easy',
    meta: 'Nature · 120 words · Grade 2–3',
    lines: [
      'The octopus is one of the most fascinating animals in the ocean.',
      'It has eight long arms covered with round suckers that grip tightly.',
      'Octopuses are very clever and can solve simple puzzles to find food.',
      'They can squeeze through tiny gaps because they have no solid bones.',
      'When an octopus feels scared, it squirts a cloud of dark ink.',
      'The ink cloud confuses the attacker and gives the octopus time to escape.',
      'Some octopuses can change the colour of their skin in an instant.',
      'They use this ability to hide from predators or to communicate.',
      'Octopuses live alone and are mostly active at night when it is dark.',
      'Scientists believe they are among the most intelligent animals without a backbone.',
    ],
  },
  {
    icon: '🌍',
    title: 'Climate and Weather',
    level: 'medium',
    meta: 'Science · 180 words · Grade 4–6',
    lines: [
      'Climate and weather are two different things, though people often confuse them.',
      'Weather describes what is happening outside today — sunny, rainy, or windy.',
      'Climate, on the other hand, describes the typical weather patterns over many years.',
      'Different parts of the world have very different climates because of their location.',
      'Areas near the equator receive direct sunlight all year, making them warm.',
      'Regions near the poles receive sunlight at a steep angle and stay cold.',
      'Mountain areas can be cold even near the equator because of their altitude.',
      'Ocean currents also play a significant role in shaping the climate of coastal regions.',
      'For example, the Gulf Stream keeps parts of northwestern Europe surprisingly mild.',
      'Over the past century, human activities have begun to change Earth\'s climate.',
      'Burning fossil fuels releases carbon dioxide, which traps heat in the atmosphere.',
      'This warming effect is changing rainfall patterns and melting polar ice.',
      'Understanding climate science helps us prepare for and respond to these changes.',
    ],
  },
  {
    icon: '🚀',
    title: 'The First Moon Landing',
    level: 'hard',
    meta: 'History · 220 words · Grade 6–8',
    lines: [
      'On July 20, 1969, astronaut Neil Armstrong became the first human to walk on the Moon.',
      'Armstrong and his crewmate Buzz Aldrin landed their spacecraft on the lunar surface.',
      'Their colleague Michael Collins orbited above in the command module, waiting for their return.',
      'As Armstrong stepped onto the dusty grey surface, he said his now-famous words.',
      'He described the landing as "one small step for man, one giant leap for mankind."',
      'The mission, called Apollo 11, was the result of nearly a decade of preparation.',
      'In 1961, President Kennedy had challenged the nation to reach the Moon by 1970.',
      'Hundreds of thousands of scientists, engineers, and technicians worked to make it happen.',
      'The astronauts collected rock and soil samples to bring back to Earth for study.',
      'They also planted an American flag and set up scientific instruments on the surface.',
      'The entire mission was watched live on television by around 600 million people worldwide.',
      'Armstrong and Aldrin spent approximately two and a half hours outside the spacecraft.',
      'Returning to Earth safely, they splashed down in the Pacific Ocean on July 24.',
      'The Apollo 11 mission remains one of the greatest achievements in human history.',
    ],
  },
];

// =============================================================
//  3. SCREEN NAVIGATION
//     All major views are .screen divs. Only one is .active.
// =============================================================

/**
 * Show a named screen and hide all others.
 * @param {string} id - The id of the screen element to show.
 */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// =============================================================
//  4. SETTINGS
// =============================================================

/**
 * Update a typography CSS variable and save to appState.
 * @param {string} prop - appState key (e.g. 'fontSize')
 * @param {string} val  - CSS value (e.g. '22px')
 */
function updateSetting(prop, val) {
  appState[prop] = val;
  const cssVarMap = {
    fontSize:      '--font-size',
    lineHeight:    '--line-height',
    letterSpacing: '--letter-spacing',
  };
  if (cssVarMap[prop]) {
    document.documentElement.style.setProperty(cssVarMap[prop], val);
  }
}

/**
 * Switch between light / dark / high-contrast themes.
 * @param {'light'|'dark'|'hc'} t - Theme name.
 */
function setTheme(t) {
  appState.theme = t;
  document.body.className = (t === 'light') ? '' : t;

  // Update active state on theme toggle buttons
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('theme-' + t).classList.add('active');
}

// =============================================================
//  5. PASSAGE SELECTION
//     Renders clickable passage cards into #passage-list.
// =============================================================

/**
 * Render all passages as selectable cards.
 * Called once on page load.
 */
function buildPassageList() {
  const list = document.getElementById('passage-list');
  list.innerHTML = '';

  passages.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'passage-card' + (i === appState.selectedPassage ? ' selected' : '');

    card.onclick = () => {
      appState.selectedPassage = i;
      document.querySelectorAll('.passage-card').forEach((c, j) =>
        c.classList.toggle('selected', j === i)
      );
    };

    card.innerHTML = `
      <div class="passage-card-icon">${p.icon}</div>
      <div>
        <div class="passage-card-title">${p.title}</div>
        <div class="passage-card-meta">${p.meta}</div>
      </div>
      <span class="level-badge level-${p.level}">${p.level}</span>
    `;

    list.appendChild(card);
  });
}

// Build on load
buildPassageList();

// =============================================================
//  6. SESSION INITIALISATION
// =============================================================

/**
 * Entry point when the user clicks "Begin Reading".
 * Decides whether to request camera or go straight to reading.
 */
function initReading() {
  appState.useCamera = document.getElementById('use-camera-cb').checked;

  if (appState.useCamera && !appState.demoMode) {
    // Show the camera permission modal
    document.getElementById('modal-cam').style.display = 'flex';
  } else {
    startReading();
  }
}

/**
 * User dismissed the camera modal — run in demo mode instead.
 */
function skipCamera() {
  document.getElementById('modal-cam').style.display = 'none';
  appState.useCamera = false;
  appState.demoMode  = true;
  startReading();
}

/**
 * Request webcam access, then start calibration.
 * Falls back to demo mode if permission is denied.
 */
async function requestCamera() {
  document.getElementById('modal-cam').style.display = 'none';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    appState.cameraStream = stream;
    showScreen('screen-calibration');
    startCalibration();
  } catch (err) {
    console.warn('Camera access denied:', err);
    alert('Camera access denied. Running in demo mode.');
    appState.useCamera = false;
    appState.demoMode  = true;
    startReading();
  }
}

/**
 * Shortcut: start demo mode immediately from the welcome screen.
 */
function startDemoMode() {
  appState.demoMode         = true;
  appState.useCamera        = false;
  appState.selectedPassage  = 0;
  startReading();
}

// =============================================================
//  7. CALIBRATION SYSTEM
//     9 gaze calibration points arranged in a 3×3 grid.
//     Each click collects an eye-position → screen-coordinate
//     pair, then a simple linear offset correction is derived.
// =============================================================

/** Fractional grid positions [x, y] 0..1 */
const CALIB_GRID = [
  [0.1, 0.1], [0.5, 0.1], [0.9, 0.1],
  [0.1, 0.5], [0.5, 0.5], [0.9, 0.5],
  [0.1, 0.9], [0.5, 0.9], [0.9, 0.9],
];

let calibIndex = 0;
const calibData = []; // Array of { sx, sy, ex, ey } collected samples
let calibModel  = null; // { dx, dy } screen-space offset correction

/**
 * Begin the calibration routine.
 * Attaches the webcam stream to the preview video element.
 */
function startCalibration() {
  calibIndex = 0;
  calibData.length = 0;

  // Remove any leftover dots from a previous run
  document.querySelectorAll('.calib-dot').forEach(d => d.remove());

  // Show webcam in the corner preview
  const vid = document.getElementById('calib-video');
  vid.srcObject = appState.cameraStream;

  showNextCalibDot();
}

/**
 * Show the next calibration dot.
 * When all dots are clicked, finishes calibration.
 */
function showNextCalibDot() {
  if (calibIndex >= CALIB_GRID.length) {
    finishCalibration();
    return;
  }

  const [fx, fy] = CALIB_GRID[calibIndex];
  const x = fx * window.innerWidth;
  const y = fy * window.innerHeight;

  const dot = document.createElement('div');
  dot.className = 'calib-dot';
  dot.style.left = x + 'px';
  dot.style.top  = y + 'px';
  dot.id = 'calib-dot-current';
  dot.onclick = () => collectCalibPoint(x, y, dot);

  document.getElementById('screen-calibration').appendChild(dot);

  // Update progress bar
  const pct = Math.round((calibIndex / CALIB_GRID.length) * 100);
  document.getElementById('calib-bar').style.width    = pct + '%';
  document.getElementById('calib-status').textContent =
    `Point ${calibIndex + 1} of ${CALIB_GRID.length} — Click the dot`;
}

/**
 * Record a calibration sample when the user clicks a dot.
 * @param {number} sx - Screen X of the dot.
 * @param {number} sy - Screen Y of the dot.
 * @param {HTMLElement} dot - The dot element (for visual feedback).
 */
function collectCalibPoint(sx, sy, dot) {
  // Use current raw gaze estimate (or screen position as fallback)
  calibData.push({
    sx, sy,
    ex: appState.gazeX || sx,
    ey: appState.gazeY || sy,
  });

  dot.classList.add('collected');

  // Brief pause before showing next dot
  setTimeout(() => {
    dot.remove();
    calibIndex++;
    showNextCalibDot();
  }, 400);
}

/**
 * Called when all calibration points have been collected.
 * Computes the correction model and transitions to reading.
 */
function finishCalibration() {
  document.getElementById('calib-bar').style.width    = '100%';
  document.getElementById('calib-status').textContent = 'Calibration complete! Starting reading…';

  appState.calibrated = true;
  computeCalibModel();

  setTimeout(() => startReading(), 1000);
}

/**
 * Compute a simple mean-offset calibration model.
 * More sophisticated approaches (polynomial regression, etc.) could
 * replace this for higher accuracy.
 */
function computeCalibModel() {
  if (calibData.length < 3) return;

  const dxArr = calibData.map(d => d.sx - d.ex);
  const dyArr = calibData.map(d => d.sy - d.ey);

  calibModel = {
    dx: dxArr.reduce((a, b) => a + b, 0) / dxArr.length,
    dy: dyArr.reduce((a, b) => a + b, 0) / dyArr.length,
  };
}

/**
 * Apply the calibration offset to a raw gaze coordinate.
 * @param {number} rawX
 * @param {number} rawY
 * @returns {{ x: number, y: number }}
 */
function mapGazeToScreen(rawX, rawY) {
  if (!calibModel) return { x: rawX, y: rawY };
  return { x: rawX + calibModel.dx, y: rawY + calibModel.dy };
}

// =============================================================
//  8. READING SCREEN SETUP
//     Builds the passage DOM, resets session, wires everything.
// =============================================================

/** Live reading session data */
const session = {
  startTime: null,
  wordsRead: 0,
  fixations: 0,
  regressions: 0,
  pauses: 0,
  lineTimings: [],       // seconds spent on each line
  currentLineStart: null,
  lastLine: -1,
  gazeSamples: [],
  fixationTimer: null,
  pauseTimer: null,
  behaviors: [],         // Array of { type, text, time }
  pauseWordTimer: null,
};

/**
 * Main entry point for beginning a reading session.
 * Builds the passage DOM, initialises the session state,
 * and starts eye tracking or demo mode.
 */
function startReading() {
  const p = passages[appState.selectedPassage];

  // Populate topbar and passage header
  document.getElementById('reading-title').textContent      = p.title;
  document.getElementById('passage-title-text').textContent = p.title;
  document.getElementById('passage-meta').textContent       = p.meta;

  // Build the reading lines, wrapping each word in a <span> for TTS highlighting
  const container = document.getElementById('passage-lines');
  container.innerHTML = '';

  p.lines.forEach((line, i) => {
    const div = document.createElement('div');
    div.className = 'reading-line';
    div.dataset.lineIndex = i;

    // Wrap each word in a span.word for word-level features
    div.innerHTML = line.split(' ').map((word, wi) =>
      `<span class="word" data-word="${wi}">${word} </span>`
    ).join('');

    // Allow manual line selection by clicking
    div.onclick = () => setActiveLine(i, true);

    container.appendChild(div);
  });

  // ── Reset session state ──
  session.startTime        = Date.now();
  session.wordsRead        = 0;
  session.fixations        = 0;
  session.regressions      = 0;
  session.pauses           = 0;
  session.lineTimings      = Array(p.lines.length).fill(0);
  session.currentLineStart = Date.now();
  session.lastLine         = -1;
  session.behaviors        = [];
  session.gazeSamples      = [];

  // Navigate to the reading screen
  showScreen('screen-reading');

  // Initialise TTS voices
  initTTS();

  // Start eye tracking or demo
  if (appState.useCamera && appState.cameraStream) {
    initEyeTracking();
  } else {
    initDemoGaze();
  }

  // Tick metrics display every second
  setInterval(updateMetricsUI, 1000);

  // Activate the first line after a short delay
  setTimeout(() => setActiveLine(0, appState.autoRead), 500);
}

// =============================================================
//  9. LINE MANAGEMENT
//     Core logic that responds to gaze or clicks to advance
//     the highlighted line and log behavioural events.
// =============================================================

/**
 * Set the currently active (highlighted) reading line.
 * Records regressions, timing, fixations, and triggers TTS.
 *
 * @param {number}  idx    - Zero-based line index.
 * @param {boolean} speak  - Whether to read the line aloud.
 */
function setActiveLine(idx, speak = false) {
  const lines = document.querySelectorAll('.reading-line');
  if (idx < 0 || idx >= lines.length) return;

  // ── Detect regression (reading backwards) ──
  if (idx < appState.currentLine && appState.currentLine >= 0) {
    session.regressions++;
    addBehaviorLog('reg', `Regressed to line ${idx + 1}`);
  }

  // ── Record time spent on the previous line ──
  if (session.currentLineStart && appState.currentLine >= 0) {
    const elapsed = (Date.now() - session.currentLineStart) / 1000;
    session.lineTimings[appState.currentLine] = elapsed;
  }

  // ── Update DOM highlighting ──
  lines.forEach(l => l.classList.remove('active'));
  lines[idx].classList.add('active');

  // Scroll the active line into view smoothly
  lines[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });

  // ── Update state ──
  appState.currentLine       = idx;
  session.currentLineStart   = Date.now();
  session.lastLine           = idx;
  session.fixations++;

  addBehaviorLog('fix', `Fixation on line ${idx + 1}`);

  // Update metrics panel current-line display
  document.getElementById('m-line').textContent = idx + 1;

  // Estimate cumulative words read
  const p = passages[appState.selectedPassage];
  session.wordsRead = p.lines.slice(0, idx + 1).join(' ').split(' ').length;

  // ── Read aloud if enabled ──
  if (speak && appState.autoRead) speakLine(idx);

  // ── Pause detection ──
  // If gaze stays on the same line for > 4 seconds, log a long pause.
  clearTimeout(session.pauseTimer);
  session.pauseTimer = setTimeout(() => {
    session.pauses++;
    addBehaviorLog('pause', `Long pause on line ${idx + 1}`);
  }, 4000);
}

/**
 * Add an entry to the live behaviour log panel.
 * Types: 'fix' (fixation) | 'reg' (regression) | 'pause'
 *
 * @param {'fix'|'reg'|'pause'} type
 * @param {string} text - Human-readable description.
 */
function addBehaviorLog(type, text) {
  session.behaviors.push({ type, text, time: Date.now() });

  const log     = document.getElementById('behavior-log');
  const elapsed = Math.round((Date.now() - session.startTime) / 1000);
  const mm      = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss      = String(elapsed % 60).padStart(2, '0');

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML =
    `<span class="log-time">${mm}:${ss}</span>` +
    `<span class="log-badge log-${type}">${type}</span>` +
    `<span>${text}</span>`;

  log.prepend(entry);

  // Cap at 30 entries to avoid unbounded growth
  while (log.children.length > 30) log.removeChild(log.lastChild);
}

// =============================================================
// 10. METRICS UI
//     Updates the side-panel stats every second.
// =============================================================
function updateMetricsUI() {
  if (!session.startTime) return;

  const elapsed = Math.round((Date.now() - session.startTime) / 1000);
  const mm      = Math.floor(elapsed / 60);
  const ss      = elapsed % 60;

  document.getElementById('m-time').textContent = mm + ':' + String(ss).padStart(2, '0');

  // Calculate WPM after the first 5 seconds
  if (elapsed > 5) {
    const wpm = Math.round((session.wordsRead / elapsed) * 60);
    document.getElementById('m-wpm').textContent     = wpm;
    document.getElementById('m-wpm-bar').style.width = Math.min(100, (wpm / 200) * 100) + '%';
  }

  document.getElementById('m-fix').textContent = session.fixations;
  document.getElementById('m-reg').textContent = session.regressions;
}

// =============================================================
// 11. EYE TRACKING  —  MediaPipe FaceMesh + Iris Landmarks
//
//     MediaPipe FaceMesh with refineLandmarks:true exposes 478
//     landmarks including iris keypoints. We use the iris centre
//     position relative to the eye corners to estimate gaze.
//
//     Landmark indices:
//       Left iris:  469–472  (after refinement)
//       Right iris: 474–477
//       Left eye outer corner:  33
//       Left eye inner corner: 133
// =============================================================

const LEFT_IRIS        = [469, 470, 471, 472];
const RIGHT_IRIS       = [474, 475, 476, 477];
const LEFT_EYE_OUTER   = 33;
const LEFT_EYE_INNER   = 133;

/**
 * Set up MediaPipe FaceMesh and the camera loop.
 * Falls back to demo gaze if MediaPipe fails to load.
 */
async function initEyeTracking() {
  const vidEl    = document.getElementById('reading-video');
  const preview  = document.getElementById('webcam-preview');
  const toggleBtn = document.getElementById('toggle-cam-btn');

  // Attach the camera stream to the preview element
  vidEl.srcObject    = appState.cameraStream;
  preview.style.display   = 'block';
  toggleBtn.style.display  = 'block';

  // Show loading state
  document.getElementById('status-dot').className    = 'status-dot warn';
  document.getElementById('status-text').textContent = 'Loading…';

  try {
    // Initialise FaceMesh
    const faceMesh = new FaceMesh({
      locateFile: file =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,         // Enables iris keypoints
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    faceMesh.onResults(onFaceMeshResults);
    appState.faceMesh = faceMesh;

    // Start the camera frame loop
    const cam = new Camera(vidEl, {
      onFrame: async () => { await faceMesh.send({ image: vidEl }); },
      width:  640,
      height: 480,
    });

    await cam.start();
    appState.mpCamera = cam;

    // Eye tracking is live
    document.getElementById('status-dot').className    = 'status-dot active';
    document.getElementById('status-text').textContent = 'Eye Tracking';
    setStatusPill(true);

  } catch (err) {
    console.warn('MediaPipe unavailable, falling back to demo mode:', err);
    document.getElementById('status-dot').className    = 'status-dot';
    document.getElementById('status-text').textContent = 'Demo Mode';
    initDemoGaze();
  }
}

/**
 * Calculate the centroid of a set of landmark points.
 * @param {{ x: number, y: number }[]} pts
 * @returns {{ x: number, y: number }}
 */
function avgPoints(pts) {
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}

/**
 * MediaPipe FaceMesh results callback.
 * Runs on every webcam frame and extracts iris positions.
 *
 * @param {Object} results - FaceMesh results object.
 */
function onFaceMeshResults(results) {
  if (!results.multiFaceLandmarks || !results.multiFaceLandmarks.length) return;

  const lm   = results.multiFaceLandmarks[0]; // First face only
  const canv = document.getElementById('reading-canvas');
  const ctx  = canv.getContext('2d');
  canv.width  = 160;
  canv.height = 120;

  // Draw iris dots on the mini preview canvas for visual feedback
  ctx.clearRect(0, 0, 160, 120);
  ctx.fillStyle = 'rgba(224, 90, 43, 0.8)';
  LEFT_IRIS.forEach(i => {
    const p = lm[i];
    ctx.beginPath();
    ctx.arc(p.x * 160, p.y * 120, 2, 0, Math.PI * 2);
    ctx.fill();
  });

  // Compute iris centre coordinates (normalised 0..1)
  const leftIrisCenter  = avgPoints(LEFT_IRIS.map(i => lm[i]));

  // Estimate horizontal gaze by how far the iris is from the outer eye corner
  // relative to the total eye width (0 = looking hard left, 1 = looking hard right)
  const eyeOuterLandmark = lm[LEFT_EYE_OUTER];
  const eyeInnerLandmark = lm[LEFT_EYE_INNER];
  const eyeWidth = Math.abs(eyeInnerLandmark.x - eyeOuterLandmark.x);
  // (irisOffset not used directly here but available for word-level mapping)
  // const irisOffset = (leftIrisCenter.x - eyeOuterLandmark.x) / eyeWidth;

  // Map normalised landmark coords to screen pixels.
  // The webcam image is mirrored horizontally (scaleX(-1) in CSS), so we invert x.
  const rawX = (1 - leftIrisCenter.x) * window.innerWidth;
  const rawY = (leftIrisCenter.y + 0.1) * window.innerHeight * 2;

  const mapped = mapGazeToScreen(rawX, rawY);
  updateGaze(mapped.x, mapped.y);
}

// =============================================================
// 12. DEMO GAZE  —  Automatic line advance + mouse tracking
//     Used when no camera is available (or when requested).
//     Simulates a plausible reading session by stepping through
//     lines at a pace proportional to their character length.
// =============================================================

let demoGazeInterval = null;
let demoLineIdx      = 0;

/**
 * Start demo gaze mode.
 * Automatically advances through lines with a reading-paced delay.
 * Mouse movement overrides the automatic gaze position.
 */
function initDemoGaze() {
  setStatusPill(false);
  document.getElementById('status-text').textContent = 'Demo Mode';

  const p = passages[appState.selectedPassage];
  demoLineIdx = 0;

  function advanceLine() {
    if (demoLineIdx < p.lines.length) {
      setActiveLine(demoLineIdx, appState.autoRead);

      // Move simulated gaze to a natural position within the line
      const lineEl = document.querySelectorAll('.reading-line')[demoLineIdx];
      if (lineEl) {
        const rect = lineEl.getBoundingClientRect();
        const cx   = rect.left + rect.width  * 0.3 + Math.random() * rect.width * 0.4;
        const cy   = rect.top  + rect.height / 2;
        updateGaze(cx, cy);
      }

      demoLineIdx++;

      // Delay proportional to line length (longer lines take more time)
      const delay = 3000 + p.lines[demoLineIdx - 1].length * 35;
      demoGazeInterval = setTimeout(advanceLine, delay);
    }
  }

  // Start after a brief pause to let the UI settle
  setTimeout(advanceLine, 1500);

  // Allow mouse to override gaze position for interactive testing
  document.getElementById('screen-reading').addEventListener('mousemove', e => {
    updateGaze(e.clientX, e.clientY);
  });
}

// =============================================================
// 13. GAZE PROCESSING
//     Raw gaze coordinates are smoothed, then mapped to reading
//     lines and optionally to individual words.
// =============================================================

let gazeHistory = [];
const GAZE_SMOOTHING = 0.25; // Exponential moving average weight

/**
 * Receive a new raw gaze coordinate, apply smoothing,
 * update the gaze-dot overlay, and map to line/word.
 *
 * @param {number} rawX - Raw screen X coordinate.
 * @param {number} rawY - Raw screen Y coordinate.
 */
function updateGaze(rawX, rawY) {
  // Exponential moving average smoothing to reduce jitter
  appState.gazeX = appState.gazeX * (1 - GAZE_SMOOTHING) + rawX * GAZE_SMOOTHING;
  appState.gazeY = appState.gazeY * (1 - GAZE_SMOOTHING) + rawY * GAZE_SMOOTHING;

  // Maintain a short history for potential fixation detection
  gazeHistory.push({ x: appState.gazeX, y: appState.gazeY, t: Date.now() });
  if (gazeHistory.length > 30) gazeHistory.shift();

  // Update the floating gaze-dot indicator
  if (appState.showGazeDot) {
    const dot = document.getElementById('gaze-dot');
    dot.style.display = 'block';
    dot.style.left    = appState.gazeX + 'px';
    dot.style.top     = appState.gazeY + 'px';
  }

  // Map smoothed gaze to a reading line (and optionally a word)
  mapGazeToLine(appState.gazeX, appState.gazeY);
}

/**
 * Determine which reading line the gaze Y coordinate falls within.
 * Uses bounding-box hit testing against each .reading-line element.
 *
 * @param {number} gx - Smoothed gaze X (not used for line, but for word).
 * @param {number} gy - Smoothed gaze Y.
 */
function mapGazeToLine(gx, gy) {
  const lines = document.querySelectorAll('.reading-line');

  for (let i = 0; i < lines.length; i++) {
    const rect = lines[i].getBoundingClientRect();

    if (gy >= rect.top - 10 && gy <= rect.bottom + 10) {
      // Only call setActiveLine if we've moved to a new line
      if (i !== appState.currentLine) {
        setActiveLine(i, appState.autoRead);
      }

      // Optional: word-level mapping for pause-pronunciation
      if (appState.pausePronounce) {
        mapGazeToWord(lines[i], gx);
      }
      break;
    }
  }
}

let wordHoverTimer = null;
let lastWordEl     = null;

/**
 * Detect which word the gaze X coordinate is over within a line.
 * If the gaze lingers on the same word for > 2.5 s, pronounce it.
 *
 * @param {HTMLElement} lineEl - The active .reading-line element.
 * @param {number}      gx     - Smoothed gaze X.
 */
function mapGazeToWord(lineEl, gx) {
  const words = lineEl.querySelectorAll('.word');

  for (const w of words) {
    const r = w.getBoundingClientRect();

    if (gx >= r.left && gx <= r.right) {
      if (w !== lastWordEl) {
        // Gaze moved to a new word — reset the hover timer
        clearTimeout(wordHoverTimer);
        lastWordEl = w;

        wordHoverTimer = setTimeout(() => {
          const text = w.textContent.trim().replace(/[^a-zA-Z'-]/g, '');
          if (text.length > 3) {
            // Pronounce the word and briefly highlight it
            speakWord(text);
            w.classList.add('current-word');
            setTimeout(() => w.classList.remove('current-word'), 2000);
          }
        }, 2500);
      }
      break;
    }
  }
}

// =============================================================
// 14. TEXT-TO-SPEECH (TTS)
//     Wraps the Web Speech API (SpeechSynthesis).
//     Provides line reading, word pronunciation, and word-level
//     boundary highlighting via the SpeechSynthesisUtterance API.
// =============================================================

let voices    = [];
let utterance = null;

/**
 * Initialise TTS by loading available voices.
 * Populates the voice <select> dropdown and preselects English.
 */
function initTTS() {
  if (!('speechSynthesis' in window)) return;

  function loadVoices() {
    voices = window.speechSynthesis.getVoices();

    const sel = document.getElementById('voice-select');
    sel.innerHTML = '';

    voices.forEach((v, i) => {
      const opt = document.createElement('option');
      opt.value       = i;
      opt.textContent = `${v.name} (${v.lang})`;
      sel.appendChild(opt);
    });

    // Prefer the first English voice
    const engIdx = voices.findIndex(v => v.lang.startsWith('en'));
    if (engIdx >= 0) {
      sel.value               = engIdx;
      appState.selectedVoice  = voices[engIdx];
    }
  }

  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

/**
 * Update the selected TTS voice when the dropdown changes.
 * @param {string|number} idx - Index into the voices array.
 */
function selectVoice(idx) {
  appState.selectedVoice = voices[idx] || null;
}

/**
 * Read a specific passage line aloud.
 * @param {number} idx - Line index.
 */
function speakLine(idx) {
  const p = passages[appState.selectedPassage];
  if (!p || idx >= p.lines.length) return;
  speak(p.lines[idx]);
}

/** Read the currently highlighted line aloud. */
function speakCurrentLine() {
  speakLine(appState.currentLine >= 0 ? appState.currentLine : 0);
}

/**
 * Pronounce a single word (for pause-triggered pronunciation).
 * @param {string} word
 */
function speakWord(word) {
  speak(word);
}

/**
 * Core TTS function. Creates a SpeechSynthesisUtterance,
 * attaches word-boundary highlighting, and starts speaking.
 *
 * @param {string} text - Text to synthesise.
 */
function speak(text) {
  if (!('speechSynthesis' in window)) return;

  stopSpeech(); // Cancel any in-progress speech

  utterance       = new SpeechSynthesisUtterance(text);
  utterance.rate  = appState.speechRate;
  utterance.pitch = 1;

  if (appState.selectedVoice) utterance.voice = appState.selectedVoice;

  // ── Word boundary event → highlight the spoken word ──
  utterance.onboundary = (e) => {
    if (e.name !== 'word') return;

    const lineEl = document.querySelectorAll('.reading-line')[appState.currentLine];
    if (!lineEl) return;

    const wordSpans = lineEl.querySelectorAll('.word');
    const fullText  = passages[appState.selectedPassage].lines[appState.currentLine];

    // Derive word index from the character offset provided by the event
    const soFar   = fullText.substring(0, e.charIndex);
    const wordIdx = soFar.split(' ').length - 1;

    wordSpans.forEach((w, i) => {
      w.classList.remove('spoken', 'current-word');
      if (i < wordIdx)  w.classList.add('spoken');
      if (i === wordIdx) w.classList.add('current-word');
    });
  };

  // ── Clear highlighting when speech ends ──
  utterance.onend = () => {
    const lineEl = document.querySelectorAll('.reading-line')[appState.currentLine];
    if (lineEl) {
      lineEl.querySelectorAll('.word').forEach(w =>
        w.classList.remove('spoken', 'current-word')
      );
    }
  };

  window.speechSynthesis.speak(utterance);
}

/** Cancel any active speech synthesis. */
function stopSpeech() {
  window.speechSynthesis.cancel();
}

/**
 * Update TTS playback speed.
 * @param {number}      rate - Speech rate multiplier (e.g. 0.7, 1, 1.3).
 * @param {HTMLElement} btn  - The clicked speed button (for .active styling).
 */
function setSpeed(rate, btn) {
  appState.speechRate = rate;
  document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

/** Read the entire current passage as a single utterance. */
function readFullPassage() {
  const p = passages[appState.selectedPassage];
  speak(p.lines.join('. '));
}

// =============================================================
// 15. STATUS PILL
// =============================================================

/**
 * Update the eye-tracking status pill in the reading topbar.
 * @param {boolean} active - Whether eye tracking is live.
 */
function setStatusPill(active) {
  document.getElementById('status-dot').className =
    'status-dot' + (active ? ' active' : '');
}

// =============================================================
// 16. WEBCAM PREVIEW TOGGLE
// =============================================================

let camVisible = true;

/** Toggle the webcam preview window visibility. */
function toggleWebcamPreview() {
  camVisible = !camVisible;
  document.getElementById('webcam-preview').style.display  = camVisible ? 'block' : 'none';
  document.getElementById('toggle-cam-btn').textContent     = camVisible ? 'Hide cam' : 'Show cam';
}

// =============================================================
// 17. SESSION END + DASHBOARD
//     Stops all active processes, computes summary statistics,
//     and renders the post-session dashboard.
// =============================================================

/**
 * End the reading session:
 * stop speech, stop gaze/camera, hide gaze dot, show dashboard.
 */
function endSession() {
  stopSpeech();
  clearTimeout(demoGazeInterval);

  // Stop MediaPipe camera if running
  if (appState.mpCamera) {
    try { appState.mpCamera.stop(); } catch (e) { /* ignore */ }
  }

  document.getElementById('gaze-dot').style.display = 'none';

  buildDashboard();
  showScreen('screen-dashboard');
}

/**
 * Compute all session statistics and render the dashboard UI.
 * Includes: summary cards, speed-per-line chart,
 *           heuristic difficulty indicator, and insight suggestions.
 */
function buildDashboard() {
  const p       = passages[appState.selectedPassage];
  const elapsed = Math.round((Date.now() - session.startTime) / 1000);
  const mm      = Math.floor(elapsed / 60);
  const ss      = elapsed % 60;
  const wpm     = elapsed > 5 ? Math.round((session.wordsRead / elapsed) * 60) : 0;

  document.getElementById('dash-subtitle').textContent =
    `"${p.title}" · ${mm}m ${ss}s session`;

  // ── Summary stat cards ──
  const cards = [
    { icon: '⏱', val: mm + ':' + String(ss).padStart(2, '0'), label: 'Total Time'    },
    { icon: '📖', val: wpm || '—',                             label: 'Words / Min'   },
    { icon: '👁', val: session.fixations,                      label: 'Fixations'     },
    { icon: '↩', val: session.regressions,                    label: 'Regressions'   },
    { icon: '⏸', val: session.pauses,                         label: 'Long Pauses'   },
    { icon: '📝', val: p.lines.length,                         label: 'Lines Read'    },
  ];

  const grid = document.getElementById('dash-grid');
  grid.innerHTML = '';
  cards.forEach(c => {
    const d = document.createElement('div');
    d.className = 'dash-card';
    d.innerHTML =
      `<div class="dash-card-icon">${c.icon}</div>` +
      `<div class="dash-card-val">${c.val}</div>`   +
      `<div class="dash-card-label">${c.label}</div>`;
    grid.appendChild(d);
  });

  // ── Reading speed bar chart (time per line) ──
  const chart   = document.getElementById('speed-chart');
  chart.innerHTML = '';

  const timings = session.lineTimings.filter(t => t > 0);
  const maxT    = Math.max(...timings, 1);

  timings.forEach((t, i) => {
    const pct = Math.max(4, (t / maxT) * 100);
    const g   = document.createElement('div');
    g.className = 'bar-group';
    g.innerHTML =
      `<div class="bar" style="height:${pct}%"></div>` +
      `<div class="bar-label">L${i + 1}</div>`;
    chart.appendChild(g);
  });

  // ── Difficulty score (heuristic ML-like calculation) ──
  //
  // Feature vector:
  //   regRate   = regressions / fixations  (0..1)
  //   pauseRate = pauses / fixations        (0..1)
  //   speedScore = WPM / 150 clamped       (0..1, higher = easier)
  //
  // Score = weighted sum of difficulty signals (0..100)
  //
  // IMPORTANT: This is a heuristic pattern indicator only.
  // It does NOT constitute a clinical or educational diagnosis.

  const regRate    = session.fixations > 0 ? session.regressions / session.fixations : 0;
  const pauseRate  = session.fixations > 0 ? session.pauses      / session.fixations : 0;
  const speedScore = wpm > 0 ? Math.min(1, wpm / 150) : 0.5;

  const diffScore = Math.min(100, Math.round(
    (regRate   * 40) +
    (pauseRate * 35) +
    ((1 - speedScore) * 25)
  ));

  document.getElementById('diff-fill').style.width = diffScore + '%';
  document.getElementById('diff-label').textContent =
    diffScore < 30
      ? `Fluent reading pattern detected (score: ${diffScore}/100)`
      : diffScore < 60
        ? `Developing reader — some pauses noted (score: ${diffScore}/100)`
        : `Needs additional support — frequent pauses & regressions (score: ${diffScore}/100)`;

  // ── Personalised insights ──
  const insights = [];

  if (wpm > 120) {
    insights.push({
      icon: '🎉',
      text: `<span class="insight-strong">Strong reading pace</span> — ${wpm} WPM is above average for this level.`,
    });
  }
  if (wpm > 0 && wpm < 60) {
    insights.push({
      icon: '🐢',
      text: `<span class="insight-strong">Slower pace detected</span> — Reading at ${wpm} WPM. Practising with shorter passages may help build confidence.`,
    });
  }
  if (session.regressions > 3) {
    insights.push({
      icon: '↩',
      text: `<span class="insight-strong">${session.regressions} regressions</span> observed. This may indicate unfamiliar vocabulary or difficulty tracking lines. Try larger font or line spacing in Settings.`,
    });
  }
  if (session.pauses > 4) {
    insights.push({
      icon: '⏸',
      text: `<span class="insight-strong">${session.pauses} long pauses</span> recorded. The audio pronunciation feature can help when tricky words cause hesitation.`,
    });
  }
  if (session.regressions <= 1) {
    insights.push({
      icon: '✅',
      text: `<span class="insight-strong">Excellent line tracking</span> — very few regressions suggest good visual flow.`,
    });
  }

  // Always include a general tip
  insights.push({
    icon: '💡',
    text: `<span class="insight-strong">Suggestion:</span> Try adjusting font size or line spacing in Settings to find your most comfortable reading layout.`,
  });

  const insightList = document.getElementById('insights-list');
  insightList.innerHTML = '';

  insights.forEach(ins => {
    const d = document.createElement('div');
    d.className = 'insight';
    d.innerHTML =
      `<div class="insight-icon">${ins.icon}</div>` +
      `<div class="insight-text">${ins.text}</div>`;
    insightList.appendChild(d);
  });
}

// =============================================================
// 18. EXPORT
//     Saves a JSON session report to the user's downloads folder.
// =============================================================

/**
 * Build a session report object and trigger a JSON file download.
 * The report is for supportive / teacher reference purposes only.
 */
function exportReport() {
  const p       = passages[appState.selectedPassage];
  const elapsed = Math.round((Date.now() - session.startTime) / 1000);
  const wpm     = elapsed > 5 ? Math.round((session.wordsRead / elapsed) * 60) : 0;

  const report = {
    app: 'ReadEase',
    passage: p.title,
    date: new Date().toISOString(),
    duration_seconds: elapsed,
    words_per_minute: wpm,
    fixations: session.fixations,
    regressions: session.regressions,
    long_pauses: session.pauses,
    disclaimer:
      'This data is for supportive purposes only and does not ' +
      'constitute a medical or educational diagnosis.',
    behaviors: session.behaviors.slice(-20), // Last 20 events
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `readease-session-${Date.now()}.json`;
  a.click();
}

// =============================================================
// 19. KEYBOARD SHORTCUTS (reading screen only)
//     ↓        — Advance to next line
//     ↑        — Go back to previous line
//     Space    — Read current line aloud
//     Escape   — Stop speech
// =============================================================
document.addEventListener('keydown', e => {
  const readingActive = document.getElementById('screen-reading').classList.contains('active');
  if (!readingActive) return;

  switch (e.key) {
    case 'ArrowDown':
      setActiveLine(appState.currentLine + 1, appState.autoRead);
      break;
    case 'ArrowUp':
      setActiveLine(appState.currentLine - 1, false);
      break;
    case ' ':
      e.preventDefault();
      speakCurrentLine();
      break;
    case 'Escape':
      stopSpeech();
      break;
  }
});

// =============================================================
//  INIT — Trigger voice loading as early as possible
//  (Chrome requires a user gesture before speaking, but we can
//   pre-load the voice list at page load.)
// =============================================================
window.addEventListener('load', () => {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices(); // Trigger async voice list load
  }
});