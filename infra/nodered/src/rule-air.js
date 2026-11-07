// REGLA 1 — Restricción vehicular por calidad del aire.
// Si el AQI de DEV02 llega a 150 (dañino) se reduce la demanda de tráfico simulada en DEV05 (medida tipo
// "pico y placa ambiental"). Se restablece cuando el AQI baja de 100. Actúa solo en transiciones (histéresis).
const v = msg.payload && msg.payload.variables;
const aqi = v && v.us_aqi && v.us_aqi.value;
if (typeof aqi !== 'number') return null;
const active = flow.get('air_restriction') === true;
if (!active && aqi >= 150) {
    flow.set('air_restriction', true);
    node.status({ fill: 'red', shape: 'dot', text: 'restricción activa (AQI ' + aqi + ')' });
    return command('DEV05', 'set_params', { demand_factor: 0.7 }, 'restriccion_aire');
}
if (active && aqi < 100) {
    flow.set('air_restriction', false);
    node.status({ fill: 'green', shape: 'dot', text: 'normal (AQI ' + aqi + ')' });
    return command('DEV05', 'set_params', { demand_factor: 1 }, 'restriccion_aire');
}
node.status({ fill: active ? 'red' : 'green', shape: 'ring', text: 'AQI ' + aqi });
return null;
