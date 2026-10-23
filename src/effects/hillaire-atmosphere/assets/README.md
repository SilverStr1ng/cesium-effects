# Lunar color map

`lroc_color_2k.jpg` — 2048 × 1024, 457,942 bytes, downloaded unchanged on 2026-10-23.

- Source: [NASA Scientific Visualization Studio, CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/), 2025 color-map revision.
- File: https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg
- Credit: NASA's Scientific Visualization Studio; visualization by Ernie Wright; LRO / LROC / LOLA instrument teams. LROC color mosaic: NASA / GSFC / Arizona State University.
- [NASA SVS use policy](https://svs.gsfc.nasa.gov/help/#frequently-asked-questions): public domain unless otherwise noted. No separate restriction is stated for this map. This asset is not claimed as original MIT-licensed project artwork; NASA endorsement is not implied.
- SHA-256: `f7130a1822681fa7512d7dcfd40db8c10b9ba4f06777910348698260ed7a2170`.

Equirectangular, 0° longitude at the image centre; east increases to the right, north is the top row. Upload uses `flipY: false`, with `u = 0.5 + atan(y,x)/(2π)`, `v = 0.5 − asin(z)/π` in lunar body-fixed coordinates. Longitude repeats, latitude clamps. Cesium 1.146's IAU 2000 lunar orientation provides analytic libration and the pole orientation; this is not JPL DE440/441 precision.

The JPEG is decoded as sRGB to linear RGBA8 **before** generating mipmaps. Shading divides by the area-weighted linear luminance mean and retains the existing 0.82 mean relative reflectance. NASA describes this map as adjusted for visual appearance, not scientific measurement; it is not an absolute radiometric albedo. No bump/displacement map or reference-video frame is included.
