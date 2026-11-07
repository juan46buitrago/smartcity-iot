// Historial de conexión (para disponibilidad). Se usa la hora de recepción: el LWT lleva la hora de conexión.
const p = msg.payload;
const topicDev = msg.topic.split('/')[1];
if (!p || !isDev(p.device_id) || p.device_id !== topicDev) { bump('rejected'); return null; }
const conn = p.connection === 'online' ? 'online' : 'offline';
const state = ['running', 'stopped', 'degraded', 'error'].includes(p.state) ? p.state : 'unknown';
const fields = ['online=' + (conn === 'online' ? '1.0' : '0.0')];
if (typeof p.reason === 'string') fields.push('reason=' + escStr(p.reason.slice(0, 200)));
bump('ok');
msg.payload = 'device_status,device_id=' + p.device_id + ',connection=' + conn + ',state=' + state + ' ' + fields.join(',') + ' ' + Date.now();
return msg;
