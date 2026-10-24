/* SehPlus PWA: local-only camera, filter, still-image and pipette tools. */
const CONFIG = {
  donationUrl: "https://buymeacoffee.com/sehplus",
  feedbackUrl: "https://docs.google.com/forms/d/e/DEIN_FORMULAR_ID/viewform"
};

const $ = id => document.getElementById(id);
const viewCanvas = $("viewCanvas");
const viewContext = viewCanvas.getContext("2d", {willReadFrequently: true});
const rawCanvas = document.createElement("canvas");
const rawContext = rawCanvas.getContext("2d", {willReadFrequently: true});
const video = document.createElement("video");
video.muted = true;
video.playsInline = true;
video.setAttribute("aria-hidden", "true");

const state = {
  stream: null,
  mode: "empty",
  frozen: false,
  image: null,
  videoUrl: "",
  filter: "red_green_plus",
  strength: 0.70,
  recognition: "off",
  normal: false,
  zoom: 1,
  pipette: false,
  area: "medium",
  point: null,
  lastResult: null,
  torchOn: false,
  torchTrack: null,
  deferredInstall: null,
  autoEnhance: localStorage.getItem("sehplus_auto_enhance") !== "false",
  haptics: localStorage.getItem("sehplus_haptics") !== "false",
  notes: JSON.parse(localStorage.getItem("sehplus_color_notes") || "[]")
};

const PROFILES = {
  red_green: {name: "Rot-Grün"},
  red_green_plus: {name: "Rot-Grün+"},
  tritan: {name: "Blau-Gelb", matrix: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, .475, .525, 0, 0, 0, 0, 0, 1, 0]},
  contrast: {name: "Kontrast", matrix: [1.24, -.12, -.12, 0, 0, -.08, 1.16, -.08, 0, 0, -.08, -.08, 1.16, 0, 0, 0, 0, 0, 1, 0]},
  neutral: {name: "Neutral", matrix: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]}
};

const LINEAR = Array.from({length: 256}, (_, i) => {
  const value = i / 255;
  return value <= .04045 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4);
});
const toSrgb = value => {
  const clipped = clamp(value, 0, 1);
  const encoded = clipped <= .0031308 ? clipped * 12.92 : 1.055 * Math.pow(clipped, 1 / 2.4) - .055;
  return Math.round(clamp(encoded, 0, 1) * 255);
};

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function haptic() { if (state.haptics && navigator.vibrate) navigator.vibrate(8); }
function setStatus(message) { $("statusText").textContent = message; }
function setButtonState() {
  const available = rawCanvas.width > 0 && rawCanvas.height > 0;
  $("stageEmpty").hidden = available;
  $("stillButton").disabled = !available;
  $("pipetteButton").disabled = !available;
  $("normalButton").disabled = !available;
  $("zoomOut").disabled = !available;
  $("zoomReset").disabled = !available;
  $("zoomIn").disabled = !available;
  $("areaButton").disabled = !available;
  $("saveNoteButton").disabled = !state.lastResult;
  $("shareButton").disabled = !state.lastResult;
  $("normalButton").textContent = state.normal ? "FILTERANSICHT" : "NORMALANSICHT";
  $("stillButton").textContent = state.mode === "live" && !state.frozen ? "STANDBILD" : "WEITER LIVE";
  $("pipetteButton").textContent = state.pipette ? "PIPETTE AUS" : "PIPETTE";
  $("zoomValue").textContent = `Zoom ${state.zoom.toFixed(1).replace(".0", "")}×`;
  viewCanvas.style.transform = `scale(${state.zoom})`;
}

function showPage(pageId) {
  ["cameraPage", "aboutPage", "settingsPage"].forEach(id => $(id).hidden = id !== pageId);
  document.querySelectorAll(".nav-button").forEach(button => button.classList.toggle("selected", button.dataset.page === pageId));
  if (pageId === "cameraPage") render();
}

