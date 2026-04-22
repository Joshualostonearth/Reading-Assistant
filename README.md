# GazeReader — Eye-Tracking Reading Prototype

A web-based eye-tracking prototype that uses your webcam to track where you look while reading text. Built with WebGazer.js.

---

## Prerequisites

Before you start, make sure you have these installed:

1. **Node.js** (includes npm)
   - Download from: https://nodejs.org
   - Pick the **LTS** version (green button)
   - Run the installer, click Next through everything
   - To verify it installed, open a terminal and type: `node --version`

2. **VS Code** (code editor)
   - Download from: https://code.visualstudio.com

3. **Google Chrome** or **Microsoft Edge** (browser)
   - Must be a modern browser that supports webcam access
   - Do NOT use Incognito/Private mode — it may block camera access

---

## Setup Instructions (One-Time)

### Step 1 — Open the project in VS Code

1. Open VS Code
2. Go to **File → Open Folder**
3. Navigate to the `eye-tracking-reader` folder and select it
4. Click **Select Folder**

### Step 2 — Open the terminal

Press **Ctrl + `** (backtick key, located above the Tab key on your keyboard).
A terminal panel will appear at the bottom of VS Code.

### Step 3 — Navigate to the project folder

Type this command and press **Enter**:

```
cd c:\path\to\eye-tracking-reader
```

Replace `c:\path\to\` with the actual path where your `eye-tracking-reader` folder is located.

### Step 4 — Initialize the project

Type this and press **Enter**:

```
npm init -y
```

You'll see it create a `package.json` file. This is normal.

### Step 5 — Install WebGazer

Type this and press **Enter**:

```
npm install webgazer@3.4.0
```

Wait for it to finish (about 1-2 minutes). You may see some yellow warnings — those are safe to ignore. When it's done, you'll see `added XX packages` and a new `node_modules` folder will appear in your project.

---

## Running the App

### Step 1 — Start the local server

In the VS Code terminal, type:

```
npx -y serve .
```

You'll see output like:

```
   ┌──────────────────────────────────────────┐
   │                                          │
   │   Serving!                               │
   │                                          │
   │   - Local:    http://localhost:3000       │
   │                                          │
   └──────────────────────────────────────────┘
```

### Step 2 — Open in browser

Open **Google Chrome** (regular window, NOT Incognito) and go to:

```
http://localhost:3000
```

**IMPORTANT:** Do NOT open the HTML file by double-clicking it. You MUST use the localhost URL above. WebGazer requires a local server to access your webcam.

### Step 3 — Use the app

1. Click **"Initialize Eye Tracker"**
2. Your browser will ask for camera permission — click **Allow**
3. Complete the **9-point calibration** (click each dot 5 times while looking at it)
4. The reading screen will appear — read the text naturally
5. Click **"Finish Reading"** to see your reading analysis
6. Optionally download the gaze data as a CSV file

### Step 4 — Stop the server

When you're done, go back to the VS Code terminal and press **Ctrl + C** to stop the server.

---

## Running Again (After First-Time Setup)

After the initial setup, you only need two steps each time:

1. Open terminal in VS Code (**Ctrl + `**)
2. Run:
   ```
   cd c:\path\to\eye-tracking-reader
   npx -y serve .
   ```
3. Open `http://localhost:3000` in Chrome

You do NOT need to run `npm init` or `npm install` again — those are one-time steps.

---

## Running on Mobile (iPhone/Android)

The app works on smartphones — the phone's front camera is usually better quality than a laptop webcam, which gives WebGazer better data to work with.

### Requirements
- Your phone and PC must be on the **same WiFi network**
- iPhone: Use **Safari** (not Chrome on iOS)
- Android: Use **Chrome**

### Step 1 — Start the HTTPS server

Mobile browsers require HTTPS for camera access. Use this command:

```
npx -y http-server . -S -p 3000
```

> **Note:** The `-S` flag enables HTTPS with a self-signed certificate. You'll see security warnings — this is normal.

### Step 2 — Find your PC's IP address

In the terminal, type:

```
ipconfig
```

