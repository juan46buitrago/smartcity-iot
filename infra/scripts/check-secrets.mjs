#!/usr/bin/env node
/**
 * Bloquea commits con secretos. Se instala como gancho pre-commit:
 *   node infra/scripts/check-secrets.mjs --install
 * Uso manual (revisa los archivos preparados para commit, o todos los versionables con --all):
 *   node infra/scripts/check-secrets.mjs [--all]
 *
 * Busca en cada archivo:
 *  - los valores exactos de los secretos locales (.env, .local-credentials.txt) y de la colección Postman
 *    antigua de referencias/ (si existe en este equipo), sin mostrarlos nunca;
 *  - patrones de claves privadas y tokens conocidos.
 * Rechaza además cualquier archivo .env, .pem, .key o de credenciales aunque se fuerce con `git add -f`.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const rel = (p) => join(root, p);

if (process.argv.includes('--install')) {
  const hook = rel('.git/hooks/pre-commit');
  writeFileSync(hook, '#!/bin/sh\nexec node infra/scripts/check-secrets.mjs\n');
  try {
    chmodSync(hook, 0o755);
  } catch {
    /* Windows */
  }
  console.log('Gancho pre-commit instalado: cada commit se revisa en busca de secretos.');
  process.exit(0);
}

/* ---------- valores secretos conocidos (solo en memoria) ---------- */
const secrets = [];
const add = (v) => {
  v = String(v ?? '').trim().replace(/^["']|["']$/g, '');
  if (v.length >= 8 && !/^(password|username|pending|subscription-key)$/i.test(v)) secrets.push(v);
};
if (existsSync(rel('.env')))
  for (const line of readFileSync(rel('.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && /PASS|TOKEN|SECRET|HASH|KEY/.test(m[1])) add(m[2]);
  }
if (existsSync(rel('.local-credentials.txt')))
  for (const m of readFileSync(rel('.local-credentials.txt'), 'utf8').matchAll(/contraseña=\s*(\S+)/g)) add(m[1]);
if (existsSync(rel('referencias')))
  for (const f of readdirSync(rel('referencias')).filter((x) => x.endsWith('.postman_collection.json'))) {
    const walk = (o, k = '') => {
      if (o && typeof o === 'object') for (const [kk, v] of Object.entries(o)) walk(v, kk);
      else if (typeof o === 'string') {
        if (/key|pass|token|secret|auth/i.test(k)) add(o);
        for (const m of o.matchAll(/(?:subscription-key|api[-_]?key|password|pass|token)=([^&\s"]{6,})/gi)) add(m[1]);
        for (const m of o.matchAll(/[A-Za-z0-9]{32,}/g)) add(m[0]);
      }
    };
    try {
      walk(JSON.parse(readFileSync(join(rel('referencias'), f), 'utf8')));
    } catch {
      /* colección ilegible: se ignora */
    }
  }

const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clave privada'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'clave de acceso AWS'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'token de GitHub'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, 'token de Slack'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'clave de API (sk-…)'],
];
const FORBIDDEN = /(^|\/)(\.env(\..+)?|\.local-credentials\.txt|flows_cred\.json|.+\.(pem|key|p12|pfx)|id_(rsa|ed25519)[^/]*)$/;

const files = process.argv.includes('--all')
  ? execSync('git ls-files --cached --others --exclude-standard', { cwd: root, encoding: 'utf8' })
  : execSync('git diff --cached --name-only --diff-filter=ACMR', { cwd: root, encoding: 'utf8' });
const list = files.split(/\r?\n/).filter(Boolean);

const problems = [];
for (const f of list) {
  if (FORBIDDEN.test(f) && !f.endsWith('.env.example')) {
    problems.push(`${f}: tipo de archivo que nunca debe versionarse`);
    continue;
  }
  let c;
  try {
    c = readFileSync(join(root, f), 'utf8');
  } catch {
    continue;
  }
  if (secrets.some((s) => c.includes(s))) problems.push(`${f}: contiene el valor de un secreto conocido`);
  for (const [re, name] of PATTERNS) if (re.test(c)) problems.push(`${f}: parece contener ${name}`);
}

if (problems.length) {
  console.error('✘ Commit bloqueado: posibles secretos (no se muestran los valores):');
  for (const p of problems) console.error('  - ' + p);
  console.error('Quite esos datos o use variables de entorno (.env, ignorado por Git).');
  process.exit(1);
}
console.log(`✔ Sin secretos en ${list.length} archivo(s) revisado(s).`);
