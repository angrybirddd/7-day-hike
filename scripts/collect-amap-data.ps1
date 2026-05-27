param(
    [string]$OutDir = "data",
    [int]$DelayMilliseconds = 450
)

$ErrorActionPreference = "Stop"

if (-not $env:AMAP_API_KEY) {
    throw "Set AMAP_API_KEY in the current shell before running this script."
}

$rawDir = Join-Path $OutDir "raw/amap"
$processedDir = Join-Path $OutDir "processed"
New-Item -ItemType Directory -Force -Path $rawDir, $processedDir | Out-Null

$cityEncoded = "%E5%91%BC%E4%BC%A6%E8%B4%9D%E5%B0%94"

$placeQueries = @(
    @{ slug = "ganhe-forestry-bureau"; encoded = "%E7%94%98%E6%B2%B3%E6%9E%97%E4%B8%9A%E5%B1%80" },
    @{ slug = "ganhe-forest-farm"; encoded = "%E7%94%98%E6%B2%B3%E6%9E%97%E5%9C%BA" },
    @{ slug = "alihe-forestry-bureau"; encoded = "%E9%98%BF%E9%87%8C%E6%B2%B3%E6%9E%97%E4%B8%9A%E5%B1%80" },
    @{ slug = "alihe-forest-farm"; encoded = "%E9%98%BF%E9%87%8C%E6%B2%B3%E6%9E%97%E5%9C%BA" },
    @{ slug = "jiagedaqi-forestry-bureau"; encoded = "%E5%8A%A0%E6%A0%BC%E8%BE%BE%E5%A5%87%E6%9E%97%E4%B8%9A%E5%B1%80" },
    @{ slug = "jiagedaqi-forest-farm"; encoded = "%E5%8A%A0%E6%A0%BC%E8%BE%BE%E5%A5%87%E6%9E%97%E5%9C%BA" },
    @{ slug = "dayangshu-forestry-bureau"; encoded = "%E5%A4%A7%E6%9D%A8%E6%A0%91%E6%9E%97%E4%B8%9A%E5%B1%80" },
    @{ slug = "dayangshu-forest-farm"; encoded = "%E5%A4%A7%E6%9D%A8%E6%A0%91%E6%9E%97%E5%9C%BA" },
    @{ slug = "yakeshi-forestry-bureau"; encoded = "%E7%89%99%E5%85%8B%E7%9F%B3%E6%9E%97%E4%B8%9A%E5%B1%80" },
    @{ slug = "yakeshi-forest-farm"; encoded = "%E7%89%99%E5%85%8B%E7%9F%B3%E6%9E%97%E5%9C%BA" },
    @{ slug = "hailar-forestry-bureau"; encoded = "%E6%B5%B7%E6%8B%89%E5%B0%94%E6%9E%97%E4%B8%9A%E5%B1%80" },
    @{ slug = "mianduhe-forestry-bureau"; encoded = "%E5%85%8D%E6%B8%A1%E6%B2%B3%E6%9E%97%E4%B8%9A%E5%B1%80" },
    @{ slug = "wuerqihan-forestry-bureau"; encoded = "%E4%B9%8C%E5%B0%94%E6%97%97%E6%B1%89%E6%9E%97%E4%B8%9A%E5%B1%80" },
    @{ slug = "wuerqihan-alt-forestry-bureau"; encoded = "%E4%B9%8C%E5%B0%94%E6%97%97%E6%B1%97%E6%9E%97%E4%B8%9A%E5%B1%80" },
    @{ slug = "kuduer-forestry-bureau"; encoded = "%E5%BA%93%E9%83%BD%E5%B0%94%E6%9E%97%E4%B8%9A%E5%B1%80" },
    @{ slug = "tulihe-forestry-bureau"; encoded = "%E5%9B%BE%E9%87%8C%E6%B2%B3%E6%9E%97%E4%B8%9A%E5%B1%80" },
    @{ slug = "yitulihe-forestry-bureau"; encoded = "%E4%BC%8A%E5%9B%BE%E9%87%8C%E6%B2%B3%E6%9E%97%E4%B8%9A%E5%B1%80" },
    @{ slug = "genhe-forestry-bureau"; encoded = "%E6%A0%B9%E6%B2%B3%E6%9E%97%E4%B8%9A%E5%B1%80" },
    @{ slug = "jiwen-forestry-bureau"; encoded = "%E5%90%89%E6%96%87%E6%9E%97%E4%B8%9A%E5%B1%80" },
    @{ slug = "keyihe-forestry-bureau"; encoded = "%E5%85%8B%E4%B8%80%E6%B2%B3%E6%9E%97%E4%B8%9A%E5%B1%80" }
)