function setCanvasSize(width, height) {
  if (!width || !height) return;
  if (rawCanvas.width === width && rawCanvas.height === height
      && viewCanvas.width === width && viewCanvas.height === height) return;
  rawCanvas.width = width;
  rawCanvas.height = height;
  viewCanvas.width = width;
  viewCanvas.height = height;
  viewCanvas.style.width = `${width}px`;
  viewCanvas.style.height = `${height}px`;
  $("stageEmpty").hidden = true;
}

function drawVideoFrame() {
  if (!video.videoWidth || !video.videoHeight) return false;
  setCanvasSize(video.videoWidth, video.videoHeight);
  rawContext.drawImage(video, 0, 0, rawCanvas.width, rawCanvas.height);
  return true;
}

function drawImageSource() {
  if (!state.image) return false;
  const width = state.image.naturalWidth || state.image.videoWidth || state.image.width;
  const height = state.image.naturalHeight || state.image.videoHeight || state.image.height;
  if (!width || !height) return false;
  setCanvasSize(width, height);
  rawContext.drawImage(state.image, 0, 0, width, height);
  return true;
}

function render() {
  if (!rawCanvas.width || !rawCanvas.height) {
    setButtonState();
    return;
  }
  const source = rawContext.getImageData(0, 0, rawCanvas.width, rawCanvas.height);
  const output = source.data;
  if (!state.normal) {
    if (state.autoEnhance) applyAutoEnhance(output);
    if (state.recognition !== "off") applyRecognition(output, rawCanvas.width, rawCanvas.height, state.recognition === "whiteboard");
    else if (state.filter === "red_green" || state.filter === "red_green_plus") applyRedGreen(output, state.filter === "red_green_plus");
    else applyMatrix(output, PROFILES[state.filter].matrix);
  }
  viewContext.putImageData(source, 0, 0);
  setButtonState();
}

function applyAutoEnhance(data) {
  let total = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4 * Math.max(1, Math.floor(data.length / 24000))) {
    total += .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
    count++;
  }
  if (!count) return;
  const offset = clamp((128 - total / count) * .12, -12, 12);
  if (Math.abs(offset) < 1) return;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clampByte(data[i] + offset);
    data[i + 1] = clampByte(data[i + 1] + offset);
    data[i + 2] = clampByte(data[i + 2] + offset);
  }
}

function applyMatrix(data, matrix) {
  if (!matrix) return;
  const intensity = state.strength;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const values = [r, g, b, 255];
    const out = [0, 0, 0];
    for (let row = 0; row < 3; row++) {
      const offset = row * 5;
      const identity = values[row];
      const transformed = matrix[offset] * r + matrix[offset + 1] * g + matrix[offset + 2] * b + matrix[offset + 4] * 255;
      out[row] = identity + (transformed - identity) * intensity;
    }
    data[i] = clampByte(out[0]);
    data[i + 1] = clampByte(out[1]);
    data[i + 2] = clampByte(out[2]);
  }
}

function applyRedGreen(data, strong) {
  const opponentStrength = (strong ? .86 : .46) * state.strength;
  for (let i = 0; i < data.length; i += 4) {
    const r = LINEAR[data[i]], g = LINEAR[data[i + 1]], b = LINEAR[data[i + 2]];
    const maximum = Math.max(r, g, b);
    const minimum = Math.min(r, g, b);
    const chroma = maximum - minimum;
    const luminance = .2126 * r + .7152 * g + .0722 * b;
    const opponent = clamp((r - g) * 2.25, -1, 1);
    const shift = opponent * Math.min(1, chroma * 3.2) * opponentStrength;
    let red = r + shift * .08;
    let green = g + shift * .23;
    let blue = b - shift * .20;
    if (strong && chroma > .035) {
      const localContrast = clamp((luminance - .5) * .10, -.06, .06);
      red += localContrast; green += localContrast; blue += localContrast;
    }
    data[i] = toSrgb(red);
    data[i + 1] = toSrgb(green);
    data[i + 2] = toSrgb(blue);
  }
}

