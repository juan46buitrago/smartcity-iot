// Encola una línea validada en la cola persistente del flujo (contexto en disco, sobrevive a reinicios).
// Un temporizador la envía por lotes a InfluxDB. Tope de 20 000 líneas: si se supera se descartan las más antiguas.
const MAX_PENDING = 20000;
if (!msg.payload) return null;
const pending = flow.get('pending') || [];
pending.push(msg.payload);
if (pending.length > MAX_PENDING) pending.splice(0, pending.length - MAX_PENDING);
flow.set('pending', pending);
return null;
