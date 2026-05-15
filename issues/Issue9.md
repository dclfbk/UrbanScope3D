**Description**
Follow-up tasks from the call on 2026-05-15. This issue collects the next round
of upgrades: navigation aids, richer datasets, bilingual UI, layer
hierarchy, and onboarding documentation.

Tasks

UI / navigation
- [ ] Compass / N-S-W-E indicator on the map.
- [ ] Click popup on the map should also report **wind speed** at the
      clicked pixel
- [ ] Click popup on the map should also report **temperature** at the
      clicked pixel
- [ ] Group the layer toggles into categories instead of a single flat
      list (a layer hierarchy / collapsible sections).
- [ ] Sticky search bar always visible at the top
- [ ] Search bar for Bologna **neighborhoods** (`quartieri`); selecting
      one highlights it in pseudo-3D (extruded block above the rest of
      the map).
- [ ] Bilingual UI (IT / EN) via a React i18n library (e.g.
      `react-i18next` or `next-intl`).


New datasets / overlays
- [ ] Add building heights — via DSM/DTM (nDSM pipeline) or via Open Data Bologna building
- [ ] Open Data Bologna building dataset
      https://opendata.comune.bologna.it/explore/dataset/c_a944ctc_edifici_pl/information/?disjunctive.descrizion&disjunctive.origine
- [ ] Colour the buildings by temperature (heatmap-style fill on
      `fill-extrusion-color`).
- [ ] Colour the buildings and make understandable the wind direction in 3d map on 
      `fill-extrusion-color`).
- [ ] Noise overlay - explore:
  - https://noisy-city.jetpack.ai/
  - https://goodcitylife.org/
- [ ] Apply the official **Bologna colour palette** (Pantone references)
      to the city rendering, so the visual identity matches the comune's
      brand.

- [ ] **Bologna 3D** (Comune di Bologna) ArcGIS service:
      https://sitmappe.comune.bologna.it/Bologna3D/ - specifically the
      `CartografiaTecnica/MapServer/14` layer carries the **eaves height**
      (`ALT_UV`) per building. Working query example:
      https://sitmappe.comune.bologna.it/agsfed/rest/services/Basi/CartografiaTecnica/MapServer/14/query?f=json&where=1=1&outFields=ALT_UV,COD_DESCR,ENTE,OBJECTID&outSR=4326
      [https://sitmappe.comune.bologna.it/agsfed/rest/services/Basi/CartografiaTecnica/MapServer/14/query?f=json&geometry={"spatialReference"%3A{"latestWkid"%3A3857%2C"wkid"%3A102100}%2C"xmin"%3A1262739.7072677985%2C"ymin"%3A5541990.298789958%2C"xmax"%3A1263045.4553809392%2C"ymax"%3A5542296.046903098}&resultOffset=0&resultRecordCount=1000&where=1%3D1&outFields=ALT_UV%2CCOD_DESCR%2CENTE%2COBJECTID&outSR=102100&quantizationParameters={"extent"%3A{"spatialReference"%3A{"latestWkid"%3A7791%2C"wkid"%3A7791}%2C"xmin"%3A677199.381%2C"ymin"%3A4921303.674%2C"xmax"%3A693300.238%2C"ymax"%3A4936274.612}%2C"mode"%3A"view"%2C"originPosition"%3A"upperLeft"%2C"tolerance"%3A1.1943285669555674}&spatialRel=esriSpatialRelIntersects&geometryType=esriGeometryEnvelope&inSR=102100](https://sitmappe.comune.bologna.it/agsfed/rest/services/Basi/CartografiaTecnica/MapServer/14/query?f=json&geometry=%7B%22spatialReference%22%3A%7B%22latestWkid%22%3A3857%2C%22wkid%22%3A102100%7D%2C%22xmin%22%3A1262739.7072677985%2C%22ymin%22%3A5541990.298789958%2C%22xmax%22%3A1263045.4553809392%2C%22ymax%22%3A5542296.046903098%7D&resultOffset=0&resultRecordCount=1000&where=1%3D1&outFields=ALT_UV%2CCOD_DESCR%2CENTE%2COBJECTID&outSR=102100&quantizationParameters=%7B%22extent%22%3A%7B%22spatialReference%22%3A%7B%22latestWkid%22%3A7791%2C%22wkid%22%3A7791%7D%2C%22xmin%22%3A677199.381%2C%22ymin%22%3A4921303.674%2C%22xmax%22%3A693300.238%2C%22ymax%22%3A4936274.612%7D%2C%22mode%22%3A%22view%22%2C%22originPosition%22%3A%22upperLeft%22%2C%22tolerance%22%3A1.1943285669555674%7D&spatialRel=esriSpatialRelIntersects&geometryType=esriGeometryEnvelope&inSR=102100)
      The field `ALT_UV` should replace the `DEFAULT_BUILDING_HEIGHT = 15`
      fallback in the viewer when the DSM-derived height is unavailable.
- [ ] OSM **roof shapes** look into
      https://wiki.openstreetmap.org/wiki/Key:roof:shape
      consuming the OSM `roof:shape`.
- [ ] **Ortofoto** basemap option (in addition to dark/light/satellite).
- [ ] Regional portal data: https://mappe.regione.emilia-romagna.it/

LiDAR
- [ ] **Textured LiDAR / photorealistic 3D Tiles** — evaluate new viewer layer 

Documentation
- [ ] Write a "how to add a new dataset" section in the docs (download,
      preprocessing, viewer wiring). Goal: a future contributor can add
      a new layer end-to-end without reverse-engineering the codebase.
- [ ] Reflect Leonardo's NBS toolkit PDF in the design:
  - aesthetic / visual style inspired by the NBS toolkit,
  - implement / surface the **3-30-300 green rule** 


Deliverables
[11_v2-roadmap.md](https://github.com/dclfbk/UrbanScope3D/blob/main/documentation/11_v2-roadmap.md)