function luminanceAt(data, width, x, y) {
  const safeX = clamp(Math.round(x), 0, width - 1);
  const safeY = clamp(Math.round(y), 0, Math.floor(data.length / 4 / width) - 1);
  const offset = (safeY * width + safeX) * 4;
  return .2126 * LINEAR[data[offset]] + .7152 * LINEAR[data[offset + 1]] + .0722 * LINEAR[data[offset + 2]];
}

function applyRecognition(data, width, height, whiteboard) {
  const source = new Uint8ClampedArray(data);
  const strength = Math.max(.05, state.strength);
  const opponentStrength = (whiteboard ? .82 : 1.12) * strength;
  const contrast = (whiteboard ? 1.10 : 1.06) + strength * (whiteboard ? .12 : .14);
  for (let i = 0; i < data.length; i += 4) {
    const r = LINEAR[source[i]], g = LINEAR[source[i + 1]], b = LINEAR[source[i + 2]];
    const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b);
    const chroma = maximum - minimum;
    const luminance = .2126 * r + .7152 * g + .0722 * b;
    const pixel = i / 4, x = pixel % width, y = Math.floor(pixel / width);
    const local = (luminanceAt(source, width, x - 4, y) + luminanceAt(source, width, x + 4, y)
      + luminanceAt(source, width, x, y - 4) + luminanceAt(source, width, x, y + 4)) / 4;
    const detail = clamp((luminance - local) * (whiteboard ? 2.0 : 2.8), -.22, .22);
    const opponent = clamp((r - g) * 2.5, -1, 1);
    const shift = opponent * Math.min(1, chroma * (whiteboard ? 2.8 : 4.0)) * opponentStrength;
    let red = r + shift * (whiteboard ? .05 : .10) + detail;
    let green = g + shift * (whiteboard ? .18 : .30) + detail;
    let blue = b - shift * (whiteboard ? .22 : .30) + detail;
    if (whiteboard && luminance > .72 && chroma < .18) {
      const whiteLift = Math.min(.12, (luminance - .72) * .45 * strength);
      red += whiteLift; green += whiteLift; blue += whiteLift;
    }
    data[i] = toSrgb((red - .5) * contrast + .5);
    data[i + 1] = toSrgb((green - .5) * contrast + .5);
    data[i + 2] = toSrgb((blue - .5) * contrast + .5);
  }
}

function clampByte(value) { return Math.round(clamp(value, 0, 255)); }

function animationLoop() {
  if (state.mode === "live" && !state.frozen && state.stream) {
    if (drawVideoFrame()) render();
    requestAnimationFrame(animationLoop);
  }
}

async function startCamera() {
  if (!window.isSecureContext && location.hostname !== "localhost") {
    setStatus("Kamera benötigt eine HTTPS-Seite.");
    return;
  }
  stopStream();
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: "environment"}}, audio: false});
    video.srcObject = state.stream;
    await video.play();
    state.mode = "live";
    state.frozen = false;
    state.image = null;
    state.normal = false;
    state.zoom = 1;
    state.point = null;
    state.torchTrack = state.stream.getVideoTracks()[0] || null;
    const capabilities = state.torchTrack?.getCapabilities?.() || {};
    $("torchButton").disabled = !capabilities.torch;
    $("torchButton").textContent = capabilities.torch ? "TASCHENLAMPE AUS" : "TASCHENLAMPE NICHT VERFÜGBAR";
    $("cameraButton").textContent = "KAMERA STOPPEN";
    setStatus("Live-Kamera · Filter wird lokal angewendet");
    haptic();
    animationLoop();
  } catch (error) {
    setStatus(error?.name === "NotAllowedError" ? "Kamerazugriff wurde nicht erlaubt." : "Kamera konnte nicht gestartet werden.");
  }
}

function stopStream() {
  if (state.stream) state.stream.getTracks().forEach(track => track.stop());
  state.stream = null;
  video.srcObject = null;
  state.torchTrack = null;
  state.torchOn = false;
  $("torchButton").disabled = true;
}

