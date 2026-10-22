import { cpSync, mkdirSync } from 'node:fs';
const root = new URL('../', import.meta.url);
for (const directory of ['Workers', 'ThirdParty', 'Assets', 'Widgets']) {
  const destination = new URL(`public/cesium/${directory}`, root);
  mkdirSync(destination, { recursive: true });
  cpSync(new URL(`node_modules/cesium/Build/Cesium/${directory}`, root), destination, { recursive: true });
}
console.log('Cesium runtime assets ready.');
