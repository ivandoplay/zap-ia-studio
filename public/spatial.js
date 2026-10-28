// O conteúdo e a esfera CSS continuam visíveis caso WebGL ou a biblioteca falhem.
const stage = document.getElementById('spatialStage');
const canvas = document.getElementById('spatialCanvas');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
async function mountScene() {
  if (!stage || !canvas || reduce.matches || navigator.connection?.saveData) return;
  let renderer, observer, frame = 0, visible = true, stopped = false;
  try {
    const THREE = await import('/vendor/three/three.module.js');
    renderer = new THREE.WebGLRenderer({canvas, alpha:true, antialias:true, powerPreference:'low-power'});
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, .1, 100);
    camera.position.set(0, 0, 9.5);
    const group = new THREE.Group(); scene.add(group);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.72, 48, 32), new THREE.MeshStandardMaterial({color:0x497e5b, roughness:.34, metalness:.42}));
    group.add(sphere);
    const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.745, 3), new THREE.MeshBasicMaterial({color:0xb2dfbc, wireframe:true, transparent:true, opacity:.075}));
    group.add(wire);
    const ringGeo = new THREE.TorusGeometry(2.35,.012,8,120);
    const ringMat = new THREE.MeshBasicMaterial({color:0xa8d9b1, transparent:true, opacity:.45});
    const ring1 = new THREE.Mesh(ringGeo,ringMat); ring1.rotation.set(1.12,.34,.2); group.add(ring1);
    const ring2 = new THREE.Mesh(ringGeo,ringMat); ring2.rotation.set(.9,-.8,-.6); group.add(ring2);
    const beadGeo = new THREE.SphereGeometry(.07, 12, 8);
    const beadMat = new THREE.MeshStandardMaterial({color:0xc3f3ca, emissive:0x406747, emissiveIntensity:.6, roughness:.3});
    for (const [x,y,z] of [[2.12,.8,.4],[-1.92,-.65,.6],[.9,1.65,-.9]]) {const bead=new THREE.Mesh(beadGeo,beadMat);bead.position.set(x,y,z);group.add(bead)}
    scene.add(new THREE.HemisphereLight(0xd1f7d6,0x12271b,2));
    const key = new THREE.DirectionalLight(0xf4fff0,2.8);key.position.set(-3,4,5);scene.add(key);
    const rim = new THREE.DirectionalLight(0x74ce87,2);rim.position.set(4,-1,-3);scene.add(rim);
    function resize(){const w=stage.clientWidth,h=stage.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
    function draw(t){frame=0;if(stopped||!visible||document.hidden)return;group.rotation.y=Math.sin(t*.00022)*.13;wire.rotation.y=t*.00004;ring1.rotation.z=.2+t*.00008;ring2.rotation.z=-.6-t*.00006;renderer.render(scene,camera);frame=requestAnimationFrame(draw)}
    function schedule(){if(!frame&&!stopped&&visible&&!document.hidden)frame=requestAnimationFrame(draw)}
    const resizeObserver = new ResizeObserver(resize);resizeObserver.observe(stage);resize();
    observer = new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(!visible&&frame){cancelAnimationFrame(frame);frame=0}else schedule()},{threshold:.01});observer.observe(stage);
    document.addEventListener('visibilitychange',schedule);
    canvas.addEventListener('webglcontextlost',()=>{stopped=true;stage.classList.remove('has-webgl')});
    window.addEventListener('pagehide',()=>{stopped=true;cancelAnimationFrame(frame);resizeObserver.disconnect();observer.disconnect();renderer.dispose()},{once:true});
    renderer.render(scene,camera);stage.classList.add('has-webgl');schedule();
  } catch (error) { stage.classList.remove('has-webgl'); if(renderer)renderer.dispose();if(observer)observer.disconnect(); }
}
if ('requestIdleCallback' in window) requestIdleCallback(mountScene,{timeout:2000});else setTimeout(mountScene,100);