function stopCameraFromUserAction() {
  stopStream();
  state.mode = rawCanvas.width ? "still" : "empty";
  state.frozen = false;
  $("cameraButton").textContent = "KAMERA STARTEN";
  setStatus(rawCanvas.width ? "Kamera gestoppt · letztes Bild bleibt verfügbar" : "Kamera gestoppt");
  setButtonState();
}

function freezeFrame() {
  if (state.mode !== "live" || !state.stream) return;
  drawVideoFrame();
  state.frozen = true;
  state.mode = "still";
  stopStream();
  setStatus("Standbild aktiv · Vorschauauflösung verwendet");
  render();
  haptic();
}

function continueLive() {
  if (state.mode === "still" && rawCanvas.width) {
    startCamera();
    return;
  }
  startCamera();
}

function readImage(file) {
  if (!file) return;
  stopStream();
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.videoUrl = "";
  state.normal = false;
  state.zoom = 1;
  state.point = null;
  if (file.type.startsWith("video/")) {
    const fileVideo = document.createElement("video");
    fileVideo.muted = true;
    fileVideo.playsInline = true;
    fileVideo.src = URL.createObjectURL(file);
    state.videoUrl = fileVideo.src;
    fileVideo.addEventListener("loadeddata", () => {
      state.image = fileVideo;
      state.mode = "still";
      drawImageSource();
      setStatus("Video-Standbild · erster Frame lokal geladen");
      render();
    }, {once: true});
    return;
  }
  const image = new Image();
  image.onload = () => {
    state.image = image;
    state.mode = "still";
    drawImageSource();
    setStatus("Standbild aktiv · Bild lokal geöffnet");
    render();
  };
  image.onerror = () => setStatus("Bild konnte nicht geöffnet werden.");
  image.src = URL.createObjectURL(file);
  state.videoUrl = image.src;
}

function toggleNormal() {
  state.normal = !state.normal;
  setStatus(state.normal ? "Normalansicht · Filter ausgeblendet" : "Filteransicht · Profil aktiv");
  render();
}

function setPipette(enabled) {
  state.pipette = enabled;
  $("pipetteMarker").hidden = !enabled || !state.point;
  setStatus(enabled ? "Pipette aktiv · über die Bildfläche ziehen" : "Pipette ausgeschaltet");
  haptic();
  setButtonState();
}

function imagePointFromEvent(event) {
  if (!rawCanvas.width || !rawCanvas.height) return null;
  const rect = $("stage").getBoundingClientRect();
  const stageX = event.clientX - rect.left;
  const stageY = event.clientY - rect.top;
  const baseScale = Math.min(rect.width / rawCanvas.width, rect.height / rawCanvas.height);
  const drawWidth = rawCanvas.width * baseScale;
  const drawHeight = rawCanvas.height * baseScale;
  const baseX = (stageX - rect.width / 2) / state.zoom + rect.width / 2;
  const baseY = (stageY - rect.height / 2) / state.zoom + rect.height / 2;
  const left = (rect.width - drawWidth) / 2;
  const top = (rect.height - drawHeight) / 2;
  const x = clamp(Math.round((baseX - left) / baseScale), 0, rawCanvas.width - 1);
  const y = clamp(Math.round((baseY - top) / baseScale), 0, rawCanvas.height - 1);
  return {x, y, stageX, stageY};
}

function sampleAtEvent(event) {
  const point = imagePointFromEvent(event);
  if (!point) return;
  state.point = point;
  const marker = $("pipetteMarker");
  marker.style.left = `${point.stageX}px`;
  marker.style.top = `${point.stageY}px`;
  marker.hidden = false;
  state.lastResult = analyzeColor(point.x, point.y);
  renderResult(state.lastResult);
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  return [h, max ? delta / max : 0, max];
}

function hueDistance(a, b) { const d = Math.abs(a - b); return Math.min(d, 360 - d); }
function median(values) { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; }

