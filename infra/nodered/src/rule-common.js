// Construye una orden válida según el contrato MQTT (command_id UUID v4 + issued_at).
function uuid4() {
    const h = [];
    for (let i = 0; i < 32; i++) h.push(Math.floor(Math.random() * 16).toString(16));
    h[12] = '4';
    h[16] = (8 + Math.floor(Math.random() * 4)).toString(16);
    const s = h.join('');
    return s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20);
}
function command(device, action, params, rule) {
    return {
        topic: 'smartcity/' + device + '/control',
        qos: 1,
        payload: { command_id: uuid4(), action: action, params: params, issued_at: new Date().toISOString(), issued_by: 'nodered:' + rule },
    };
}
