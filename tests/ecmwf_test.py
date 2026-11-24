# /// script
# requires-python = ">=3.13"
# dependencies = ["omfiles==1.2.0", "aiohttp==3.14.5", "numpy==2.5.5", "pillow==12.0.0"]
# ///
import datetime as dt
import importlib.util
import io
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import aiohttp
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
spec = importlib.util.spec_from_file_location("surface", pathlib.Path(__file__).resolve().parents[1] / "scripts/update-weather-native.py")
surface = importlib.util.module_from_spec(spec)
spec.loader.exec_module(surface)
import jma_msm
import weather_calculations as calc
import terrain_surface as terrain


class NativeWeatherTests(unittest.TestCase):
    def test_three_and_six_hour_totals_preserve_water(self):
        axis = np.array([0, 3600, 14400, 36000])
        amounts = np.array([[1, 6, 12]], dtype=np.float32)
        targets = np.arange(3600, 36001, 3600)
        hourly = calc.resample(amounts, axis[1:], targets, 0, True, True, axis)
        np.testing.assert_allclose(hourly, [[1] + [2] * 9])
        self.assertAlmostEqual(float(hourly.sum()), 19)

    def test_instant_interpolation_and_interval_gust_maximum(self):
        times = np.array([0, 10800])
        np.testing.assert_allclose(calc.resample(np.array([[0, 30]]), times, np.array([3600, 7200]), 0), [[10, 20]])
        gust = calc.resample(np.array([[25]]), np.array([10800]), np.array([3600, 7200, 10800]), 0, "maximum", False, times)
        np.testing.assert_allclose(gust, [[25, 25, 25]])
        with self.assertRaises(ValueError):
            calc.resample(np.array([[25]]), np.array([10800]), np.array([14400]), 0, True, True, times)

    def test_daylight_filters_winter_evening_in_hokkaido(self):
        targets = np.array([dt.datetime(2026, 12, 21, h, tzinfo=surface.JST).timestamp() for h in [8, 16]])
        sun = calc.daylight(np.array([45.4]), np.array([141.7]), targets)
        np.testing.assert_array_equal(sun, [[True, False]])

    def test_hiking_window_excludes_rain_before_its_start(self):
        targets = np.array([dt.datetime(2026, 6, 21, h, tzinfo=surface.JST).timestamp() for h in range(8, 17)])
        fields = {name: np.zeros((1, 9), dtype=np.float32) for name in surface.FIELDS}
        fields["temperature_2m"][:] = 15
        fields["dew_point_2m"][:] = 5
        fields["visibility"][:] = 20000
        fields["precipitation"][0, 0] = 40  # 07–08 is outside 08–16.
        fields["precipitation"][0, 1:] = 2
        result = calc.summarize(fields, np.array([36.]), np.array([138.]), targets)[0]
        self.assertEqual(result[0], 8)
        self.assertEqual(result[4], 16)
        self.assertEqual(result[5], 2)
        self.assertEqual(result[10], 0)

    def test_native_rows_retain_all_cells_and_geographic_order(self):
        rows = surface.japan_rows()
        self.assertEqual(sum(r["stop"] - r["start"] for r in rows), 68433)
        self.assertEqual(len(rows), 313)
        self.assertTrue(all(rows[i]["latitude"] > rows[i + 1]["latitude"] for i in range(len(rows) - 1)))
        self.assertTrue(all(r["west"] >= 122 and r["east"] <= 147 for r in rows))

    def test_missing_daylight_is_encoded_by_field_name_in_any_contract_order(self):
        targets = np.array([dt.datetime(2026, 12, 21, h, tzinfo=surface.JST).timestamp() for h in range(8, 17)])
        fields = {name: np.zeros((1, 9), dtype=np.float32) for name in surface.FIELDS}
        order = list(reversed(calc.METRICS))
        with patch.object(calc, "METRICS", order):
            result = calc.summarize(fields, np.array([89.]), np.array([138.]), targets)[0]
        metrics = dict(zip(order, result, strict=True))
        self.assertEqual(metrics["hours"], 0)
        self.assertTrue(all(np.isnan(value) for name, value in metrics.items() if name != "hours"))


