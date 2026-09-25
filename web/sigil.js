// Procedural holographic emblem used when an agent has no avatar image:
// a geometry derived from the name (stable per agent) around its initial.
export function sigilSvg(name, color, center) {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const sides = 3 + (h % 5), turns = 1 + ((h >> 3) % 3), rot = (h >> 6) % 360;
  const poly = (r, k, off) => Array.from({ length: k }, (_, i) => {
    const a = ((i / k) * 360 + off) * Math.PI / 180;
    return `${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
  const layers = Array.from({ length: turns + 1 }, (_, i) =>
    `<polygon points="${poly(40 - i * 7, sides, rot + i * (180 / sides))}" fill="none" stroke="${color}" stroke-width="${1.2 - i * 0.2}" opacity="${0.9 - i * 0.2}"/>`).join("");
  return `<svg class="sigil" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="46" fill="none" stroke="${color}" stroke-width=".6" opacity=".5" stroke-dasharray="2 4"/>
    ${layers}
    ${center ?? `<text x="50" y="50" text-anchor="middle" dominant-baseline="central" fill="${color}" font-size="30" font-weight="200" font-family="inherit">${name[0]}</text>`}
  </svg>`;
}

// OpenClaw mascot (outline from the official favicon, openclaw/openclaw ui/public/favicon.svg, MIT), redrawn
// as a hologram: neon outline in the interface colour, translucent fill with scan lines, glowing eyes.
// Keeps the original idle motion (float, claws snapping, eyes blinking) with SMIL, so no script runs for it.
const spline = 'calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1; 0.42 0 0.58 1; 0.42 0 0.58 1"';
const claw = (d, pivot, begin = "0s") => `<path d="${d}" fill="url(#oc-fill)" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round">
      <animateTransform attributeName="transform" type="rotate" values="0 ${pivot}; 0 ${pivot}; -8 ${pivot}; 0 ${pivot}; 0 ${pivot}"
        keyTimes="0; 0.85; 0.9; 0.95; 1" dur="4s" begin="${begin}" repeatCount="indefinite" ${spline}/></path>`;
const eye = (x) => `<circle cx="${x}" cy="35" r="6.5" fill="#02060d" stroke="currentColor" stroke-width="1.2"/>
    <circle cx="${x + 1}" cy="34" r="2.6" fill="#e6fbff"><animate attributeName="opacity" values="1; 1; 0.2; 1" keyTimes="0; 0.9; 0.95; 1" dur="3s" repeatCount="indefinite"/></circle>`;

/** The J.A.R.V.I.S emblem: the rotating sigil geometry with the OpenClaw mascot at its centre. */
export function openclawSigilSvg(color) {
  const body = "M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z";
  const mascot = `<defs>
      <linearGradient id="oc-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".42"/><stop offset="1" stop-color="${color}" stop-opacity=".06"/></linearGradient>
      <pattern id="oc-scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1.3" fill="${color}" opacity=".35"/>
        <animateTransform attributeName="patternTransform" type="translate" values="0 0; 0 4" dur="1.2s" repeatCount="indefinite"/></pattern>
    </defs>
    <g transform="translate(23.6 25) scale(.44)" style="color:${color}">
      <g><animateTransform attributeName="transform" type="translate" values="0 0; 0 -5; 0 0" keyTimes="0; 0.5; 1" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"/>
        <path d="M45 15 Q35 5 30 8 M75 15 Q85 5 90 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
        ${claw("M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z", "26 53")}
        ${claw("M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z", "94 53", "0.2s")}
        <path d="${body}" fill="url(#oc-fill)" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>
        <path d="${body}" fill="url(#oc-scan)"/>
        <path d="M40 72 Q60 80 80 72 M42 84 Q60 91 78 84" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55"/>
        ${eye(45)}${eye(75)}
      </g>
    </g>`;
  return sigilSvg("JARVIS", color, mascot).replace('class="sigil"', 'class="sigil emblem"');
}
