// Field Manual — an interactive book modal explaining what to do in the
// game and the real Antarctic microbiology behind it. Pages render as a
// two-page spread on wide screens, single-page on narrow.
//
// Pages are HTML strings; ToC entries use `data-spread="N"` to jump.
import * as controls from "./controls.js";

// ── page-turn sound ───────────────────────────────────────────────────
// Synthesised at runtime so we don't need a binary asset. Two staggered
// bandpass-filtered noise bursts: a thin "lift" then a soft "set-down".
let _audioCtx = null;
function getAudioCtx() {
    if (_audioCtx) return _audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    _audioCtx = new Ctx();
    return _audioCtx;
}
function playPageTurn() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume?.();
    const now = ctx.currentTime;
    const burst = (offset, duration, peak, freq, q) => {
        const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = freq;
        filter.Q.value = q;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, now + offset);
        gain.gain.linearRampToValueAtTime(peak, now + offset + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        src.start(now + offset);
        src.stop(now + offset + duration + 0.02);
    };
    // Two thumps timed to the close-and-reopen animation:
    // 1) book closing (pages snapping shut while the gloves press)
    burst(0.05, 0.16, 0.09, 3500, 0.7);
    // 2) book reopening (a softer "whoosh" as the pages unfold again)
    burst(0.40, 0.22, 0.10, 2300, 0.9);
}

const SVG_BACTERIA = `
    <svg viewBox="0 0 200 80" class="art-bacteria">
        <ellipse cx="40" cy="40" rx="22" ry="11" fill="#7ed957" stroke="#0d0d0d" stroke-width="2"/>
        <circle cx="32" cy="35" r="2.5" fill="#0d0d0d"/>
        <circle cx="48" cy="44" r="2" fill="#0d0d0d"/>
        <ellipse cx="105" cy="45" rx="28" ry="9" fill="#5cb8d0" stroke="#0d0d0d" stroke-width="2" transform="rotate(-12 105 45)"/>
        <circle cx="98" cy="42" r="2" fill="#0d0d0d"/>
        <circle cx="115" cy="48" r="1.8" fill="#0d0d0d"/>
        <circle cx="160" cy="38" r="9" fill="#f0a875" stroke="#0d0d0d" stroke-width="2"/>
        <circle cx="178" cy="48" r="6" fill="#f0a875" stroke="#0d0d0d" stroke-width="2"/>
        <circle cx="158" cy="38" r="1.5" fill="#0d0d0d"/>
        <circle cx="177" cy="48" r="1.2" fill="#0d0d0d"/>
    </svg>
`;

const SVG_CRYOCONITE = `
    <svg viewBox="0 0 200 110" class="art-section">
        <rect x="0" y="0" width="200" height="65" fill="#dae6ee"/>
        <rect x="0" y="65" width="200" height="45" fill="#9bb6c7"/>
        <ellipse cx="60" cy="68" rx="22" ry="6" fill="#3a4a55"/>
        <path d="M 38 65 Q 60 95 82 65" fill="#5a8aa8" stroke="#0d0d0d" stroke-width="1.2"/>
        <ellipse cx="140" cy="70" rx="14" ry="3.5" fill="#3a4a55"/>
        <path d="M 126 70 Q 140 88 154 70" fill="#5a8aa8" stroke="#0d0d0d" stroke-width="1"/>
        <text x="60" y="105" font-size="9" text-anchor="middle" fill="#0d2233">cryoconite hole</text>
    </svg>
`;

const SVG_TUBE = `
    <svg viewBox="0 0 60 140" class="art-tube">
        <rect x="18" y="6" width="24" height="14" fill="#888" stroke="#0d0d0d" stroke-width="1.5" rx="2"/>
        <rect x="20" y="20" width="20" height="110" fill="rgba(94,184,208,0.4)" stroke="#0d0d0d" stroke-width="1.5"/>
        <path d="M 20 130 Q 30 140 40 130 L 40 110 L 20 110 Z" fill="rgba(94,184,208,0.55)" stroke="#0d0d0d" stroke-width="1.5"/>
        <rect x="22" y="40" width="16" height="68" fill="rgba(255,255,255,0.5)"/>
        <circle cx="28" cy="80" r="1.8" fill="#7ed957"/>
        <circle cx="34" cy="92" r="1.5" fill="#7ed957"/>
        <circle cx="30" cy="105" r="1.2" fill="#7ed957"/>
    </svg>
`;

const SVG_PETRI = `
    <svg viewBox="0 0 120 120" class="art-petri">
        <circle cx="60" cy="60" r="55" fill="#dde6ee" stroke="#0d0d0d" stroke-width="2"/>
        <circle cx="60" cy="60" r="55" fill="url(#petriShineManual)"/>
        <defs>
            <radialGradient id="petriShineManual" cx="35%" cy="32%" r="65%">
                <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>
                <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
            </radialGradient>
        </defs>
        <ellipse cx="48" cy="50" rx="14" ry="9" fill="#7ed957" stroke="#0d0d0d" stroke-width="1.3"/>
        <ellipse cx="78" cy="74" rx="9" ry="6" fill="#a4b86a" stroke="#0d0d0d" stroke-width="1.2"/>
        <circle cx="66" cy="42" r="3" fill="#5cb8d0" stroke="#0d0d0d" stroke-width="1"/>
        <circle cx="80" cy="50" r="2" fill="#5cb8d0" stroke="#0d0d0d" stroke-width="1"/>
        <circle cx="42" cy="78" r="2.5" fill="#f0a875" stroke="#0d0d0d" stroke-width="1"/>
    </svg>
`;

