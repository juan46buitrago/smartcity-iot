// Utilidades de line protocol de InfluxDB (se insertan al inicio de cada función de persistencia).
// Un tag vacío o con salto de línea invalida la línea y InfluxDB rechazaría el lote completo (400).
const escTag = (v) => String(v == null || v === '' ? 'unknown' : v).replace(/[\r\n]+/g, ' ').slice(0, 64).replace(/[,= ]/g, (c) => '\\' + c);
// Un salto de línea separa registros en line protocol: se sustituye por espacio (evita inyección de filas).
const escStr = (v) => '"' + String(v).replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const isDev = (id) => /^DEV(0[1-9]|1[01])$/.test(id);
const MAX_AGE_MS = 10 * 24 * 3600 * 1000; // IDEAM publica con retraso de hasta varios días
const MAX_FUTURE_MS = 5 * 60 * 1000;
function bump(key) {
    const s = flow.get('stats') || { ok: 0, rejected: 0 };
    s[key] = (s[key] || 0) + 1;
    flow.set('stats', s);
    node.status({ fill: s.rejected ? 'yellow' : 'green', shape: 'dot', text: 'ok ' + s.ok + ' · rechazados ' + s.rejected });
}
