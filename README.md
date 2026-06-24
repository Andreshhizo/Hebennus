# Hebennus

Tienda de ropa oversize, atlética y cómoda (Lima, Perú). SPA en **Vue 3 + Vite**, catálogo en **Supabase** y confirmación de pedido por correo (**Resend** vía Edge Function).

## Stack
- Vue 3 (`<script setup>`) + Vite
- vue-router (history mode — URLs limpias, sin `#`)
- Supabase (catálogo + pedidos)
- Tema claro/oscuro con persistencia

## Requisitos
- Node.js 18 o superior.

## Desarrollo
```bash
npm install
npm run dev        # servidor de desarrollo (http://localhost:5173)
npm run build      # build de producción → dist/
npm run preview    # sirve dist/ localmente
```

## Variables de entorno
Copia `.env.example` a `.env` y rellena los valores (el `.env` NO se sube al repo):
```
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key            # Supabase → Settings → API → anon public
VITE_WHATSAPP_NUMERO=51XXXXXXXXX              # formato internacional sin "+" ni espacios
VITE_IZIPAY_MERCHANT_CODE=tu_merchant_code    # opcional — pasarela Izipay (valores públicos)
VITE_IZIPAY_PUBLIC_KEY=tu_public_key          # si están vacíos, el checkout no usa pasarela
```
La anon key es pública por diseño (la seguridad real es RLS). **Nunca** uses la `service_role` key en el frontend.

## Catálogo: fotos de productos
1. En Supabase → Storage, crea un bucket **público** (ej. `products`).
2. Sube las imágenes y copia su URL pública.
3. En la tabla `products`, columna `images` (array), pega las URLs en orden.
   Convención para variantes por color: primero las fotos del color 1, luego las del color 2.

## Pedidos (checkout + correo)
El checkout inserta el pedido y envía la confirmación de forma segura en el servidor:
1. **SQL** — aplica las migraciones de `supabase/migrations/` (tablas `orders` / `order_items`, función `create_order`, RLS, contactos de marketing y campos de comprobante). Recomendado: `npx supabase db push`.
2. **Edge Function** — `supabase functions deploy create-order`
3. **Secrets** (servidor):
   ```bash
   supabase secrets set RESEND_API_KEY=re_xxx
   supabase secrets set RESEND_FROM="Hebennus <pedidos@tudominio.com>"   # dominio verificado en Resend
   supabase secrets set STORE_EMAIL=tucorreo@ejemplo.com                  # opcional (copia a la tienda)
   ```
   `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase automáticamente.

## Pasarela de pago (Izipay — Web Core, opcional)
Si defines `VITE_IZIPAY_MERCHANT_CODE` + `VITE_IZIPAY_PUBLIC_KEY`, el checkout muestra el
formulario de pago embebido de Izipay; el pedido se registra **tras** el pago exitoso.
1. **Edge Function** — `supabase functions deploy izipay-token`
2. **Secrets** (servidor):
   ```bash
   supabase secrets set IZIPAY_MERCHANT_CODE=...   # mismo del frontend
   supabase secrets set IZIPAY_PUBLIC_KEY=...       # mismo del frontend
   # IZIPAY_API_URL es opcional (por defecto el sandbox).
   ```
3. ⚠️ **Verifica contra el panel/Postman de tu cuenta Izipay**: el contrato exacto de
   `generate_token` (en `supabase/functions/izipay-token/index.ts`), los campos requeridos de
   `billing` (p. ej. DNI real), el `código` de éxito del callback y la validación de firma (IPN)
   en `onPagoRespuesta` (en `CheckoutPage.vue`). El scaffold sigue el flujo documentado.

## Deploy (frontend)
1. Sube el repo a GitHub y conéctalo en Vercel o Netlify.
2. Configura las variables `VITE_*` en el panel del hosting.
3. Build command: `npm run build` · Output: `dist/`
4. Usa **history mode** (URLs limpias). El `vercel.json` incluye la regla de reescritura SPA (todas las rutas → `index.html`) para que recargar `/admin`, `/coleccion`, etc. no dé 404.

## Estructura
```
src/
  pages/        -> Home, Colección, Producto, Lanzamientos, Nosotros, Checkout, 404
  components/   -> Nav, Footer, CartDrawer, ProductCard, QuickBuyModal, etc.
  lib/          -> supabase.js, config.js, order.js, izipay.js, prendas.js, useTheme.js
  style.css     -> sistema de diseño (tokens, tema claro/oscuro)
supabase/
  functions/create-order/    -> Edge Function (inserta pedido + envía correo)
  functions/izipay-token/    -> Edge Function (token de sesión Izipay, server-side)
  migrations/                -> tablas, función transaccional, RLS, marketing y campos de comprobante
```

> Los métodos de pago aún no están implementados.