class ModelRunTests(unittest.IsolatedAsyncioTestCase):
    async def test_msm_selects_latest_complete_window_and_retains_long_run_for_day_three(self):
        class Source:
            async def json(self, url):
                if url.endswith("latest.json"):
                    return {"reference_time": "2020-01-02T03:00:00Z"}
                stamp = dt.datetime.strptime(url.split("jma_msm/")[1].replace("/meta.json", ""), "%Y/%m/%d/%H00Z").replace(tzinfo=dt.timezone.utc)
                hours = 78 if stamp.hour in (0, 12) else 39
                return {"reference_time": stamp.isoformat(), "variables": list(jma_msm.FIELDS),
                        "valid_times": [(stamp + dt.timedelta(hours=h)).isoformat() for h in range(hours + 1)]}
        dates = [(dt.date(2020, 1, 2) + dt.timedelta(days=i)).isoformat() for i in range(7)]
        runs = await jma_msm.available_runs(Source(), dates, surface.JST)
        self.assertEqual([run[1]["reference_time"] if run else None for run in runs], [
            "2020-01-01T21:00:00+00:00", "2020-01-02T03:00:00+00:00", "2020-01-02T00:00:00+00:00",
            None, None, None, None])

    async def test_latest_run_is_used_only_when_it_covers_the_whole_hiking_window(self):
        class Source:
            async def json(self, url):
                reference = next((stamp for stamp, path in [
                    ("2020-01-02T00:00:00Z", "2020/01/02/0000Z"),
                    ("2020-01-01T12:00:00Z", "2020/01/01/1200Z"),
                ] if path in url), None)
                if reference is None:
                    raise aiohttp.ClientResponseError(None, (), status=404)
                start = dt.datetime.fromisoformat(reference.replace("Z", "+00:00"))
                return {"reference_time": reference, "crs_wkt": "O1280", "variables": list(surface.FIELDS),
                        "valid_times": [(start + dt.timedelta(hours=h)).isoformat() for h in range(0, 361, 6)]}
        dates = [(dt.date(2020, 1, 2) + dt.timedelta(days=i)).isoformat() for i in range(7)]
        runs = await surface.available_runs(Source(), dates)
        self.assertEqual(runs[0][1]["reference_time"], "2020-01-01T12:00:00Z")
        self.assertTrue(all(run[1]["reference_time"] == "2020-01-02T00:00:00Z" for run in runs[1:]))
        # Moving the configured window after the latest initialization must also
        # move today's run selection; no separate hardcoded morning cutoff.
        with patch.dict(surface.HIKING_WINDOW, {"startHour": 10, "endHour": 14}):
            later_window = await surface.available_runs(Source(), dates)
        self.assertTrue(all(run[1]["reference_time"] == "2020-01-02T00:00:00Z" for run in later_window))


class MsmTests(unittest.TestCase):
    def test_native_msm_grid_retains_5km_cells_and_north_to_south_order(self):
        rows = jma_msm.japan_rows()
        self.assertEqual(len(rows), 441)
        self.assertEqual(sum(row["count"] for row in rows), 176841)
        self.assertEqual(rows[0]["latitude"], 46)
        self.assertEqual(rows[-1]["latitude"], 24)
        self.assertEqual(rows[0]["west"], 122)
        self.assertEqual(rows[0]["west"] + (rows[0]["count"] - 1) * rows[0]["step"], 147)

    def test_ifs_supplements_are_sampled_from_the_nearest_native_cell(self):
        rows = [{"latitude": 2, "west": 10, "step": 1, "count": 2}, {"latitude": 1, "west": 10, "step": .5, "count": 3}]
        np.testing.assert_array_equal(calc.nearest_cells(rows, np.array([1.9, 1.1, 1.1]), np.array([10.9, 10.5, 11.])), [1, 3, 4])

    def test_msm_uses_own_rain_and_snow_with_ifs_gusts_visibility_and_thunder(self):
        targets = np.array([dt.datetime(2026, 6, 21, h, tzinfo=surface.JST).timestamp() for h in range(8, 17)])
        fields = {name: np.zeros((2, 9), dtype=np.float32) for name in jma_msm.FIELDS}
        fields["temperature_2m"][:] = -2
        fields["relative_humidity_2m"][:] = 80
        fields["precipitation"][:] = 1
        support = np.array([[8, 15, 15, 15, 0, 0, 0, 10, 65, 500, 1], [0] + [np.nan] * 10], dtype=np.float32)
        result = calc.summarize_msm(fields, support, np.array([36., 36.]), np.array([138., 138.]), targets)
        metrics = dict(zip(calc.METRICS, result[0], strict=True))
        self.assertEqual(metrics["temperatureMin"], -2)
        self.assertEqual(metrics["precipitation"], 8)
        self.assertAlmostEqual(metrics["snowfall"], 5.6, places=5)
        self.assertEqual(metrics["gustMax"], 65)
        self.assertEqual(metrics["visibilityMin"], 500)
        self.assertEqual(metrics["hazards"], 3)
        self.assertEqual(result[1, 0], 0)
        self.assertTrue(np.isnan(result[1, 1:]).all())


