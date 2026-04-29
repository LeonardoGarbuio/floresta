import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// ─── DEVICE DETECTION (AAA-style quality tiers) ──────────
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || ('ontouchstart' in window && window.innerWidth < 1024);
const cores = navigator.hardwareConcurrency || 2;
const isLowEnd = isMobile && (cores <= 4 || window.innerWidth < 700);
const TIER = isLowEnd ? 'low' : isMobile ? 'med' : 'high';

// ─── DRACO DECODER ───────────────────────────────────────
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/');
dracoLoader.preload();

// ─── RENDERER (adaptive to device) ──────────────────────
const maxPR = TIER === 'high' ? 1.5 : TIER === 'med' ? 1.0 : 0.75;
const renderer = new THREE.WebGLRenderer({
    antialias: TIER === 'high',
    powerPreference: isMobile ? 'low-power' : 'high-performance',
    stencil: false,
    depth: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPR));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = false;
renderer.info.autoReset = false; // manual reset for perf monitoring
document.getElementById('canvas-container').appendChild(renderer.domElement);

// ─── SCENE + BLUE SKY ───────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5BA3D9);
// Tighter fog on mobile = GPU skips distant fragments (free perf)
const fogNear = TIER === 'high' ? 70 : TIER === 'med' ? 50 : 35;
const fogFar = TIER === 'high' ? 200 : TIER === 'med' ? 150 : 100;
scene.fog = new THREE.Fog(0x87CEEB, fogNear, fogFar);

// ─── CAMERA ──────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, fogFar + 20);

// ─── DAYTIME LIGHTING (forest-friendly, preserves tree colors) ─
scene.add(new THREE.HemisphereLight(0x8ed4a0, 0x3a6b3a, 2.6));
const sun = new THREE.DirectionalLight(0xffd070, 2.6);
sun.position.set(-30, 70, 40);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xc0eec8, 1.2);
fill.position.set(10, 25, 30);
scene.add(fill);
scene.add(new THREE.AmbientLight(0x304830, 0.5));

