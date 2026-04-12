/**
 * ============================================================
 *  FLORESTA 3D – GLB OPTIMIZATION PIPELINE
 *  Compresses, simplifies, and texture-optimizes all 3D models
 * ============================================================
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, simplify, prune, draco, textureCompress, flatten } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const OUT = path.join(ROOT, 'optimized');
const VEG_DIR = path.join(ROOT, 'vegetação da floresta');
const VEG_OUT = path.join(OUT, 'vegetação da floresta');

// ─── Create output directories ──────────────────────────
[OUT, VEG_OUT].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ─── Initialize dependencies ────────────────────────────
console.log('🔧 Initializing MeshoptSimplifier...');
await MeshoptSimplifier.ready;
console.log('✅ MeshoptSimplifier ready');

console.log('🔧 Initializing Draco encoder/decoder...');
const encoderModule = await draco3d.createEncoderModule();
const decoderModule = await draco3d.createDecoderModule();
console.log('✅ Draco ready');

const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
        'draco3d.encoder': encoderModule,
        'draco3d.decoder': decoderModule,
    });

// ─── Stats tracking ─────────────────────────────────────
let totalInputMB = 0;
let totalOutputMB = 0;
let filesProcessed = 0;
let filesFailed = 0;

// ─── Optimize a single GLB file ─────────────────────────
async function optimizeFile(inputPath, outputPath, opts = {}) {
    const { simplifyRatio = 0.05, maxTextureSize = 1024, label = '' } = opts;

    if (!fs.existsSync(inputPath)) {
        console.log(`  ⚠️ File not found: ${inputPath}`);
        filesFailed++;
        return;
    }

    const inputSize = fs.statSync(inputPath).size;
    const inputMB = inputSize / (1024 * 1024);
    totalInputMB += inputMB;
    const name = path.basename(inputPath);

    console.log(`\n${'═'.repeat(64)}`);
    console.log(`📦 ${label || name}`);
    console.log(`   File: ${name}`);
    console.log(`   Size: ${inputMB.toFixed(1)} MB`);
    console.log(`${'─'.repeat(64)}`);

    const startTime = Date.now();

    try {
        // 1. Read the document
        console.log('  📖 Reading GLB...');
        const doc = await io.read(inputPath);

        // 2. Manually resize and compress textures with sharp
        const textures = doc.getRoot().listTextures();
        console.log(`  🎨 Processing ${textures.length} texture(s)...`);

        for (let ti = 0; ti < textures.length; ti++) {
            const tex = textures[ti];
            const image = tex.getImage();
            if (!image || image.byteLength < 500) continue;

            try {
                const buf = Buffer.from(image.buffer, image.byteOffset, image.byteLength);
                const metadata = await sharp(buf).metadata();
                const origW = metadata.width || 0;
                const origH = metadata.height || 0;
                const origKB = (image.byteLength / 1024).toFixed(0);

                let pipeline = sharp(buf);

                // Resize if larger than max
                if (origW > maxTextureSize || origH > maxTextureSize) {
                    pipeline = pipeline.resize(maxTextureSize, maxTextureSize, {
                        fit: 'inside',
                        withoutEnlargement: true,
                    });
                }

                // Convert to WebP
                const compressed = await pipeline.webp({ quality: 72 }).toBuffer();
                const newKB = (compressed.byteLength / 1024).toFixed(0);

                tex.setImage(new Uint8Array(compressed));
                tex.setMimeType('image/webp');

                console.log(`    Tex ${ti + 1}/${textures.length}: ${origW}×${origH} ${origKB}KB → ${newKB}KB (WebP)`);
            } catch (texErr) {
                console.log(`    Tex ${ti + 1}: skip (${texErr.message})`);
            }
        }

        // 3. Run geometry optimization pipeline
        console.log('  🔨 Running optimization pipeline...');
        console.log(`     dedup → prune → weld → simplify(${(simplifyRatio * 100).toFixed(0)}%) → draco`);

        await doc.transform(
            dedup(),
            prune(),
            weld({ tolerance: 0.0001 }),
            simplify({ simplifier: MeshoptSimplifier, ratio: simplifyRatio, error: 0.01 }),
            draco(),
        );

        // 4. Write optimized file
        console.log('  💾 Writing optimized GLB...');
        await io.write(outputPath, doc);

        const outputSize = fs.statSync(outputPath).size;
        const outputMB = outputSize / (1024 * 1024);
        totalOutputMB += outputMB;
        const reduction = ((1 - outputSize / inputSize) * 100).toFixed(1);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log(`  ✅ DONE in ${elapsed}s`);
        console.log(`     ${inputMB.toFixed(1)} MB → ${outputMB.toFixed(1)} MB  (−${reduction}%)`);
        filesProcessed++;

    } catch (err) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`  ❌ FAILED after ${elapsed}s: ${err.message}`);
        console.error(`     Stack: ${err.stack?.split('\n')[1]?.trim()}`);
        filesFailed++;
    }

    // Force GC if available
    if (global.gc) global.gc();
}

// ═══════════════════════════════════════════════════════════
//  HERO MODELS – close-up, need moderate detail
// ═══════════════════════════════════════════════════════════
console.log('\n\n🌳🌳🌳 PHASE 1: HERO MODELS 🌳🌳🌳\n');

const heroes = [
    { file: 'Meshy_AI_erva_mate_0222023324_generate.glb',     label: '🧉 Erva-Mate (15 MB)' },
    { file: 'Meshy_AI_araucaria_0222021559_generate.glb',     label: '🌲 Araucária (71 MB)' },
    { file: 'Meshy_AI_margarida_0222024657_generate.glb',     label: '🌼 Margarida (103 MB)' },
    { file: 'Meshy_AI_Ipe_amarelo_0222022300_generate.glb',   label: '🌻 Ipê Amarelo (310 MB)' },
    { file: 'Meshy_AI_samambaia_0222022826_generate.glb',     label: '🌿 Samambaia (310 MB)' },
];

for (const { file, label } of heroes) {
    await optimizeFile(
        path.join(ROOT, file),
        path.join(OUT, file),
        { simplifyRatio: 0.08, maxTextureSize: 1024, label }
    );
}

// ═══════════════════════════════════════════════════════════
//  FOREST MODELS – instanced, can be very low poly
// ═══════════════════════════════════════════════════════════
console.log('\n\n🌲🌲🌲 PHASE 2: FOREST VEGETATION 🌲🌲🌲\n');

const forest = [
    'Meshy_AI_faça_modelos_de_arvo_0222025357_generate.glb',
    'Meshy_AI_faça_modelos_de_arvo_0222025655_generate.glb',
    'Meshy_AI_faça_modelos_de_arvo_0222025549_generate.glb',
    'Meshy_AI_faça_modelos_de_arvo_0222025411_generate.glb',
];

for (const file of forest) {
    await optimizeFile(
        path.join(VEG_DIR, file),
        path.join(VEG_OUT, file),
        { simplifyRatio: 0.03, maxTextureSize: 512, label: `🌲 ${file.slice(0, 40)}...` }
    );
}

// ═══════════════════════════════════════════════════════════
//  SUMMARY
// ═══════════════════════════════════════════════════════════
console.log('\n\n' + '═'.repeat(64));
console.log('🎉 OPTIMIZATION COMPLETE');
console.log('═'.repeat(64));
console.log(`  Files processed: ${filesProcessed}`);
console.log(`  Files failed:    ${filesFailed}`);
console.log(`  Total input:     ${totalInputMB.toFixed(1)} MB`);
console.log(`  Total output:    ${totalOutputMB.toFixed(1)} MB`);
console.log(`  Total reduction: ${((1 - totalOutputMB / totalInputMB) * 100).toFixed(1)}%`);
console.log('═'.repeat(64));
console.log('\n✨ Now update main.js to use ./optimized/ paths!\n');