const SVG_MICROSCOPE = `
    <svg viewBox="0 0 120 140" class="art-section">
        <rect x="40" y="120" width="60" height="14" fill="#3a4a55" stroke="#0d0d0d" stroke-width="1.5" rx="2"/>
        <path d="M 60 30 L 80 30 L 80 90 L 60 90 Z" fill="#586876" stroke="#0d0d0d" stroke-width="1.5"/>
        <rect x="55" y="92" width="30" height="8" fill="#3a4a55" stroke="#0d0d0d" stroke-width="1.5"/>
        <rect x="50" y="100" width="40" height="20" fill="#586876" stroke="#0d0d0d" stroke-width="1.5"/>
        <circle cx="70" cy="22" r="10" fill="#dae6ee" stroke="#0d0d0d" stroke-width="1.5"/>
        <circle cx="70" cy="22" r="5" fill="#5a8aa8"/>
        <line x1="80" y1="50" x2="100" y2="40" stroke="#0d0d0d" stroke-width="1.5"/>
        <circle cx="100" cy="40" r="4" fill="#3a4a55" stroke="#0d0d0d" stroke-width="1.2"/>
    </svg>
`;

const SVG_PLANET = `
    <svg viewBox="0 0 140 140" class="art-section">
        <circle cx="70" cy="70" r="55" fill="#3a5a78" stroke="#0d0d0d" stroke-width="2"/>
        <path d="M 30 60 Q 70 50 110 65" stroke="#dae6ee" stroke-width="2" fill="none" opacity="0.7"/>
        <path d="M 25 80 Q 70 90 115 75" stroke="#dae6ee" stroke-width="2" fill="none" opacity="0.7"/>
        <path d="M 35 95 Q 70 105 105 92" stroke="#dae6ee" stroke-width="1.5" fill="none" opacity="0.55"/>
        <circle cx="105" cy="40" r="3" fill="#ffe156"/>
    </svg>
`;

const SVG_AUTOCLAVE = `
    <svg viewBox="0 0 140 140" class="art-section">
        <rect x="20" y="22" width="100" height="86" fill="#586876" stroke="#0d0d0d" stroke-width="2" rx="8"/>
        <circle cx="70" cy="65" r="28" fill="#dae6ee" stroke="#0d0d0d" stroke-width="2"/>
        <circle cx="70" cy="65" r="22" fill="#3a4a55"/>
        <rect x="62" y="35" width="16" height="6" fill="#ffe156" stroke="#0d0d0d" stroke-width="1"/>
        <rect x="40" y="115" width="60" height="14" fill="#3a4a55" stroke="#0d0d0d" stroke-width="1.5"/>
        <text x="70" y="22" font-size="9" text-anchor="middle" fill="#0d2233">121&deg;C / 15 PSI</text>
        <line x1="35" y1="100" x2="45" y2="100" stroke="#0d0d0d" stroke-width="1.5"/>
        <line x1="50" y1="100" x2="60" y2="100" stroke="#0d0d0d" stroke-width="1.5"/>
    </svg>
`;

const SVG_STREAK = `
    <svg viewBox="0 0 140 140" class="art-section">
        <circle cx="70" cy="70" r="60" fill="#dde6ee" stroke="#0d0d0d" stroke-width="2"/>
        <g fill="none" stroke="#0d0d0d" stroke-width="1.6" stroke-linecap="round">
            <path d="M 30 32 Q 50 38 65 32 M 30 40 Q 50 46 65 40 M 30 48 Q 50 54 65 48"/>
            <path d="M 70 35 Q 90 50 100 70 M 78 32 Q 96 50 105 75 M 86 30 Q 102 52 110 78"/>
            <path d="M 100 95 L 60 100 M 105 100 L 65 108 M 108 105 L 70 116"/>
            <path d="M 35 110 L 28 90 M 42 113 L 32 95 M 48 116 L 36 100"/>
        </g>
        <text x="35" y="28" font-size="10" fill="#b33a1a" font-weight="bold">1</text>
        <text x="105" y="40" font-size="10" fill="#b33a1a" font-weight="bold">2</text>
        <text x="115" y="98" font-size="10" fill="#b33a1a" font-weight="bold">3</text>
        <text x="22" y="128" font-size="10" fill="#b33a1a" font-weight="bold">4</text>
    </svg>
`;

const SVG_DILUTION = `
    <svg viewBox="0 0 240 90" class="art-row-svg">
        <g stroke="#0d0d0d" stroke-width="1.5">
            <rect x="6" y="20" width="22" height="60" fill="#5cb8d0" rx="2"/>
            <rect x="40" y="20" width="22" height="60" fill="#7fcadb" rx="2"/>
            <rect x="74" y="20" width="22" height="60" fill="#a3dde8" rx="2"/>
            <rect x="108" y="20" width="22" height="60" fill="#c2e8ef" rx="2"/>
            <rect x="142" y="20" width="22" height="60" fill="#dcf1f5" rx="2"/>
            <rect x="176" y="20" width="22" height="60" fill="#eef8f9" rx="2"/>
            <rect x="210" y="20" width="22" height="60" fill="#f9fcfd" rx="2"/>
        </g>
        <g font-size="8" text-anchor="middle" fill="#0d2233">
            <text x="17" y="14">10⁻¹</text>
            <text x="51" y="14">10⁻²</text>
            <text x="85" y="14">10⁻³</text>
            <text x="119" y="14">10⁻⁴</text>
            <text x="153" y="14">10⁻⁵</text>
            <text x="187" y="14">10⁻⁶</text>
            <text x="221" y="14">10⁻⁷</text>
        </g>
        <g stroke="#b33a1a" stroke-width="1.6" fill="none" marker-end="url(#arrow)">
            <path d="M 30 50 L 38 50"/>
            <path d="M 64 50 L 72 50"/>
            <path d="M 98 50 L 106 50"/>
            <path d="M 132 50 L 140 50"/>
            <path d="M 166 50 L 174 50"/>
            <path d="M 200 50 L 208 50"/>
        </g>
        <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 Z" fill="#b33a1a"/>
            </marker>
        </defs>
    </svg>
`;

