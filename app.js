/* ========================================
   GazeReader — Reading Disability Screening
   ======================================== */

(() => {
    'use strict';

    // ===== SAMPLE TEXT WITH REVERSAL PAIRS =====
    // Contains: was/saw, on/no, tap/pat, god/dog, pot/top, bat/tab
    const SAMPLE_TEXT = `The dog saw a big red ball on the grass near the old garden wall. It was not far from the tap where Pat liked to wash his hands. Sam came to play but he was slow to start. He saw the ball and ran fast, but Pat got there first. No one was sad about it at all. They put the ball down and sat on the soft green mat under the big tree. The sun was warm and the sky was bright. A small cat sat in a pot by the door while the boy had a bat in his hand. They saw ten birds fly over the top of the red barn. The dog ran to the tall gate and the boy went to tap on the old wood. God made the world full of light and every day was good.`;

    // Reversal pairs to track — words that can be read as their reverse
    const REVERSAL_PAIRS = {
        'was': 'saw', 'saw': 'was',
        'on': 'no', 'no': 'on',
        'tap': 'pat', 'pat': 'tap',
        'god': 'dog', 'dog': 'god',
        'pot': 'top', 'top': 'pot',
        'bat': 'tab', 'tab': 'bat',
        'sat': 'tas', 'ten': 'net',
    };

    // ===== AGE-BASED WPM BENCHMARKS =====
    const WPM_BENCHMARKS = {
        '6-7': { below: 60, avgLow: 60, avgHigh: 90, above: 90 },
        '8-9': { below: 90, avgLow: 90, avgHigh: 130, above: 130 },
        '10-11': { below: 120, avgLow: 120, avgHigh: 160, above: 160 },
        '12-13': { below: 140, avgLow: 140, avgHigh: 180, above: 180 },
        '14-15': { below: 160, avgLow: 160, avgHigh: 200, above: 200 },
        '16-17': { below: 180, avgLow: 180, avgHigh: 220, above: 220 },
        '18+': { below: 200, avgLow: 200, avgHigh: 280, above: 280 },
    };

    // ===== CONFIG =====
    const CALIBRATION_CLICKS_NEEDED = 5;
    const GAZE_SMOOTHING = 0.15; // Lower at 30fps — more data points means less averaging needed
    const FIXATION_THRESHOLD_MS = 150;
    const FIXATION_DISTANCE_PX = 60;
    const HEATMAP_POINT_RADIUS = 40;
    const LOG_SAMPLE_INTERVAL_MS = 100;

    // ===== STATE =====
    const state = {
        currentScreen: 'startup',
        ageGroup: '18+',
        // Gaze data
        gazeLog: [],
        fixations: [],
        wordFocusCounts: {},
        readingStartTime: null,
        readingEndTime: null,
        timerInterval: null,
        lastLogTime: 0,
        smoothX: 0,
        smoothY: 0,
        lastFixationWord: null,
        lastFixationX: 0,
        lastFixationY: 0,
        fixationStart: 0,
        regressions: 0,
        lastWordIndex: -1,
        // Enhanced tracking
        wordDwellTimes: {},        // wordIndex -> total dwell ms
        readingOrder: [],          // sequence of word indices visited
        totalSaccades: 0,          // total eye movements between words
        wordsInText: 0,            // total word count
        // Color filter tracking
        currentFilter: 'none',
        filterSessions: {},        // filterName -> { startTime, gazeCount, regressions, wordsRead }
        filterStartTime: null,
        filterGazeCount: 0,
        filterRegressions: 0,
        filterWordsRead: new Set(),
        // Focus mode
        focusMode: false,
        // Sequential line/word progression
        currentLineIndex: 0,
        currentWordInLine: 0,
        lineWordMap: [],           // lineWordMap[lineIdx] = [wordIdx, wordIdx, …]
        clearedWords: new Set(),
        // Font scaling
        fontSize: 26,
        // Stale gaze pulse
        lastGazeTime: 0,
        staleGazeTimer: null,
        isPulsing: false,
        // Performance: cached DOM refs & word positions
        wordElements: [],          // cached array of word span elements
        wordPositions: [],         // cached [{cx, cy, left, top, right, bottom}] of each word
        activeWordEl: null,        // currently highlighted word element
        gazeDotEl: null,           // cached gaze dot element
        heatmapToggleEl: null,     // cached heatmap toggle element
        lastHeatmapRender: 0,      // throttle heatmap rendering
        // Head tracking
        headBaselineX: null,       // calibrated center X of face
        headBaselineY: null,       // calibrated center Y of face
        headStabilizeInterval: null,
        headTrackingInterval: null,
        headStableStart: 0,        // when face first became stable
        headCalibrated: false,
    };

    // ===== DOM REFS =====
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const screens = {
        startup: $('#screen-startup'),
        calibration: $('#screen-calibration'),
        headStabilize: $('#screen-head-stabilize'),
        reading: $('#screen-reading'),
        summary: $('#screen-summary'),
    };

    // ===== SCREEN MANAGEMENT =====
    function showScreen(name) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        screens[name].classList.add('active');
        state.currentScreen = name;
    }

    // ===== STARTUP =====
    $('#btn-start').addEventListener('click', initWebGazer);

    async function initWebGazer() {
        // Default age group (age selector removed from UI)
        state.ageGroup = '18+';

        const statusEl = $('#startup-status');
        statusEl.textContent = 'Initializing eye tracker...';
        statusEl.className = 'status-text';

        try {
            if (typeof webgazer === 'undefined') {
                throw new Error('WebGazer.js failed to load. Check your internet connection.');
            }

            // ===== GPU-ACCELERATED MODE =====
            // Force TensorFlow.js (bundled inside WebGazer) to use WebGL backend.
            // This offloads face detection tensor ops to your GPU via WebGL.
            if (typeof tf !== 'undefined') {
                try {
                    await tf.setBackend('webgl');
                    await tf.ready();
                    console.log('[GazeReader] TF.js backend:', tf.getBackend()); // should log "webgl"
                    statusEl.textContent = 'GPU backend active (WebGL)...';
                } catch (e) {
                    console.warn('[GazeReader] WebGL backend unavailable, falling back to CPU:', e);
                }
            }

            // Full resolution — GPU handles 640x480 @ 30fps without breaking a sweat
            webgazer.params.camConstraints = {
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: 'user',
                    frameRate: { ideal: 30, max: 30 }
                }
            };

            // Larger viewer = more face pixels = better eye crop = better gaze accuracy
            webgazer.params.videoViewerWidth = 320;
            webgazer.params.videoViewerHeight = 240;

            // Still skip overlays — just visual noise
            webgazer.params.showFaceOverlay = false;
            webgazer.params.showFaceFeedbackBox = false;

            statusEl.textContent = 'Requesting camera (GPU-accelerated mode)...';

            // weightedRidge weights recent calibration clicks more heavily
            // so it stays accurate as the session progresses
            webgazer.setRegression('weightedRidge');
            webgazer.setGazeListener(() => { });
            webgazer.saveDataAcrossSessions(false);
            await webgazer.begin();
            webgazer.showPredictionPoints(false);

            statusEl.textContent = 'Camera connected! Moving to calibration...';
            statusEl.className = 'status-text success';

            setTimeout(() => {
                showScreen('calibration');
                setupCalibration();
            }, 800);
        } catch (err) {
            statusEl.textContent = `Error: ${err.message || 'Could not access camera.'}`;
            statusEl.className = 'status-text error';
            console.error('WebGazer init error:', err);
        }
    }

    // ===== CALIBRATION =====
    function setupCalibration() {
        const container = $('#calibration-points');
        container.innerHTML = '';

        const positions = [
            [10, 15], [50, 15], [90, 15],
            [10, 50], [50, 50], [90, 50],
            [10, 85], [50, 85], [90, 85],
        ];

        let completed = 0;

        positions.forEach(([xPct, yPct], i) => {
            const dot = document.createElement('div');
            dot.className = 'cal-point';
            dot.style.left = `${xPct}%`;
            dot.style.top = `${yPct}%`;
            dot.dataset.clicks = '0';
            dot.dataset.index = i;

            const counter = document.createElement('span');
            counter.className = 'cal-count';
            counter.textContent = `0/${CALIBRATION_CLICKS_NEEDED}`;
            dot.appendChild(counter);

            dot.addEventListener('click', () => {
                if (dot.classList.contains('done')) return;

                let clicks = parseInt(dot.dataset.clicks) + 1;
                dot.dataset.clicks = clicks;
                counter.textContent = `${clicks}/${CALIBRATION_CLICKS_NEEDED}`;

                dot.style.transform = 'scale(1.3)';
                setTimeout(() => { dot.style.transform = 'scale(1)'; }, 200);

                if (clicks >= CALIBRATION_CLICKS_NEEDED) {
                    dot.classList.add('done');
                    completed++;
                    updateCalProgress(completed, positions.length);

                    if (completed >= positions.length) {
                        $('#btn-start-reading').disabled = false;
                    }
                }
            });

            container.appendChild(dot);
        });

        updateCalProgress(0, positions.length);
    }

    function updateCalProgress(done, total) {
        const pct = (done / total) * 100;
        $('#cal-progress-bar').style.width = `${pct}%`;
        $('#cal-progress-text').textContent = `${done} / ${total} points`;
    }

    $('#btn-start-reading').addEventListener('click', () => {
        $('#calibration-points').innerHTML = '';
        showScreen('headStabilize');
        startHeadStabilization();
    });

    // ===== HEAD STABILIZATION =====
    function startHeadStabilization() {
        // Get the camera stream from WebGazer's video element
        const wgVideo = document.getElementById('webgazerVideoFeed');
        const stabVideo = $('#stabilize-video');

        if (wgVideo && wgVideo.srcObject) {
            stabVideo.srcObject = wgVideo.srcObject;
        } else if (wgVideo) {
            // Fallback: clone the stream when it becomes available
            const checkStream = setInterval(() => {
                if (wgVideo.srcObject) {
                    stabVideo.srcObject = wgVideo.srcObject;
                    clearInterval(checkStream);
                }
            }, 200);
        }

        const faceDot = $('#face-position-dot');
        const ringProgress = $('#face-ring-progress');
        const viewport = $('#face-guide-viewport');
        const ring = $('.face-guide-ring');
        const posStatus = $('#head-position-status');
        const stabStatus = $('#head-stability-status');
        const tiltStatus = $('#head-tilt-status');
        const progressFill = $('#stabilize-progress-fill');
        const instruction = $('#stabilize-instruction');
        const btnBegin = $('#btn-begin-reading');

        const STABLE_REQUIRED_MS = 3000;
        const CENTER_THRESHOLD = 0.18;  // fraction of viewport (18%)
        const STABLE_THRESHOLD = 0.08;  // movement threshold for "stable" (increased — face mesh has inherent jitter)
        const TILT_THRESHOLD = 15;      // degrees

        let posHistory = [];
        let stableStartTime = 0;
        let wasStable = false;

        state.headStabilizeInterval = setInterval(() => {
            // Get face predictions from WebGazer's face tracker
            const tracker = webgazer.getTracker();
            const positions = tracker && tracker.getPositions ? tracker.getPositions() : null;

            if (!positions || positions.length === 0) {
                setStatus(posStatus, 'No Face', 'bad');
                setStatus(stabStatus, '—', 'bad');
                setStatus(tiltStatus, '—', 'bad');
                instruction.textContent = 'Make sure your face is visible';
                instruction.classList.remove('ready');
                stableStartTime = 0;
                progressFill.style.width = '0%';
                ringProgress.setAttribute('stroke-dashoffset', '817');
                return;
            }

            // Calculate face center and tilt from landmarks
            // WebGazer uses TFFaceMesh (468 landmarks) or clmtrackr (71 landmarks)
            let faceCX, faceCY, tiltAngle = 0;

            if (positions.length > 400) {
                // TFFaceMesh — 468 landmarks
                // Index 4 = nose tip, 33 = right eye outer, 263 = left eye outer
                faceCX = positions[4][0];
                faceCY = positions[4][1];

                const rightEyeOuter = positions[33];
                const leftEyeOuter = positions[263];
                if (rightEyeOuter && leftEyeOuter) {
                    tiltAngle = Math.atan2(leftEyeOuter[1] - rightEyeOuter[1], leftEyeOuter[0] - rightEyeOuter[0]) * (180 / Math.PI);
                }
            } else if (positions.length > 62) {
                // clmtrackr — 71 landmarks
                faceCX = positions[62][0];
                faceCY = positions[62][1];

                const leftEye = positions[27];
                const rightEye = positions[32];
                if (leftEye && rightEye) {
                    tiltAngle = Math.atan2(rightEye[1] - leftEye[1], rightEye[0] - leftEye[0]) * (180 / Math.PI);
                }
            } else {
                // Fallback: average all points
                let sumX = 0, sumY = 0;
                for (let i = 0; i < positions.length; i++) {
                    sumX += positions[i][0];
                    sumY += positions[i][1];
                }
                faceCX = sumX / positions.length;
                faceCY = sumY / positions.length;
            }

            // Normalize face center to the webcam resolution
            const videoW = wgVideo.videoWidth || 640;
            const videoH = wgVideo.videoHeight || 480;
            const normX = faceCX / videoW;  // 0..1
            const normY = faceCY / videoH;  // 0..1

            // Map to the face guide circle — flip X because video is mirrored
            const guideSize = 280; // wrapper size
            const dotLeft = 10 + (guideSize - 20) * (1 - normX); // flip X for mirror
            const dotTop = 10 + (guideSize - 20) * normY;
            const dotPctLeft = (dotLeft / guideSize) * 100;
            const dotPctTop = (dotTop / guideSize) * 100;

            faceDot.style.left = `${dotPctLeft}%`;
            faceDot.style.top = `${dotPctTop}%`;

            // Check if centered (within threshold of 50%)
            const distFromCenter = Math.hypot(normX - 0.5, normY - 0.5);
            const isCentered = distFromCenter < CENTER_THRESHOLD;

            // Check stability (low movement over recent frames)
            posHistory.push({ x: normX, y: normY, t: Date.now() });
            // Keep last 1 second of history
            const oneSecAgo = Date.now() - 1000;
            posHistory = posHistory.filter(p => p.t > oneSecAgo);

            let isStable = false;
            if (posHistory.length > 5) {
                // Use mean position as reference (not the last sample) for noise robustness
                let meanX = 0, meanY = 0;
                for (const p of posHistory) {
                    meanX += p.x;
                    meanY += p.y;
                }
                meanX /= posHistory.length;
                meanY /= posHistory.length;

                let maxDrift = 0;
                for (const p of posHistory) {
                    const d = Math.hypot(p.x - meanX, p.y - meanY);
                    if (d > maxDrift) maxDrift = d;
                }
                isStable = maxDrift < STABLE_THRESHOLD;
            }

            const isTiltOk = Math.abs(tiltAngle) < TILT_THRESHOLD;

            // Update UI
            if (isCentered) {
                setStatus(posStatus, 'Centered', 'good');
                faceDot.classList.add('centered');
                viewport.classList.add('centered');
            } else {
                setStatus(posStatus, distFromCenter < CENTER_THRESHOLD * 1.5 ? 'Close' : 'Off Center', distFromCenter < CENTER_THRESHOLD * 1.5 ? 'warn' : 'bad');
                faceDot.classList.remove('centered');
                viewport.classList.remove('centered');
            }

            setStatus(stabStatus, isStable ? 'Steady' : 'Moving', isStable ? 'good' : 'warn');
            setStatus(tiltStatus,
                isTiltOk ? 'Level' : `${tiltAngle > 0 ? 'Right' : 'Left'} ${Math.abs(tiltAngle).toFixed(0)}°`,
                isTiltOk ? 'good' : 'warn'
            );

            const allGood = isCentered && isStable && isTiltOk;

            if (allGood) {
                ring.classList.add('centered');
                if (!wasStable) {
                    stableStartTime = Date.now();
                    wasStable = true;
                }
                const elapsed = Date.now() - stableStartTime;
                const pct = Math.min((elapsed / STABLE_REQUIRED_MS) * 100, 100);
                progressFill.style.width = `${pct}%`;

                // Ring progress (stroke-dashoffset: 817 = empty, 0 = full)
                const dashOffset = 817 - (817 * (pct / 100));
                ringProgress.setAttribute('stroke-dashoffset', dashOffset.toString());

                if (pct < 100) {
                    instruction.textContent = `Hold still… ${((STABLE_REQUIRED_MS - elapsed) / 1000).toFixed(1)}s`;
                    instruction.classList.remove('ready');
                } else {
                    instruction.textContent = '✓ Head position locked!';
                    instruction.classList.add('ready');
                    btnBegin.disabled = false;

                    // Save baseline
                    state.headBaselineX = normX;
                    state.headBaselineY = normY;
                    state.headCalibrated = true;
                }
            } else {
                ring.classList.remove('centered');
                wasStable = false;
                stableStartTime = 0;
                progressFill.style.width = '0%';
                ringProgress.setAttribute('stroke-dashoffset', '817');
                btnBegin.disabled = true;

                if (!isCentered) {
                    instruction.textContent = 'Move your face to the center of the circle';
                } else if (!isStable) {
                    instruction.textContent = 'Hold still — stop moving your head';
                } else {
                    instruction.textContent = 'Level your head — avoid tilting';
                }
                instruction.classList.remove('ready');
            }
        }, 100); // 10fps check rate

        // Begin reading button
        btnBegin.addEventListener('click', () => {
            clearInterval(state.headStabilizeInterval);
            showScreen('reading');
            startReading();
            startLiveHeadTracking();
        });
    }

    function setStatus(el, text, level) {
        el.textContent = text;
        el.className = `metric-value status-${level}`;
    }

    // ===== LIVE HEAD TRACKING (during reading) =====
    function startLiveHeadTracking() {
        const indicator = $('#head-indicator');
        const dot = $('#head-dot-live');
        const label = $('#head-indicator-label');
        const ringEl = $('#head-ring-live');

        indicator.classList.add('visible');

        const DRIFT_WARN = 0.10;  // 10% drift = yellow
        const DRIFT_BAD = 0.20;  // 20% drift = red

        state.headTrackingInterval = setInterval(() => {
            if (state.currentScreen !== 'reading') return;
            if (!state.headCalibrated) return;

            const tracker = webgazer.getTracker();
            const positions = tracker && tracker.getPositions ? tracker.getPositions() : null;

            if (!positions || positions.length === 0) {
                label.textContent = 'No Face';
                label.className = 'head-indicator-label bad';
                dot.className = 'head-dot-live bad';
                ringEl.setAttribute('stroke', '#ff4d6a');
                return;
            }

            let faceCX, faceCY;
            if (positions.length > 400) {
                // TFFaceMesh — nose tip at index 4
                faceCX = positions[4][0];
                faceCY = positions[4][1];
            } else if (positions.length > 62) {
                // clmtrackr — nose tip at index 62
                faceCX = positions[62][0];
                faceCY = positions[62][1];
            } else {
                let sumX = 0, sumY = 0;
                for (let i = 0; i < positions.length; i++) {
                    sumX += positions[i][0];
                    sumY += positions[i][1];
                }
                faceCX = sumX / positions.length;
                faceCY = sumY / positions.length;
            }

            const wgVideo = document.getElementById('webgazerVideoFeed');
            const videoW = wgVideo ? (wgVideo.videoWidth || 640) : 640;
            const videoH = wgVideo ? (wgVideo.videoHeight || 480) : 480;
            const normX = faceCX / videoW;
            const normY = faceCY / videoH;

            const drift = Math.hypot(normX - state.headBaselineX, normY - state.headBaselineY);

            // Position the dot within the small indicator ring (56x56, ring is 60x60 viewbox)
            // Map drift to pixel offset from center (max ~16px)
            const dx = (normX - state.headBaselineX) * 80;
            const dy = (normY - state.headBaselineY) * 80;
            const clampedDx = Math.max(-16, Math.min(16, dx));
            const clampedDy = Math.max(-16, Math.min(16, dy));

            dot.style.left = `calc(50% + ${clampedDx}px)`;
            dot.style.top = `calc(50% + ${clampedDy}px)`;

            if (drift < DRIFT_WARN) {
                label.textContent = 'Stable';
                label.className = 'head-indicator-label';
                dot.className = 'head-dot-live';
                ringEl.setAttribute('stroke', '#3cf0c5');
            } else if (drift < DRIFT_BAD) {
                label.textContent = 'Drifting';
                label.className = 'head-indicator-label warn';
                dot.className = 'head-dot-live drifted';
                ringEl.setAttribute('stroke', '#ffb84d');
            } else {
                label.textContent = 'Moved!';
                label.className = 'head-indicator-label bad';
                dot.className = 'head-dot-live bad';
                ringEl.setAttribute('stroke', '#ff4d6a');
            }
        }, 200); // 5fps is enough for indicator
    }

    // ===== COLOR FILTER SETUP =====
    function setupFilterButtons() {
        const btns = $$('.filter-btn');
        btns.forEach(btn => {
            btn.addEventListener('click', () => {
                const filterName = btn.dataset.filter;

                // Save current filter session
                saveFilterSession();

                // Switch filter
                btns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.currentFilter = filterName;

                // Start new filter session
                startFilterSession(filterName);

                // Apply overlay
                const overlay = $('#color-overlay');
                overlay.className = 'color-overlay';
                if (filterName !== 'none') {
                    overlay.classList.add(`filter-${filterName}`);
                }
            });
        });
    }

    function startFilterSession(filterName) {
        state.filterStartTime = Date.now();
        state.filterGazeCount = 0;
        state.filterRegressions = 0;
        state.filterWordsRead = new Set();
    }

    function saveFilterSession() {
        if (!state.filterStartTime) return;
        const elapsed = (Date.now() - state.filterStartTime) / 1000;
        if (elapsed < 2) return; // too short to be meaningful

        const filterName = state.currentFilter;
        if (!state.filterSessions[filterName]) {
            state.filterSessions[filterName] = { totalTime: 0, gazeCount: 0, regressions: 0, wordsRead: 0 };
        }
        const session = state.filterSessions[filterName];
        session.totalTime += elapsed;
        session.gazeCount += state.filterGazeCount;
        session.regressions += state.filterRegressions;
        session.wordsRead = Math.max(session.wordsRead, state.filterWordsRead.size);
    }

    // ===== FOCUS MODE SETUP =====
    function setupFocusMode() {
        $('#toggle-focus-mode').addEventListener('change', (e) => {
            state.focusMode = e.target.checked;
            const container = $('#text-container');
            if (e.target.checked) {
                container.classList.add('focus-mode-active');
                // Reset progression to start
                state.currentLineIndex = 0;
                state.currentWordInLine = 0;
                state.clearedWords = new Set();
                // Remove old per-word states
                state.wordElements.forEach(w => {
                    w.classList.remove('word-target', 'word-cleared', 'line-active');
                });
                buildLineWordMap();
                applyLineProgression();
            } else {
                container.classList.remove('focus-mode-active');
                // Remove all progression classes
                state.wordElements.forEach(w => {
                    w.classList.remove('line-active', 'word-target', 'word-cleared');
                    w.style.opacity = '';
                });
            }
        });
    }

    // ===== LINE/WORD MAP BUILDER =====
    // Groups word elements into lines based on vertical position
    function buildLineWordMap() {
        const elements = state.wordElements;
        if (elements.length === 0) return;

        const lines = [];
        let currentLine = [0];
        let currentTop = state.wordPositions[0] ? state.wordPositions[0].cy : 0;

        for (let i = 1; i < elements.length; i++) {
            const pos = state.wordPositions[i];
            if (!pos) continue;
            // If the vertical center differs by more than 15px, it's a new line
            if (Math.abs(pos.cy - currentTop) > 15) {
                lines.push(currentLine);
                currentLine = [i];
                currentTop = pos.cy;
            } else {
                currentLine.push(i);
            }
        }
        if (currentLine.length > 0) {
            lines.push(currentLine);
        }

        state.lineWordMap = lines;
    }

    // ===== APPLY LINE PROGRESSION =====
    // Updates the visual state of all words based on current line/word progress
    function applyLineProgression() {
        if (!state.focusMode || state.lineWordMap.length === 0) return;

        const lineIdx = state.currentLineIndex;
        const elements = state.wordElements;

        // Remove all progression classes first
        for (let i = 0; i < elements.length; i++) {
            elements[i].classList.remove('line-active', 'word-target');
        }

        // Mark cleared words
        state.clearedWords.forEach(idx => {
            elements[idx].classList.add('word-cleared');
        });

        // If we've finished all lines, just show everything
        if (lineIdx >= state.lineWordMap.length) {
            elements.forEach(w => {
                w.classList.add('line-active', 'word-cleared');
            });
            return;
        }

        // Activate current line
        const currentLineWords = state.lineWordMap[lineIdx];
        currentLineWords.forEach(wordIdx => {
            elements[wordIdx].classList.add('line-active');
        });

        // Highlight the current target word in green
        if (state.currentWordInLine < currentLineWords.length) {
            const targetIdx = currentLineWords[state.currentWordInLine];
            // Only highlight if not already cleared
            if (!state.clearedWords.has(targetIdx)) {
                elements[targetIdx].classList.add('word-target');
            }
        }
    }

    // ===== FONT SCALING SETUP =====
    function setupFontScaling() {
        const MIN_FONT = 14;
        const MAX_FONT = 48;
        const STEP = 2;

        const updateFontSize = (delta) => {
            state.fontSize = Math.max(MIN_FONT, Math.min(MAX_FONT, state.fontSize + delta));
            // Apply to all word elements
            state.wordElements.forEach(w => {
                w.style.fontSize = state.fontSize + 'px';
            });
            $('#font-size-label').textContent = state.fontSize + 'px';

            // Critical: recalculate bounding boxes after font change
            // Use requestAnimationFrame to wait for layout recalc
            requestAnimationFrame(() => {
                cacheWordPositions();
                buildLineWordMap();
                if (state.focusMode) {
                    applyLineProgression();
                }
            });
        };

        $('#btn-font-increase').addEventListener('click', () => updateFontSize(STEP));
        $('#btn-font-decrease').addEventListener('click', () => updateFontSize(-STEP));
    }

    // ===== STALE GAZE DETECTOR =====
    function startStaleGazeDetector() {
        const STALE_THRESHOLD_MS = 3000;
        const readingArea = $('#reading-area');

        state.lastGazeTime = Date.now();
        state.isPulsing = false;

        state.staleGazeTimer = setInterval(() => {
            if (state.currentScreen !== 'reading') return;

            const elapsed = Date.now() - state.lastGazeTime;
            if (elapsed > STALE_THRESHOLD_MS && !state.isPulsing) {
                readingArea.classList.add('gaze-pulse');
                state.isPulsing = true;
            }
        }, 500);
    }

    function stopStaleGazeDetector() {
        if (state.staleGazeTimer) {
            clearInterval(state.staleGazeTimer);
            state.staleGazeTimer = null;
        }
        const readingArea = $('#reading-area');
        if (readingArea) {
            readingArea.classList.remove('gaze-pulse');
        }
        state.isPulsing = false;
    }

    // ===== READING =====
    function startReading() {
        const words = SAMPLE_TEXT.split(/\s+/);
        state.wordsInText = words.length;
        const container = $('#text-container');
        container.innerHTML = '';

        // Get lowercase versions of reversal keys for detection
        const reversalKeys = new Set(Object.keys(REVERSAL_PAIRS));

        words.forEach((word, i) => {
            const span = document.createElement('span');
            span.className = 'word';
            span.textContent = word;
            span.dataset.index = i;
            span.id = `word-${i}`;

            // Mark reversal words
            const cleanWord = word.replace(/[.,!?;:'"]/g, '').toLowerCase();
            if (reversalKeys.has(cleanWord)) {
                span.dataset.reversal = 'true';
                span.dataset.clean = cleanWord;
            }

            container.appendChild(span);

            if (i < words.length - 1) {
                container.appendChild(document.createTextNode(' '));
            }
        });

        // Init state
        state.readingStartTime = Date.now();
        state.gazeLog = [];
        state.fixations = [];
        state.wordFocusCounts = {};
        state.wordDwellTimes = {};
        state.readingOrder = [];
        state.totalSaccades = 0;
        state.regressions = 0;
        state.lastWordIndex = -1;
        state.smoothX = window.innerWidth / 2;
        state.smoothY = window.innerHeight / 2;
        state.fixationStart = Date.now();
        state.lastFixationX = state.smoothX;
        state.lastFixationY = state.smoothY;
        state.filterSessions = {};
        state.currentFilter = 'none';
        state.activeWordEl = null;
        state.lastHeatmapRender = 0;

        // Initialize dwell times
        for (let i = 0; i < words.length; i++) {
            state.wordDwellTimes[i] = 0;
        }

        // PERFORMANCE: Cache word elements and their positions
        // This avoids querying the DOM and calling getBoundingClientRect() every frame
        state.wordElements = Array.from(container.querySelectorAll('.word'));
        cacheWordPositions();

        // Cache frequently accessed DOM elements
        state.gazeDotEl = $('#gaze-dot');
        state.heatmapToggleEl = $('#toggle-heatmap');

        // Start filter session tracking
        startFilterSession('none');

        // Setup heatmap canvas
        const canvas = $('#heatmap-canvas');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        // Start timer
        updateTimer();
        state.timerInterval = setInterval(updateTimer, 1000);

        // Install gaze listener
        webgazer.setGazeListener(onGaze);

        // Show gaze dot
        state.gazeDotEl.classList.add('visible');

        // Setup controls
        setupFilterButtons();
        setupFocusMode();
        setupFontScaling();

        // Build initial line/word map
        buildLineWordMap();

        // Start stale gaze detector
        startStaleGazeDetector();

        // Initialize progression state
        state.currentLineIndex = 0;
        state.currentWordInLine = 0;
        state.clearedWords = new Set();
        state.fontSize = 26;
        $('#font-size-label').textContent = '26px';

        $('#toggle-heatmap').addEventListener('change', (e) => {
            const canvas = $('#heatmap-canvas');
            if (e.target.checked) {
                renderHeatmap();
                canvas.classList.add('visible');
            } else {
                canvas.classList.remove('visible');
            }
        });

        $('#toggle-gaze-dot').addEventListener('change', (e) => {
            if (e.target.checked) state.gazeDotEl.classList.add('visible');
            else state.gazeDotEl.classList.remove('visible');
        });
    }

    // Cache word positions — called once on start and on resize/font change
    function cacheWordPositions() {
        state.wordPositions = state.wordElements.map(w => {
            const rect = w.getBoundingClientRect();
            return {
                cx: rect.left + rect.width / 2,
                cy: rect.top + rect.height / 2,
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
            };
        });
    }

    // ===== GAZE CALLBACK (OPTIMIZED) =====
    function onGaze(data, elapsedTime) {
        if (!data) return;
        if (state.currentScreen !== 'reading') return;

        const now = Date.now();

        // Update stale gaze tracker
        state.lastGazeTime = now;
        if (state.isPulsing) {
            // Gaze resumed — remove pulse
            const readingArea = $('#reading-area');
            readingArea.classList.remove('gaze-pulse');
            state.isPulsing = false;
        }

        state.smoothX += (data.x - state.smoothX) * GAZE_SMOOTHING;
        state.smoothY += (data.y - state.smoothY) * GAZE_SMOOTHING;

        const x = Math.round(state.smoothX);
        const y = Math.round(state.smoothY);

        // Move gaze dot (cached reference)
        state.gazeDotEl.style.left = `${x}px`;
        state.gazeDotEl.style.top = `${y}px`;

        // Highlight nearest word (uses cached positions)
        highlightNearestWord(x, y);

        // Log at interval
        if (now - state.lastLogTime >= LOG_SAMPLE_INTERVAL_MS) {
            // Use the already-found active word instead of querying again
            const nearestWord = state.activeWordEl;
            state.gazeLog.push({
                x, y,
                t: now - state.readingStartTime,
                word: nearestWord ? nearestWord.textContent : null,
            });
            state.lastLogTime = now;
            state.filterGazeCount++;

            // Track dwell time per word
            if (nearestWord) {
                const idx = parseInt(nearestWord.dataset.index);
                state.wordDwellTimes[idx] = (state.wordDwellTimes[idx] || 0) + LOG_SAMPLE_INTERVAL_MS;
                state.filterWordsRead.add(idx);
            }

            // Track fixations
            const dist = Math.hypot(x - state.lastFixationX, y - state.lastFixationY);
            if (dist > FIXATION_DISTANCE_PX) {
                const fixDuration = now - state.fixationStart;
                if (fixDuration >= FIXATION_THRESHOLD_MS) {
                    state.fixations.push({
                        x: state.lastFixationX,
                        y: state.lastFixationY,
                        startTime: state.fixationStart - state.readingStartTime,
                        endTime: now - state.readingStartTime,
                        word: state.activeWordEl ? state.activeWordEl.textContent : null,
                    });
                }
                state.fixationStart = now;
                state.lastFixationX = x;
                state.lastFixationY = y;
            }

            // Throttle heatmap to every 500ms instead of 100ms
            if (state.heatmapToggleEl.checked && now - state.lastHeatmapRender > 500) {
                renderHeatmap();
                state.lastHeatmapRender = now;
            }
        }
    }

    // ===== WORD HIGHLIGHTING (OPTIMIZED) =====
    // Uses cached word positions instead of getBoundingClientRect() each frame.
    // Only modifies the DOM for the previously-active and newly-active word,
    // instead of iterating all words to remove/add classes.
    function highlightNearestWord(x, y) {
        const positions = state.wordPositions;
        const elements = state.wordElements;
        let closestIdx = -1;
        let closestDist = Infinity;

        // Find nearest word using cached positions (no DOM reads)
        for (let i = 0; i < positions.length; i++) {
            const dx = x - positions[i].cx;
            const dy = y - positions[i].cy;
            const dist = dx * dx + dy * dy; // squared distance (skip sqrt for speed)
            if (dist < closestDist) {
                closestDist = dist;
                closestIdx = i;
            }
        }

        // Convert to actual distance for threshold check
        closestDist = Math.sqrt(closestDist);

        if (closestDist > 100 || closestIdx < 0) {
            // Gaze is far from any word — deactivate current
            if (state.activeWordEl) {
                state.activeWordEl.classList.remove('gaze-active');
                state.activeWordEl = null;
            }
            return;
        }

        const closest = elements[closestIdx];

        // Only update DOM if the active word changed
        if (closest !== state.activeWordEl) {
            // Remove active from previous word (just 1 element, not all)
            if (state.activeWordEl) {
                state.activeWordEl.classList.remove('gaze-active');
            }

            // Activate new word
            closest.classList.add('gaze-active');
            closest.classList.add('gaze-visited');
            state.activeWordEl = closest;

            // Word focus count
            const word = closest.textContent;
            state.wordFocusCounts[word] = (state.wordFocusCounts[word] || 0) + 1;

            // Track reading order and saccades
            if (closestIdx !== state.lastWordIndex) {
                state.totalSaccades++;
                state.readingOrder.push(closestIdx);

                if (closestIdx < state.lastWordIndex) {
                    state.regressions++;
                    state.filterRegressions++;
                }
                state.lastWordIndex = closestIdx;
            }
        }

        // === Sequential word clearance (focus mode) ===
        if (state.focusMode && state.lineWordMap.length > 0) {
            const lineIdx = state.currentLineIndex;
            if (lineIdx < state.lineWordMap.length) {
                const currentLineWords = state.lineWordMap[lineIdx];
                const targetWordInLine = state.currentWordInLine;

                if (targetWordInLine < currentLineWords.length) {
                    const targetGlobalIdx = currentLineWords[targetWordInLine];

                    // Check if gaze intersects the target word's bounding box
                    const tPos = state.wordPositions[targetGlobalIdx];
                    if (tPos && x >= tPos.left && x <= tPos.right && y >= tPos.top && y <= tPos.bottom) {
                        // Word cleared!
                        state.clearedWords.add(targetGlobalIdx);
                        state.wordElements[targetGlobalIdx].classList.remove('word-target');
                        state.wordElements[targetGlobalIdx].classList.add('word-cleared');
                        state.currentWordInLine++;

                        // Check if line is complete
                        if (state.currentWordInLine >= currentLineWords.length) {
                            // Mark all words in the finished line as cleared
                            currentLineWords.forEach(idx => {
                                state.clearedWords.add(idx);
                                state.wordElements[idx].classList.add('word-cleared');
                            });
                            // Advance to next line
                            state.currentLineIndex++;
                            state.currentWordInLine = 0;
                        }

                        applyLineProgression();
                    }
                }
            }
        }
    }

    // getNearestWord using cached positions (used for fixation recording)
    function getNearestWord(x, y) {
        const positions = state.wordPositions;
        const elements = state.wordElements;
        let closestIdx = -1;
        let closestDist = Infinity;

        for (let i = 0; i < positions.length; i++) {
            const dx = x - positions[i].cx;
            const dy = y - positions[i].cy;
            const dist = dx * dx + dy * dy;
            if (dist < closestDist) {
                closestDist = dist;
                closestIdx = i;
            }
        }

        return (Math.sqrt(closestDist) < 120 && closestIdx >= 0) ? elements[closestIdx] : null;
    }

    function updateTimer() {
        if (!state.readingStartTime) return;
        const elapsed = Math.floor((Date.now() - state.readingStartTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        $('#reading-timer').textContent = `${mins}:${secs}`;
    }

    // ===== HEATMAP =====
    function renderHeatmap() {
        const canvas = $('#heatmap-canvas');
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        const points = state.gazeLog;
        if (points.length === 0) return;

        const offscreen = document.createElement('canvas');
        offscreen.width = w;
        offscreen.height = h;
        const offCtx = offscreen.getContext('2d');

        points.forEach(({ x, y }) => {
            const grad = offCtx.createRadialGradient(x, y - 56, 0, x, y - 56, HEATMAP_POINT_RADIUS);
            grad.addColorStop(0, 'rgba(108, 99, 255, 0.06)');
            grad.addColorStop(1, 'rgba(108, 99, 255, 0)');
            offCtx.fillStyle = grad;
            offCtx.fillRect(x - HEATMAP_POINT_RADIUS, y - 56 - HEATMAP_POINT_RADIUS,
                HEATMAP_POINT_RADIUS * 2, HEATMAP_POINT_RADIUS * 2);
        });

        const imageData = offCtx.getImageData(0, 0, w, h);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha === 0) continue;

            const t = Math.min(alpha / 80, 1);

            if (t < 0.33) {
                const s = t / 0.33;
                data[i] = 60;
                data[i + 1] = Math.round(80 + 160 * s);
                data[i + 2] = 255;
            } else if (t < 0.66) {
                const s = (t - 0.33) / 0.33;
                data[i] = Math.round(255 * s);
                data[i + 1] = 240;
                data[i + 2] = Math.round(255 * (1 - s));
            } else {
                const s = (t - 0.66) / 0.34;
                data[i] = 255;
                data[i + 1] = Math.round(240 * (1 - s));
                data[i + 2] = 0;
            }
            data[i + 3] = Math.round(Math.min(alpha * 2.5, 200));
        }

        offCtx.putImageData(imageData, 0, 0);
        ctx.drawImage(offscreen, 0, 0);
    }

    // ===== FINISH READING =====
    $('#btn-finish').addEventListener('click', finishReading);

    function finishReading() {
        state.readingEndTime = Date.now();
        clearInterval(state.timerInterval);
        stopStaleGazeDetector();

        webgazer.setGazeListener(() => { });
        $('#gaze-dot').classList.remove('visible');
        $('#head-indicator').classList.remove('visible');
        clearInterval(state.headTrackingInterval);

        // Record final fixation
        const now = Date.now();
        const fixDuration = now - state.fixationStart;
        if (fixDuration >= FIXATION_THRESHOLD_MS) {
            const fw = getNearestWord(state.lastFixationX, state.lastFixationY);
            state.fixations.push({
                x: state.lastFixationX,
                y: state.lastFixationY,
                startTime: state.fixationStart - state.readingStartTime,
                endTime: now - state.readingStartTime,
                word: fw ? fw.textContent : null,
            });
        }

        // Save last filter session
        saveFilterSession();

        showScreen('summary');
        renderDiagnosticReport();
    }

    // ===== DIAGNOSTIC REPORT =====
    function generateDiagnosticReport() {
        const durationMs = state.readingEndTime - state.readingStartTime;
        const durationSec = durationMs / 1000;
        const wordCount = state.wordsInText;
        const wpm = Math.round((wordCount / durationSec) * 60);

        // === Reading speed assessment ===
        const benchmark = WPM_BENCHMARKS[state.ageGroup];
        let speedAssessment, speedDesc;
        if (wpm < benchmark.avgLow) {
            speedAssessment = 'below';
            speedDesc = `Reading at ${wpm} WPM, which is below the average range (${benchmark.avgLow}–${benchmark.avgHigh} WPM) for the ${state.ageGroup} age group.`;
        } else if (wpm <= benchmark.avgHigh) {
            speedAssessment = 'average';
            speedDesc = `Reading at ${wpm} WPM, which is within the average range (${benchmark.avgLow}–${benchmark.avgHigh} WPM) for the ${state.ageGroup} age group.`;
        } else {
            speedAssessment = 'above';
            speedDesc = `Reading at ${wpm} WPM, which is above average (>${benchmark.above} WPM) for the ${state.ageGroup} age group.`;
        }

        // === Regression rate ===
        const regressionRate = state.totalSaccades > 0
            ? (state.regressions / state.totalSaccades) * 100
            : 0;

        // === Fixation profile ===
        const avgFixation = state.fixations.length > 0
            ? state.fixations.reduce((s, f) => s + (f.endTime - f.startTime), 0) / state.fixations.length
            : 0;

        let fixationAssessment;
        if (avgFixation < 200) fixationAssessment = 'skimming';
        else if (avgFixation <= 350) fixationAssessment = 'normal';
        else if (avgFixation <= 600) fixationAssessment = 'slow';
        else fixationAssessment = 'letter-by-letter';

        // === Reading flow score ===
        let forwardMoves = 0;
        for (let i = 1; i < state.readingOrder.length; i++) {
            if (state.readingOrder[i] > state.readingOrder[i - 1]) forwardMoves++;
        }
        const flowScore = state.readingOrder.length > 1
            ? Math.round((forwardMoves / (state.readingOrder.length - 1)) * 100)
            : 100;

        // === Reversal word analysis ===
        const reversalAnalysis = [];
        const allDwellValues = Object.values(state.wordDwellTimes);
        const avgDwell = allDwellValues.length > 0
            ? allDwellValues.reduce((s, v) => s + v, 0) / allDwellValues.length
            : 0;

        $$('.word[data-reversal]').forEach(w => {
            const idx = parseInt(w.dataset.index);
            const dwell = state.wordDwellTimes[idx] || 0;
            const ratio = avgDwell > 0 ? dwell / avgDwell : 0;
            reversalAnalysis.push({
                word: w.textContent.replace(/[.,!?;:'"]/g, ''),
                cleanWord: w.dataset.clean,
                pair: REVERSAL_PAIRS[w.dataset.clean] || '—',
                dwellMs: Math.round(dwell),
                ratio: ratio,
                flagged: ratio > 2.0, // >2x average dwell = flagged
            });
        });

        // === Skipped words ===
        let skippedContent = 0;
        let skippedFunction = 0;
        const functionWords = new Set(['the', 'a', 'an', 'is', 'was', 'are', 'in', 'on', 'to', 'of', 'and', 'but', 'it', 'he', 'his', 'they']);
        const words = SAMPLE_TEXT.split(/\s+/);
        words.forEach((word, i) => {
            if ((state.wordDwellTimes[i] || 0) < 50) {
                const clean = word.replace(/[.,!?;:'"]/g, '').toLowerCase();
                if (functionWords.has(clean)) skippedFunction++;
                else skippedContent++;
            }
        });

        // === Working memory: re-reading rate ===
        let reReads = 0;
        const visited = new Set();
        state.readingOrder.forEach(idx => {
            if (visited.has(idx)) reReads++;
            visited.add(idx);
        });
        const reReadRate = state.readingOrder.length > 0
            ? (reReads / state.readingOrder.length) * 100
            : 0;

        // === Compile indicators ===
        const indicators = [];

        if (speedAssessment === 'below') {
            indicators.push({
                name: 'Below Average Reading Speed',
                severity: wpm < benchmark.below * 0.6 ? 'high' : 'moderate',
                icon: '🐢',
                description: `Reading speed is ${wpm} WPM, below the average range of ${benchmark.avgLow}–${benchmark.avgHigh} WPM for age group ${state.ageGroup}. This may indicate processing difficulty.`,
            });
        }

        if (regressionRate > 25) {
            indicators.push({
                name: 'Excessive Regressions',
                severity: regressionRate > 40 ? 'high' : 'moderate',
                icon: '↩️',
                description: `Regression rate is ${regressionRate.toFixed(1)}% (normal is 10–15%). Frequent backward eye movements suggest difficulty with comprehension or word recognition.`,
            });
        }

        if (fixationAssessment === 'letter-by-letter') {
            indicators.push({
                name: 'Letter-by-Letter Reading Pattern',
                severity: 'high',
                icon: '🔤',
                description: `Average fixation duration is ${Math.round(avgFixation)}ms (>600ms), suggesting the reader is decoding letter-by-letter rather than recognizing whole words.`,
            });
        } else if (fixationAssessment === 'slow') {
            indicators.push({
                name: 'Slow/Effortful Reading',
                severity: 'moderate',
                icon: '⏱️',
                description: `Average fixation duration is ${Math.round(avgFixation)}ms (normal is 200–350ms), suggesting effortful processing.`,
            });
        }

        if (flowScore < 60) {
            indicators.push({
                name: 'Disrupted Reading Flow',
                severity: flowScore < 40 ? 'high' : 'moderate',
                icon: '🌊',
                description: `Reading flow score is ${flowScore}/100. The reader's eye movements were not following a consistent left-to-right, top-to-bottom pattern.`,
            });
        }

        const flaggedReversals = reversalAnalysis.filter(r => r.flagged);
        if (flaggedReversals.length >= 2) {
            indicators.push({
                name: 'Reversal Word Difficulty',
                severity: flaggedReversals.length >= 4 ? 'high' : 'moderate',
                icon: '🔄',
                description: `Extended fixation on ${flaggedReversals.length} reversal words (${flaggedReversals.map(r => r.cleanWord).join(', ')}). This may indicate difficulty distinguishing letter order, a common feature of dyslexia.`,
            });
        }

        if (reReadRate > 40) {
            indicators.push({
                name: 'Working Memory Concern',
                severity: reReadRate > 60 ? 'high' : 'moderate',
                icon: '🧠',
                description: `Re-reading rate is ${reReadRate.toFixed(1)}%. Frequently revisiting already-read words may suggest working memory limitations.`,
            });
        }

        if (skippedContent > wordCount * 0.15) {
            indicators.push({
                name: 'Word Omissions',
                severity: 'moderate',
                icon: '⏭️',
                description: `${skippedContent} content words received minimal gaze time (potentially skipped). High omission rates may indicate difficulty maintaining attention.`,
            });
        }

        // === Compile interventions ===
        const interventions = [];

        if (speedAssessment === 'below' || fixationAssessment === 'slow') {
            interventions.push({
                icon: '📚',
                title: 'Guided Reading Practice',
                description: 'Practice timed reading with gradually increasing speed targets. Start with comfortable passages and progressively reduce the allowed reading time. Use a finger or pointer to guide eye movement along the text.',
            });
        }

        if (fixationAssessment === 'letter-by-letter') {
            interventions.push({
                icon: '🔤',
                title: 'Whole-Word Recognition Training',
                description: 'Use flash card exercises to build sight-word vocabulary. Practice recognizing common words as whole units rather than decoding letter-by-letter. Start with high-frequency words and gradually add complexity.',
            });
        }

        if (regressionRate > 25) {
            interventions.push({
                icon: '📝',
                title: 'Chunked Text Presentation',
                description: 'Break text into smaller meaningful phrases or chunks. This reduces the need for re-reading by keeping manageable units of meaning. Highlight phrase boundaries during practice sessions.',
            });
        }

        if (flaggedReversals.length >= 2) {
            interventions.push({
                icon: '🔄',
                title: 'Letter Orientation Exercises',
                description: 'Practice distinguishing commonly reversed letter sequences. Use multi-sensory approaches: trace letters in sand, form them with clay, or write them in the air. Focus on word pairs like "was/saw", "on/no".',
            });
        }

        if (reReadRate > 40) {
            interventions.push({
                icon: '🧠',
                title: 'Working Memory Exercises',
                description: 'Use shorter text passages and build up gradually. Practice summarizing after each sentence. Working memory games (like repeating sequences) can strengthen this capacity over time.',
            });
        }

        // Check filter comparison for color recommendation
        const filterNames = Object.keys(state.filterSessions);
        if (filterNames.length > 1) {
            const filterWPMs = {};
            filterNames.forEach(name => {
                const session = state.filterSessions[name];
                if (session.totalTime > 3) {
                    filterWPMs[name] = Math.round((session.wordsRead / session.totalTime) * 60);
                }
            });

            const bestFilter = Object.entries(filterWPMs).sort((a, b) => b[1] - a[1])[0];
            if (bestFilter && bestFilter[0] !== 'none') {
                interventions.push({
                    icon: '🎨',
                    title: `Consider ${bestFilter[0].charAt(0).toUpperCase() + bestFilter[0].slice(1)} Overlay`,
                    description: `Reading performance was best with the ${bestFilter[0]} overlay. Colored overlays can reduce visual stress (Irlen Syndrome/Scotopic Sensitivity). Consider using a ${bestFilter[0]}-tinted reading sheet or screen overlay for daily reading.`,
                });
            }
        }

        if (indicators.length === 0) {
            interventions.push({
                icon: '✅',
                title: 'Reading Patterns Within Normal Range',
                description: 'No significant concerns were detected in this screening session. Continue with regular reading practice to maintain and improve reading skills.',
            });
        }

        return {
            wpm, durationSec, speedAssessment, speedDesc, benchmark,
            regressionRate, avgFixation: Math.round(avgFixation),
            fixationAssessment, flowScore, reReadRate,
            reversalAnalysis, skippedContent, skippedFunction,
            indicators, interventions,
        };
    }

    // ===== RENDER DIAGNOSTIC REPORT =====
    function renderDiagnosticReport() {
        const report = generateDiagnosticReport();

        // === Speed gauge ===
        $('#stat-wpm').textContent = report.wpm;

        // Benchmark marker position (0-100%)
        const bm = report.benchmark;
        const maxWPM = bm.avgHigh * 1.5;
        const markerPct = Math.min(Math.max((report.wpm / maxWPM) * 100, 5), 95);
        $('#benchmark-marker').style.left = `${markerPct}%`;
        $('#benchmark-desc').textContent = report.speedDesc;

        // === Core metrics ===
        $('#stat-duration').textContent = `${report.durationSec.toFixed(1)}s`;
        $('#stat-fixations').textContent = state.fixations.length;
        $('#stat-regressions').textContent = state.regressions;
        $('#stat-avg-fixation').textContent = `${report.avgFixation}ms`;
        $('#stat-flow-score').textContent = `${report.flowScore}/100`;
        $('#stat-regression-rate').textContent = `${report.regressionRate.toFixed(1)}%`;

        // === Indicators ===
        const indContainer = $('#indicators-container');
        indContainer.innerHTML = '';

        if (report.indicators.length === 0) {
            indContainer.innerHTML = '<div class="no-indicators">✅ No significant reading difficulty indicators detected in this session.</div>';
        } else {
            report.indicators.forEach(ind => {
                const card = document.createElement('div');
                card.className = `indicator-card severity-${ind.severity}`;
                card.innerHTML = `
                    <div class="indicator-badge">${ind.icon}</div>
                    <div class="indicator-content">
                        <h4>${ind.name}</h4>
                        <p>${ind.description}</p>
                        <span class="indicator-tag">${ind.severity}</span>
                    </div>
                `;
                indContainer.appendChild(card);
            });
        }

        // === Filter comparison ===
        const filterNames = Object.keys(state.filterSessions);
        if (filterNames.length > 1) {
            const section = $('#filter-comparison-section');
            section.style.display = '';
            const container = $('#filter-comparison');
            container.innerHTML = '';

            const filterColors = {
                none: '#666', yellow: '#FFD54F', blue: '#64B5F6',
                pink: '#F48FB1', green: '#81C784', peach: '#FFAB91',
            };

            // Calculate WPM for each filter
            const filterData = [];
            filterNames.forEach(name => {
                const session = state.filterSessions[name];
                if (session.totalTime > 3) {
                    const fWPM = Math.round((session.wordsRead / session.totalTime) * 60);
                    filterData.push({ name, wpm: fWPM, time: session.totalTime });
                }
            });

            const bestWPM = Math.max(...filterData.map(f => f.wpm));

            filterData.forEach(fd => {
                const card = document.createElement('div');
                card.className = 'filter-compare-card' + (fd.wpm === bestWPM ? ' best' : '');
                card.innerHTML = `
                    <div class="fc-color" style="background:${filterColors[fd.name]}"></div>
                    <div class="fc-wpm">${fd.wpm}</div>
                    <div class="fc-label">${fd.name === 'none' ? 'No Filter' : fd.name} WPM</div>
                    ${fd.wpm === bestWPM ? '<span class="fc-tag">Best</span>' : ''}
                `;
                container.appendChild(card);
            });
        }

        // === Reversal word analysis ===
        if (report.reversalAnalysis.length > 0) {
            const section = $('#reversal-section');
            section.style.display = '';
            const container = $('#reversal-chart');
            container.innerHTML = '';

            report.reversalAnalysis.forEach(rw => {
                const card = document.createElement('div');
                card.className = 'reversal-word-card' + (rw.flagged ? ' flagged' : '');
                card.innerHTML = `
                    <div class="rw-word">${rw.word}</div>
                    <div class="rw-pair">reverses to "${rw.pair}"</div>
                    <div class="rw-dwell" style="color: ${rw.flagged ? 'var(--warning)' : 'var(--text-secondary)'}">${rw.dwellMs}ms</div>
                    <div class="rw-ratio">${rw.ratio.toFixed(1)}× avg dwell</div>
                `;
                container.appendChild(card);
            });
        }

        // === Word focus chart ===
        const chart = $('#word-focus-chart');
        chart.innerHTML = '';

        const sortedWords = Object.entries(state.wordFocusCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 30);

        const maxCount = sortedWords.length > 0 ? sortedWords[0][1] : 1;

        sortedWords.forEach(([word, count]) => {
            const el = document.createElement('span');
            el.className = 'wf-word';
            const intensity = Math.min(count / maxCount, 1);

            const r = Math.round(108 + (255 - 108) * intensity);
            const g = Math.round(99 + (77 - 99) * intensity);
            const b = Math.round(255 + (106 - 255) * intensity);
            const alpha = 0.3 + 0.7 * intensity;

            el.style.background = `rgba(${r}, ${g}, ${b}, ${alpha})`;
            el.innerHTML = `${word}<span class="wf-count">${count}</span>`;
            chart.appendChild(el);
        });

        // === Interventions ===
        if (report.interventions.length > 0) {
            const section = $('#interventions-section');
            section.style.display = '';
            const container = $('#interventions-container');
            container.innerHTML = '';

            report.interventions.forEach(int => {
                const card = document.createElement('div');
                card.className = 'intervention-card';
                card.innerHTML = `
                    <div class="int-icon">${int.icon}</div>
                    <div>
                        <h4>${int.title}</h4>
                        <p>${int.description}</p>
                    </div>
                `;
                container.appendChild(card);
            });
        }

        // === Gaze log table ===
        const tbody = $('#gaze-log-body');
        tbody.innerHTML = '';

        const entries = state.gazeLog.slice(-200);
        $('#log-count').textContent = `(${state.gazeLog.length} total samples)`;

        entries.forEach(({ x, y, t, word }) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${(t / 1000).toFixed(2)}</td>
                <td>${x}</td>
                <td>${y}</td>
                <td style="color: var(--accent-secondary); font-family: var(--font-body);">${word || '—'}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // ===== DOWNLOAD CSV =====
    $('#btn-download').addEventListener('click', downloadCSV);

    function downloadCSV() {
        let csv = 'timestamp_ms,x,y,nearest_word\n';
        state.gazeLog.forEach(({ x, y, t, word }) => {
            csv += `${t},${x},${y},"${word || ''}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gazedata_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ===== DOWNLOAD REPORT =====
    $('#btn-download-report').addEventListener('click', downloadReport);

    function downloadReport() {
        const report = generateDiagnosticReport();
        let text = `GazeReader — Reading Analysis Report\n`;
        text += `Generated: ${new Date().toLocaleString()}\n`;
        text += `Age Group: ${state.ageGroup}\n`;
        text += `${'='.repeat(50)}\n\n`;

        text += `READING SPEED\n`;
        text += `  Words Per Minute: ${report.wpm}\n`;
        text += `  Assessment: ${report.speedAssessment}\n`;
        text += `  ${report.speedDesc}\n\n`;

        text += `CORE METRICS\n`;
        text += `  Reading Time: ${report.durationSec.toFixed(1)}s\n`;
        text += `  Total Fixations: ${state.fixations.length}\n`;
        text += `  Regressions: ${state.regressions}\n`;
        text += `  Avg Fixation Duration: ${report.avgFixation}ms (${report.fixationAssessment})\n`;
        text += `  Regression Rate: ${report.regressionRate.toFixed(1)}%\n`;
        text += `  Reading Flow Score: ${report.flowScore}/100\n\n`;

        if (report.indicators.length > 0) {
            text += `SCREENING INDICATORS\n`;
            report.indicators.forEach(ind => {
                text += `  [${ind.severity.toUpperCase()}] ${ind.name}\n`;
                text += `    ${ind.description}\n\n`;
            });
        } else {
            text += `SCREENING INDICATORS\n`;
            text += `  No significant concerns detected.\n\n`;
        }

        if (report.reversalAnalysis.length > 0) {
            text += `REVERSAL WORD ANALYSIS\n`;
            report.reversalAnalysis.forEach(rw => {
                text += `  "${rw.cleanWord}" (reverses to "${rw.pair}"): ${rw.dwellMs}ms dwell (${rw.ratio.toFixed(1)}x avg)${rw.flagged ? ' ⚠️ FLAGGED' : ''}\n`;
            });
            text += `\n`;
        }

        if (report.interventions.length > 0) {
            text += `INTERVENTION RECOMMENDATIONS\n`;
            report.interventions.forEach(int => {
                text += `  ${int.title}\n`;
                text += `    ${int.description}\n\n`;
            });
        }

        text += `${'='.repeat(50)}\n`;
        text += `DISCLAIMER: This tool provides screening indicators only,\n`;
        text += `not clinical diagnoses. Results should be reviewed with a\n`;
        text += `qualified educational psychologist or reading specialist.\n`;

        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reading_report_${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ===== RESTART =====
    $('#btn-restart').addEventListener('click', () => {
        location.reload();
    });

    // ===== RESIZE HANDLER =====
    window.addEventListener('resize', () => {
        const canvas = $('#heatmap-canvas');
        if (canvas) {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        // Recache word positions after layout change
        if (state.wordElements.length > 0) {
            cacheWordPositions();
            buildLineWordMap();
            if (state.focusMode) {
                applyLineProgression();
            }
        }
    });

})();