#!/bin/sh
# Se ejecuta UNA vez en la configuración inicial de InfluxDB (DOCKER_INFLUXDB_INIT_MODE=setup).
#  - raw     : datos crudos (retención definida por DOCKER_INFLUXDB_INIT_RETENTION, 30d)
#  - agg_5m  : agregados de 5 min (media, mínimo, máximo) durante 1 año
set -eu
ORG="${DOCKER_INFLUXDB_INIT_ORG}"

influx bucket create --org "$ORG" --name agg_5m --retention 365d --description "Agregados de 5 min (mean/min/max)"

cat > /tmp/downsample.flux <<'FLUX'
import "types"

option task = {name: "downsample_telemetry_5m", every: 5m, offset: 1m}

src =
    from(bucket: "raw")
        |> range(start: -task.every)
        |> filter(fn: (r) => r._measurement == "telemetry")
        |> filter(fn: (r) => types.isType(v: r._value, type: "float"))

agg = (fn, stat) =>
    src
        |> aggregateWindow(every: 5m, fn: fn, createEmpty: false)
        |> set(key: "stat", value: stat)

union(tables: [agg(fn: mean, stat: "mean"), agg(fn: min, stat: "min"), agg(fn: max, stat: "max")])
    |> to(bucket: "agg_5m")
FLUX
influx task create --org "$ORG" --file /tmp/downsample.flux
echo "InfluxDB: bucket agg_5m y tarea de downsampling creados"