class SummitTests(unittest.TestCase):
    def test_elevation_correction_handles_higher_lower_and_missing_terrain(self):
        fields = {"temperature_2m": np.full((3, 2), 10.), "dew_point_2m": np.full((3, 2), 5.),
                  "wind_gusts_10m": np.full((3, 2), 20.)}
        corrected = calc.correct_elevation(fields, np.array([1200., 2200., np.nan]), np.array([2200., 1200., 1000.]))
        np.testing.assert_allclose(corrected["temperature_2m"][:2], [[3.5, 3.5], [16.5, 16.5]])
        np.testing.assert_allclose(corrected["dew_point_2m"][:2], [[-1.5, -1.5], [11.5, 11.5]])
        self.assertTrue(np.isnan(corrected["temperature_2m"][2]).all())
        np.testing.assert_array_equal(fields["temperature_2m"], 10)
        np.testing.assert_array_equal(corrected["wind_gusts_10m"], fields["wind_gusts_10m"])

    def test_cell_selection_prefers_nearby_land_and_keeps_close_height_matches(self):
        rows = [{"latitude": lat, "west": 138.7, "step": .0625, "count": 3} for lat in [35.4, 35.35, 35.3]]
        terrain = np.full(9, -999.)
        terrain[4], terrain[1] = 100, 700
        cells, heights = calc.summit_cells(rows, terrain, np.array([35.35]), np.array([138.7625]), np.array([800.]))
        self.assertEqual(cells[0], 1)
        self.assertEqual(heights[0], 700)
        terrain[4] = 750
        self.assertEqual(calc.summit_cells(rows, terrain, np.array([35.35]), np.array([138.7625]), np.array([800.]))[0][0], 4)
        terrain[:] = -999
        self.assertEqual(calc.summit_cells(rows, terrain, np.array([35.35]), np.array([138.7625]), np.array([800.]))[1][0], 0)

    def test_daily_totals_use_midnight_boundaries_while_hiking_uses_daylight_window(self):
        midnight = dt.datetime(2026, 6, 21, tzinfo=surface.JST)
        targets = np.array([(midnight + dt.timedelta(hours=h)).timestamp() for h in range(25)])
        fields = {name: np.zeros((1, 25), dtype=np.float32) for name in surface.FIELDS}
        fields["temperature_2m"][:] = 15
        fields["dew_point_2m"][:] = 5
        fields["visibility"][:] = 20000
        fields["temperature_2m"][0, [0, 23, 24]] = [-6, 30, -99]
        fields["precipitation"][0, [0, 2, 8, 9, 16, 17, 24]] = [100, 50, 20, 1, 3, 40, 7]
        fields["wind_gusts_10m"][0, 2] = 50
        result = calc.summit_forecasts(fields, np.array([36.]), np.array([138.]), targets, "ecmwf_ifs")[0]
        self.assertEqual(result["temperatureMin"], -6)
        self.assertEqual(result["temperatureMax"], 30)
        self.assertEqual(result["precipitation"], 121)
        self.assertEqual(result["gustMax"], 180)
        self.assertEqual(result["hiking"]["precipitation"], 4)
        self.assertEqual(result["hiking"]["temperatureMin"], 15)
        self.assertEqual(result["hiking"]["hours"], 8)

    def test_msm_snow_and_weather_code_are_derived_after_height_correction(self):
        midnight = dt.datetime(2026, 6, 21, tzinfo=surface.JST)
        targets = np.array([(midnight + dt.timedelta(hours=h)).timestamp() for h in range(25)])
        raw = {name: np.zeros((1, 25), dtype=np.float32) for name in jma_msm.FIELDS}
        raw["temperature_2m"][:] = 8
        raw["relative_humidity_2m"][:] = 80
        raw["precipitation"][:] = 1
        fields = calc.derive_msm_fields(calc.correct_elevation(raw, np.array([1000.]), np.array([3000.])))
        fields["wind_gusts_10m"] = np.zeros((1, 25))
        fields["visibility"] = np.full((1, 25), 20000)
        result = calc.summit_forecasts(fields, np.array([36.]), np.array([138.]), targets, "jma_msm", np.zeros((1, 25)))[0]
        self.assertEqual(result["temperatureMin"], -5)
        self.assertAlmostEqual(result["snowfall"], 16.8, places=5)
        self.assertEqual(result["hiking"]["codes"], [0, 73])
        self.assertAlmostEqual(result["hiking"]["snowfall"], 5.6, places=5)
        fields["temperature_2m"][0, 12] = np.nan
        fields["dew_point_2m"][0, 12] = np.nan
        missing = calc.summit_forecasts(fields, np.array([36.]), np.array([138.]), targets, "jma_msm", np.zeros((1, 25)))[0]
        self.assertIsNone(missing["temperatureMin"])
        self.assertIsNone(missing["hiking"]["feelsLikeMin"])

    def test_snow_codes_and_surface_hazards_follow_the_same_hiking_intervals_as_amounts(self):
        midnight = dt.datetime(2026, 11, 26, tzinfo=surface.JST)
        targets = np.array([(midnight + dt.timedelta(hours=h)).timestamp() for h in range(25)])
        latitude, longitude = np.array([38.4554]), np.array([140.6199])
        for hour, included in [(8, False), (9, True), (16, True), (17, False)]:
            with self.subTest(hour=hour):
                raw = {name: np.zeros((1, 25), dtype=np.float32) for name in jma_msm.FIELDS}
                raw["temperature_2m"][:] = 2.9
                raw["relative_humidity_2m"][:] = 80
                raw["precipitation"][0, hour] = .1
                fields = calc.derive_msm_fields(calc.correct_elevation(raw, np.array([876.]), np.array([1500.])))
                fields["wind_gusts_10m"] = np.zeros((1, 25))
                fields["visibility"] = np.full((1, 25), 20000)
                thunder = np.zeros((1, 25))
                hiking = calc.summit_forecasts(fields, latitude, longitude, targets, "jma_msm", thunder)[0]["hiking"]
                self.assertAlmostEqual(hiking["precipitation"], .1 if included else 0)
                self.assertAlmostEqual(hiking["snowfall"], .07 if included else 0)
                self.assertEqual(71 in hiking["codes"], included)
                section = slice(8, 17)
                metrics = calc.summarize({name: values[:, section] for name, values in fields.items()},
                                         latitude, longitude, targets[section], thunder[:, section])[0]
                self.assertEqual(metrics[calc.METRICS.index("hazards")], 2 if included else 0)

    def test_hiking_start_retains_instant_fog_and_thunder_when_previous_snow_is_excluded(self):
        midnight = dt.datetime(2026, 11, 26, tzinfo=surface.JST)
        targets = np.array([(midnight + dt.timedelta(hours=h)).timestamp() for h in range(25)])
        fields = {name: np.zeros((2, 25), dtype=np.float32) for name in surface.FIELDS}
        fields["temperature_2m"][:] = -1
        fields["dew_point_2m"][:] = -2
        fields["visibility"][:] = 20000
        fields["visibility"][0, 8] = 500
        fields["precipitation"][:, 8] = .1
        fields["snowfall_water_equivalent"][:, 8] = .1
        thunder = np.zeros((2, 25))
        thunder[1, 8] = 70
        forecasts = calc.summit_forecasts(fields, np.array([38.4554] * 2), np.array([140.6199] * 2), targets, "ecmwf_ifs", thunder)
        self.assertEqual(forecasts[0]["hiking"]["codes"], [0, 45])
        self.assertEqual(forecasts[1]["hiking"]["codes"], [0, 95])


