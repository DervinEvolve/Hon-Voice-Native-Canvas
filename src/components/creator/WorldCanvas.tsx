import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { LumaSplatsThree } from '@lumaai/luma-web';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import { useComicStore } from '../../store/useComicStore';
import { Panel } from '../../types';

interface WorldCanvasProps {
  comic: any;
  currentPageIndex: number;
  onClose: () => void;
}

export const WorldCanvas: React.FC<WorldCanvasProps> = ({ comic, currentPageIndex, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { worldSettings } = useComicStore();
  const [isLoaded, setIsLoaded] = useState(false);
  
  // Panels on the current page
  const panels = useMemo(() => {
    return comic?.pages[currentPageIndex] || [];
  }, [comic, currentPageIndex]);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || !worldSettings.splatUrl) return;

    // Scene Setup
    const scene = new THREE.Scene();
    // Add some fog for depth
    scene.fog = new THREE.FogExp2(0x000000, 0.03);
    scene.background = new THREE.Color(0x000000);

    // Camera
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 4); // Eye level

    // Renderer
    const renderer = new THREE.WebGLRenderer({ 
      canvas: canvasRef.current,
      antialias: true,
      alpha: false 
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Controls
    const controls = new PointerLockControls(camera, containerRef.current);
    
    // Click to lock
    const onClick = () => {
      controls.lock();
    };
    containerRef.current.addEventListener('click', onClick);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1);
    scene.add(ambientLight);

    // Luma Splats
    const splats = new LumaSplatsThree({
      source: worldSettings.splatUrl,
      loadingAnimationEnabled: true,
      onLoad: () => {
        // Fade in nicely
        setIsLoaded(true);
      }
    });
    scene.add(splats);

    // Panels as Billboards
    const textureLoader = new THREE.TextureLoader();
    const panelMeshes: THREE.Mesh[] = [];

    panels.forEach((panel: Panel, index: number) => {
      if (!panel.url || (panel.type !== 'image' && panel.type !== 'video')) return;

      // Create texture
      // Note: CORS might be an issue for some images; ensuring crossOrigin is set
      const texture = textureLoader.load(panel.url);
      texture.colorSpace = THREE.SRGBColorSpace;

      const aspect = panel.aspectRatio || 1;
      const width = 1.5; // World units
      const height = width / aspect;

      const geometry = new THREE.PlaneGeometry(width, height);
      const material = new THREE.MeshBasicMaterial({ 
        map: texture,
        side: THREE.DoubleSide,
        transparent: true
      });
      
      const mesh = new THREE.Mesh(geometry, material);
      
      // Position panels in a circle around origin or scattered
      const angle = (index / panels.length) * Math.PI * 2;
      const radius = 3;
      mesh.position.set(
        Math.sin(angle) * radius,
        1.6, // Eye level
        Math.cos(angle) * radius
      );
      
      // Look at center (where user starts usually, or look at camera)
      mesh.lookAt(0, 1.6, 0);
      
      scene.add(mesh);
      panelMeshes.push(mesh);
    });

    // Animation Loop
    let animationId: number;
    const clock = new THREE.Clock();

    // Movement variables
    const velocity = new THREE.Vector3();
    const direction = new THREE.Vector3();
    let moveForward = false;
    let moveBackward = false;
    let moveLeft = false;
    let moveRight = false;

    // Key handlers
    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
          moveForward = true;
          break;
        case 'ArrowLeft':
        case 'KeyA':
          moveLeft = true;
          break;
        case 'ArrowDown':
        case 'KeyS':
          moveBackward = true;
          break;
        case 'ArrowRight':
        case 'KeyD':
          moveRight = true;
          break;
        case 'Escape':
          // Handled by PointerLock automatically
          break;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
          moveForward = false;
          break;
        case 'ArrowLeft':
        case 'KeyA':
          moveLeft = false;
          break;
        case 'ArrowDown':
        case 'KeyS':
          moveBackward = false;
          break;
        case 'ArrowRight':
        case 'KeyD':
          moveRight = false;
          break;
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    const animate = () => {
      animationId = requestAnimationFrame(animate);

      const delta = clock.getDelta();

      if (controls.isLocked) {
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize(); // this ensures consistent movements in all directions

        if (moveForward || moveBackward) velocity.z -= direction.z * 40.0 * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * 40.0 * delta;

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);
      }

      // Subtle float for panels
      const time = clock.getElapsedTime();
      panelMeshes.forEach((mesh, i) => {
        mesh.position.y = 1.6 + Math.sin(time + i) * 0.1;
      });

      renderer.render(scene, camera);
    };

    animate();
    setIsLoaded(true);

    // Resize handler
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      containerRef.current?.removeEventListener('click', onClick);
      
      // Unlock pointer if locked
      if (document.pointerLockElement === containerRef.current) {
        document.exitPointerLock();
      }
      
      controls.dispose();
      renderer.dispose();
      splats.dispose();
      // Clean geometry/materials
      panelMeshes.forEach(mesh => {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
    };
  }, [worldSettings.splatUrl, panels]);

  if (!worldSettings.splatUrl) return null;

  return (
    <div ref={containerRef} className="w-full h-full relative bg-black overflow-hidden">
      <canvas 
        ref={canvasRef} 
        className={`block w-full h-full relative z-10 transition-opacity duration-1000 ${isLoaded ? 'opacity-100' : 'opacity-0'}`} 
      />
      
      {/* Overlay Instructions */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-none text-white/50 text-xs bg-black/20 px-4 py-2 rounded-full backdrop-blur-md z-20">
        Click to look around • WASD to move • ESC to release cursor
      </div>
    </div>
  );
};
