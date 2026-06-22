# Hebennus

Tienda de ropa oversize, atlética y cómoda (Lima, Perú). SPA en **Vue 3 + Vite**, catálogo en **Supabase**, pago **contraentrega** y confirmación de pedido por correo (**Resend** vía Edge Function).

## Stack
- Vue 3 (`<script setup>`) + Vite
- vue-router (hash history)
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
```
La anon key es pública por diseño (la seguridad real es RLS). **Nunca** uses la `service_role` key en el frontend.

## Catálogo: fotos de productos
1. En Supabase → Storage, crea un bucket **público** (ej. `products`).
2. Sube las imágenes y copia su URL pública.
3. En la tabla `products`, columna `images` (array), pega las URLs en orden.
   Convención para variantes por color: primero las fotos del color 1, luego las del color 2.

## Pedidos (checkout + correo)
El checkout inserta el pedido y envía la confirmación de forma segura en el servidor:
1. **SQL** — ejecuta `supabase/migrations/0001_orders.sql` (tablas `orders` / `order_items`, función `create_order`, RLS).
2. **Edge Function** — `supabase functions deploy create-order`
3. **Secrets** (servidor):
   ```bash
   supabase secrets set RESEND_API_KEY=re_xxx
   supabase secrets set RESEND_FROM="Hebennus <pedidos@tudominio.com>"   # dominio verificado en Resend
   supabase secrets set STORE_EMAIL=tucorreo@ejemplo.com                  # opcional (copia a la tienda)
   ```
   `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase automáticamente.

## Deploy (frontend)
1. Sube el repo a GitHub y conéctalo en Vercel o Netlify.
2. Configura las variables `VITE_*` en el panel del hosting.
3. Build command: `npm run build` · Output: `dist/`
4. Usa **hash routing**, así que no necesitas reglas de reescritura para SPA.

## Estructura
```
src/
  pages/        -> Home, Colección, Producto, Lanzamientos, Nosotros, Checkout, 404
  components/   -> Nav, Footer, CartDrawer, ProductCard, QuickBuyModal, etc.
  lib/          -> supabase.js, config.js, order.js, prendas.js, useTheme.js
  style.css     -> sistema de diseño (tokens, tema claro/oscuro)
supabase/
  functions/create-order/   -> Edge Function (inserta pedido + envía correo)
  migrations/0001_orders.sql -> tablas + función transaccional + RLS
```

> Los métodos de pago aún no están implementados (flujo actual: pago contraentrega).
