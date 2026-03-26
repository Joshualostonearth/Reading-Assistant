/* ==========================================================================
   script.js — ReadFlow
   ==========================================================================
   01  Init on DOMContentLoaded
   02  Element references
   03  Navbar: scroll state + hamburger + active link
   04  Reading settings: sliders, swatches, font
   05  Text-to-Speech engine
   06  Sentence builder + highlighter
   07  Progress bar
   08  Focus Mode
   09  Contact form
   10  Scroll reveal (IntersectionObserver)
   11  Pre-loaded sample text
   12  Toast helper
   ========================================================================== */

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  /* ──────────────────────────────────────────
     02  ELEMENT REFERENCES
  ────────────────────────────────────────── */
  const navbar      = document.getElementById('navbar');
  const hamburger   = document.getElementById('hamburger');
  const mobileMenu  = document.getElementById('mobileMenu');
  const navLinks    = document.querySelectorAll('.nav-link');
  const sections    = document.querySelectorAll('section[id]');

  const cFontSize   = document.getElementById('cFontSize');
  const cSpacing    = document.getElementById('cSpacing');
  const cLineH      = document.getElementById('cLineH');
  const cSpeed      = document.getElementById('cSpeed');
  const vFontSize   = document.getElementById('cFontSizeVal');
  const vSpacing    = document.getElementById('cSpacingVal');
  const vLineH      = document.getElementById('cLineHVal');
  const vSpeed      = document.getElementById('cSpeedVal');

  const swatches    = document.querySelectorAll('.rf-swatch');
  const fontSelect  = document.getElementById('cFont');

  const textInput   = document.getElementById('textInput');
  const btnRead     = document.getElementById('btnRead');
  const btnPause    = document.getElementById('btnPause');
  const btnStop     = document.getElementById('btnStop');
  const btnFocus    = document.getElementById('btnFocus');
  const btnClear    = document.getElementById('btnClear');
  const readDisplay = document.getElementById('readDisplay');
  const rdEmpty     = document.getElementById('rdEmpty');
  const progFill    = document.getElementById('progFill');
  const progBar     = document.getElementById('progBar');
  const progLabel   = document.getElementById('progLabel');
  const progPct     = document.getElementById('progPct');

  const focusOverlay = document.getElementById('focusOverlay');
  const focusText    = document.getElementById('focusText');
  const focusCount   = document.getElementById('focusCount');
  const focusClose   = document.getElementById('focusClose');
  const focusPrev    = document.getElementById('focusPrev');
  const focusNext    = document.getElementById('focusNext');

  const contactForm  = document.getElementById('contactForm');
  const formFeedback = document.getElementById('formFeedback');


  /* ──────────────────────────────────────────
     03  NAVBAR
  ────────────────────────────────────────── */
  window.addEventListener('scroll', function () {
    // Shadow on scroll
    if (window.scrollY > 20) {
      navbar.style.boxShadow = '0 1px 20px rgba(0,0,0,.08)';
    } else {
      navbar.style.boxShadow = 'none';
    }

    // Active nav link based on scroll position
    let current = '';
    sections.forEach(function (sec) {
      if (window.scrollY >= sec.offsetTop - 140) {
        current = sec.id;
      }
    });
    navLinks.forEach(function (link) {
      link.classList.toggle('active', link.getAttribute('href') === '#' + current);
    });
  });

  // Hamburger toggle
  hamburger.addEventListener('click', function () {
    const isOpen = !mobileMenu.classList.contains('hidden');
    mobileMenu.classList.toggle('hidden');
    hamburger.setAttribute('aria-expanded', String(!isOpen));
    hamburger.querySelector('i').className = isOpen ? 'fa-solid fa-bars text-ink/60' : 'fa-solid fa-xmark text-ink/60';
  });

  // Close mobile menu on link click
  mobileMenu.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      mobileMenu.classList.add('hidden');
      hamburger.setAttribute('aria-expanded', 'false');
      hamburger.querySelector('i').className = 'fa-solid fa-bars text-ink/60';
    });
  });


  /* ──────────────────────────────────────────
     04  READING SETTINGS
  ────────────────────────────────────────── */
  cFontSize.addEventListener('input', function () {
    vFontSize.textContent = this.value + 'px';
    readDisplay.style.fontSize = this.value + 'px';
    focusText.style.fontSize   = this.value + 'px';
  });

  cSpacing.addEventListener('input', function () {
    vSpacing.textContent = this.value + 'px';
    readDisplay.style.letterSpacing = this.value + 'px';
    focusText.style.letterSpacing   = this.value + 'px';
  });

  cLineH.addEventListener('input', function () {
    const val = parseFloat(this.value).toFixed(1);
    vLineH.textContent = val;
    readDisplay.style.lineHeight = val;
    focusText.style.lineHeight   = val;
  });

  cSpeed.addEventListener('input', function () {
    vSpeed.textContent = parseFloat(this.value).toFixed(1) + '×';
  });

  swatches.forEach(function (btn) {
    btn.addEventListener('click', function () {
      swatches.forEach(function (s) { s.classList.remove('active'); });
      this.classList.add('active');
      readDisplay.style.backgroundColor = this.dataset.bg;
      readDisplay.style.color           = this.dataset.clr;
      focusText.style.backgroundColor   = this.dataset.bg;
      focusText.style.color             = this.dataset.clr;
    });
  });

  fontSelect.addEventListener('change', function () {
    readDisplay.style.fontFamily = this.value;
    focusText.style.fontFamily   = this.value;
  });


  /* ──────────────────────────────────────────
     05  TEXT-TO-SPEECH ENGINE
  ────────────────────────────────────────── */
  var sentences  = [];
  var currentIdx = 0;
  var isSpeaking = false;
  var isPaused   = false;

  function splitSentences(text) {
    var parts = text.match(/[^.!?]+[.!?]*/g);
    if (!parts) return [text];
    return parts.map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function buildDisplay(arr) {
    rdEmpty.style.display = 'none';
    readDisplay.innerHTML = '';
    arr.forEach(function (text, i) {
      var span = document.createElement('span');
      span.textContent   = text + ' ';
      span.className     = 'sentence';
      span.dataset.index = String(i);
      span.addEventListener('click', function () {
        if (isSpeaking) jumpTo(i);
      });
      readDisplay.appendChild(span);
    });
    setProgress(0, arr.length);
  }

  function highlight(index) {
    document.querySelectorAll('.sentence').forEach(function (s) {
      s.classList.remove('active');
    });
    var active = readDisplay.querySelector('.sentence[data-index="' + index + '"]');
    if (active) {
      active.classList.add('active');
      active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    setProgress(index + 1, sentences.length);
  }

  function speakOne(index) {
    if (index >= sentences.length) { resetSpeech(); return; }
    highlight(index);
    var utter     = new SpeechSynthesisUtterance(sentences[index]);
    utter.lang    = 'en-US';
    utter.rate    = parseFloat(cSpeed.value);
    utter.onend   = function () {
      if (isSpeaking && !isPaused) { currentIdx++; speakOne(currentIdx); }
    };
    utter.onerror = function (e) { if (e.error !== 'interrupted') console.warn('Speech error:', e.error); };
    window.speechSynthesis.speak(utter);
  }

  function startFrom(index) {
    window.speechSynthesis.cancel();
    isSpeaking = true; isPaused = false;
    btnRead.disabled  = true;
    btnPause.disabled = false;
    btnStop.disabled  = false;
    btnPause.innerHTML = '<i class="fa-solid fa-circle-pause"></i> Pause';
    speakOne(index);
  }

  function jumpTo(index) { currentIdx = index; startFrom(index); }

  function resetSpeech() {
    isSpeaking = false; isPaused = false; currentIdx = 0;
    btnRead.disabled  = false;
    btnPause.disabled = true;
    btnStop.disabled  = true;
    btnPause.innerHTML = '<i class="fa-solid fa-circle-pause"></i> Pause';
    document.querySelectorAll('.sentence').forEach(function (s) { s.classList.remove('active'); });
  }

  btnRead.addEventListener('click', function () {
    var text = textInput.value.trim();
    if (!text) { showToast('⚠️  Please paste or type some text first'); return; }
    if (!('speechSynthesis' in window)) { showToast('⚠️  Text-to-speech not supported. Use Chrome or Edge.'); return; }
    sentences  = splitSentences(text);
    currentIdx = 0;
    buildDisplay(sentences);
    startFrom(0);
    readDisplay.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  btnPause.addEventListener('click', function () {
    if (!isPaused) {
      window.speechSynthesis.pause();
      isPaused = true;
      this.innerHTML = '<i class="fa-solid fa-circle-play"></i> Resume';
    } else {
      window.speechSynthesis.resume();
      isPaused = false;
      this.innerHTML = '<i class="fa-solid fa-circle-pause"></i> Pause';
    }
  });

  btnStop.addEventListener('click', function () {
    window.speechSynthesis.cancel();
    resetSpeech();
    setProgress(0, sentences.length);
  });

  btnClear.addEventListener('click', function () {
    window.speechSynthesis.cancel();
    resetSpeech();
    textInput.value = '';
    sentences = []; currentIdx = 0;
    readDisplay.innerHTML = '';
    rdEmpty.style.display = 'flex';
    readDisplay.appendChild(rdEmpty);
    setProgress(0, 0);
  });


  /* ──────────────────────────────────────────
     07  PROGRESS BAR
  ────────────────────────────────────────── */
  function setProgress(done, total) {
    var pct = total > 0 ? Math.round((done / total) * 100) : 0;
    progFill.style.width = pct + '%';
    progPct.textContent  = pct + '%';
    progBar.setAttribute('aria-valuenow', String(pct));
    if (pct === 0)        progLabel.textContent = 'Ready to read';
    else if (pct === 100) progLabel.textContent = '✓ All done!';
    else                  progLabel.textContent = 'Reading…';
  }


  /* ──────────────────────────────────────────
     08  FOCUS MODE
  ────────────────────────────────────────── */
  var focusParas = [];
  var focusIdx   = 0;

  btnFocus.addEventListener('click', function () {
    var text = textInput.value.trim();
    if (!text) { showToast('⚠️  Please paste some text first'); return; }
    focusParas = text.split(/\n+/).filter(Boolean);
    focusIdx   = 0;
    showFocusPara(0);
    focusOverlay.classList.add('is-open');
    focusOverlay.setAttribute('aria-hidden', 'false');
    focusClose.focus();
  });

  function showFocusPara(i) {
    focusText.textContent  = focusParas[i];
    focusCount.textContent = (i + 1) + ' / ' + focusParas.length;
    focusPrev.disabled     = (i === 0);
    focusNext.disabled     = (i === focusParas.length - 1);
  }

  focusPrev.addEventListener('click', function () {
    if (focusIdx > 0) { focusIdx--; showFocusPara(focusIdx); }
  });
  focusNext.addEventListener('click', function () {
    if (focusIdx < focusParas.length - 1) { focusIdx++; showFocusPara(focusIdx); }
  });

  function closeFocus() {
    focusOverlay.classList.remove('is-open');
    focusOverlay.setAttribute('aria-hidden', 'true');
    btnFocus.focus();
  }
  focusClose.addEventListener('click', closeFocus);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && focusOverlay.classList.contains('is-open')) closeFocus();
  });
  focusOverlay.addEventListener('click', function (e) {
    if (e.target === focusOverlay) closeFocus();
  });


  /* ──────────────────────────────────────────
     09  CONTACT FORM
  ────────────────────────────────────────── */
  contactForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var name    = document.getElementById('cfName').value.trim();
    var email   = document.getElementById('cfEmail').value.trim();
    var subject = document.getElementById('cfSubject').value.trim();
    var message = document.getElementById('cfMessage').value.trim();

    if (!name || !email || !subject || !message) {
      formFeedback.textContent = '⚠️  Please fill in all fields.';
      formFeedback.style.color = '#ef4444';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      formFeedback.textContent = '⚠️  Please enter a valid email address.';
      formFeedback.style.color = '#ef4444';
      return;
    }
    formFeedback.textContent = '✅  Thanks, ' + name + '! Your message has been received.';
    formFeedback.style.color = '#16a34a';
    contactForm.reset();
    setTimeout(function () { formFeedback.textContent = ''; }, 6000);
  });


  /* ──────────────────────────────────────────
     10  SCROLL REVEAL
  ────────────────────────────────────────── */
  var revealItems = document.querySelectorAll('.reveal-item, .notion-card, .feature-card');
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  revealItems.forEach(function (el) { observer.observe(el); });


  /* ──────────────────────────────────────────
     11  SAMPLE TEXT
  ────────────────────────────────────────── */
  textInput.value = [
    'Welcome to ReadFlow — your personalised reading companion.',
    'This platform is built for every student who finds reading challenging.',
    'Reading can be difficult for a wide variety of reasons.',
    'Some students struggle to stay focused over long passages of text.',
    'Others may find that bright white pages cause visual discomfort.',
    'Some read slowly, or lose their place when tracking lines of text.',
    'ReadFlow lets you adjust font size, letter spacing, and background colour to perfectly match your needs.',
    'Press the Read Aloud button to hear this text spoken in a natural, clear voice.',
    'Each sentence highlights as it is read, making it easy to follow along.',
    'You can pause at any time and pick up from exactly where you left off.',
    'Try Focus Mode to read just one paragraph at a time — no distractions, just your text.',
    'We hope ReadFlow makes your studies a little easier and a lot more enjoyable.'
  ].join(' ');


  /* ──────────────────────────────────────────
     12  TOAST HELPER
  ────────────────────────────────────────── */
  function showToast(message) {
    var old = document.querySelector('.rf-toast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.className   = 'rf-toast';
    t.textContent = message;
    t.setAttribute('role', 'alert');
    t.setAttribute('aria-live', 'assertive');
    document.body.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .3s ease, transform .3s ease';
      t.style.opacity    = '0';
      t.style.transform  = 'translateX(-50%) translateY(10px)';
      setTimeout(function () { t.remove(); }, 300);
    }, 3500);
  }

}); // end DOMContentLoaded
