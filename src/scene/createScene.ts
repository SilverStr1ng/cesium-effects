import {
  Viewer, Ion, Cartesian2, Cartesian3, Color, Rectangle, GridMaterialProperty,
  TileMapServiceImageryProvider, buildModuleUrl, ImageryLayer, createWorldImageryAsync,
  Math as CesiumMath, JulianDate, ScreenSpaceEventType, type Entity,
} from 'cesium';

export async function createScene(container: HTMLElement, onStatus: (message: string, error?: boolean) => void) {
  const token = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim() || '';
  Ion.defaultAccessToken = token;
  const localMap = await TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII'));
  const viewer = new Viewer(container, {
    baseLayer: new ImageryLayer(localMap),
    animation: false, timeline: false, baseLayerPicker: false, geocoder: false,
    homeButton: false, sceneModePicker: false, navigationHelpButton: false,
    fullscreenButton: false, selectionIndicator: false, infoBox: false,
    shouldAnimate: false, scene3DOnly: true,
    contextOptions: { webgl: { alpha: false, antialias: true, preserveDrawingBuffer: true } },
  });
  const scene = viewer.scene;
  const localLayer = viewer.imageryLayers.get(0);
  localLayer.brightness = 1;
  localLayer.saturation = 1;
  viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 1.5) / (window.devicePixelRatio || 1);
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.enableLighting = true;
  scene.globe.showGroundAtmosphere = false;
  scene.globe.baseColor = Color.fromCssColorString('#4e5b50');
  scene.backgroundColor = Color.fromCssColorString('#0b151b');
  if (scene.skyBox) scene.skyBox.show = true;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
  scene.fog.enabled = false;
  scene.postProcessStages.fxaa.enabled = true;
  viewer.clock.currentTime = JulianDate.fromIso8601('2026-06-21T17:00:00Z');
  viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  scene.screenSpaceCameraController.minimumZoomDistance = 100;
  scene.screenSpaceCameraController.maximumZoomDistance = 30_000_000;

  const ground: Entity = viewer.entities.add({
    id: 'lab-ground',
    rectangle: {
      coordinates: Rectangle.fromDegrees(-97.82,35.22,-97.22,35.70), height: 2,
      granularity: CesiumMath.toRadians(.01),
      material: new GridMaterialProperty({
        color: Color.fromCssColorString('#91a39a').withAlpha(.3), cellAlpha: .04,
        lineCount: new Cartesian2(100,100), lineThickness: new Cartesian2(1.2,1.2),
      }),
    },
  });
  const rings: Entity[] = [];
  for (const radius of [500,1000,2000]) {
    const positions = Array.from({length: 129}, (_, i) => {
      const angle=i/128*Math.PI*2;
      return Cartesian3.fromDegrees(-97.52+Math.cos(angle)*radius/90600,35.46+Math.sin(angle)*radius/111000,4);
    });
    rings.push(viewer.entities.add({ polyline: {
      positions, width: 1, material: Color.fromCssColorString('#d1dfad').withAlpha(.32),
    }}));
  }
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(-97.52,35.40,2500),
    orientation: { heading: 0, pitch: CesiumMath.toRadians(-12), roll: 0 },
  });
  scene.renderError.addEventListener((_scene, error) => {
    console.error(error);
    onStatus('渲染出现错误，请刷新页面或降低画质。', true);
  });

  let satellite: ImageryLayer | undefined;
  let mapRequest = 0;
  async function setMap(mode: string) {
    const request = ++mapRequest;
    if (mode === 'satellite' && !token) {
      onStatus('请先在 .env 填写 VITE_CESIUM_ION_TOKEN 并重启开发服务器。');
      return false;
    }
    if (mode === 'satellite' && !satellite) {
      try {
        const provider = await createWorldImageryAsync();
        if (viewer.isDestroyed()) return false;
        satellite = viewer.imageryLayers.addImageryProvider(provider);
        satellite.show = false;
        provider.errorEvent.addEventListener(() => onStatus('部分影像瓦片加载失败，请检查网络或 Token 权限。', true));
      } catch {
        onStatus('Cesium ion 影像加载失败，已保留实验底图。请检查 Token 与网络。', true);
        return false;
      }
    }
    if (request !== mapRequest || viewer.isDestroyed()) return false;
    if (satellite) satellite.show = mode === 'satellite';
    ground.show = mode === 'lab';
    for (const ring of rings) ring.show = mode === 'lab';
    localLayer.brightness=mode==='lab'?.28:1;
    localLayer.saturation=mode==='lab'?.15:1;
    onStatus(mode === 'lab' ? '已切换到实验网格' : mode==='satellite'?'已切换到卫星影像':'已切换到自然地球');
    return true;
  }
  return { viewer, hasToken: Boolean(token), setMap, setGuides: (show: boolean) => { for (const ring of rings) ring.show = show && ground.show; } };
}
