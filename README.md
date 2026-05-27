# 7-Day Hike Map Data

This repository collects verified Amap/Gaode map data for the Inner Mongolia
Greater Khingan area research project.

## Scope

- Raw API responses are stored under `data/raw/`.
- Normalized tables and GeoJSON outputs are stored under `data/processed/`.
- Scripts for repeatable collection and validation are stored under `scripts/`.
- Notes about API quota, data provenance, and manual checks are stored under `docs/`.

## Secrets

Do not commit API keys. Use local environment variables such as `AMAP_API_KEY`.
