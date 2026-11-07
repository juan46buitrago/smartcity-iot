// Cada 2 s: toma hasta 5000 líneas de la cola persistente y arma la petición de escritura.
// Solo una petición en vuelo a la vez; si no hay respuesta en 30 s se considera perdida y se reintenta.
const BATCH = 5000;
const inflight = flow.get('inflight');
if (inflight && Date.now() - inflight.at < 30000) return null;
let pending = flow.get('pending') || [];
if (inflight) pending = inflight.lines.concat(pending); // la petición anterior no respondió: se reintenta
if (pending.length === 0) { flow.set('inflight', null); return null; }
const lines = pending.slice(0, BATCH);
flow.set('pending', pending.slice(BATCH));
flow.set('inflight', { at: Date.now(), lines: lines });
msg.lines = lines;
msg.url = env.get('INFLUX_URL') + '/api/v2/write?org=' + encodeURIComponent(env.get('INFLUX_ORG')) +
    '&bucket=' + encodeURIComponent(env.get('INFLUX_BUCKET_RAW')) + '&precision=ms';
msg.method = 'POST';
msg.headers = { Authorization: 'Token ' + env.get('INFLUX_WRITE_TOKEN'), 'Content-Type': 'text/plain; charset=utf-8' };
msg.payload = lines.join('\n');
return msg;
