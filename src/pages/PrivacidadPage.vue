<script setup>
// Política de privacidad — PLANTILLA BASE para Hebennus (Ley 29733, Perú).
// Revisa/ajusta los textos con tu información real antes de producción.
import { MARCA } from '../lib/config.js'
import { useSeo } from '../lib/useSeo.js'

useSeo({ title: 'Política de privacidad', path: '/privacidad' })

const EMPRESA = MARCA
const CORREO  = 'hebennus.company@gmail.com'
const CIUDAD  = 'Lima, Perú'
const ACTUALIZADO = 'junio de 2026'
</script>

<template>
<div class="legal">
  <section class="page-hero">
    <div class="page-hero__inner" v-reveal>
      <span class="chip">Legal</span>
      <h1 class="page-hero__title">Política de privacidad</h1>
      <p class="page-hero__sub">Última actualización: {{ ACTUALIZADO }}</p>
    </div>
  </section>

  <section class="legal__body">
    <article class="legal__content" v-reveal>
      <p>
        En <strong>{{ EMPRESA }}</strong> ({{ CIUDAD }}) respetamos tu privacidad y protegemos tus
        datos personales conforme a la <strong>Ley N.° 29733 — Ley de Protección de Datos Personales</strong>
        del Perú y su reglamento. Esta política explica qué datos recopilamos, para qué los usamos y
        qué derechos tienes.
      </p>

      <h2>1. Qué datos recopilamos</h2>
      <ul>
        <li><strong>Datos de contacto y envío:</strong> nombres, apellidos, correo, teléfono y dirección.</li>
        <li><strong>Datos de facturación:</strong> DNI (boleta) o RUC y razón social (factura).</li>
        <li><strong>Datos del pedido:</strong> productos, montos y estado del pago.</li>
      </ul>
      <p>
        <strong>No</strong> almacenamos los datos de tu tarjeta. El pago con tarjeta se procesa
        directamente en la pasarela segura de <strong>Izipay</strong>; los números de tarjeta nunca
        pasan por nuestros servidores.
      </p>

      <h2>2. Para qué usamos tus datos</h2>
      <ul>
        <li>Procesar y entregar tu pedido, y emitir tu comprobante (boleta/factura).</li>
        <li>Contactarte para coordinar la entrega o resolver incidencias.</li>
        <li>Enviarte promociones y novedades <strong>solo si diste tu consentimiento</strong>.</li>
      </ul>

      <h2>3. Consentimiento de marketing</h2>
      <p>
        El envío de promociones es <strong>opcional</strong> y requiere tu aceptación expresa en el
        checkout. Tu correo siempre se usa para enviarte la confirmación del pedido y el comprobante,
        aunque no aceptes las promociones. Puedes <strong>darte de baja</strong> cuando quieras
        escribiéndonos a {{ CORREO }} o desde el enlace de los correos promocionales.
      </p>

      <h2>4. Con quién compartimos tus datos</h2>
      <p>
        Solo compartimos lo necesario con proveedores que nos permiten operar: la pasarela de pago
        (Izipay), el servicio de envío de correos y el courier de entrega. No vendemos tus datos a
        terceros.
      </p>

      <h2>5. Seguridad</h2>
      <p>
        Aplicamos medidas técnicas para proteger tu información (conexiones cifradas HTTPS, control de
        acceso y validaciones en el servidor). Conservamos tus datos el tiempo necesario para cumplir
        con tu pedido y las obligaciones legales (p. ej. tributarias).
      </p>

      <h2>6. Tus derechos (ARCO)</h2>
      <p>
        Puedes ejercer tus derechos de <strong>acceso, rectificación, cancelación y oposición</strong>
        sobre tus datos personales, así como revocar tu consentimiento, escribiéndonos a:
      </p>
      <p><a :href="`mailto:${CORREO}`">{{ CORREO }}</a></p>

      <h2>7. Envíos y entregas</h2>
      <ul>
        <li><strong>Costo de envío:</strong> el envío a <strong>Lima</strong> cuesta <strong>S/ 10</strong> y es <strong>gratis</strong> cuando tu pedido alcanza <strong>S/ 119</strong> o más. Los envíos a <strong>provincia se coordinan de forma interna con el comprador</strong> (por WhatsApp) y el <strong>precio puede variar</strong> según el destino. <strong>No realizamos envíos gratis salvo que se alcance el monto mínimo indicado.</strong></li>
        <li><strong>Preparación y confirmación:</strong> los pedidos se <strong>preparan los viernes</strong>; ese día te <strong>confirmamos</strong> por WhatsApp o desde la web.</li>
        <li><strong>Entregas:</strong> se realizan los <strong>sábados y domingos</strong>.</li>
        <li><strong>Horario de pedidos:</strong> tomamos pedidos de <strong>lunes a jueves</strong>. Los pedidos realizados <strong>viernes, sábado o domingo</strong> pasan a la <strong>semana siguiente</strong>. Lo hacemos así para evitar retrasos y entregas tardías.</li>
      </ul>

      <h2>8. Cambios a esta política</h2>
      <p>
        Podemos actualizar esta política. Publicaremos cualquier cambio en esta misma página con su
        nueva fecha de actualización.
      </p>

      <p class="legal__note">
        ⚠️ Esta es una versión base. Revísala y ajústala con tus datos y, si es posible, con asesoría
        legal antes de abrir la tienda al público.
      </p>

      <RouterLink to="/" class="legal__back">← Volver al inicio</RouterLink>
    </article>
  </section>
</div>
</template>

<style scoped>
.page-hero { border-bottom: 1px solid var(--border); padding: 3rem 1.25rem 2.5rem; background: var(--surface-1); }
.page-hero__inner { max-width: 760px; margin: 0 auto; }
.chip { display: inline-block; font-size: 0.68rem; letter-spacing: 0.28em; text-transform: uppercase; color: var(--accent-3); padding: 0.35rem 0.9rem; border-radius: var(--radius-pill); border: 1px solid var(--border-mid); background: var(--surface-2); }
.page-hero__title { font-family: var(--font-display); font-size: clamp(2rem, 5vw, 3.2rem); font-weight: 800; letter-spacing: -0.02em; text-transform: uppercase; color: var(--text-1); line-height: 1.05; margin-top: 0.6rem; }
.page-hero__sub { margin-top: 0.9rem; font-size: 0.78rem; letter-spacing: 0.04em; color: var(--text-3); }

.legal__body { max-width: 760px; margin: 0 auto; padding: 2.5rem 1.25rem 5rem; }
.legal__content { color: var(--text-2); line-height: 1.75; font-size: 0.95rem; }
.legal__content h2 { font-family: var(--font-display); font-size: 1.05rem; font-weight: 700; color: var(--text-1); margin: 2rem 0 0.6rem; }
.legal__content p { margin: 0.6rem 0; }
.legal__content ul { margin: 0.6rem 0; padding-left: 1.2rem; display: flex; flex-direction: column; gap: 0.35rem; }
.legal__content strong { color: var(--text-1); }
.legal__content a { color: var(--accent-3); text-decoration: underline; text-underline-offset: 2px; }
.legal__note { margin-top: 2rem; padding: 0.9rem 1.1rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-md); font-size: 0.82rem; color: var(--text-3); }
.legal__back { display: inline-block; margin-top: 2rem; font-size: 0.8rem; color: var(--accent-3); text-decoration: underline; text-underline-offset: 3px; }
.legal__back:hover { color: var(--text-1); }

@media (min-width: 861px) {
  .page-hero { padding: 3.5rem 2rem 3rem; }
  .legal__body { padding: 3rem 2rem 6rem; }
}
</style>