// Low-poly blue lab-glove hand. Built entirely from polygons so the
// silhouette reads as faceted geometry rather than a smooth render —
// each finger has a "lit" facet on its left side and a darker base
// triangle near the knuckle for cheap shading. The CSS mirrors this
// SVG via scaleX(-1) for the right hand.
const HAND_SVG = `
    <svg viewBox="0 0 200 280" xmlns="http://www.w3.org/2000/svg" stroke-linejoin="miter">
        <g stroke="#1a2233" stroke-width="2.2">
            <!-- forearm (slightly tapered quad) -->
            <polygon points="60,205 140,205 145,278 55,278" fill="#7fa8c8"/>
            <!-- glove cuff band (darker trapezoid) -->
            <polygon points="55,190 145,190 142,212 58,212" fill="#5a8db0"/>
            <!-- palm (irregular hexagon: wrist → side → side → top) -->
            <polygon points="58,212 50,142 60,90 100,80 142,92 152,142 142,212" fill="#a8c8e0"/>
            <!-- thumb (parallelogram) -->
            <polygon points="148,134 174,148 168,180 140,164" fill="#a8c8e0"/>
            <!-- four fingers (trapezoidal, slightly varied lengths) -->
            <polygon points="60,90 76,90 75,28 62,26" fill="#a8c8e0"/>
            <polygon points="80,86 100,86 99,16 82,14" fill="#a8c8e0"/>
            <polygon points="104,84 124,84 123,20 106,18" fill="#a8c8e0"/>
            <polygon points="128,90 144,90 144,38 130,36" fill="#a8c8e0"/>
        </g>
        <!-- "lit" facets — no stroke, slightly lighter colour -->
        <g fill="#c8def0" stroke="none">
            <polygon points="58,212 50,142 60,90 100,80 100,142 100,212"/>
            <polygon points="60,90 68,90 67,28 62,26"/>
            <polygon points="80,86 90,86 89,16 82,14"/>
            <polygon points="104,84 113,84 113,20 106,18"/>
            <polygon points="128,90 136,90 137,38 130,36"/>
            <polygon points="148,134 162,142 158,162 144,154"/>
        </g>
        <!-- shadow facets along the right side of the palm and thumb -->
        <g fill="#86afca" stroke="none">
            <polygon points="100,80 142,92 152,142 142,212 100,212 100,142"/>
            <polygon points="158,162 168,180 140,164 144,154"/>
        </g>
    </svg>
`;

