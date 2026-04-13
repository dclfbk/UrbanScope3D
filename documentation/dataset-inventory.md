# Dataset inventory - Bologna

## Scope

Check available public datasets useful to build a 3D urban prototype on Bologna, from:

- [Open Data Bologna](https://bologna.opendatasoft.com)
- [Geoportale Emilia-Romagna](https://geoportale.regione.emilia-romagna.it/)

## Inventory by category

### 1. Buildings

| Dataset | Portal | info | Format / access | CRS | Spatial coverage | Resolution / nominal scale | Data quality / notes |
|---|---|---|---|---|---|---|---|
| [Edifici particellari](https://bologna.opendatasoft.com/explore/dataset/rifter_edif_pl/export/) | Open Data Bologna | Municipal building footprints enriched with cadastral references. | Opendatasoft export/API. JSON/CSV or GeoJSON via API. | - | Municipality of Bologna | - | Footprint of buildings. |
| [DBTR - Edificio (EDI_GPG)](https://geoportale.regione.emilia-romagna.it/catalogo/dati-cartografici/cartografia-di-base/database-topografico-regionale/immobili-e-antropizzazioni/edificato/layer) | Geoportale Emilia-Romagna | Main regional building layer. | DXF, SHP, WMS, KMZ, GPKG, GeoJSON, FGDB; download through **Download DB Topo** | - | Regional | **Scale equivalent 1:5,000** | - |
| [DBTR - Unità volumetrica (UVL_GPG)](https://geoportale.regione.emilia-romagna.it/catalogo/dati-cartografici/cartografia-di-base/database-topografico-regionale/immobili-e-antropizzazioni/edificato/layer-6) | Geoportale Emilia-Romagna | Splits buildings into homogeneous volumetric parts. | DXF, SHP, WMS, KMZ, GPKG, GeoJSON, FGDB; Download DB Topo | - | Regional | **Scale equivalent 1:5,000** | Check this, it gives the average height for eachè sub-volume, normalized for small values |
| [DBTR - Falda (FDA_GPG)](https://geoportale.regione.emilia-romagna.it/catalogo/dati-cartografici/cartografia-di-base/database-topografico-regionale/immobili-e-antropizzazioni/edificato/layer-5) | Geoportale Emilia-Romagna | Roof-slope surfaces. | DXF, SHP, WMS, KMZ, GPKG, GeoJSON, FGDB; Download DB Topo | - | Regional | **Scale equivalent 1:5,000** | Useful for roof segmentation, it maps the individual sloped roof survace. |

---

### 2. Vegetation

| Dataset | Portal | Info | Format / access | CRS | Spatial coverage | Resolution / nominal scale | Data quality / notes |
|---|---|---|---|---|---|---|---|
| [Unità Gestionali (aree verdi in manutenzione)](https://bologna.opendatasoft.com/explore/dataset/un_gest/export/) | Open Data Bologna | Public green areas under maintenance: parks, gardens, school/sport green, traffic green, squares/flowerbeds. | Opendatasoft export/API | - | Municipality of Bologna | - | Coverage of managed public green, but not a single canopy or canopy-height dataset. |
| [Verde privato nel territorio urbanizzato](https://bologna.opendatasoft.com/explore/dataset/verde_privato_urbanizzato/?flg=it-it) | Open Data Bologna | Fills a major gap by mapping private green. | Opendatasoft export/API | - | Municipality of Bologna | - | Coverage of private green, not sigle canopy or canopy-height dataset. |
| [DBTR - Albero isolato (ALB_GPT)](https://geoportale.regione.emilia-romagna.it/catalogo/dati-cartografici/cartografia-di-base/database-topografico-regionale/vegetazione/verde-urbano/layer) | Geoportale Emilia-Romagna | Individual trees. | DXF, SHP, WMS, KMZ, GPKG, GeoJSON, FGDB; Download DB Topo | - | Regional | **Scale equivalent 1:5,000** | Only trees that are “evident and characteristic”, with canopy diameter at least **5 m**. Not complete. |
| [DBTR - Filare di alberi (FIL_GLI)](https://geoportale.regione.emilia-romagna.it/catalogo/dati-cartografici/cartografia-di-base/database-topografico-regionale/vegetazione/verde-urbano/layer-2) | Geoportale Emilia-Romagna | Tree rows. | DXF, SHP, WMS, KMZ, GPKG, GeoJSON, FGDB; Download DB Topo | - | Regional | **Scale equivalent 1:5,000** | Giving tree rows (distant less than 2m) |
| [DBTR - Area verde (PSR_GPG)](https://geoportale.regione.emilia-romagna.it/catalogo/dati-cartografici/cartografia-di-base/database-topografico-regionale/vegetazione/verde-urbano/layer-1) | Geoportale Emilia-Romagna | Polygonal layer for urban green areas. | DXF, SHP, WMS, KMZ, GPKG, GeoJSON, FGDB; Download DB Topo | - | Regional | **Scale equivalent 1:5,000** | - |

---

### 3. Terrain / DEM

| Dataset | Portal | Why it matters | Format / access | CRS | Spatial coverage | Resolution / nominal scale | Data quality / notes |
|---|---|---|---|---|---|---|---|
| [DTM 0,5x0,5m - Comune di Bologna 2023](https://geoportale.regione.emilia-romagna.it/catalogo/dati-cartografici/altimetria/layer-1740409827.23) | Geoportale Emilia-Romagna | **Terrain source for Bologna**. High-resolution DTM from 2023 airborne LiDAR. | GRID, WMS, WCS | Horizontal: RDN32 (UTM 32N), Vertical (elevation): ITALGEO2005 | Bologna municipal area | **0.5 m cells**; **scale equivalent 1:1,000**; tile size **500x500 m** | Detailed DTM for Bologna, use this one. |
| [DTM 0,5x0,5m - RER 2023-24](https://geoportale.regione.emilia-romagna.it/catalogo/dati-cartografici/altimetria/layer-60) | Geoportale Emilia-Romagna | Regiornal terrain model | GRID, WMS, WCS | Horizontal: RDN32 (UTM 32N), Vertical: ITALGEO2005 | Regional (where available) | **0.5 m cells**; **scale equivalent 1:1,000**; tile size **1000x1000 m** | Regiornal data, for areas outside Bologna (if needed) |

---

### 4. Land use / ground surface

| Dataset | Portal | Why it matters | Format / access | CRS | Spatial coverage | Resolution / nominal scale | Data quality / notes |
|---|---|---|---|---|---|---|---|
| [Uso del suolo 2020 - coperture vettoriali di dettaglio - edizione 2023](https://geoportale.regione.emilia-romagna.it/download/dati-e-prodotti-cartografici-preconfezionati/pianificazione-e-catasto/uso-del-suolo/2020-coperture-vettoriali-uso-del-suolo-di-dettaglio-edizione-2023/dati-preconfezionati) | Geoportale Emilia-Romagna | **Land-use dataset**. Thematic classification for ground surfaces / land cover. | ESRI Shapefile | **ETRS89/UTM 32N (EPSG:25832)**, **Gauss Boaga Ovest (EPSG:3003)**, **UTMRER (EPSG:202003)**, **RDN32 (EPSG:7791)** | Regional | Reference scale **1:10,000**; minimum area **0.16 ha** and minimum linear width **7 m** (from the thematic documentation) | Zonal analysis |

---

### 5. Environmental data (not for initial 3d -> maybe later for analysis or data integration)

| Dataset | Portal | Why it matters | Format / access | CRS | Spatial coverage | Resolution / nominal scale | Data quality / notes |
|---|---|---|---|---|---|---|---|
| [Temperature Bologna](https://bologna.opendatasoft.com/explore/dataset/temperature_bologna/) | Open Data Bologna | Daily temperature | Opendatasoft export/API | - | Municipality of Bologna | **Daily** | For temporal analysis, not a spatial temperature raster. |
| [Centraline qualità dell'aria (misurazioni giornaliere)](https://bologna.opendatasoft.com/explore/dataset/centraline-qualita-aria/?flg=it-it) | Open Data Bologna | Daily environmental station data for 3 Bologna stations: Giardini Margherita, Via Chiarini, Porta San Felice. | Opendatasoft export/API | Point/station based | 3 stations inside Bologna municipality | **Daily** | Useful for point-based environmental indicators; not a continuous surface. |

---

## How to request / download the data 

### A. Open Data Bologna (Opendatasoft)

>**Download on link**
**Download via API**

- **Example 1 - download buildings as GeoJSON**

    ```python
    import geopandas as gpd

    # Dataset identifier from the portal page:
    # rifter_edif_pl = "Edifici particellari"

    url = (
        "https://bologna.opendatasoft.com/api/records/1.0/download/"
        "?dataset=rifter_edif_pl"
        "&format=geojson"
        "&rows=-1"
    )

    gdf = gpd.read_file(url)
    print(gdf.head())
    print(gdf.crs)

    gdf.to_file("bologna_edifici_particellari.geojson", driver="GeoJSON")
    ```

- **Example 2 - download green areas as GeoJSON**

    ```python
    import geopandas as gpd

    datasets = {
        "public_green": "un_gest",
        "private_green": "verde_privato_urbanizzato",
    }

    for name, dataset_id in datasets.items():
        url = (
            "https://bologna.opendatasoft.com/api/records/1.0/download/"
            f"?dataset={dataset_id}"
            "&format=geojson"
            "&rows=-1"
        )
        gdf = gpd.read_file(url)
        gdf.to_file(f"{name}.geojson", driver="GeoJSON")
        print(name, len(gdf), gdf.crs)
    ```

- **Example 3 - download time series as CSV**

    ```python
    import pandas as pd

    url = (
        "https://bologna.opendatasoft.com/api/records/1.0/download/"
        "?dataset=temperature_bologna"
        "&format=csv"
        "&rows=-1"
    )

    df = pd.read_csv(url)
    print(df.head())
    df.to_csv("temperature_bologna.csv", index=False)
    ```

---

### B. Geoportale Emilia-Romagna - vector layers (DBTR)

>**Download DB Topo**
**DBTR WMS**

- **Best approach**

  1. Open the dataset page.
  2. Use the **Download DB Topo** workflow for the selected class and area.
  3. Choose the area of interest (Bologna municipality).
  4. Export the format you need.

- **DBTR service endpoint**

    ```text
    http://servizigis.regione.emilia-romagna.it/wms/dbtr?service=WMS&version=1.3.0&request=GetCapabilities
    ```

    This WSM is useful to:

  - Inspect layer names
  - add the layer to QGIS
  - verify supported CRS in the sevice capabilities

- **QGIS use**

    In QGIS:

  - Layer -> Add Layer -> Add WMS/WMTS Layer
  - URL -> The one written above

---

### C. Geoportale Emilia-Romagna - DEM / terrain via WCS

- **Example 4 - inspect a Bologna DEM services and download a ruster subset**

```python
from owslib.wcs import WebCoverageService

# Bologna 2023 50 cm DTM
url = "https://servizigis.regione.emilia-romagna.it/wcs/dtm_comune_bo_2023"

wcs = WebCoverageService(url, version="1.0.0")

print("Available coverages:")
print(list(wcs.contents))

coverage_id = "1" #"COMUNE_BO_2023_DTM_RDN32_RM"
coverage = wcs.contents[coverage_id]

print("Supported CRS:", coverage.supportedCRS)
print("Supported formats:", coverage.supportedFormats)
```

After inspecting supported formats, download a subset:

```python
from owslib.wcs import WebCoverageService

url = "https://servizigis.regione.emilia-romagna.it/wcs/dtm_comune_bo_2023"
wcs = WebCoverageService(url, version="1.0.0")

coverage_id = "1" #"COMUNE_BO_2023_DTM_RDN32_RM"

# IMPORTANT:
# Use a bbox in the CRS advertised by the service.
# Replace the numbers below with a real bbox for your area of Bologna.
response = wcs.getCoverage(
    identifier=coverage_id,
    bbox=(11.30, 44.47, 11.35, 44.50),
    crs="EPSG:4326",   # change this if the service expects a projected CRS
    format="GeoTIFF",
    width=2000,
    height=2000
)

with open("bologna_dtm_subset.tif", "wb") as f:
    f.write(response.read())
```

**Notes**:

- Read the service capabilities first
- Inspect **Supported CRS** and **Supported formats**
- Then send **GetCoverage** with matching CRS / format.

---

