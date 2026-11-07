// Valida telemetría y la convierte en una línea `telemetry` (una fila ancha por mensaje).
const p = msg.payload;
const topicDev = msg.topic.split('/')[1];
const reject = (why) => { bump('rejected'); node.warn('Telemetría rechazada (' + topicDev + '): ' + why); return null; };
if (!p || typeof p !== 'object') return reject('no es JSON');
if (!isDev(p.device_id) || p.device_id !== topicDev) return reject('device_id no coincide con el tópico');
const ts = Date.parse(p.timestamp);
if (!Number.isFinite(ts)) return reject('timestamp inválido');
if (ts > Date.now() + MAX_FUTURE_MS || ts < Date.now() - MAX_AGE_MS) return reject('timestamp fuera de rango');
if (!p.variables || typeof p.variables !== 'object') return reject('sin variables');
const fields = [];
for (const [k, obj] of Object.entries(p.variables)) {
    if (!/^[a-z0-9_]{1,40}$/.test(k) || !obj) continue;
    const v = obj.value;
    // Los numéricos se guardan siempre como float para que la agregación los trate igual.
    if (typeof v === 'number' && Number.isFinite(v)) fields.push(k + '=' + (Number.isInteger(v) ? v + '.0' : v));
    else if (typeof v === 'string') fields.push(k + '=' + escStr(v.slice(0, 64)));
    else if (typeof v === 'boolean') fields.push(k + '=' + v);
}
if (fields.length === 0) return reject('sin variables válidas');
if (Number.isInteger(p.seq)) fields.push('seq=' + p.seq + 'i');
const synthetic = !!(p.provenance && p.provenance.synthetic === true);
const src = ['simulated', 'digital_twin', 'api', 'dataset'].includes(p.source_type) ? p.source_type : 'unknown';
bump('ok');
msg.payload = 'telemetry,device_id=' + escTag(p.device_id) + ',source_type=' + src + ',synthetic=' + synthetic + ' ' + fields.join(',') + ' ' + ts;
return msg;
