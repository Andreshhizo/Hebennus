<template>
  <div class="skel">
    <div class="skel__media shine"></div>
    <div class="skel__body">
      <div class="skel__row">
        <div class="skel__line skel__line--name shine"></div>
        <div class="skel__line skel__line--price shine"></div>
      </div>
      <div class="skel__line skel__line--desc shine"></div>
      <div class="skel__line skel__line--btn shine"></div>
    </div>
  </div>
</template>

<style scoped>
@keyframes shimmer {
  0%   { background-position: -600px 0; }
  100% { background-position:  600px 0; }
}
.shine {
  background: linear-gradient(
    90deg,
    var(--surface-2) 25%,
    var(--surface-3) 50%,
    var(--surface-2) 75%
  );
  background-size: 1200px 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}
.skel { display: flex; flex-direction: column; }
.skel__media {
  aspect-ratio: 3 / 4;
  width: 100%;
}
.skel__body {
  padding: 1.1rem 1rem 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.skel__row { display: flex; justify-content: space-between; gap: 0.5rem; }
.skel__line { height: 13px; border-radius: 2px; }
.skel__line--name  { width: 58%; }
.skel__line--price { width: 22%; }
.skel__line--desc  { width: 75%; height: 10px; }
.skel__line--btn   { width: 100%; height: 38px; margin-top: 0.4rem; }
</style>
