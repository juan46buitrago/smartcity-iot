// 204 = escrito. Ante error de red o 5xx las líneas vuelven al frente de la cola persistente (máx. 20 000).
// Un 4xx indica datos que InfluxDB nunca aceptará: se registran y se descartan para no bloquear la cola.
const MAX_PENDING = 20000;
flow.set('inflight', null);
const lines = msg.lines || [];
if (msg.statusCode === 204) {
    const total = (flow.get('written') || 0) + lines.length;
    flow.set('written', total);
    node.status({ fill: 'green', shape: 'dot', text: 'escritas ' + total + ' · pendientes ' + (flow.get('pending') || []).length });
    return null;
}
if (msg.statusCode >= 400 && msg.statusCode < 500) {
    node.error('InfluxDB rechazó el lote (' + msg.statusCode + '): ' + String(msg.payload).slice(0, 300));
    node.status({ fill: 'red', shape: 'ring', text: 'rechazado ' + msg.statusCode });
    return null;
}
const pending = lines.concat(flow.get('pending') || []);
flow.set('pending', pending.slice(-MAX_PENDING));
const why = msg.statusCode || (msg.error && (msg.error.code || msg.error.message)) || msg.error;
node.status({ fill: 'yellow', shape: 'ring', text: 'reintento · pendientes ' + pending.length });
node.warn('InfluxDB no disponible (' + why + '); ' + lines.length + ' líneas reencoladas');
return null;
