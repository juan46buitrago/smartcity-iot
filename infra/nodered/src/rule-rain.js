// REGLA 2 — Alumbrado adaptativo con lluvia.
// Con lluvia (≥ 1 mm en 15 min según DEV10) se anula la atenuación nocturna de DEV07 (100 %) para mejorar
// la visibilidad; se restablece al 60 % cuando la lluvia cesa (< 0.2 mm). Actúa solo en transiciones.
const v = msg.payload && msg.payload.variables;
const rain = v && v.precipitation && v.precipitation.value;
if (typeof rain !== 'number') return null;
const active = flow.get('rain_lighting') === true;
if (!active && rain >= 1) {
    flow.set('rain_lighting', true);
    node.status({ fill: 'blue', shape: 'dot', text: 'lluvia ' + rain + ' mm → 100 %' });
    return command('DEV07', 'set_params', { night_dim_pct: 100 }, 'alumbrado_lluvia');
}
if (active && rain < 0.2) {
    flow.set('rain_lighting', false);
    node.status({ fill: 'green', shape: 'dot', text: 'sin lluvia → 60 %' });
    return command('DEV07', 'set_params', { night_dim_pct: 60 }, 'alumbrado_lluvia');
}
node.status({ fill: active ? 'blue' : 'grey', shape: 'ring', text: 'lluvia ' + rain + ' mm' });
return null;
