/**
 * Node-RED — SmartCityBGA.
 * - Flujos versionados en infra/nodered/flows (montados en /flows-src y copiados a /data al arrancar).
 * - Credenciales del broker: las genera scbga-entrypoint.sh desde el entorno (no se versionan).
 * - Editor protegido (usuario + hash bcrypt desde el entorno) y servido bajo /nodered.
 */
module.exports = {
  uiPort: 1880,
  flowFile: 'flows.json',
  flowFilePretty: true,
  credentialSecret: false,
  httpAdminRoot: '/nodered',
  httpNodeRoot: '/nodered/api',
  adminAuth: {
    type: 'credentials',
    users: [{ username: process.env.NODERED_ADMIN_USER || 'admin', password: process.env.NODERED_ADMIN_HASH, permissions: '*' }],
  },
  diagnostics: { enabled: false },
  runtimeState: { enabled: false },
  externalModules: { autoInstall: false, palette: { allowInstall: false, allowUpload: false }, modules: { allowInstall: false } },
  functionExternalModules: false,
  functionTimeout: 5,
  logging: { console: { level: 'info', metrics: false, audit: false } },
  editorTheme: { projects: { enabled: false }, tours: false, header: { title: 'SmartCityBGA · Node-RED' } },
  exportGlobalContextKeys: false,
  // Contexto persistente en /data/context: la cola de escritura (líneas pendientes) y el estado de
  // histéresis de las reglas sobreviven a reinicios. Se vuelca a disco cada 2 s y al detenerse.
  contextStorage: { default: { module: 'localfilesystem', config: { flushInterval: 2 } } },
  // Una escritura colgada no debe bloquear la cola más de 20 s.
  httpRequestTimeout: 20000,
};
