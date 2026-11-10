import { Link } from 'react-router-dom';
import { Card, PageHeader } from '../components/ui';

/** Quién opera el sitio, de dónde salen los datos y qué se guarda o se envía a terceros. */
export function AboutPage() {
  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader code="Información" title="Acerca, privacidad y términos" subtitle="Qué es este sitio, de dónde salen los datos, qué información se guarda o se envía a terceros y las condiciones de uso." />
      <div className="grid gap-5">
        <Card className="px-5 py-5">
          <h2 className="text-[17px] font-semibold">Qué es</h2>
          <p className="mt-2 text-sm text-ink-2">
            SmartCityBGA es un proyecto académico de la asignatura IoT + Cloud + Sistemas Distribuidos de la Universidad Autónoma de Bucaramanga (UNAB). Simula y
            monitorea una ciudad inteligente para fines de aprendizaje. <strong>No es un servicio oficial</strong> y no está afiliado a la Alcaldía de Bucaramanga
            ni a ninguna entidad pública. Es gratuito y no tiene planes de pago.
          </p>
        </Card>
        <Card className="px-5 py-5">
          <h2 className="text-[17px] font-semibold">De dónde salen los datos</h2>
          <p className="mt-2 text-sm text-ink-2">
            Cada dato lleva su procedencia. <strong>SIM</strong> significa dato sintético (simulación o gemelo digital: un modelo por computador que imita un sensor),
            no una medición. <strong>REAL</strong> significa que viene de una fuente externa: modelos meteorológicos y de calidad del aire de Open-Meteo (son salidas de
            modelos, no estaciones), niveles de río del IDEAM o un reanálisis histórico (ERA5) del mismo día del año anterior. El nodo ESP32 corre en el simulador
            Wokwi: su firmware y su conexión son reales, pero los valores de sus sensores los fija una persona, por eso se marca SIM. La ficha de cada dispositivo
            explica su fuente exacta.
          </p>
        </Card>
        <Card className="px-5 py-5">
          <h2 className="text-[17px] font-semibold">Privacidad</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink-2">
            <li>El sitio no pide registro y no usa cookies, analítica ni scripts de terceros.</li>
            <li>
              Tu navegador guarda solo preferencias: tema, si ya viste la guía, la voz del asistente y las últimas preguntas al asistente (se borran al cerrar la
              pestaña). Si inicias sesión como operador, el permiso queda guardado en este navegador durante 12 horas o hasta que cierres sesión, y al cerrar sesión queda anulado también en el servidor.
            </li>
            <li>
              Las preguntas al asistente Nodo se envían a un proveedor externo de inteligencia artificial (servicio compatible con la API de OpenAI; el modelo se indica
              en la página del asistente) y el servidor guarda sus primeros 300 caracteres en el registro de uso del asistente. <strong>No escribas datos personales</strong>{' '}
              en ellas.
            </li>
            <li>El mapa descarga sus imágenes de OpenStreetMap, que recibe tu dirección IP como cualquier sitio web.</li>
          </ul>
          <p className="mt-3 text-sm text-ink-2">
            El tratamiento de datos personales en Colombia se rige por la Ley 1581 de 2012. El sitio no pide nombre, correo ni ningún dato de identificación; el
            responsable es el equipo del proyecto académico, que conserva el registro de uso del asistente solo mientras dure la asignatura.
          </p>
        </Card>
        <Card className="px-5 py-5">
          <h2 className="text-[17px] font-semibold">Términos de uso</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink-2">
            <li>El sitio se ofrece tal cual, con fines educativos y sin garantía de disponibilidad, exactitud ni continuidad.</li>
            <li>
              Los datos no deben usarse para tomar decisiones reales de movilidad, salud, emergencias o calidad del aire: muchos son simulados y los reales provienen de
              modelos o fuentes externas que pueden fallar o retrasarse.
            </li>
            <li>El uso es libre y no comercial. Las funciones de operador están reservadas al equipo del proyecto.</li>
            <li>No intentes acceder sin autorización, saturar el servicio ni vulnerar su seguridad. El servidor limita las solicitudes y registra los intentos fallidos.</li>
            <li>Los mapas son © colaboradores de OpenStreetMap (ODbL) y los datos de Open-Meteo e IDEAM pertenecen a sus autores, según sus licencias.</li>
          </ul>
        </Card>
        <Card className="px-5 py-5">
          <h2 className="text-[17px] font-semibold">Contacto</h2>
          <p className="mt-2 text-sm text-ink-2">
            Equipo del proyecto SmartCityBGA · asignatura IoT + Cloud + Sistemas Distribuidos · Universidad Autónoma de Bucaramanga (UNAB). Las consultas sobre el sitio o
            sobre tus datos se atienden por los canales de la asignatura.
          </p>
        </Card>
        <p className="text-sm text-ink-3">
          <Link to="/" className="font-semibold text-accent hover:underline">
            Volver al panel
          </Link>
        </p>
      </div>
    </div>
  );
}
