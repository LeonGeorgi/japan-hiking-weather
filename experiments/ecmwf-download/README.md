# ECMWF Japan download measurement

This experiment measures actual HTTP response-body bytes from Open-Meteo's
public S3 files. It does not change the application's forecast, provider, or CI.

## Result — November 22, 2026

The complete successful run transferred **107,579,033 bytes (107.58 MB)** in
**327.38 seconds** on this machine, including the validation rereads and local
array export. MB means 1,000,000 bytes. This is an observed run, not a size
extrapolated from a sample.

| Download | Bytes | MB |
| --- | ---: | ---: |
| Twelve forecast fields | 106,992,616 | 106.99 |
| Reusable model terrain | 582,016 | 0.58 |
| Run metadata JSON | 4,401 | 0.004 |
| **Total** | **107,579,033** | **107.58** |

All 13,140 range responses were HTTP 206 with the expected byte lengths.
All 91,152,756 selected weather values were finite; all cached rereads were
identical and transferred zero additional bytes. The decoded float32 weather
arrays occupy 364.61 MB; their local `.npz` exports occupy 88.96 MB. Neither
number is the size of an eventual browser payload.

Four complete forecast downloads of this size would transfer about **428 MB per
day**, plus small metadata downloads. This is an extrapolation from the measured
run, not a measurement of four separate model updates or of an Actions workflow.

The machine-readable per-field result is in
[`result-2026-11-22.json`](result-2026-11-22.json).

## Scope

- Native ECMWF IFS O1280 grid, approximately 9 km; no spatial thinning.
- Complete rectangle: 24–46° N, 122–147° E, including surrounding sea.
- 68,433 cells on 313 latitude rows.
- Model run: 2026-11-21 12:00 UTC (21:00 Japan time).
- Requested period: November 22–28, 2026, seven calendar days in Japan.
- Twelve raw surface fields: temperature, dew point, both wind components,
  gusts, precipitation, snowfall water equivalent, visibility, cloud cover,
  CAPE, showers, and shortwave radiation.
- Model terrain elevation is measured separately because it can be reused
  between forecast runs.

## Reproduce

```sh
uv run --python 3.13 experiments/ecmwf-download/measure.py \
  --run 2026/11/21/1200Z --start 2026-11-22 \
  --block-bytes 8192 --output /tmp/ecmwf-japan
```

Run-based data currently has three months of public retention. Choose another
available run and matching start date when repeating this later.

The output directory contains the report, individual HTTP range request records,
selected row indices, and the actual decoded arrays (`.npz`). Large arrays and
request logs stay outside the repository.

## Method and limits

The reader uses an initially empty 8-KiB block cache for each file and up to twelve
HTTP connections. It counts response bodies after receiving them and requires
HTTP 206 responses. Transfer includes file metadata, compressed chunks, and any
neighboring cells/time steps fetched because of chunk or cache boundaries.
HTTP/TLS headers and the Python tool installation are excluded.

Each field uses its own embedded time coordinate. Interval fields omit the
initial forecast instant. Native time steps bracketing the entire requested
period are decoded; later forecast hours have coarser temporal spacing.
No hourly interpolation or weather-index derivation is performed in this test.
The compressed time chunks span the whole model run, so some later dates are
transferred even though only seven days are requested.

Every requested cell/time value must be finite. Each field is read again to
verify identical results and zero additional transfer from the warm cache.
This cache result applies to rereading the **same run**. A new run has new file
URLs and requires another forecast download; terrain elevation can be reused.
File sizes vary with the forecast and chosen variables.

Terrain values of `-999` are the source's sea mask, not a physical altitude.
The model terrain is smoothed and does not represent individual summit heights.

The earlier temperature-only comparison measured 26,425,608 bytes using 64-KiB
blocks and 9,197,832 bytes using 8-KiB blocks for the same cells and period.
Those setup/comparison runs are excluded from the final complete-run total.

## Sources

- [Open-Meteo public data layouts and retention](https://github.com/open-meteo/open-data)
- [Official Python OM reader](https://open-meteo.github.io/python-omfiles/)
- [O1280 coordinate/index equations](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Domains/GaussianGrid.swift)
- [Tested run metadata](https://openmeteo.s3.amazonaws.com/data_run/ecmwf_ifs/2026/11/21/1200Z/meta.json)