const PAGES = [
    // 0 — Cover
    `<div class="page-cover">
        <div class="cover-art">${SVG_BACTERIA}</div>
        <h1 class="cover-title">Antarctic<br/>Sampler</h1>
        <h2 class="cover-sub">Field Manual &amp;<br/>Microbiology Primer</h2>
        <p class="cover-edition">Edition I · Ross Sector</p>
    </div>`,

    // 1 — Mission Brief
    `<div class="page-section">
        <h3 class="section-eyebrow">Foreword</h3>
        <h2>Mission Brief</h2>
        <p><span class="dropcap">Y</span>ou stand at the edge of an Antarctic field station, two labs at your back and a kilometer-thick ice sheet stretching to the horizon. Your work is simple to describe and hard to do: <em>collect ice</em>, <em>culture what's frozen inside</em>, and <em>document what grows</em>.</p>
        <p>This handbook is half lab manual, half microbiology primer. It tells you what buttons to press in the field, why each step matters scientifically, and what to expect from the strange life that calls this continent home.</p>
        <div class="callout">
            <strong>Today's objectives</strong>
            <ol>
                <li>Find and harvest at least three ice samples (look for bluish blocks).</li>
                <li>Bring them inside and inoculate petri dishes.</li>
                <li>Wait. Observe. Log what grows.</li>
            </ol>
        </div>
    </div>`,

    // 2 — Profile L: Josefina Castellví
    `<div class="page-section page-profile">
        <h3 class="section-eyebrow">Profile</h3>
        <h2>Josefina Castellví</h2>
        <p class="profile-sub">Marine microbiologist · Chief scientist of Spain's first Antarctic campaign</p>
        <p><span class="dropcap">I</span>n December of 1986, a Spanish marine microbiologist named <strong>Josefina Castellví Piulachs</strong> stepped ashore on Livingston Island. She was fifty-one. She had been born in Barcelona, taken her doctorate at the Universitat de Barcelona in 1969, and spent two decades at the <em>Instituto de Ciencias del Mar</em> studying how bacteria live in seawater. She was about to lead Spain's first Antarctic scientific campaign.</p>
        <p>Spain had joined the Antarctic Treaty only four years earlier. The country had no Antarctic experience, no base, no logistics chain. <em>Campaña Antártica Española I</em> was a rented foothold: thirteen scientists camped under the wing of the Argentine Antarctic program, sailing south from Ushuaia aboard the <em>Bahía Paraíso</em>.</p>
        <p>Their mission was twofold: choose a site for a permanent Spanish base, and prove that Spanish science could survive — and produce — at 62°S.</p>
    </div>`,

    // 3 — Profile R: Castellví continued
    `<div class="page-section page-profile">
        <h3 class="section-eyebrow">Profile · cont.</h3>
        <h2>The First Season</h2>
        <p>Castellví ran the science program. While colleagues surveyed geology, glaciology, and meteorology, she returned to what she had spent her life studying: bacteria. How fast did they grow in seawater near zero? How did their communities differ between glacial fjords and the open shelf? What did the cold do to their enzymes?</p>
        <p>Her data from that first summer fed directly into the proposal for <strong>Base Antártica Española Juan Carlos I</strong>, which opened on Livingston Island in January 1988. Castellví became its first scientific director — and the first woman ever to lead a national base in Antarctica. She steered the Spanish campaigns through 1993.</p>
        <p>She wrote about all of it in <em>Yo, la primera mujer que mandó en la Antártida</em> — the loneliness, the wind, the small triumph of a centrifuge spinning in a tent at the bottom of the world.</p>
        <div class="callout">
            &ldquo;En la Antártida, el tiempo se mide en bacterias que crecen.&rdquo;
            <span class="callout-attrib">&mdash; J. Castellví</span>
        </div>
        <p class="profile-tie">The work in this handbook — bluish ice, sterile tubes, agar plates, slow colonies — is, in spirit, the work she did. Microbiology is the patient science. The cold rewards patience.</p>
    </div>`,

    // 4 — Table of Contents
    `<div class="page-section">
        <h3 class="section-eyebrow">Table of</h3>
        <h2>Contents</h2>
        <ol class="toc">
            <li><a data-spread="1">Profile · Josefina Castellví</a><span class="toc-num">&sect;</span></li>
            <li><a data-spread="2">Welcome to the Field</a><span class="toc-num">I</span></li>
            <li><a data-spread="3">Where Life Hides at &minus;40&deg;C</a><span class="toc-num">II</span></li>
            <li><a data-spread="3">The Sampling Procedure</a><span class="toc-num">III</span></li>
            <li><a data-spread="4">Aseptic Technique</a><span class="toc-num">IV</span></li>
            <li><a data-spread="4">Cultivation Media</a><span class="toc-num">V</span></li>
            <li><a data-spread="5">Preparing Media</a><span class="toc-num">VI</span></li>
            <li><a data-spread="5">Inoculation Techniques</a><span class="toc-num">VII</span></li>
            <li><a data-spread="6">Incubation &amp; Maintenance</a><span class="toc-num">VIII</span></li>
            <li><a data-spread="6">Identifying What You Found</a><span class="toc-num">IX</span></li>
            <li><a data-spread="7">Why This Matters</a><span class="toc-num">X</span></li>
            <li><a data-spread="7">Glossary</a><span class="toc-num">&sect;</span></li>
        </ol>
        <p class="toc-hint">Tap a chapter to jump · arrow keys flip pages.</p>
    </div>`,

    // 3 — Chapter 1: Welcome to the Field
    `<div class="page-section">
        <h3 class="chapter-num">Chapter I</h3>
        <h2>Welcome to the Field</h2>
        <p><span class="dropcap">F</span>or most of the twentieth century, scientists assumed Antarctica was sterile. A kilometer-thick sheet of ice. Interior temperatures averaging &minus;57&deg;C in winter. Winds that scour the surface for nine months a year. Nothing should live here.</p>
        <p>It does. Antarctica just hides its life carefully.</p>
        <p>The Antarctic biosphere is overwhelmingly <em>microbial</em> — bacteria, archaea, microscopic fungi, single-celled algae — clinging to surprisingly specific niches. Some live in cracks of glacial ice where summer sun produces millimeter-thin films of meltwater. Others colonize the underside of sea ice, where cold-tolerant diatoms photosynthesize through a frozen ceiling. A few exist in subglacial lakes that haven't seen sunlight in millions of years.</p>
        <p>Your job is to bring back specimens of those communities — alive — so we can grow them in the lab and study them.</p>
        <div class="ingame">
            <strong>In game.</strong> Walk the field looking for bluish ice blocks. Stand near one and click (or press <kbd>E</kbd>) to harvest a sample. Each block holds a few before it's exhausted.
        </div>
    </div>`,

    // 4 — Chapter 2: Extremophiles
    `<div class="page-section">
        <h3 class="chapter-num">Chapter II</h3>
        <h2>Where Life Hides at &minus;40&deg;C</h2>
        <p>Cold-loving organisms are called <em>psychrophiles</em>, from the Greek <em>psychros</em> (cold) and <em>philos</em> (loving). Strictly defined, a psychrophile grows optimally at or below 15&deg;C and cannot grow above 20&deg;C.</p>
        <div class="art-row">${SVG_CRYOCONITE}</div>
        <p>Three habitats dominate Antarctic microbiology:</p>
        <p><strong>Cryoconite holes.</strong> Wind-blown dust and soot darken patches of the ice surface, absorb sunlight, and melt small cylindrical pits. Each pit becomes a self-contained pond — a miniature ecosystem with its own community.</p>
        <p><strong>Sub-ice brines.</strong> As sea ice freezes, it expels salt, leaving channels that stay liquid down to &minus;20&deg;C. Densely populated by diatoms, copepods, and bacteria.</p>
        <p><strong>Subglacial lakes.</strong> Beneath kilometers of pressing ice, geothermal heat keeps water liquid. Lake Vostok and Lake Whillans both hold microbial life isolated from the surface for hundreds of thousands of years.</p>
    </div>`,

    // 5 — Chapter 3: Sampling
    `<div class="page-section">
        <h3 class="chapter-num">Chapter III</h3>
        <h2>The Sampling Procedure</h2>
        <div class="art-row art-row-right">${SVG_TUBE}</div>
        <ol class="protocol">
            <li><strong>Survey.</strong> Look for visibly different ice — melt features, biological staining (red snow, green ice). Photograph the location.</li>
            <li><strong>Sterilize.</strong> Rinse tools with ethanol or flame the metal scoop. One fingerprint of contamination can outcompete your real sample in the dish.</li>
            <li><strong>Collect.</strong> Take a small chip into a sterile tube. Cap it. Don't breathe directly into the tube. Don't touch the inside of the cap.</li>
            <li><strong>Log.</strong> Note coordinates, time, depth, ice temperature, surface conditions. Without metadata, a sample is half-useless.</li>
        </ol>
        <div class="ingame">
            <strong>In game.</strong> Sampling is automated when you're close to a viable ice block — just click. The tube on your hand glows green when full. <kbd>Q</kbd> throws a sample, <kbd>E</kbd> picks one up.
        </div>
    </div>`,

    // 6 — Chapter 4: Aseptic Technique
    `<div class="page-section">
        <h3 class="chapter-num">Chapter IV</h3>
        <h2>Aseptic Technique</h2>
        <p><span class="dropcap">T</span>he most common cause of failed cultures is <em>contamination</em>: your sample grows fine, but a colony of skin bacteria from your hands grows faster and dominates the plate.</p>
        <p>The discipline of working without contaminating is called <em>aseptic technique</em>. Three rules:</p>
        <ul class="rules">
            <li>Treat the air, your skin, and the outside of every tube as <em>contaminated</em>.</li>
            <li>Treat the inside of sealed tubes, the agar surface, and your inoculating loop (after flaming) as <em>sterile</em>.</li>
            <li>Open tubes for the shortest possible time. Pop the lid, work, replace.</li>
        </ul>
        <p>In a serious lab you'd work near a Bunsen flame; rising hot air keeps airborne contaminants from settling on your bench. In the field, you rely on ethanol wipes and discipline.</p>
    </div>`,

    // 7 — Chapter V: Cultivation Media
    `<div class="page-section">
        <h3 class="chapter-num">Chapter V</h3>
        <h2>Cultivation Media</h2>
        <div class="art-row art-row-right">${SVG_PETRI}</div>
        <p><span class="dropcap">A</span> growth medium is the food you serve the microbes. Think of it as a bespoke meal — the recipe determines who shows up to the table. Media split along several axes:</p>
        <p><strong>Solid vs liquid.</strong> Liquid (broth) lets cells multiply in suspension. Solid (with ~1.5% agar) lets discrete colonies form on a surface. Both are essential: broth for biomass, solid for isolation.</p>
        <p><strong>Defined vs complex.</strong> A <em>defined</em> medium has every component listed by chemical name and amount — useful for studying nutrient requirements. A <em>complex</em> medium uses undefined ingredients (yeast extract, peptone, beef extract) — closer to "real" food, easier in practice.</p>
        <p><strong>Selective.</strong> Contains an ingredient that suppresses unwanted organisms — antibiotics, high salt, low pH. Lets you fish for one group while ignoring others.</p>
        <p><strong>Differential.</strong> Contains an ingredient that produces visibly different colony appearance based on metabolism. Doesn't filter who grows; <em>labels</em> who has grown.</p>
        <div class="callout">
            <strong>Antarctic recipes you'll meet</strong>
            <ul>
                <li><strong>R2A.</strong> Low-nutrient. Default for glacial ice — psychrophiles starve on rich media.</li>
                <li><strong>Marine 2216 / ZoBell.</strong> High-salt, peptone &amp; yeast extract. For sub-ice brines and seawater.</li>
                <li><strong>Reasoner's.</strong> Drinking-water and oligotrophic surveys.</li>
                <li><strong>TSA.</strong> Rich, fast-growing generalist — biased toward weeds, but a useful baseline.</li>
            </ul>
        </div>
    </div>`,

    // 8 — Chapter VI: Preparing Media
    `<div class="page-section">
        <h3 class="chapter-num">Chapter VI</h3>
        <h2>Preparing Media</h2>
        <div class="art-row">${SVG_AUTOCLAVE}</div>
        <p>Most media come as a dehydrated powder. The recipe is on the bottle; the discipline is in the steps.</p>
        <ol class="protocol">
            <li><strong>Weigh.</strong> Measure the powder per bottle directions, typically 18–40 g per liter.</li>
            <li><strong>Suspend.</strong> Add to deionized water in an Erlenmeyer flask. Swirl. Heat gently — the agar must fully melt (~95&deg;C) or it sets unevenly.</li>
            <li><strong>Autoclave.</strong> 121&deg;C at 15 psi for 15–20 minutes. Pressure-sterilization kills everything, including bacterial spores.</li>
            <li><strong>Cool.</strong> To ~50&deg;C in a water bath. Hotter and the dishes warp; cooler and the agar sets in the flask.</li>
            <li><strong>Pour.</strong> Under a flame or in a laminar-flow hood, ~20 mL into each sterile dish (≈ 25 dishes per liter). Replace the lid quickly.</li>
            <li><strong>Set &amp; dry.</strong> 30 min at room temp to set, then ~1 hr lid-cracked-open to dry surface moisture.</li>
            <li><strong>Store.</strong> Inverted (lid down) at 4&deg;C in a sealed bag. Use within 2–3 weeks.</li>
        </ol>
        <div class="callout">
            <strong>Cardinal rule.</strong> Pour with a flame nearby. Five seconds of an open dish exposed to ambient air can deposit 10–50 contaminating cells.
        </div>
    </div>`,

    // 9 — Chapter VII: Inoculation Techniques
    `<div class="page-section">
        <h3 class="chapter-num">Chapter VII</h3>
        <h2>Inoculation Techniques</h2>
        <div class="art-row art-row-right">${SVG_STREAK}</div>
        <p>Several ways to put cells onto or into media, each suited to a different question.</p>
        <p><strong>Streak plate.</strong> Drag an inoculating loop across the agar in a four-quadrant pattern, flaming the loop between quadrants. Each quadrant dilutes the sample further. The fourth quadrant should give isolated colonies — the gold standard for getting <em>pure cultures</em>.</p>
        <p><strong>Spread plate.</strong> Pipette a small volume (0.1 mL) of liquid sample onto the surface, then spread with a sterile bent glass rod. Best for counting cells: each colony came from one cell in known volume.</p>
        <p><strong>Pour plate.</strong> Mix the sample into molten cooled agar (~45&deg;C) in a tube, then pour the inoculated mixture into a dish. Colonies grow inside the agar as well as on top — useful for anaerobes and for total counts.</p>
        <p><strong>Broth culture.</strong> Add sample to a tube of liquid medium. Bacteria multiply in suspension. Used for biomass production and as a precursor to other techniques.</p>
        <p><strong>Stab inoculation.</strong> A straight wire driven into a tube of soft (semi-solid) agar — for anaerobes and motility tests.</p>
        <div class="art-row">${SVG_DILUTION}</div>
        <p><strong>Serial dilution.</strong> Dilute the sample 10-fold step by step (1 mL into 9 mL, repeat). Plate each dilution. The plate that gives 30–300 colonies is the one you count; multiply by the dilution factor to get cells per mL of original sample. The unit is <em>CFU/mL</em> — colony-forming units per millilitre.</p>
    </div>`,

    // 10 — Chapter VIII: Incubation & Maintenance
    `<div class="page-section">
        <h3 class="chapter-num">Chapter VIII</h3>
        <h2>Incubation &amp; Maintenance</h2>
        <p>Once inoculated, the conditions matter as much as the medium.</p>
        <p><strong>Temperature.</strong> Match the source environment. Antarctic isolates: 4&deg;C. Soil generalists: 25&deg;C. Human-associated: 37&deg;C. Above 30&deg;C will kill psychrophiles outright.</p>
        <p><strong>Atmosphere.</strong> Most are obligate aerobes (need oxygen). Some are obligate anaerobes (oxygen kills them — incubate in sealed jars with oxygen scavengers). A few are microaerophilic.</p>
        <p><strong>Time.</strong> Antarctic samples are slow. Don't expect colonies in 24 hours; first-pass plates from glacial ice give visible growth in 5–14 days, sometimes longer.</p>
        <p><strong>Reading.</strong> Once colonies appear, score each by morphology — shape, size, color, surface, edge. Count if doing density work. Photograph for the lab notebook.</p>
        <p><strong>Subculturing (passaging).</strong> A pure culture must be transferred to fresh medium every 1–4 weeks or it dies as nutrients deplete and waste accumulates. Pick a single isolated colony and re-streak.</p>
        <div class="callout">
            <strong>Long-term storage</strong>
            <ul>
                <li><strong>Agar slants.</strong> Pure culture stabbed into slanted agar in a tube. Months at 4&deg;C. Cheap, reliable.</li>
                <li><strong>Glycerol stocks.</strong> Mix 1:1 with sterile 50% glycerol; freeze at &minus;80&deg;C. Indefinite.</li>
                <li><strong>Lyophilization.</strong> Freeze-dry under vacuum. Decades of stability. Expensive equipment.</li>
            </ul>
        </div>
    </div>`,

    // 11 — Chapter IX: Identification
    `<div class="page-section">
        <h3 class="chapter-num">Chapter IX</h3>
        <h2>Identifying What You Found</h2>
        <div class="art-row">${SVG_MICROSCOPE}</div>
        <p>Modern microbial identification is a sandwich of techniques. Each layer narrows the answer:</p>
        <ul>
            <li><strong>Morphology.</strong> Colony shape, color, edge, surface, opacity. A small smooth cream colony probably isn't a fungus.</li>
            <li><strong>Microscopy.</strong> Cell shape (cocci, rods, spirals), arrangement (chains, clusters), motility, internal structures (spores, granules).</li>
            <li><strong>Gram staining.</strong> Reveals whether the cell wall has thick peptidoglycan (Gram-positive, stains purple) or a thin layer with an outer membrane (Gram-negative, stains pink).</li>
            <li><strong>Biochemical tests.</strong> Catalase, oxidase, sugar fermentation, indole — narrow the genus by metabolic capability.</li>
            <li><strong>16S rRNA sequencing.</strong> The 16S gene is universal in bacteria but varies just enough between species to act as a barcode. Sequence it, compare to GenBank, and you have a probable identity to genus or species.</li>
            <li><strong>Whole-genome sequencing.</strong> Increasingly cheap. Definitive at species and strain level.</li>
        </ul>
        <p>Genera you'll see frequently in Antarctic samples: <em>Pseudomonas</em>, <em>Flavobacterium</em>, <em>Polaromonas</em>, <em>Psychrobacter</em>, plus diverse cyanobacteria from green &amp; red snow communities.</p>
    </div>`,

    // 12 — Chapter X: Why It Matters
    `<div class="page-section">
        <h3 class="chapter-num">Chapter X</h3>
        <h2>Why This Matters</h2>
        <div class="art-row art-row-right">${SVG_PLANET}</div>
        <p>Three reasons people care about Antarctic microbiology:</p>
        <p><strong>1. Astrobiology.</strong> Europa (Jupiter) and Enceladus (Saturn) both have subsurface oceans under thick ice shells. Antarctic subglacial lakes are the closest analog on Earth. If we want to know what life on those moons might look like — and how to detect it without contaminating the search — we look here.</p>
        <p><strong>2. Climate.</strong> As the Antarctic warms, microbial communities shift. Those shifts feed back into carbon cycling, ice melt rates, and methane release. Microbes are the canary; we don't fully understand what they're singing yet.</p>
        <p><strong>3. Biotechnology.</strong> Cold-active enzymes are commercially valuable — cold-water laundry detergents, low-temperature food processing, polymerase variants for PCR. Most were discovered by surveying organisms exactly like the ones you're collecting.</p>
    </div>`,

    // 13 — Glossary part 1
    `<div class="page-section">
        <h3 class="section-eyebrow">Reference</h3>
        <h2>Glossary</h2>
        <dl class="glossary">
            <dt>Agar</dt><dd>Jelly-like polysaccharide extracted from red seaweed; the solid surface microbes grow on. Sets ~40&deg;C, melts ~85&deg;C.</dd>
            <dt>Aseptic</dt><dd>Free of contaminating microbes — the goal of every step that involves an open tube.</dd>
            <dt>Autoclave</dt><dd>Pressure cooker run at 121&deg;C / 15 psi for 15–20 min. Kills everything, including spores.</dd>
            <dt>CFU</dt><dd>Colony-forming unit. The number of cells (or clumps) that form a colony on a plate.</dd>
            <dt>Colony</dt><dd>Visible cluster of cells on an agar plate, descended from a single founding cell (usually).</dd>
            <dt>Complex medium</dt><dd>A medium containing undefined ingredients like yeast extract or peptone.</dd>
            <dt>Cryoconite</dt><dd>Wind-blown dust that darkens ice and melts shallow holes; each hole hosts its own community.</dd>
            <dt>Defined medium</dt><dd>A medium where every component is a known chemical at known concentration.</dd>
            <dt>Differential medium</dt><dd>A medium where different organisms produce visibly different colonies (e.g., color change).</dd>
            <dt>Extremophile</dt><dd>An organism thriving in conditions that would kill most life — hot, cold, salty, acidic, irradiated.</dd>
            <dt>Glycerol stock</dt><dd>Frozen 25% glycerol suspension of a culture, stored at &minus;80&deg;C for indefinite preservation.</dd>
            <dt>Gram stain</dt><dd>A four-step stain that distinguishes thick-walled (Gram-positive) from thin-walled (Gram-negative) bacteria.</dd>
        </dl>
    </div>`,

    // 14 — Glossary part 2
    `<div class="page-section">
        <h3 class="section-eyebrow">Reference (cont.)</h3>
        <h2>Glossary</h2>
        <dl class="glossary">
            <dt>Inoculate</dt><dd>To introduce a sample into a growth medium.</dd>
            <dt>Lyophilization</dt><dd>Freeze-drying under vacuum. The most stable form of long-term culture storage.</dd>
            <dt>Oligotroph</dt><dd>An organism adapted to nutrient-poor environments — exactly what you'll get from glacial ice.</dd>
            <dt>Passaging</dt><dd>Regularly transferring a culture to fresh medium to keep it alive.</dd>
            <dt>Pour plate</dt><dd>Mixing sample into molten cooled agar before pouring; colonies grow throughout the agar volume.</dd>
            <dt>Psychrophile</dt><dd>A cold-loving organism, growing optimally below 15&deg;C; cannot grow above ~20&deg;C.</dd>
            <dt>Pure culture</dt><dd>A culture descended from a single founding cell — the unit on which all classical microbiology rests.</dd>
            <dt>R2A</dt><dd>Reasoner's 2A medium. Low-nutrient. Default for psychrophilic and oligotrophic isolation.</dd>
            <dt>Selective medium</dt><dd>A medium containing an inhibitor that suppresses unwanted organisms (antibiotics, high salt, low pH).</dd>
            <dt>Serial dilution</dt><dd>Stepwise 10-fold dilutions used to bring a sample into a countable density range.</dd>
            <dt>Slant</dt><dd>A tube of agar set on an angle to maximize surface area; used for stock storage of pure cultures.</dd>
            <dt>Spread plate</dt><dd>Inoculation method: pipette small volume on the surface and spread with a sterile rod.</dd>
            <dt>Streak plate</dt><dd>Inoculation method: drag a loop in a four-quadrant pattern to isolate single colonies.</dd>
            <dt>Subculture</dt><dd>A new culture made by transferring a small portion of an old one to fresh medium.</dd>
            <dt>16S rRNA</dt><dd>A bacterial gene used as a near-universal species barcode for identification.</dd>
        </dl>
    </div>`,

    // 15 — Back cover / colophon
    `<div class="page-cover page-back">
        <p class="back-quote">&ldquo;The cold is patient. So is the work.&rdquo;</p>
        <div class="cover-art">${SVG_BACTERIA}</div>
        <p class="back-credit">Antarctic Field Survey<br/>Ross Sector &middot; Edition I</p>
        <p class="back-foot">Good luck out there.</p>
    </div>`,
];