$anchorQueries = @(
    @{ slug = "hailar"; encoded = "%E6%B5%B7%E6%8B%89%E5%B0%94%E5%8C%BA" },
    @{ slug = "yakeshi"; encoded = "%E7%89%99%E5%85%8B%E7%9F%B3%E5%B8%82" },
    @{ slug = "mianduhe"; encoded = "%E5%85%8D%E6%B8%A1%E6%B2%B3%E9%95%87" },
    @{ slug = "wuerqihan"; encoded = "%E4%B9%8C%E5%B0%94%E6%97%97%E6%B1%97%E9%95%87" },
    @{ slug = "kuduer"; encoded = "%E5%BA%93%E9%83%BD%E5%B0%94%E9%95%87" },
    @{ slug = "tulihe"; encoded = "%E5%9B%BE%E9%87%8C%E6%B2%B3%E9%95%87" },
    @{ slug = "yitulihe"; encoded = "%E4%BC%8A%E5%9B%BE%E9%87%8C%E6%B2%B3%E9%95%87" },
    @{ slug = "genhe"; encoded = "%E6%A0%B9%E6%B2%B3%E5%B8%82" },
    @{ slug = "keyihe"; encoded = "%E5%85%8B%E4%B8%80%E6%B2%B3%E9%95%87" },
    @{ slug = "jiwen"; encoded = "%E5%90%89%E6%96%87%E9%95%87" },
    @{ slug = "ganhe"; encoded = "%E7%94%98%E6%B2%B3%E9%95%87" },
    @{ slug = "alihe"; encoded = "%E9%98%BF%E9%87%8C%E6%B2%B3%E9%95%87" },
    @{ slug = "dayangshu"; encoded = "%E5%A4%A7%E6%9D%A8%E6%A0%91%E9%95%87" },
    @{ slug = "jiagedaqi"; encoded = "%E5%8A%A0%E6%A0%BC%E8%BE%BE%E5%A5%87%E5%8C%BA" }
)

$anchorOverrides = @{
    # Amap geocoding matches these names to the wrong province/district unless
    # constrained manually. Use precise POI coordinates from the place search.
    ganhe = @{
        location = "123.050544,50.632735"
        adcode = "150723"
        source = "amap_place_text_override"
    }
    alihe = @{
        location = "123.724613,50.599909"
        adcode = "150723"
        source = "amap_place_text_override"
    }
    dayangshu = @{
        location = "124.625848,49.737245"
        adcode = "150723"
        source = "amap_place_text_override"
    }
}

function Invoke-AmapJson {
    param([string]$Url)
    Start-Sleep -Milliseconds $DelayMilliseconds
    $response = Invoke-RestMethod -Method Get -Uri $Url
    if ($response.status -ne "1") {
        $safeUrl = $Url -replace "key=[^&]+", "key=***"
        throw "Amap request failed: $($response.info) / $($response.infocode) / $safeUrl"
    }
    return $response
}

function Save-Json {
    param([object]$Value, [string]$Path)
    $Value | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath $Path -Encoding UTF8
}

$allPois = New-Object System.Collections.Generic.List[object]