function analyzeColor(centerX, centerY) {
  const radius = state.area === "small" ? 18 : state.area === "large" ? 48 : 30;
  const samples = [];
  const source = rawContext.getImageData(0, 0, rawCanvas.width, rawCanvas.height).data;
  for (let y = Math.max(0, centerY - radius); y <= Math.min(rawCanvas.height - 1, centerY + radius); y++) {
    for (let x = Math.max(0, centerX - radius); x <= Math.min(rawCanvas.width - 1, centerX + radius); x++) {
      if (Math.hypot(x - centerX, y - centerY) > radius) continue;
      const offset = (y * rawCanvas.width + x) * 4;
      const hsv = rgbToHsv(source[offset], source[offset + 1], source[offset + 2]);
      samples.push({r: source[offset], g: source[offset + 1], b: source[offset + 2], h: hsv[0], s: hsv[1], v: hsv[2]});
    }
  }
  if (!samples.length) return null;
  const neutralRatio = samples.filter(sample => sample.s < .20).length / samples.length;
  let selected = samples;
  let dominantHue = 0;
  let mixed = false;
  if (neutralRatio < .68) {
    const bins = Array(36).fill(0);
    samples.forEach(sample => {
      const weight = Math.max(.18, sample.s);
      const bin = Math.floor(sample.h / 10) % 36;
      bins[bin] += weight;
    });
    const order = bins.map((value, index) => ({value, index})).sort((a, b) => b.value - a.value);
    dominantHue = order[0].index * 10 + 5;
    const secondHue = order[1].index * 10 + 5;
    mixed = order[1].value > order[0].value * .48 && hueDistance(dominantHue, secondHue) > 42;
    selected = samples.filter(sample => hueDistance(sample.h, dominantHue) <= 38);
    if (selected.length < Math.max(5, samples.length / 4)) selected = samples;
  }
  const r = median(selected.map(sample => sample.r));
  const g = median(selected.map(sample => sample.g));
  const b = median(selected.map(sample => sample.b));
  const hsv = rgbToHsv(r, g, b);
  const spread = selected.reduce((max, sample) => Math.max(max, hueDistance(sample.h, dominantHue)), 0);
  const dominantRatio = selected.length / samples.length;
  const confidence = mixed || dominantRatio < .46 || spread > 34 ? "niedrig" : dominantRatio < .64 || spread > 28 ? "mittel" : "hoch";
  const reason = mixed ? "gemischte Fläche oder Kante erkannt" : spread > 28 ? "Struktur erkannt" : "Fläche überwiegend einheitlich";
  const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b);
  let quality = "gut · Fläche überwiegend einheitlich";
  if (maximum < 32) quality = "eingeschränkt · zu dunkel";
  else if (maximum > 248 && maximum - minimum < 18) quality = "eingeschränkt · sehr hell oder Spiegelung";
  else if (mixed || confidence === "niedrig") quality = "eingeschränkt · Fläche uneinheitlich";
  else if (confidence === "mittel") quality = "brauchbar · möglichst gleichmäßig beleuchten";
  return {r, g, b, name: colorName(hsv[0], hsv[1], hsv[2]), confidence, reason, quality, count: samples.length};
}

function colorName(hue, saturation, value) {
  if (value < .18) return "Schwarz";
  if (saturation < .12) return value > .92 ? "Weiß" : "Grau";
  if (value < .34) return "Dunkel";
  if (hue < 12 || hue >= 345) return "Rot";
  if (hue < 42) return "Orange";
  if (hue < 70) return "Gelb";
  if (hue < 165) return "Grün";
  if (hue < 205) return "Türkis";
  if (hue < 260) return "Blau";
  if (hue < 320) return "Violett";
  return "Pink";
}

