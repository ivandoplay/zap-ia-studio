// Profundidade discreta na vitrine; não interfere com o painel e respeita redução de movimento.
(() => {
  const visual = document.getElementById('heroVisual');
  if (!visual || !window.matchMedia('(hover: hover) and (pointer: fine)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const photo = visual.querySelector('.hero-image-shell');
  const message = visual.querySelector('.floating-message');
  const voice = visual.querySelector('.floating-voice');
  let frame = 0;
  visual.addEventListener('pointermove', (event) => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      const rect = visual.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - .5;
      const y = (event.clientY - rect.top) / rect.height - .5;
      photo.style.transform = `rotate(1.6deg) rotateY(${x * 3}deg) rotateX(${-y * 3}deg)`;
      message.style.transform = `translate3d(${x * 8}px, ${y * 8}px, 40px) rotate(-4deg)`;
      voice.style.transform = `translate3d(${-x * 6}px, ${-y * 6}px, 70px) rotate(4deg)`;
      frame = 0;
    });
  }, { passive: true });
  visual.addEventListener('pointerleave', () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    photo.style.transform = '';
    message.style.transform = '';
    voice.style.transform = '';
  });
})();

// Objeto 3D leve, carregado apenas quando aparece; a versão CSS é o fallback.
(() => {
  const stage = document.getElementById('orbitStage');
  const canvas = document.getElementById('orbitCanvas');
  if (!stage || !canvas || matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData || !('IntersectionObserver' in window)) return;
  let renderer, frame = 0, active = false, mounted = false, stopped = false;
  const observer = new IntersectionObserver(async entries => {
    active = entries[0].isIntersecting;
    if (!active && frame) { cancelAnimationFrame(frame); frame = 0; }
    if (!active || stopped) return;
    if (!mounted) {
      mounted = true;
      try {
        const THREE = await import('/vendor/three/three.module.js');
        if (stopped) return;
        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
        renderer.setSize(190, 190, false);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
        camera.position.set(0, 0, 5.1);
        const block = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshStandardMaterial({ color: 0x56a477, roughness: .38, metalness: .08 }));
        block.rotation.set(.35, -.55, -.13); scene.add(block);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x244d34, 2.6));
        const key = new THREE.DirectionalLight(0xffffff, 2.3); key.position.set(-3, 4, 5); scene.add(key);
        function draw(time) {
          frame = 0;
          if (!active || stopped || document.hidden) return;
          block.rotation.y = -.55 + Math.sin(time * .0003) * .2;
          block.rotation.x = .35 + Math.sin(time * .0002) * .08;
          renderer.render(scene, camera);
          frame = requestAnimationFrame(draw);
        }
        stage.classList.add('has-webgl');
        renderer.render(scene, camera);
        stage._scheduleOrbit = () => { if (!frame && active && !stopped && !document.hidden) frame = requestAnimationFrame(draw); };
      } catch { stage.classList.remove('has-webgl'); renderer?.dispose(); return; }
    }
    stage._scheduleOrbit?.();
  }, { threshold: .1 });
  observer.observe(stage);
  document.addEventListener('visibilitychange', () => stage._scheduleOrbit?.());
  window.addEventListener('pagehide', () => { stopped = true; if (frame) cancelAnimationFrame(frame); observer.disconnect(); renderer?.dispose(); stage.classList.remove('has-webgl'); }, { once: true });
})();
