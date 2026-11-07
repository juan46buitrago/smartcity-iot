// Eventos de incidentes SINTÉTICOS de DEV04. Solo se aceptan si vienen marcados como sintéticos.
const p = msg.payload;
const i = p && p.incident;
if (!i || p.device_id !== 'DEV04' || i.synthetic !== true || !/^SIM-INC-[A-Z0-9-]+$/.test(i.incident_id)) { bump('rejected'); return null; }
const ts = Date.parse(p.timestamp);
if (!Number.isFinite(ts)) { bump('rejected'); return null; }
// Un número no finito (NaN) haría que InfluxDB rechazara el lote entero: se descarta solo este evento.
const nums = [i.location && i.location.lat, i.location && i.location.lon, i.speed_impact, i.lanes_blocked].map(Number);
if (!nums.every(Number.isFinite)) { bump('rejected'); node.warn('Incidente descartado: coordenadas o métricas no numéricas'); return null; }
const tags = [
    'event=' + escTag(p.event), 'type=' + escTag(i.type), 'severity=' + escTag(i.severity),
    'state=' + escTag(i.state), 'road_class=' + escTag(i.road_class), 'test=' + (i.test === true), 'synthetic=true',
].join(',');
const fields = [
    'incident_id=' + escStr(i.incident_id), 'road_name=' + escStr(i.road_name), 'segment_id=' + escStr(i.segment_id),
    'lat=' + nums[0], 'lon=' + nums[1], 'speed_impact=' + nums[2], 'lanes_blocked=' + Math.trunc(nums[3]) + '.0',
].join(',');
bump('ok');
msg.payload = 'incident_events,' + tags + ' ' + fields + ' ' + ts;
return msg;
