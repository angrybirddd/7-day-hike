# Amap Web Service Quota Notes

Checked on 2026-05-27 against Amap official pages.

Official pages used:

- https://lbs.amap.com/pages/base_service_price
- https://lbs.amap.com/api/webservice/guide/tools/flowlevel
- https://lbs.amap.com/upgrade

## Current API Type

The project uses a `Web服务` key, which can call Amap REST endpoints such as
geocoding, POI search, distance, and route planning.

## Official Limits Observed

For basic LBS services such as geocoding, reverse geocoding, route planning,
distance measurement, coordinate conversion, district lookup, IP lookup, and
static maps:

- Unverified developer: unavailable for these services.
- Personal verified developer: 150,000 calls/month, 3 QPS.
- Enterprise verified developer under the Chengfeng plan: 3,000,000 calls/month,
  30 QPS.
- Enterprise verified developer with technical service license: 9,000,000
  calls/month, 100 QPS.

For basic search services such as keyword search, nearby search, polygon search,
ID lookup, and input tips:

- Unverified developer: unavailable.
- Personal verified developer: 5,000 calls/month, 3 QPS.
- Enterprise verified developer under the Chengfeng plan: 50,000 calls/month,
  30 QPS.
- Enterprise verified developer with technical service license: 500,000
  calls/month, 100 QPS.

The official Web Service flow-limit page says QPS quota should be checked in
Console -> Flow Analysis -> Quota Management.

## Paid Scaling Path

Amap's service-upgrade page says monthly traffic packages can be bound to a
`Web服务` key. After binding, all Web Service API calls made with that key are
not subject to traffic upper limits. Technical support flagship is sold together
with traffic package monthly service and starts at six months.

## Practical Impact For This Project

The bottleneck for collecting forestry-site POIs is search quota, not geocoding.
For a careful first pass, keep requests below 3 QPS and cache every raw response.
If repeated full-region refreshes are needed, upgrade the account or buy a
traffic package for the Web Service key before running large crawls.