// ─── PROCEDURAL CLOUDS (soft, realistic edges) ──────────
const CLOUD_TEX_SIZE = TIER === 'high' ? 512 : 256;
const CLOUD_TEX_H = CLOUD_TEX_SIZE / 2;
function createCloudTexture(seed) {
    const canvas = document.createElement('canvas');
    canvas.width = CLOUD_TEX_SIZE;
    canvas.height = CLOUD_TEX_H;
    const ctx = canvas.getContext('2d');
    let s = seed;
    const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const blobs = 8 + Math.floor(rand() * 8);
    for (let i = 0; i < blobs; i++) {
        const hw = CLOUD_TEX_SIZE / 2, hh = CLOUD_TEX_H / 2;
        const bx = hw + (rand() - 0.5) * (hw * 1.09);
        const by = hh + (rand() - 0.5) * (hh * 0.78);
        const br = (CLOUD_TEX_SIZE * 0.1) + rand() * (CLOUD_TEX_SIZE * 0.21);
        const grad = ctx.createRadialGradient(bx, by, br * 0.05, bx, by, br);
        grad.addColorStop(0, `rgba(255,255,255,${0.55 + rand() * 0.35})`);
        grad.addColorStop(0.25, `rgba(255,255,255,${0.35 + rand() * 0.2})`);
        grad.addColorStop(0.55, `rgba(255,255,255,${0.12 + rand() * 0.1})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, CLOUD_TEX_SIZE, CLOUD_TEX_H);
    }
    ctx.globalCompositeOperation = 'destination-in';
    const mask = ctx.createRadialGradient(CLOUD_TEX_SIZE/2, CLOUD_TEX_H/2, 0, CLOUD_TEX_SIZE/2, CLOUD_TEX_H/2, CLOUD_TEX_SIZE*0.51);
    mask.addColorStop(0, 'rgba(255,255,255,1)');
    mask.addColorStop(0.6, 'rgba(255,255,255,0.8)');
    mask.addColorStop(0.85, 'rgba(255,255,255,0.2)');
    mask.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, CLOUD_TEX_SIZE, CLOUD_TEX_H);
    ctx.globalCompositeOperation = 'source-over';
    return new THREE.CanvasTexture(canvas);
}

const CLOUD_COUNT = TIER === 'high' ? 20 : TIER === 'med' ? 10 : 6;
const clouds = [];
// Reuse geometry across clouds (huge draw call savings)
const cloudGeoCache = {};
for (let i = 0; i < CLOUD_COUNT; i++) {
    const tex = createCloudTexture(i * 7919 + 31);
    const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.75 + Math.random() * 0.2,
        side: THREE.DoubleSide, depthWrite: false, fog: false,
    });
    const w = Math.round((25 + Math.random() * 45) / 5) * 5; // snap to reuse geo
    const h = Math.round((10 + Math.random() * 18) / 5) * 5;
    const geoKey = `${w}_${h}`;
    if (!cloudGeoCache[geoKey]) cloudGeoCache[geoKey] = new THREE.PlaneGeometry(w, h, 1, 1);
    const cloud = new THREE.Mesh(cloudGeoCache[geoKey], mat);
    cloud.position.set(
        (Math.random() - 0.5) * 200,
        35 + Math.random() * 30,
        -50 + (Math.random() - 0.5) * 220
    );
    cloud.rotation.x = -Math.PI / 2;
    cloud.userData.speed = 0.3 + Math.random() * 0.6;
    cloud.matrixAutoUpdate = false; // we update manually
    clouds.push(cloud);
    scene.add(cloud);
}

// ─── CAMERA PATH (winding curves) ────────────────────────
const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.3, 8),
    new THREE.Vector3(6, 1.3, -18),
    new THREE.Vector3(-6, 1.3, -45),
    new THREE.Vector3(5, 1.3, -72),
    new THREE.Vector3(-7, 1.3, -99),
    new THREE.Vector3(2, 1.3, -126),
    new THREE.Vector3(7, 1.3, -153),
    new THREE.Vector3(-5, 1.3, -180),
    new THREE.Vector3(0, 1.3, -210),
], false, 'catmullrom', 0.5);

// ─── GROUND (vertex-colored grass patches) ───────────────
(() => {
    const gw = 120, gh = 460;
    const segX = TIER === 'high' ? 60 : 30;
    const segZ = TIER === 'high' ? 220 : 110;
    const floorGeo = new THREE.PlaneGeometry(gw, gh, segX, segZ);
    const colors = new Float32Array(floorGeo.attributes.position.count * 3);
    for (let i = 0; i < floorGeo.attributes.position.count; i++) {
        const x = floorGeo.attributes.position.getX(i);
        const z = floorGeo.attributes.position.getY(i);
        // Layered noise for natural patches
        const n1 = Math.sin(x * 0.3 + 1.2) * Math.cos(z * 0.2 + 0.7);
        const n2 = Math.sin(x * 0.7 - 0.5) * Math.cos(z * 0.5 + 2.1) * 0.5;
        const n3 = Math.sin(x * 1.5 + z * 0.8) * 0.25;
        const noise = (n1 + n2 + n3) * 0.5 + 0.5;
        const hue = 0.26 + noise * 0.07;        // green to yellow-green
        const sat = 0.45 + noise * 0.3;          // varied saturation
        const light = 0.14 + noise * 0.14;       // dark to mid green
        const c = new THREE.Color().setHSL(hue, sat, light);
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    floorGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.95, metalness: 0,
    }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -1.5, -100);
    scene.add(floor);
})();


// ─── CURVED PATH RIBBONS ────────────────────────────────
function createCurvedRibbon(width, yLevel, material, segments = 250) {
    const positions = [], indices = [], uvs = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const point = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t).normalize();
        const right = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        const lx = point.x + right.x * (-width / 2), lz = point.z + right.z * (-width / 2);
        const rx = point.x + right.x * (width / 2), rz = point.z + right.z * (width / 2);
        positions.push(lx, yLevel, lz, rx, yLevel, rz);
        uvs.push(0, t, 1, t);
        if (i < segments) { const b = i * 2; indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices); geo.computeVertexNormals();
    return new THREE.Mesh(geo, material);
}
scene.add(createCurvedRibbon(11, -1.49, new THREE.MeshStandardMaterial({ color: 0x2c6a2c, roughness: 1 })));
scene.add(createCurvedRibbon(4.5, -1.485, new THREE.MeshStandardMaterial({ color: 0x5a3c1e, roughness: 1 })));

// ─── STONES (instanced for minimal draw calls) ──────────
const dummy = new THREE.Object3D();
const STONE_COUNT = TIER === 'high' ? 70 : TIER === 'med' ? 40 : 25;
const stoneMat = new THREE.MeshStandardMaterial({ color: 0x7a6a5a, roughness: 0.9 });
const stoneGeo = new THREE.SphereGeometry(1, 5, 4);
const stoneInst = new THREE.InstancedMesh(stoneGeo, stoneMat, STONE_COUNT);
stoneInst.frustumCulled = false; // always visible (cheap enough)
for (let i = 0; i < STONE_COUNT; i++) {
    const t = Math.min(i / STONE_COUNT, 0.999);
    const pp = curve.getPointAt(t), tn = curve.getTangentAt(t).normalize();
    const rt = new THREE.Vector3(-tn.z, 0, tn.x).normalize();
    const r = 0.05 + Math.random() * 0.13, lo = (Math.random() - 0.5) * 3.5;
    dummy.position.set(pp.x + rt.x * lo, -1.46 + r, pp.z + rt.z * lo);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    dummy.scale.setScalar(r);
    dummy.updateMatrix();
    stoneInst.setMatrixAt(i, dummy.matrix);
}
stoneInst.instanceMatrix.needsUpdate = true;
scene.add(stoneInst);

// ─── WAYPOINTS ───────────────────────────────────────────
const WAYPOINTS = [
    { t: 0.12, side: 1 }, { t: 0.28, side: -1 }, { t: 0.47, side: 1 },
    { t: 0.65, side: -1 }, { t: 0.83, side: 1 },
];
// lookY per waypoint: tall trees look ahead, small plants look down
const LOOK_Y = [3.5, 5, -0.5, 0.5, -1.0];
const HERO_DIST = 10;
WAYPOINTS.forEach((wp, i) => {
    const camPos = curve.getPointAt(wp.t);
    const tan = curve.getTangentAt(wp.t).normalize();
    const right = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    wp.heroPos = camPos.clone().addScaledVector(right, wp.side * HERO_DIST);
    wp.heroPos.y = 0;
    wp.lookTarget = wp.heroPos.clone().setY(LOOK_Y[i]);
});

function isNearWaypoint(x, z, r = 15) {
    for (const wp of WAYPOINTS) { const dx = x - wp.heroPos.x, dz = z - wp.heroPos.z; if (dx * dx + dz * dz < r * r) return true; }
    return false;
}
function getCurveXAtZ(z) { return curve.getPointAt(Math.max(0, Math.min(0.999, (8 - z) / 218))).x; }

// ─── GLTF LOADER ─────────────────────────────────────────
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

function normalise(gltfScene, targetH) {
    const box = new THREE.Box3().setFromObject(gltfScene);
    const sz = box.getSize(new THREE.Vector3());
    const s = targetH / Math.max(sz.x, sz.y, sz.z);
    gltfScene.traverse(c => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = false; } });
    return { scale: s, box };
}

const INST_COUNT = TIER === 'high' ? 20 : TIER === 'med' ? 12 : 8;
function instForest(gltfScene, _count, zStart, zEnd) {
    const count = INST_COUNT;
    const { scale: baseScale, box } = normalise(gltfScene, 11);
    const meshes = [];
    gltfScene.traverse(c => { if (c.isMesh && c.geometry) meshes.push(c); });
    meshes.forEach(src => {
        const mat = Array.isArray(src.material) ? src.material.map(m => m.clone()) : src.material.clone();
        const inst = new THREE.InstancedMesh(src.geometry, mat, count);
        inst.frustumCulled = true;
        for (let i = 0; i < count; i++) {
            const instanceScale = baseScale * (0.7 + Math.random() * 0.85);
            const yPos = -1.5 - box.min.y * instanceScale;
            const baseZ = zStart + (i / count) * (zEnd - zStart);
            let z = baseZ + (Math.random() - 0.5) * 7;
            const curveX = getCurveXAtZ(z);
            const side = i % 2 === 0 ? 1 : -1;
            let x = curveX + side * (6 + Math.random() * 20);
            let attempts = 0;
            while (isNearWaypoint(x, z) && attempts < 5) {
                z = baseZ + (Math.random() - 0.5) * 14;
                x = getCurveXAtZ(z) + side * (6 + Math.random() * 20);
                attempts++;
            }
            if (isNearWaypoint(x, z)) x = getCurveXAtZ(z) + side * (30 + Math.random() * 8);
            dummy.position.set(x, yPos, z);
            dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
            dummy.scale.setScalar(instanceScale);
            dummy.updateMatrix();
            inst.setMatrixAt(i, dummy.matrix);
        }
        inst.instanceMatrix.needsUpdate = true;
        scene.add(inst);
    });
}

function placeHero(gltfScene, heroPos, targetHeight = 13) {
    const { scale: s, box } = normalise(gltfScene, targetHeight);
    gltfScene.position.copy(heroPos);
    gltfScene.position.y = -1.5 - box.min.y * s;
    gltfScene.scale.setScalar(s);
    gltfScene.rotation.y = Math.PI;
    scene.add(gltfScene);
}

/** Place multiple copies of a model in a natural cluster (for flowers/small plants) */
function placeCluster(gltfScene, heroPos, targetHeight, count = 25, radius = 4) {
    const box = new THREE.Box3().setFromObject(gltfScene);
    const sz = box.getSize(new THREE.Vector3());
    const baseScale = targetHeight / Math.max(sz.x, sz.y, sz.z);
    gltfScene.traverse(c => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = false; } });
    for (let i = 0; i < count; i++) {
        const clone = gltfScene.clone();
        const individualScale = baseScale * (0.5 + Math.random() * 0.8);
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.pow(Math.random(), 0.6) * radius; // denser at center
        clone.position.set(
            heroPos.x + Math.cos(angle) * dist,
            -1.5 - box.min.y * individualScale,
            heroPos.z + Math.sin(angle) * dist
        );
        clone.scale.setScalar(individualScale);
        clone.rotation.y = Math.random() * Math.PI * 2;
        scene.add(clone);
    }
}

// ─── LOADING TRACKER ─────────────────────────────────────
const TOTAL = 9;
let done = 0;
function onLoad() {
    done++;
    const pct = Math.round((done / TOTAL) * 100);
    const bar = document.querySelector('.loading-bar-fill');
    const lbl = document.getElementById('loading-label');
    if (bar) bar.style.width = pct + '%';
    if (lbl) lbl.textContent = `Carregando floresta... ${pct}%`;
    if (done >= TOTAL) setTimeout(() => {
        const ls = document.getElementById('loading-screen');
        if (!ls) return;
        ls.style.opacity = '0';
        setTimeout(() => ls.style.display = 'none', 700);
    }, 400);
}

// ─── LOAD MODELS ─────────────────────────────────────────
const VEG = './optimized/vegeta%C3%A7%C3%A3o%20da%20floresta/';
['Meshy_AI_fa%C3%A7a_modelos_de_arvo_0222025357_generate.glb',
 'Meshy_AI_fa%C3%A7a_modelos_de_arvo_0222025655_generate.glb',
 'Meshy_AI_fa%C3%A7a_modelos_de_arvo_0222025549_generate.glb',
 'Meshy_AI_fa%C3%A7a_modelos_de_arvo_0222025411_generate.glb',
].forEach(f => {
    loader.load(VEG + f, gltf => { instForest(gltf.scene, INST_COUNT, 6, -215); onLoad(); },
        undefined, err => { console.warn('[Forest]', err.message); onLoad(); });
});

const heroFiles = [
    { file: './optimized/Meshy_AI_Ipe_amarelo_0222022300_generate.glb', wp: 0, height: 13 },
    { file: './optimized/Meshy_AI_araucaria_0222021559_generate.glb',   wp: 1, height: 15 },
    { file: './optimized/Meshy_AI_samambaia_0222022826_generate.glb',   wp: 2, height: 1.5 },
    { file: './optimized/Meshy_AI_erva_mate_0222023324_generate.glb',   wp: 3, height: 5 },
    { file: './optimized/Meshy_AI_margarida_0222024657_generate.glb',   wp: 4, height: 1.8, cluster: TIER === 'high' ? 25 : TIER === 'med' ? 15 : 10 },
];
heroFiles.forEach(({ file, wp, height, cluster }) => {
    loader.load(file, gltf => {
        if (cluster) {
            placeCluster(gltf.scene, WAYPOINTS[wp].heroPos, height, cluster, 4);
        } else {
            placeHero(gltf.scene, WAYPOINTS[wp].heroPos, height);
        }
        onLoad();
    }, undefined, err => { console.warn('[Hero]', err.message); onLoad(); });
});

// ─── FIREFLIES ───────────────────────────────────────────
const FF = TIER === 'high' ? 50 : TIER === 'med' ? 25 : 15;
const ffPos = new Float32Array(FF * 3), ffSpd = new Float32Array(FF);
for (let i = 0; i < FF; i++) {
    ffPos[i * 3] = (Math.random() - 0.5) * 28;
    ffPos[i * 3 + 1] = 0.3 + Math.random() * 5;
    ffPos[i * 3 + 2] = 6 + Math.random() * (-220);
    ffSpd[i] = 0.003 + Math.random() * 0.005;
}
const ffGeo = new THREE.BufferGeometry();
ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
const ffMat = new THREE.PointsMaterial({ color: 0xb8ffb0, size: 0.18, transparent: true, opacity: 0.8, sizeAttenuation: true });
scene.add(new THREE.Points(ffGeo, ffMat));

// ─── FALLING LEAF PARTICLES ──────────────────────────────
const LEAF_COUNT = TIER === 'high' ? 40 : TIER === 'med' ? 20 : 10;
const leafPos = new Float32Array(LEAF_COUNT * 3);
const leafCol = new Float32Array(LEAF_COUNT * 3);
const leafSpd = new Float32Array(LEAF_COUNT);
for (let i = 0; i < LEAF_COUNT; i++) {
    leafPos[i * 3] = (Math.random() - 0.5) * 50;
    leafPos[i * 3 + 1] = 4 + Math.random() * 18;
    leafPos[i * 3 + 2] = 10 + Math.random() * (-230);
    leafSpd[i] = 0.004 + Math.random() * 0.01;
    const hue = 0.18 + Math.random() * 0.18;
    const c = new THREE.Color().setHSL(hue, 0.5 + Math.random() * 0.3, 0.3 + Math.random() * 0.25);
    leafCol[i * 3] = c.r; leafCol[i * 3 + 1] = c.g; leafCol[i * 3 + 2] = c.b;
}
const leafGeo = new THREE.BufferGeometry();
leafGeo.setAttribute('position', new THREE.BufferAttribute(leafPos, 3));
leafGeo.setAttribute('color', new THREE.BufferAttribute(leafCol, 3));
const leafMat = new THREE.PointsMaterial({ size: 0.2, transparent: true, opacity: 0.75, sizeAttenuation: true, vertexColors: true });
scene.add(new THREE.Points(leafGeo, leafMat));

// ─── SCROLL ──────────────────────────────────────────────
let scrollProg = 0, targetProg = 0;
let snapTimeout;
window.addEventListener('scroll', () => {
    const max = document.body.scrollHeight - window.innerHeight;
    targetProg = window.scrollY / max;
    document.getElementById('progress-fill').style.width = (targetProg * 100).toFixed(1) + '%';
    // Scroll snap: after user stops, gently pull to nearest waypoint
    clearTimeout(snapTimeout);
    snapTimeout = setTimeout(() => {
        const current = window.scrollY / max;
        for (const wp of WAYPOINTS) {
            if (Math.abs(current - wp.t) < 0.025) {
                window.scrollTo({ top: wp.t * max, behavior: 'smooth' });
                break;
            }
        }
    }, 700);
}, { passive: true });

// ─── DISCOVERY SYSTEM ────────────────────────────────────
const discovered = new Set();
const WP_NAMES = ['Ipê Amarelo', 'Araucária', 'Samambaia', 'Erva-Mate', 'Margarida'];
function updateDiscovery() {
    const counter = document.getElementById('discovery-counter');
    const label = document.getElementById('discovery-label');
    if (!counter) return;
    if (discovered.size >= 5) {
        label.textContent = '🏆 Explorador Completo!';
        counter.classList.add('complete');
    } else {
        label.textContent = `🌿 ${discovered.size}/5 espécies descobertas`;
        counter.classList.remove('complete');
    }
    counter.classList.add('pulse');
    setTimeout(() => counter.classList.remove('pulse'), 600);
}

// ─── CARDS / LOOK-AT ─────────────────────────────────────
let activeWP = -1;
let dismissedWP = -1; // track which card was manually closed
const currentLookAt = new THREE.Vector3();
function showCard(i) {
    if (activeWP === i) return;
    if (dismissedWP === i) return; // user closed this card, don't reopen
    document.querySelectorAll('.curiosity-card').forEach(c => c.classList.remove('visible'));
    document.getElementById(`card-${i}`)?.classList.add('visible');
    document.querySelectorAll('.wp-dot').forEach((d, j) => d.classList.toggle('active', j === i));
    activeWP = i;
    if (!discovered.has(i)) { discovered.add(i); updateDiscovery(); }
    updateHotspotsVisibility();
}
function hideCards(userDismissed = false) {
    document.querySelectorAll('.curiosity-card').forEach(c => c.classList.remove('visible'));
    document.querySelectorAll('.wp-dot').forEach(d => d.classList.remove('active'));
    if (userDismissed) dismissedWP = activeWP;
    activeWP = -1;
    updateHotspotsVisibility();
    hideTooltip();
}
function checkWaypoints(t) {
    for (let i = 0; i < WAYPOINTS.length; i++) {
        if (Math.abs(t - WAYPOINTS[i].t) < 0.05) { showCard(i); return; }
    }
    // User scrolled away from all waypoints – clear dismissed flag
    dismissedWP = -1;
    if (activeWP !== -1) hideCards();
}

// ─── INTERACTIVE HOTSPOTS ────────────────────────────────
const HOTSPOT_DATA = [
    [
        { offset: [0, 10, 0], label: "Copa & Flores", icon: "🌼", info: "A copa do Ipê se cobre inteira de flores douradas entre julho e setembro — antes mesmo de brotar folhas. Cada flor dura apenas 3 a 5 dias, mas a floração coletiva cria o icônico espetáculo dourado." },
        { offset: [0.5, 5, 0.5], label: "Tronco", icon: "🪵", info: "A madeira do Ipê é tão densa (1.100 kg/m³) que afunda na água. É 3× mais resistente que o carvalho europeu e naturalmente imune a cupins, fungos e brocas." },
        { offset: [-0.5, 0.5, 0.3], label: "Raízes", icon: "🌱", info: "O sistema radicular do Ipê pode atingir 15 metros de profundidade, captando água de lençóis subterrâneos. Isso permite que a árvore floresça mesmo durante secas severas." },
    ],
    [
        { offset: [0, 12, 0], label: "Copa Candelabro", icon: "🕯️", info: "A copa da Araucária tem o formato único de candelabro, com galhos dispostos em andares horizontais. Esse formato evoluiu há 200 milhões de anos, quando dinossauros caminhavam sob elas." },
        { offset: [0.8, 8, 0.3], label: "Pinhão", icon: "🌰", info: "Cada pinha contém até 150 pinhões ricos em amido e minerais. Eles foram o alimento principal dos povos Kaingang e Guarani por milênios. Uma única árvore pode produzir 200 pinhas por ano." },
        { offset: [-0.3, 3, 0.5], label: "Tronco Reto", icon: "🪵", info: "O tronco da Araucária cresce perfeitamente reto por até 20m antes do primeiro galho. A casca grossa e rugosa protege contra incêndios florestais naturais." },
    ],
    [
        { offset: [0.4, 1.2, 0], label: "Frondes", icon: "🌿", info: "As folhas das samambaias se desenrolam em espiral — um fenômeno chamado 'vernação circinada'. Essa forma em espiral segue uma proporção áurea perfeita da natureza." },
        { offset: [-0.4, 0.7, 0.3], label: "Esporos", icon: "🔬", info: "Na face inferior das frondes ficam os soros — agrupamentos de esporângios que liberam milhões de esporos microscópicos. As samambaias se reproduzem sem flores nem sementes há 360 milhões de anos." },
        { offset: [0, 0.15, 0.4], label: "Rizoma", icon: "🌱", info: "O caule da samambaia é subterrâneo (rizoma) e cresce horizontalmente. Dele brotam novas frondes. Algumas espécies podem colonizar florestas inteiras a partir de um único rizoma." },
    ],
    [
        { offset: [0.5, 4, 0], label: "Folhas", icon: "🍃", info: "As folhas da Erva-Mate contêm 196 compostos bioativos, incluindo cafeína, teobromina e saponinas. Possuem mais antioxidantes que o chá verde e o vinho tinto combinados." },
        { offset: [-0.3, 2, 0.3], label: "Caule", icon: "🪵", info: "O caule da Erva-Mate tem casca acinzentada e lisa quando jovem. Em cultivo, a planta é podada a cada 2 anos para estimular o crescimento de folhas novas mais ricas em nutrientes." },
        { offset: [0, 0.3, 0.4], label: "Raízes", icon: "🌱", info: "As raízes da Erva-Mate vivem em simbiose com fungos micorrízicos que ampliam sua capacidade de absorção. Essa parceria permite que a planta cresça mesmo em solos pobres da Mata Atlântica." },
    ],
    [
        { offset: [0, 0.6, 0], label: "Pétalas", icon: "🤍", info: "O que parecem pétalas são na verdade flores individuais chamadas 'lígulas'. Cada margarida possui 13 a 34 dessas mini-flores — sempre em números de Fibonacci." },
        { offset: [0.15, 0.5, 0.1], label: "Disco Central", icon: "🟡", info: "O centro amarelo é composto por centenas de 'flósculos' — mini-flores tubulares organizadas em espirais duplas seguindo a sequência de Fibonacci. Cada flósculo produz uma semente." },
        { offset: [-0.1, 0.25, 0.15], label: "Caule", icon: "🌱", info: "O caule da margarida é coberto por tricomas (pelos finos) que reduzem a perda de água e protegem contra insetos. Pode atingir 20-80cm e é surpreendentemente resistente ao vento." },
    ],
];

const hotspotContainer = document.getElementById('hotspots-container');
const allHotspotEls = [];
HOTSPOT_DATA.forEach((wpHotspots, wpIdx) => {
    const wpEls = wpHotspots.map((hs, hsIdx) => {
        const dot = document.createElement('div');
        dot.className = 'hotspot-dot';
        dot.innerHTML = `<div class="dot-ring"></div><div class="dot-core"></div><span class="dot-label">${hs.label}</span>`;
        dot.addEventListener('click', e => { e.stopPropagation(); showTooltip(wpIdx, hsIdx, dot); });
        hotspotContainer.appendChild(dot);
        return { el: dot, ...hs };
    });
    allHotspotEls.push(wpEls);
});

function updateHotspotsVisibility() {
    allHotspotEls.forEach((wpEls, wpIdx) => {
        wpEls.forEach(hs => hs.el.classList.toggle('visible', wpIdx === activeWP));
    });
}

const projVec = new THREE.Vector3();
function updateHotspotPositions() {
    if (activeWP < 0) return;
    const wp = WAYPOINTS[activeWP];
    allHotspotEls[activeWP].forEach(hs => {
        projVec.set(wp.heroPos.x + hs.offset[0], -1.5 + hs.offset[1], wp.heroPos.z + hs.offset[2]);
        projVec.project(camera);
        if (projVec.z > 1) { hs.el.style.display = 'none'; return; }
        hs.el.style.display = '';
        hs.el.style.left = ((projVec.x * 0.5 + 0.5) * window.innerWidth) + 'px';
        hs.el.style.top = ((-projVec.y * 0.5 + 0.5) * window.innerHeight) + 'px';
    });
}

const tooltip = document.getElementById('hotspot-tooltip');
let activeTooltipDot = null;
function showTooltip(wpIdx, hsIdx, dotEl) {
    const hs = HOTSPOT_DATA[wpIdx][hsIdx];
    if (activeTooltipDot === dotEl && tooltip.classList.contains('visible')) { hideTooltip(); return; }
    tooltip.querySelector('.hotspot-tooltip-icon').textContent = hs.icon;
    tooltip.querySelector('.hotspot-tooltip-label').textContent = hs.label;
    tooltip.querySelector('.hotspot-tooltip-text').textContent = hs.info;
    const r = dotEl.getBoundingClientRect();
    let left = r.left + 30, top = r.top - 90;
    const tw = Math.min(360, window.innerWidth * 0.85);
    if (left + tw > window.innerWidth - 16) left = r.left - tw - 20;
    if (left < 16) left = 16;
    if (top < 16) top = 16;
    if (top + 180 > window.innerHeight - 16) top = window.innerHeight - 196;
    tooltip.style.left = left + 'px'; tooltip.style.top = top + 'px';
    tooltip.classList.add('visible');
    activeTooltipDot = dotEl;
}
function hideTooltip() { tooltip.classList.remove('visible'); activeTooltipDot = null; }
document.addEventListener('click', e => {
    if (!e.target.closest('.hotspot-dot') && !e.target.closest('.hotspot-tooltip')) hideTooltip();
});
tooltip.querySelector('.hotspot-tooltip-close').addEventListener('click', hideTooltip);

// ─── KEYBOARD NAVIGATION ────────────────────────────────
document.addEventListener('keydown', e => {
    const max = document.body.scrollHeight - window.innerHeight;
    switch (e.key) {
        case 'ArrowDown': case 'PageDown':
            e.preventDefault(); window.scrollBy({ top: window.innerHeight * 0.3, behavior: 'smooth' }); break;
        case 'ArrowUp': case 'PageUp':
            e.preventDefault(); window.scrollBy({ top: -window.innerHeight * 0.3, behavior: 'smooth' }); break;
        case '1': case '2': case '3': case '4': case '5':
            const idx = parseInt(e.key) - 1;
            window.scrollTo({ top: WAYPOINTS[idx].t * max, behavior: 'smooth' }); break;
        case 'Escape':
            hideCards(); hideTooltip(); break;
        case 'f': case 'F':
            toggleFullscreen(); break;
        case 'm': case 'M':
            toggleMute(); break;
    }
});

// ─── FULLSCREEN ──────────────────────────────────────────
function toggleFullscreen() {
    const btn = document.getElementById('fullscreen-btn');
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().then(() => {
            if (btn) btn.textContent = '⊗';
        }).catch(() => {});
    } else {
        document.exitFullscreen();
        if (btn) btn.textContent = '⛶';
    }
}
document.addEventListener('fullscreenchange', () => {
    const btn = document.getElementById('fullscreen-btn');
    if (btn) btn.textContent = document.fullscreenElement ? '⊗' : '⛶';
});
document.getElementById('fullscreen-btn')?.addEventListener('click', toggleFullscreen);

// ─── AMBIENT SOUND (Web Audio API) ─────────────────
let audioCtx = null, isMuted = false, windGain = null;

function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // White noise → lowpass filter = wind ambience
    const bufSize = 2 * audioCtx.sampleRate;
    const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = audioCtx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 350;
    windGain = audioCtx.createGain();
    windGain.gain.value = 0.035;
    noise.connect(lp); lp.connect(windGain); windGain.connect(audioCtx.destination);
    noise.start();
    scheduleBird();
}

function playBirdChirp() {
    if (!audioCtx || isMuted) return;
    const now = audioCtx.currentTime;
    const chirps = 2 + Math.floor(Math.random() * 3);
    for (let c = 0; c < chirps; c++) {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = 'sine';
        const freq = 2500 + Math.random() * 3500;
        const t = now + c * 0.12;
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.linearRampToValueAtTime(freq * (0.8 + Math.random() * 0.4), t + 0.08);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.012, t + 0.02);
        g.gain.linearRampToValueAtTime(0, t + 0.1);
        osc.connect(g); g.connect(audioCtx.destination);
        osc.start(t); osc.stop(t + 0.12);
    }
}

function scheduleBird() {
    setTimeout(() => {
        if (!isMuted) playBirdChirp();
        scheduleBird();
    }, 3000 + Math.random() * 7000);
}

function toggleMute() {
    isMuted = !isMuted;
    if (windGain) windGain.gain.value = isMuted ? 0 : 0.035;
    const btn = document.getElementById('sound-btn');
    if (btn) btn.textContent = isMuted ? '🔇' : '🔊';
}

// Start audio on first user interaction (browser policy)
let audioStarted = false;
function tryStartAudio() {
    if (audioStarted) return;
    audioStarted = true;
    initAudio();
}
window.addEventListener('scroll', tryStartAudio, { once: true, passive: true });
window.addEventListener('click', tryStartAudio, { once: true });
document.getElementById('sound-btn')?.addEventListener('click', toggleMute);

// ─── CONCLUSION SCREEN ─────────────────────────────
let conclusionShown = false;
function checkConclusion() {
    if (conclusionShown) return;
    if (scrollProg > 0.95) {
        conclusionShown = true;
        const el = document.getElementById('final-species');
        if (el) el.textContent = `${discovered.size}/5`;
        setTimeout(() => {
            document.getElementById('conclusion-screen')?.classList.add('visible');
        }, 800);
    }
}
document.getElementById('restart-btn')?.addEventListener('click', () => {
    document.getElementById('conclusion-screen')?.classList.remove('visible');
    conclusionShown = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ─── MINIMAP ─────────────────────────────────────────────
const minimapCanvas = document.getElementById('minimap-canvas');
const mmCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;
const WP_EMOJIS = ['🌻', '🌲', '🌿', '🧉', '🌼'];

function mmX(worldX) { return 60 + worldX * 3; }
function mmY(worldZ) { return 14 + ((8 - worldZ) / 218) * 212; }

function drawMinimap() {
    if (!mmCtx) return;
    const w = minimapCanvas.width, h = minimapCanvas.height;
    mmCtx.clearRect(0, 0, w, h);

    // Trail
    mmCtx.strokeStyle = 'rgba(201,168,76,0.35)';
    mmCtx.lineWidth = 2;
    mmCtx.beginPath();
    for (let i = 0; i <= 80; i++) {
        const pt = curve.getPointAt(Math.min(i / 80, 0.999));
        const mx = mmX(pt.x), my = mmY(pt.z);
        i === 0 ? mmCtx.moveTo(mx, my) : mmCtx.lineTo(mx, my);
    }
    mmCtx.stroke();

    // Waypoint dots
    WAYPOINTS.forEach((wp, i) => {
        const pt = curve.getPointAt(wp.t);
        const mx = mmX(pt.x), my = mmY(pt.z);
        mmCtx.beginPath();
        mmCtx.arc(mx, my, discovered.has(i) ? 4 : 3, 0, Math.PI * 2);
        mmCtx.fillStyle = discovered.has(i) ? '#4caf7d' : 'rgba(255,255,255,0.25)';
        mmCtx.fill();
        if (discovered.has(i)) {
            mmCtx.font = '10px sans-serif';
            mmCtx.fillStyle = 'rgba(255,255,255,0.7)';
            mmCtx.fillText(WP_NAMES[i], mx + 8, my + 3);
        }
    });

    // Current position
    const curPt = curve.getPointAt(Math.min(scrollProg, 0.999));
    const cx = mmX(curPt.x), cy = mmY(curPt.z);
    mmCtx.beginPath(); mmCtx.arc(cx, cy, 7, 0, Math.PI * 2);
    mmCtx.fillStyle = 'rgba(201,168,76,0.25)'; mmCtx.fill();
    mmCtx.beginPath(); mmCtx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    mmCtx.fillStyle = '#c9a84c'; mmCtx.fill();
    mmCtx.strokeStyle = 'white'; mmCtx.lineWidth = 1.5; mmCtx.stroke();
}

// Minimap click → jump to waypoint
minimapCanvas?.addEventListener('click', e => {
    const rect = minimapCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (minimapCanvas.width / rect.width);
    const my = (e.clientY - rect.top) * (minimapCanvas.height / rect.height);
    const max = document.body.scrollHeight - window.innerHeight;
    for (let i = 0; i < WAYPOINTS.length; i++) {
        const pt = curve.getPointAt(WAYPOINTS[i].t);
        const wx = mmX(pt.x), wy = mmY(pt.z);
        if (Math.sqrt((mx - wx) ** 2 + (my - wy) ** 2) < 14) {
            window.scrollTo({ top: WAYPOINTS[i].t * max, behavior: 'smooth' }); return;
        }
    }
});

// ─── ADAPTIVE QUALITY (AAA-style dynamic resolution) ─────
let frameCount = 0, lastFPSCheck = performance.now();
const MIN_PR = isMobile ? 0.5 : 0.75;
let currentFPS = 60;
function adaptQuality() {
    frameCount++;
    const now = performance.now(), elapsed = now - lastFPSCheck;
    if (elapsed >= 1500) {
        currentFPS = (frameCount / elapsed) * 1000;
        frameCount = 0; lastFPSCheck = now;
        const pr = renderer.getPixelRatio();
        if (currentFPS < 22 && pr > MIN_PR) {
            // Emergency: drop resolution fast
            renderer.setPixelRatio(Math.max(MIN_PR, pr - 0.3));
            renderer.setSize(window.innerWidth, window.innerHeight);
        } else if (currentFPS < 30 && pr > MIN_PR) {
            renderer.setPixelRatio(Math.max(MIN_PR, pr - 0.15));
            renderer.setSize(window.innerWidth, window.innerHeight);
        } else if (currentFPS > 50 && pr < maxPR) {
            // Slowly recover quality when FPS is good
            renderer.setPixelRatio(Math.min(maxPR, pr + 0.05));
            renderer.setSize(window.innerWidth, window.innerHeight);
        }
    }
}

// ─── ANIMATE (frame-budgeted) ────────────────────────────
const clock = new THREE.Clock();
// Cache DOM refs outside loop (avoid layout thrashing)
const titleEl = document.getElementById('title-overlay');
// Throttle interval: update non-critical things less often on mobile
const PARTICLE_SKIP = TIER === 'high' ? 1 : TIER === 'med' ? 2 : 3;
const MINIMAP_SKIP = TIER === 'high' ? 1 : 3;
let animFrame = 0;

function animate() {
    animFrame++;
    const elapsed = clock.getElapsedTime();
    scrollProg += (targetProg - scrollProg) * 0.045;
    const t0 = Math.min(scrollProg, 0.999);

    // Camera (always smooth – never skip)
    const camPos = curve.getPointAt(t0);
    camPos.y += Math.sin(elapsed * 0.55) * 0.03;
    camera.position.lerp(camPos, 0.12);
    const ahead = curve.getPointAt(Math.min(t0 + 0.018, 0.999));
    const targetLook = (activeWP >= 0) ? WAYPOINTS[activeWP].lookTarget : ahead;
    currentLookAt.lerp(targetLook, (activeWP >= 0) ? 0.04 : 0.1);
    camera.lookAt(currentLookAt);

    // Clouds (update matrix manually, skip frames on mobile)
    if (animFrame % PARTICLE_SKIP === 0) {
        for (let i = 0; i < clouds.length; i++) {
            const c = clouds[i];
            c.position.x += c.userData.speed * 0.012 * PARTICLE_SKIP;
            if (c.position.x > 100) c.position.x = -100;
            c.updateMatrix();
        }
    }

    // Fireflies (throttled on mobile)
    if (animFrame % (PARTICLE_SKIP * 2) === 0) {
        const fa = ffGeo.attributes.position.array;
        for (let i = 0; i < FF; i++) {
            fa[i * 3 + 1] += ffSpd[i] * Math.sin(elapsed * 1.4 + i);
            fa[i * 3] += Math.sin(elapsed * 0.4 + i * 0.8) * 0.003;
            if (fa[i * 3 + 1] > 7) fa[i * 3 + 1] = 0.3;
        }
        ffGeo.attributes.position.needsUpdate = true;
        ffMat.opacity = 0.35 + Math.sin(elapsed * 2.1) * 0.4;
    }

    // Falling leaves (throttled on mobile)
    if (animFrame % PARTICLE_SKIP === 0) {
        const lp = leafGeo.attributes.position.array;
        for (let i = 0; i < LEAF_COUNT; i++) {
            lp[i * 3] += Math.sin(elapsed * 0.5 + i * 2.1) * 0.012 * PARTICLE_SKIP;
            lp[i * 3 + 1] -= leafSpd[i] * PARTICLE_SKIP;
            lp[i * 3 + 2] += Math.cos(elapsed * 0.3 + i * 1.7) * 0.006 * PARTICLE_SKIP;
            if (lp[i * 3 + 1] < -1.5) {
                lp[i * 3] = camera.position.x + (Math.random() - 0.5) * 35;
                lp[i * 3 + 1] = 6 + Math.random() * 14;
                lp[i * 3 + 2] = camera.position.z + (Math.random() - 0.5) * 40;
            }
        }
        leafGeo.attributes.position.needsUpdate = true;
    }

    // Title fade (cheap, always run)
    if (titleEl) {
        const a = 1 - Math.min(1, Math.max(0, (scrollProg - 0.02) / 0.07));
        titleEl.style.opacity = a;
        if (a < 0.05) titleEl.style.pointerEvents = 'none';
    }

    checkWaypoints(scrollProg);
    checkConclusion();
    updateHotspotPositions();
    // Minimap: skip frames on mobile (it's a small canvas, nobody notices)
    if (animFrame % MINIMAP_SKIP === 0) drawMinimap();
    adaptQuality();
    renderer.info.reset();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

// ─── RESIZE ──────────────────────────────────────────────
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }, 100);
});

// ─── UI INIT ─────────────────────────────────────────────
document.querySelectorAll('.card-close').forEach(btn => btn.addEventListener('click', () => hideCards(true)));
document.querySelectorAll('.wp-dot').forEach((dot, i) =>
    dot.addEventListener('click', () => {
        const max = document.body.scrollHeight - window.innerHeight;
        window.scrollTo({ top: WAYPOINTS[i].t * max, behavior: 'smooth' });
    })
);

// ─── START ───────────────────────────────────────────────
camera.position.copy(curve.getPointAt(0));
currentLookAt.copy(curve.getPointAt(0.018));
animate();