export function createManual() {
    const root = document.createElement("div");
    root.id = "manual";
    root.innerHTML = `
        <div class="manual-backdrop"></div>
        <div class="manual-book" role="dialog" aria-label="Field Manual">
            <button class="manual-close" type="button" aria-label="Close manual">&times;</button>
            <div class="manual-spread">
                <div class="manual-page" data-side="left"></div>
                <div class="manual-spine"></div>
                <div class="manual-page" data-side="right"></div>
                <button class="manual-nav manual-nav-prev" data-act="prev" type="button" aria-label="Previous page">&larr;</button>
                <button class="manual-nav manual-nav-next" data-act="next" type="button" aria-label="Next page">&rarr;</button>
                <span class="manual-pagenum"></span>
            </div>
        </div>
    `;
    document.body.appendChild(root);

    const spreadEl = root.querySelector(".manual-spread");
    const leftPage = root.querySelector('[data-side="left"]');
    const rightPage = root.querySelector('[data-side="right"]');
    const pagenum = root.querySelector(".manual-pagenum");
    const prevBtn = root.querySelector('[data-act="prev"]');
    const nextBtn = root.querySelector('[data-act="next"]');
    const closeBtn = root.querySelector(".manual-close");

    let currentSpread = 0;
    let animating = false;
    const spreadCount = Math.ceil(PAGES.length / 2);

    function pageHTML(i) {
        return PAGES[i] || "";
    }

    function render() {
        const li = currentSpread * 2;
        const ri = li + 1;
        leftPage.innerHTML = pageHTML(li);
        rightPage.innerHTML = pageHTML(ri);
        rightPage.style.visibility = ri < PAGES.length ? "" : "hidden";
        pagenum.textContent = ri < PAGES.length
            ? `Pages ${li + 1}–${ri + 1} of ${PAGES.length}`
            : `Page ${li + 1} of ${PAGES.length}`;
        leftPage.scrollTop = 0;
        rightPage.scrollTop = 0;
        setNavEnabled();
    }

    // "Close and reopen" — both pages fold inward to 90° (edge-on, text
    // invisible), two gloved hands slide in from the sides as if to press
    // the book shut, content swaps mid-animation, then the pages unfold
    // with the new spread on display while the hands retreat. This avoids
    // showing rotating text mid-flip and reads as a real book transition.
    const FLIP_DURATION = 720; // total ms — synced with the CSS keyframes
    function closeOpenFlip(swapContent, onComplete) {
        const handL = document.createElement("div");
        handL.className = "manual-hand manual-hand-left";
        handL.innerHTML = HAND_SVG;
        const handR = document.createElement("div");
        handR.className = "manual-hand manual-hand-right";
        handR.innerHTML = HAND_SVG;
        spreadEl.appendChild(handL);
        spreadEl.appendChild(handR);

        spreadEl.classList.add("flipping");
        // Halfway through, the pages are at 90° (edge-on) — swap content
        // while it's invisible, then the second half reveals the new pages.
        setTimeout(swapContent, FLIP_DURATION / 2);
        setTimeout(() => {
            spreadEl.classList.remove("flipping");
            handL.remove();
            handR.remove();
            onComplete();
        }, FLIP_DURATION);
    }

    function setNavEnabled() {
        prevBtn.disabled = currentSpread === 0 || animating;
        nextBtn.disabled = currentSpread >= spreadCount - 1 || animating;
    }

    function next() {
        if (animating || currentSpread >= spreadCount - 1) return;
        animating = true;
        const newSpread = currentSpread + 1;
        setNavEnabled();
        playPageTurn();
        closeOpenFlip(
            () => { currentSpread = newSpread; render(); },
            () => { animating = false; setNavEnabled(); },
        );
    }
    function prev() {
        if (animating || currentSpread <= 0) return;
        animating = true;
        const newSpread = currentSpread - 1;
        setNavEnabled();
        playPageTurn();
        closeOpenFlip(
            () => { currentSpread = newSpread; render(); },
            () => { animating = false; setNavEnabled(); },
        );
    }
    function jumpTo(spread) {
        const s = parseInt(spread, 10);
        if (!Number.isFinite(s)) return;
        const target = Math.max(0, Math.min(spreadCount - 1, s));
        if (target === currentSpread || animating) return;
        // For multi-spread jumps from the ToC, just snap rather than
        // animate through every intermediate page.
        if (Math.abs(target - currentSpread) === 1) {
            target > currentSpread ? next() : prev();
        } else {
            currentSpread = target;
            render();
        }
    }

    prevBtn.addEventListener("click", prev);
    nextBtn.addEventListener("click", next);
    closeBtn.addEventListener("click", () => close());
    root.querySelector(".manual-backdrop").addEventListener("click", () => close());

    // ToC link delegation
    root.addEventListener("click", (e) => {
        const link = e.target.closest("[data-spread]");
        if (link) {
            e.preventDefault();
            jumpTo(link.dataset.spread);
        }
    });

    // arrow keys / Esc when open. Capture phase + stopPropagation so the
    // page's own keydown handler doesn't double-fire (e.g., Esc would
    // otherwise also hit the pause-menu Esc binding).
    const handled = new Set([
        "Escape",
        "ArrowRight", "ArrowLeft",
        "PageDown", "PageUp",
        "Home", "End",
    ]);
    window.addEventListener("keydown", (e) => {
        if (!isOpen) return;
        if (!handled.has(e.code)) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.code === "Escape") close();
        else if (e.code === "ArrowRight" || e.code === "PageDown") next();
        else if (e.code === "ArrowLeft" || e.code === "PageUp") prev();
        else if (e.code === "Home") jumpTo(0);
        else if (e.code === "End") jumpTo(spreadCount - 1);
    }, true);

    let isOpen = false;
    let closing = false;
    function open(spread = 0) {
        if (isOpen || closing) return;
        isOpen = true;
        currentSpread = Math.max(0, Math.min(spreadCount - 1, spread));
        render();
        root.classList.add("visible");
        controls.pause("manual");
        controls.keys.clear();
        // mission flag — read by todo.js
        try { sessionStorage.setItem("todo-readManual", "1"); } catch { /* private mode */ }
    }
    // Closing plays a mirror of the opening animation: the gloves swing
    // back in, the pages fold to edge-on, the book scales/tilts/fades
    // out into the dark blurred world. We keep the modal in the DOM
    // throughout the animation so the user actually sees it close —
    // rather than the previous "instant disappear" which felt abrupt.
    const CLOSE_DURATION = 720; // ms — matches CSS keyframes
    function close() {
        if (!isOpen || closing) return;
        closing = true;
        // gloves come in to "shut" the book
        const handL = document.createElement("div");
        handL.className = "manual-hand manual-hand-left";
        handL.innerHTML = HAND_SVG;
        const handR = document.createElement("div");
        handR.className = "manual-hand manual-hand-right";
        handR.innerHTML = HAND_SVG;
        spreadEl.appendChild(handL);
        spreadEl.appendChild(handR);
        root.classList.add("closing");
        playPageTurn();
        setTimeout(() => {
            isOpen = false;
            closing = false;
            root.classList.remove("visible", "closing");
            handL.remove();
            handR.remove();
            controls.unpause("manual");
        }, CLOSE_DURATION);
    }
    function toggle() {
        if (isOpen) close();
        else open();
    }

    return {
        open,
        close,
        toggle,
        get isOpen() { return isOpen; },
    };
}