function renderResult(result) {
  if (!result) return;
  const hex = [result.r, result.g, result.b].map(value => value.toString(16).padStart(2, "0")).join("").toUpperCase();
  $("pipetteResult").textContent = `Grundfarbe: ${result.name}\nMessqualität: ${result.quality}\nSicherheit: ${result.confidence} · ${result.reason}\nHEX #${hex} · RGB ${result.r}, ${result.g}, ${result.b}\nMessung: ${result.count} Pixel`;
  $("colorSwatch").style.background = `rgb(${result.r}, ${result.g}, ${result.b})`;
  setButtonState();
}

function cycleArea() {
  state.area = state.area === "small" ? "medium" : state.area === "medium" ? "large" : "small";
  $("areaButton").textContent = `MESSFLÄCHE · ${state.area === "small" ? "KLEIN" : state.area === "large" ? "GROSS" : "MITTEL"}`;
  if (state.point) { state.lastResult = analyzeColor(state.point.x, state.point.y); renderResult(state.lastResult); }
}

async function toggleTorch() {
  if (!state.torchTrack) return;
  state.torchOn = !state.torchOn;
  try {
    await state.torchTrack.applyConstraints({advanced: [{torch: state.torchOn}]});
    $("torchButton").textContent = state.torchOn ? "TASCHENLAMPE AN" : "TASCHENLAMPE AUS";
  } catch (_) {
    state.torchOn = false;
    setStatus("Taschenlampe wird von diesem Browser nicht unterstützt.");
  }
}

function saveNote() {
  if (!state.lastResult) return;
  const label = window.prompt("Name für diese Messung", "Meine Farbmessung");
  if (label === null) return;
  state.notes.unshift({label: label.trim() || "Meine Farbmessung", result: state.lastResult, date: new Date().toISOString()});
  state.notes = state.notes.slice(0, 30);
  localStorage.setItem("sehplus_color_notes", JSON.stringify(state.notes));
  setStatus("Farbmessung lokal gespeichert · kein Foto");
}

async function shareResult() {
  if (!state.lastResult) return;
  const result = state.lastResult;
  const hex = [result.r, result.g, result.b].map(value => value.toString(16).padStart(2, "0")).join("").toUpperCase();
  const text = `SehPlus Farbkarte\nGrundfarbe: ${result.name}\nMessqualität: ${result.quality}\nSicherheit: ${result.confidence}\nHEX #${hex} · RGB ${result.r}, ${result.g}, ${result.b}`;
  try {
    if (navigator.share) await navigator.share({title: "SehPlus Farbkarte", text});
    else await navigator.clipboard.writeText(text);
    setStatus(navigator.share ? "Farbkarte geteilt" : "Farbkarte in die Zwischenablage kopiert");
  } catch (_) { setStatus("Teilen wurde abgebrochen."); }
}

function updateFilter() { state.filter = $("filterSelect").value; state.normal = false; setStatus(`Filter · ${PROFILES[state.filter].name}`); render(); }
function updateStrength() { state.strength = Number($("strengthRange").value) / 100; $("strengthValue").textContent = `${Math.round(state.strength * 100)} %`; render(); }
function updateRecognition() { state.recognition = $("recognitionSelect").value; state.normal = false; setStatus(state.recognition === "off" ? "Normaler Filter aktiv" : `${$("recognitionSelect").selectedOptions[0].textContent} · Erkennung aktiv`); render(); }
function updateZoom(delta) { state.zoom = clamp(state.zoom + delta, 1, 4); setButtonState(); }

function showHelp() {
  window.alert("1. Kamera starten und möglichst gleichmäßig beleuchten.\n\n2. Für Testbilder oder Whiteboards Standbild und Farben verschieben verwenden.\n\n3. Mit der Pipette eine matte, möglichst gleichmäßige Fläche messen. Die Farbnamen sind Näherungen; HEX/RGB und Messqualität helfen beim Einordnen.");
}