foreach ($querySpec in $placeQueries) {
    $query = [uri]::UnescapeDataString($querySpec.encoded)
    $encoded = $querySpec.encoded
    $url = "https://restapi.amap.com/v3/place/text?keywords=$encoded&city=$cityEncoded&citylimit=false&extensions=all&offset=25&page=1&key=$env:AMAP_API_KEY"
    $json = Invoke-AmapJson -Url $url
    Save-Json $json (Join-Path $rawDir "place-$($querySpec.slug).json")

    foreach ($poi in @($json.pois)) {
        $allPois.Add([pscustomobject]@{
            id = $poi.id
            query = $query
            name = $poi.name
            type = $poi.type
            address = if ($poi.address -is [array]) { ($poi.address -join ";") } else { $poi.address }
            adname = $poi.adname
            location = $poi.location
            pname = $poi.pname
            cityname = $poi.cityname
            tel = if ($poi.tel -is [array]) { ($poi.tel -join ";") } else { $poi.tel }
            source = "amap_place_text"
        })
    }
}

$dedup = $allPois |
    Where-Object { $_.id -and $_.location } |
    Sort-Object id, query -Unique

Save-Json $dedup (Join-Path $processedDir "places-first-pass.json")

$anchors = New-Object System.Collections.Generic.List[object]

foreach ($querySpec in $anchorQueries) {
    $query = [uri]::UnescapeDataString($querySpec.encoded)
    $encoded = $querySpec.encoded

    if ($anchorOverrides.ContainsKey($querySpec.slug)) {
        $override = $anchorOverrides[$querySpec.slug]
        $anchors.Add([pscustomobject]@{
            name = $query
            formatted_address = "$query POI override"
            province = $null
            city = $null
            district = $null
            adcode = $override.adcode
            location = $override.location
            source = $override.source
        })
        continue
    }

    $url = "https://restapi.amap.com/v3/geocode/geo?address=$encoded&key=$env:AMAP_API_KEY"
    $json = Invoke-AmapJson -Url $url
    Save-Json $json (Join-Path $rawDir "geocode-$($querySpec.slug).json")
    $geo = @($json.geocodes) | Select-Object -First 1
    if ($geo) {
        $anchors.Add([pscustomobject]@{
            name = $query
            formatted_address = $geo.formatted_address
            province = $geo.province
            city = $geo.city
            district = $geo.district
            adcode = $geo.adcode
            location = $geo.location
            source = "amap_geocode"
        })
    }
}

Save-Json $anchors (Join-Path $processedDir "anchor-towns.json")

$routePairs = New-Object System.Collections.Generic.List[object]
for ($i = 0; $i -lt ($anchors.Count - 1); $i++) {
    $from = $anchors[$i]
    $to = $anchors[$i + 1]
    $url = "https://restapi.amap.com/v3/direction/driving?origin=$($from.location)&destination=$($to.location)&extensions=base&strategy=0&key=$env:AMAP_API_KEY"
    $json = Invoke-AmapJson -Url $url
    Save-Json $json (Join-Path $rawDir "driving-$i.json")
    $path = @($json.route.paths) | Select-Object -First 1
    $routePairs.Add([pscustomobject]@{
        from = $from.name
        to = $to.name
        origin = $from.location
        destination = $to.location
        distance_m = if ($path) { [int]$path.distance } else { $null }
        duration_s = if ($path) { [int]$path.duration } else { $null }
        tolls_yuan = if ($path) { $path.tolls } else { $null }
        source = "amap_direction_driving"
    })
}

Save-Json $routePairs (Join-Path $processedDir "anchor-route-segments.json")

$geojsonFeatures = foreach ($poi in $dedup) {
    $parts = $poi.location -split ","
    [pscustomobject]@{
        type = "Feature"
        geometry = @{
            type = "Point"
            coordinates = @([double]$parts[0], [double]$parts[1])
        }
        properties = @{
            id = $poi.id
            name = $poi.name
            query = $poi.query
            type = $poi.type
            address = $poi.address
            adname = $poi.adname
            source = $poi.source
        }
    }
}

$geojson = [pscustomobject]@{
    type = "FeatureCollection"
    features = @($geojsonFeatures)
}

Save-Json $geojson (Join-Path $processedDir "places-first-pass.geojson")

Write-Host "Wrote $($dedup.Count) unique POIs, $($anchors.Count) anchors, and $($routePairs.Count) route segments."
