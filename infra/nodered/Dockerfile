FROM nodered/node-red:4.0.9-22
# Configuración endurecida: editor con usuario/contraseña, sin instalación de paquetes desde el editor.
COPY settings.js /usr/src/node-red/scbga-settings.js
COPY --chmod=755 scbga-entrypoint.sh /usr/src/node-red/scbga-entrypoint.sh
ENV FLOWS=flows.json
ENTRYPOINT ["/usr/src/node-red/scbga-entrypoint.sh"]
CMD ["--settings", "/usr/src/node-red/scbga-settings.js"]