function wireEvents() {
  $("cameraButton").addEventListener("click", () => state.mode === "live" && state.stream ? stopCameraFromUserAction() : startCamera());
  $("imageInput").addEventListener("change", event => readImage(event.target.files[0]));
  $("stillButton").addEventListener("click", () => state.mode === "live" && state.stream ? freezeFrame() : continueLive());
  $("pipetteButton").addEventListener("click", () => setPipette(!state.pipette));
  $("normalButton").addEventListener("click", toggleNormal);
  $("filterSelect").addEventListener("change", updateFilter);
  $("strengthRange").addEventListener("input", updateStrength);
  $("recognitionSelect").addEventListener("change", updateRecognition);
  $("zoomOut").addEventListener("click", () => updateZoom(-.25));
  $("zoomReset").addEventListener("click", () => { state.zoom = 1; setButtonState(); });
  $("zoomIn").addEventListener("click", () => updateZoom(.5));
  $("areaButton").addEventListener("click", cycleArea);
  $("torchButton").addEventListener("click", toggleTorch);
  $("saveNoteButton").addEventListener("click", saveNote);
  $("shareButton").addEventListener("click", shareResult);
  $("helpButton").addEventListener("click", showHelp);
  $("autoEnhance").checked = state.autoEnhance;
  $("haptics").checked = state.haptics;
  $("autoEnhance").addEventListener("change", event => { state.autoEnhance = event.target.checked; localStorage.setItem("sehplus_auto_enhance", state.autoEnhance); render(); });
  $("haptics").addEventListener("change", event => { state.haptics = event.target.checked; localStorage.setItem("sehplus_haptics", state.haptics); });
  $("clearData").addEventListener("click", () => { localStorage.removeItem("sehplus_color_notes"); state.notes = []; setStatus("Lokale Farbmemos gelöscht"); });
  $("stage").addEventListener("pointerdown", event => { if (state.pipette) { $("stage").setPointerCapture?.(event.pointerId); sampleAtEvent(event); } });
  $("stage").addEventListener("pointermove", event => { if (state.pipette && (event.buttons || event.pointerType === "touch")) sampleAtEvent(event); });
  document.querySelectorAll(".nav-button").forEach(button => button.addEventListener("click", () => showPage(button.dataset.page)));
  const feedback = $("feedbackLink");
  $("donationLink").href = CONFIG.donationUrl;
  if (CONFIG.feedbackUrl.includes("DEIN_FORMULAR_ID")) {
    feedback.removeAttribute("href");
    feedback.addEventListener("click", event => { event.preventDefault(); window.alert("Bitte zuerst den Google-Forms-Link in web/app.js eintragen."); });
  } else feedback.href = CONFIG.feedbackUrl;
  const welcome = $("welcomeDialog");
  const closeWelcome = () => { localStorage.setItem("sehplus_web_welcome", "true"); welcome.close(); };
  $("welcomeLater").addEventListener("click", closeWelcome);
  $("welcomeStart").addEventListener("click", () => { closeWelcome(); startCamera(); });
  if (!localStorage.getItem("sehplus_web_welcome") && typeof welcome.showModal === "function") welcome.showModal();
}

window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); state.deferredInstall = event; $("installButton").hidden = false; });
$("installButton").addEventListener("click", async () => {
  if (!state.deferredInstall) return;
  state.deferredInstall.prompt();
  await state.deferredInstall.userChoice;
  state.deferredInstall = null;
  $("installButton").hidden = true;
});
window.addEventListener("pagehide", stopStream);
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
wireEvents();
setButtonState();
fetch("sehplus_color_assist_v2.json")
  .then(response => response.ok ? response.json() : Promise.reject(new Error("profile")))
  .then(profile => {
    profile.profiles?.forEach(entry => {
      if (!PROFILES[entry.id]) PROFILES[entry.id] = {};
      PROFILES[entry.id].name = entry.name || PROFILES[entry.id].name;
      if (entry.matrix) PROFILES[entry.id].matrix = entry.matrix;
    });
    if (profile.defaults?.strength != null) {
      state.strength = Number(profile.defaults.strength);
      $("strengthRange").value = Math.round(state.strength * 100);
      $("strengthValue").textContent = `${Math.round(state.strength * 100)} %`;
    }
    render();
  })
  .catch(() => {});