class TerrainSurfaceTests(unittest.TestCase):
    def test_gsi_decoder_handles_positive_negative_and_missing_heights(self):
        rgba = np.zeros((256, 256, 4), dtype=np.uint8)
        rgba[:, :, 3] = 255
        rgba[0, :3, :3] = [[2, 229, 104], [255, 255, 156], [128, 0, 0]]
        rgba[0, 3, 3] = 0
        buffer = io.BytesIO()
        Image.fromarray(rgba).save(buffer, format="PNG")
        heights = terrain.decode_elevation(buffer.getvalue())
        self.assertAlmostEqual(float(heights[0, 0]), 1898)
        self.assertEqual(heights[0, 1], -1)
        self.assertTrue(np.isnan(heights[0, 2:4]).all())

    def test_mercator_pixels_round_trip_and_land_mask_preserves_holes(self):
        px, py = terrain.world_pixels(140.811488055, 42.826659444, 9)
        x, y = int(px) // 256, int(py) // 256
        index = np.array([int(py) % 256 * 256 + int(px) % 256])
        lat, lon = terrain.pixel_coordinates(x, y, index, 9)
        self.assertLess(abs(lat[0] - 42.826659444), .002)
        self.assertLess(abs(lon[0] - 140.811488055), .002)
        outer = np.array([[2, 2], [20, 2], [20, 20], [2, 20], [2, 2]])
        hole = np.array([[8, 8], [14, 8], [14, 14], [8, 14], [8, 8]])
        island = np.array([[30, 30], [31, 30], [31, 31], [30, 31], [30, 30]])
        mask = terrain.land_alpha([[outer, hole], [island]], 0, 0)
        self.assertEqual(mask[4, 4], 255)
        self.assertEqual(mask[10, 10], 0)
        self.assertGreater(mask[30, 30], 0)
        self.assertEqual(mask[100, 100], 0)

    def test_terrain_tiles_recalculate_hourly_temperature_and_msm_snow_before_scoring(self):
        targets = np.array([dt.datetime(2026, 11, 26, h, tzinfo=surface.JST).timestamp() for h in range(8, 17)])
        rows = [{"latitude": 43., "west": 140., "step": 1., "count": 2},
                {"latitude": 42., "west": 140., "step": 1., "count": 2}]
        raw = {name: np.zeros((4, 9), dtype=np.float32) for name in jma_msm.FIELDS}
        raw["temperature_2m"][:] = 2.25
        raw["relative_humidity_2m"][:] = 80
        support = {name: np.zeros((4, 9), dtype=np.float32) for name in surface.FIELDS}
        support["visibility"][:] = 20000
        # Encode scores as greyscale in this fixture so pixel values expose the rating.
        palette = [[i, i, i, 255] for i in range(256)]
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            indices = np.array([100 * 256 + 100, 100 * 256 + 101], dtype=np.uint16)
            alpha = np.zeros((256, 256), dtype=np.uint8)
            alpha.reshape(-1)[indices] = 255
            path = root / "terrain.npz"
            np.savez(path, indices=indices, heights=np.array([314., 1898.]), alpha=alpha)
            writer = terrain.TerrainSurface([(456, 188, path)], root / "surface", palette)
            try:
                for date, rain in [("2026-11-26", 0), ("2026-11-27", .1)]:
                    raw["precipitation"][:] = rain
                    writer.write_day(date, raw, rows, np.full(4, 314.), targets, "jma_msm", (support, rows, np.full(4, 314.)))
                with Image.open(root / "surface/2026-11-26/9/456/188.png") as image:
                    dry = np.array(image)
                with Image.open(root / "surface/2026-11-27/9/456/188.png") as image:
                    wet = np.array(image)
                self.assertGreater(dry[100, 100, 0], dry[100, 101, 0])
                self.assertGreater(wet[100, 100, 0], 0)
                self.assertEqual(wet[100, 101, 0], 0)  # Snow only at the higher point.
                self.assertEqual(wet[100, 101, 3], 255)  # Score zero stays visible.
                self.assertEqual(wet[0, 0, 3], 0)  # Ocean stays transparent.
                metadata = writer.finish(["2026-11-26", "2026-11-27"])
                self.assertIn("5/28/11", metadata["tiles"])
                with Image.open(root / "surface/2026-11-26/5/28/11.png") as overview:
                    self.assertEqual(overview.size, (256, 256))
            finally:
                writer.close()


if __name__ == "__main__":
    unittest.main()
