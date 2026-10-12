(() => {
  const photo = document.querySelector('.hero-photo');
  if (!photo) return;

  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let inset = 0;
  let distance = 1;

  function render() {
    frame = 0;
    const progress = motionPreference.matches ? 1 : Math.min(1, Math.max(0, window.scrollY / distance));
    const eased = 1 - Math.pow(1 - progress, 3);
    photo.style.setProperty('--hero-inset', `${inset * eased}px`);
  }

  function schedule() {
    if (!frame) frame = window.requestAnimationFrame(render);
  }

  function measure() {
    const viewport = document.documentElement.clientWidth;
    inset = Math.max(0, (viewport - photo.parentElement.getBoundingClientRect().width) / 2);
    distance = Math.max(1, Math.min(photo.offsetHeight * 0.75, window.innerHeight * 0.55));
    photo.style.setProperty('--hero-viewport', `${viewport}px`);
    schedule();
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', measure, { passive: true });
  window.addEventListener('pageshow', measure);
  motionPreference.addEventListener('change', schedule);
  measure();
})();
