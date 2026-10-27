import {build} from 'vite';
import {resolve,sep} from 'node:path';
import {existsSync,cpSync} from 'node:fs';

// An optional source snapshot uses exactly the same fixture as the current tree.
// Outputs stay ignored; the main application build remains unchanged.
const source=resolve(process.argv[2]??'.');
const outDir=resolve(process.argv[3]??'artifacts/satellite-current');
if(!outDir.startsWith(resolve('artifacts')+sep))throw new Error('Validation output must be a subdirectory of artifacts/');
// Keep fixtures independent of a separate development-server lifetime. The
// preview server's root is artifacts/, including this generated Cesium copy.
cpSync(resolve('public/cesium'),resolve('artifacts/cesium'),{recursive:true});
await build({configFile:false,root:source,base:'./',publicDir:false,
  define:{CESIUM_BASE_URL:JSON.stringify('/cesium/')},
  build:{outDir,emptyOutDir:true,chunkSizeWarningLimit:6000,
    rollupOptions:{input:Object.fromEntries(['cloud-scene','cloud-gpu','water-cloud-gpu','celestial-state','celestial-gpu','celestial-optics','celestial-scene','atmosphere-gpu','lighting-gpu','satellite-lod','cloud-pipeline','high-cloud-gpu','cloud-grazing','cloud-partial','cloud-cache','stage5-scene','cloud-startup','cloud-closure']
      .filter(name=>existsSync(resolve(source,`tests/${name}.html`))).map(name=>[name,resolve(source,`tests/${name}.html`)]))}}});