Look for **"IPv4 Address"** under your WiFi adapter. It will look like `192.168.x.x` or `172.20.x.x`.

### Step 3 — Open on your phone

1. Open **Safari** on your iPhone
2. Go to: `https://YOUR_PC_IP:3000` (example: `https://192.168.1.50:3000`)
3. You'll see a security warning — this is expected:
   - Tap **"Show Details"** or **"Advanced"**
   - Tap **"Visit this website"** or **"Proceed"**
   - Tap **"Visit Website"** to confirm
4. The GazeReader app will load with a mobile-optimized layout

### Step 4 — Allow camera access

- Safari will ask for camera permission — tap **Allow**
- Make sure your face is well-lit and visible to the front camera
- Hold the phone at arm's length (~30-40cm from your face)

### Tips for Mobile Eye Tracking
- **Use portrait mode** for startup/calibration, landscape works too for reading
- **Good lighting is crucial** — face a window or lamp
- **Hold the phone steady** — prop it against something if possible
- **iPhone front camera advantage**: much better image quality than most laptop webcams


## Project Files

### Core Application Files

| File | Purpose |
|------|---------|
| **index.html** | The main HTML page. Contains the structure and layout for all four screens: startup, calibration, reading, and summary. This is the entry point of the app — it loads the CSS, WebGazer library, and app logic. |
| **style.css** | All visual styling for the application. Defines the dark theme, colors, animations, layout, typography, and responsive design. Uses CSS custom properties (variables) for a consistent design system with gradients, glassmorphism effects, and micro-animations. |
| **app.js** | The core application logic written in JavaScript. Handles WebGazer initialization, the 9-point calibration process, real-time gaze tracking, word highlighting, fixation detection, regression counting, heatmap rendering, reading analytics, and CSV data export. |

### Generated Files (Created During Setup)

| File / Folder | Purpose |
|---------------|---------|
| **package.json** | Created by `npm init -y`. Defines the project metadata and tracks installed dependencies (like WebGazer). |
| **package-lock.json** | Auto-generated by npm. Locks the exact versions of all installed packages for reproducibility. |
| **node_modules/** | Auto-generated by `npm install`. Contains the WebGazer library and all its dependencies (TensorFlow.js, face detection models, etc.). This folder is large (~33 MB) — do NOT delete it or the app won't work. If accidentally deleted, just run `npm install` again to restore it. |

### How the Files Connect

```
index.html
  ├── loads style.css (visual styling)
  ├── loads node_modules/webgazer/dist/webgazer.js (eye-tracking library)
  └── loads app.js (application logic that uses WebGazer)
```

The browser loads `index.html` first. That file contains `<link>` and `<script>` tags that pull in the CSS and JavaScript files. WebGazer provides the webcam-based eye tracking, and `app.js` uses WebGazer's API to build the reading analysis features on top of it.

---

## Troubleshooting

### "Your browser does not support access to the webcam"
- You opened the file directly (address bar shows `file:///...`)
- Solution: Use `http://localhost:3000` instead (start the server first)

### Camera permission denied
- Click the lock/info icon (🔒 or ℹ️) in the browser address bar
- Go to **Site Settings → Camera → Allow**
- Refresh the page

### Page loads slowly the first time
- Normal! WebGazer loads TensorFlow.js (~33 MB) and a face detection model
- Subsequent loads will be faster due to browser caching

### Terminal shows "port already in use"
- Another server is already running on port 3000
- Either stop it (find the other terminal and press Ctrl+C) or use a different port:
  ```
  npx -y serve . -l 5000
  ```
  Then open `http://localhost:5000` instead

### npm install fails
- Make sure Node.js is installed: run `node --version` in the terminal
- If it says "not recognized", download and install Node.js from https://nodejs.org
- After installing Node.js, restart VS Code completely

---

## Tips

- **Lighting matters**: WebGazer works best in a well-lit room with your face clearly visible
- **Stay still**: Try to keep your head relatively still during calibration and reading
- **Calibrate carefully**: Look directly at each dot while clicking — better calibration = better tracking
- **Chrome works best**: Google Chrome has the best support for WebGazer
